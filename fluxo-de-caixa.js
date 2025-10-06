import { getFirestore, collection, query, where, getDocs, doc, getDoc, addDoc, serverTimestamp, runTransaction, updateDoc, collectionGroup } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// This function will be called from the main script when the user is authenticated.
export function initializeFluxoDeCaixa(db, userId, common) {
    const fluxoDeCaixaPage = document.getElementById('fluxo-de-caixa-page');
    if (!fluxoDeCaixaPage) return;

    // --- DOM Elements ---
    // Filters
    const periodoDeInput = document.getElementById('fluxo-periodo-de');
    const periodoAteInput = document.getElementById('fluxo-periodo-ate');
    const contaBancariaSelect = document.getElementById('fluxo-conta-bancaria');
    const conciliacaoFilterGroup = document.getElementById('fluxo-conciliacao-filter-group');

    // KPIs
    const kpiSaldoAnterior = document.getElementById('kpi-saldo-anterior');
    const kpiTotalEntradas = document.getElementById('kpi-total-entradas');
    const kpiTotalSaidas = document.getElementById('kpi-total-saidas');
    const kpiResultadoLiquido = document.getElementById('kpi-resultado-liquido');
    const kpiSaldoFinal = document.getElementById('kpi-saldo-final');

    // Tables & Content
    const extratoTableBody = document.getElementById('fluxo-extrato-table-body');
    const dreTableBody = document.getElementById('fluxo-dre-table-body');

    // Modals & Buttons
    const lancarTransferenciaBtn = document.getElementById('lancar-transferencia-btn');
    const transferenciaModal = document.getElementById('transferencia-modal');
    const closeTransferenciaModalBtn = document.getElementById('close-transferencia-modal-btn');
    const cancelTransferenciaModalBtn = document.getElementById('cancel-transferencia-modal-btn');
    const transferenciaForm = document.getElementById('transferencia-form');

    // --- State ---
    let allContasBancarias = [];
    let activeConciliacaoFilter = 'todas';
    const visaoRealizadoCheckbox = document.getElementById('visao-realizado-checkbox');
    const visaoProjetadoCheckbox = document.getElementById('visao-projetado-checkbox');

    // --- Utility Functions (from common) ---
    const { formatCurrency, toCents, fromCents, showFeedback } = common;

    // --- Main Logic ---
    async function fetchTransactionsEfficiently(parentCollectionName, subcollectionName, startDate, endDate, inclusive = true) {
        // This approach is more efficient as it pre-filters parent documents by a relevant date field.
        // This reduces the number of subcollection queries needed.
        const parentDateFilterField = parentCollectionName === 'despesas' ? 'vencimento' : 'dataVencimento';

        // Create a broader query on the parent collection.
        // We fetch parents from a wider date range to catch transactions that might have been paid/received
        // outside their due date but still fall within our cash flow period.
        let parentQuery = collection(db, `users/${userId}/${parentCollectionName}`);

        // The query for subcollections will be precise, so the parent query can be broader.
        // This is a balance between performance and correctness.
        // For simplicity in this fix, we'll still fetch all parents, but the sub-query will be precise.
        // A more advanced optimization could pre-filter parents by date.

        const parentDocsSnapshot = await getDocs(parentQuery);

        const promises = parentDocsSnapshot.docs.map(parentDoc => {
            let subcollectionQuery = collection(parentDoc.ref, subcollectionName);

            // Apply the precise date filtering at the subcollection level.
            if (startDate) {
                 subcollectionQuery = query(subcollectionQuery, where('dataTransacao', inclusive ? '>=' : '<', startDate));
            }
            if (endDate) {
                 subcollectionQuery = query(subcollectionQuery, where('dataTransacao', inclusive ? '<=' : '<', endDate));
            }

            return getDocs(subcollectionQuery);
        });

        const querySnapshots = await Promise.all(promises);
        return querySnapshots.flatMap(snapshot => snapshot.docs);
    }

    async function fetchProjectedTransactions(startDate, endDate) {
        const unifiedProjected = [];
        const planoContasMap = new Map();
        const planoContasSnap = await getDocs(collection(db, `users/${userId}/planosDeContas`));
        planoContasSnap.forEach(doc => planoContasMap.set(doc.id, doc.data()));

        // Fetch ALL pending expenses and filter in code to avoid composite indexes
        const despesasQuery = collection(db, `users/${userId}/despesas`);
        const despesasSnap = await getDocs(despesasQuery);
        despesasSnap.forEach(doc => {
            const despesaData = doc.data();
            const status = despesaData.status || 'Pendente';
            // Manual filtering
            if (['Pendente', 'Vencido', 'Pago Parcialmente'].includes(status) && despesaData.vencimento >= startDate && despesaData.vencimento <= endDate) {
                const categoria = planoContasMap.get(despesaData.categoriaId);
                unifiedProjected.push({
                    id: doc.id,
                    isProjected: true,
                    data: despesaData.vencimento,
                    descricao: `(Projetado) ${despesaData.descricao}`,
                    participante: despesaData.favorecidoNome || 'N/A',
                    planoDeConta: categoria ? categoria.nome : 'N/A',
                    dataVencimento: despesaData.vencimento,
                    entrada: 0,
                    saida: despesaData.valorSaldo || despesaData.valorOriginal,
                    juros: 0,
                    desconto: 0,
                    conciliado: false,
                    type: 'despesa_projetada'
                });
            }
        });

        // Fetch ALL pending revenues and filter in code
        const receitasQuery = collection(db, `users/${userId}/receitas`);
        const receitasSnap = await getDocs(receitasQuery);
        receitasSnap.forEach(doc => {
            const receitaData = doc.data();
            const status = receitaData.status || 'Pendente';
            const dataVencimento = receitaData.dataVencimento || receitaData.vencimento;
            // Manual filtering
            if (['Pendente', 'Vencido', 'Recebido Parcialmente'].includes(status) && dataVencimento >= startDate && dataVencimento <= endDate) {
                const categoria = planoContasMap.get(receitaData.categoriaId);
                unifiedProjected.push({
                    id: doc.id,
                    isProjected: true,
                    data: dataVencimento,
                    descricao: `(Projetado) ${receitaData.descricao}`,
                    participante: receitaData.clienteNome || 'N/A',
                    planoDeConta: categoria ? categoria.nome : 'N/A',
                    dataVencimento: dataVencimento,
                    entrada: receitaData.saldoPendente || receitaData.valorOriginal,
                    saida: 0,
                    juros: 0,
                    desconto: 0,
                    conciliado: false,
                    type: 'receita_projetada'
                });
            }
        });

        return unifiedProjected;
    }

    async function calculateAndRenderCashFlow() {
        const startDate = periodoDeInput.value;
        const endDate = periodoAteInput.value;
        const contaId = contaBancariaSelect.value;
        const showRealizado = visaoRealizadoCheckbox.checked;
        const showProjetado = visaoProjetadoCheckbox.checked;

        if (!startDate || !endDate) {
            extratoTableBody.innerHTML = `<tr><td colspan="12" class="text-center p-8 text-gray-500">Por favor, selecione um período para começar.</td></tr>`;
            return;
        }
        if (!showRealizado && !showProjetado) {
            extratoTableBody.innerHTML = `<tr><td colspan="12" class="text-center p-8 text-gray-500">Selecione uma visão (Realizado e/ou Projetado).</td></tr>`;
            renderKPIs({ saldoAnterior: 0, totalEntradas: 0, totalSaidas: 0, resultadoLiquido: 0, saldoFinal: 0 });
            renderCharts([]);
            renderDRE([]);
            return;
        }

        extratoTableBody.innerHTML = `<tr><td colspan="12" class="text-center p-8 text-gray-500">Carregando dados...</td></tr>`;

        try {
            const saldoAnterior = await calculateSaldoAnterior(startDate, contaId);
            let unifiedTransactions = [];

            if (showRealizado) {
                const [pagamentos, recebimentos, transferencias] = await Promise.all([
                    fetchTransactionsEfficiently('despesas', 'pagamentos', startDate, endDate),
                    fetchTransactionsEfficiently('receitas', 'recebimentos', startDate, endDate),
                    fetchCollection('transferencias', startDate, endDate)
                ]);
                const realizedTransactions = await enrichAndUnifyTransactions(pagamentos, recebimentos, transferencias);
                unifiedTransactions.push(...realizedTransactions);
            }

            if (showProjetado) {
                const projectedTransactions = await fetchProjectedTransactions(startDate, endDate);
                unifiedTransactions.push(...projectedTransactions);
            }

            unifiedTransactions.sort((a, b) => new Date(a.data) - new Date(b.data));

            // 4. Apply Filters
            unifiedTransactions = applyFilters(unifiedTransactions, contaId, activeConciliacaoFilter);

            // 5. Calculate KPIs
            const kpis = calculateKPIs(saldoAnterior, unifiedTransactions, contaId);

            // 6. Render UI
            renderKPIs(kpis);
            renderExtrato(unifiedTransactions, kpis.saldoAnterior);
            renderDRE(unifiedTransactions);
            renderCharts(unifiedTransactions, kpis.saldoAnterior, startDate, endDate);

        } catch (error) {
            console.error("Error calculating cash flow:", error);
            extratoTableBody.innerHTML = `<tr><td colspan="12" class="text-center p-8 text-red-500">Ocorreu um erro ao carregar os dados. Verifique o console para mais detalhes.</td></tr>`;
        }
    }

    async function calculateSaldoAnterior(startDate, contaId) {
        // 1. Fetch and sum initial balances based on the selected account
        let saldoInicial = 0;
        const contasBancariasQuery = query(collection(db, `users/${userId}/contasBancarias`));
        const contasBancariasSnap = await getDocs(contasBancariasQuery);

        if (contaId === 'todas') {
            contasBancariasSnap.forEach(doc => {
                saldoInicial += doc.data().saldoInicial || 0;
            });
        } else {
            const contaDocSnap = contasBancariasSnap.docs.find(doc => doc.id === contaId);
            if (contaDocSnap && contaDocSnap.exists()) {
                saldoInicial = contaDocSnap.data().saldoInicial || 0;
            }
        }

        // 2. Calculate the sum of transactions before the start date
        let saldoTransacoes = 0;
        const [pagamentos, recebimentos, transferencias] = await Promise.all([
            fetchTransactionsEfficiently('despesas', 'pagamentos', null, startDate, false),
            fetchTransactionsEfficiently('receitas', 'recebimentos', null, startDate, false),
            fetchCollection('transferencias', null, startDate, false)
        ]);

        const allTransactions = await enrichAndUnifyTransactions(pagamentos, recebimentos, transferencias);
        const filteredTransactions = applyFilters(allTransactions, contaId, 'todas'); // Conciliation status doesn't matter for historical balance

        filteredTransactions.forEach(t => {
            saldoTransacoes += (t.entrada || 0) - (t.saida || 0);
        });

        // 3. Return the total previous balance
        return saldoInicial + saldoTransacoes;
    }

    async function fetchCollection(collName, startDate, endDate, inclusive = true) {
        let q = query(collection(db, `users/${userId}/${collName}`));
         if (startDate) {
            q = query(q, where('dataTransacao', inclusive ? '>=' : '<', startDate));
        }
        if (endDate) {
            q = query(q, where('dataTransacao', inclusive ? '<=' : '<', endDate));
        }
        const snapshot = await getDocs(q);
        return snapshot.docs;
    }

    async function enrichAndUnifyTransactions(pagamentos, recebimentos, transferencias) {
        const unified = [];
        const planoContasMap = new Map();
        const planoContasSnap = await getDocs(collection(db, `users/${userId}/planosDeContas`));
        planoContasSnap.forEach(doc => {
            planoContasMap.set(doc.id, doc.data());
        });

        for (const doc of pagamentos) {
            const data = doc.data();
            const parentDespesaRef = doc.ref.parent.parent;
            if (parentDespesaRef) {
                const despesaSnap = await getDoc(parentDespesaRef);
                if (despesaSnap.exists()) {
                    const despesaData = despesaSnap.data();
                    const categoria = planoContasMap.get(despesaData.categoriaId);
                    unified.push({
                        id: doc.id,
                        parentId: parentDespesaRef.id,
                        data: data.dataTransacao,
                        descricao: despesaData.descricao,
                        participante: despesaData.favorecidoNome || 'N/A',
                        planoDeConta: categoria ? categoria.nome : 'N/A',
                        dataVencimento: despesaData.vencimento,
                        tipoAtividade: categoria ? categoria.tipoDeAtividade : 'Operacional',
                        entrada: 0,
                        saida: data.valorPrincipal || 0,
                        juros: data.jurosPagos || 0,
                        desconto: data.descontosAplicados || 0,
                        contaId: data.contaSaidaId,
                        conciliado: data.conciliado || false,
                        type: 'pagamento'
                    });
                }
            }
        }

        for (const doc of recebimentos) {
            const data = doc.data();
            const parentReceitaRef = doc.ref.parent.parent;
             if (parentReceitaRef) {
                const receitaSnap = await getDoc(parentReceitaRef);
                 if (receitaSnap.exists()) {
                    const receitaData = receitaSnap.data();
                    const categoria = planoContasMap.get(receitaData.categoriaId);
                    unified.push({
                        id: doc.id,
                        parentId: parentReceitaRef.id,
                        data: data.dataTransacao,
                        descricao: receitaData.descricao,
                        participante: receitaData.clienteNome || 'N/A',
                        planoDeConta: categoria ? categoria.nome : 'N/A',
                        dataVencimento: receitaData.dataVencimento,
                        tipoAtividade: categoria ? categoria.tipoDeAtividade : 'Operacional',
                        entrada: data.valorPrincipal || 0,
                        saida: 0,
                        juros: data.jurosRecebidos || 0,
                        desconto: data.descontosConcedidos || 0,
                        contaId: data.contaEntradaId,
                        conciliado: data.conciliado || false,
                        type: 'recebimento'
                    });
                }
            }
        }

        for (const doc of transferencias) {
            const data = doc.data();
            unified.push({
                id: doc.id,
                data: data.dataTransacao,
                descricao: `Transferência de ${data.contaOrigemNome} para ${data.contaDestinoNome}`,
                participante: 'Interno',
                planoDeConta: 'Transferência',
                dataVencimento: data.dataTransacao, // Vencimento é a própria data
                tipoAtividade: 'N/A',
                valor: data.valor, // Valor único para ser tratado na renderização
                juros: 0,
                desconto: 0,
                contaOrigemId: data.contaOrigemId,
                contaDestinoId: data.contaDestinoId,
                conciliado: data.conciliado || false,
                type: 'transferencia'
            });
        }

        return unified.sort((a, b) => new Date(a.data) - new Date(b.data));
    }

    function applyFilters(transactions, contaId, conciliacaoStatus) {
        return transactions.filter(t => {
            // Filter by Bank Account
            let contaMatch = true;
            if (contaId !== 'todas') {
                if (t.type === 'transferencia') {
                    contaMatch = t.contaOrigemId === contaId || t.contaDestinoId === contaId;
                } else {
                    contaMatch = t.contaId === contaId;
                }
            }
            if (!contaMatch) return false;

            // Filter by Conciliation Status
            let conciliacaoMatch = true;
            if (conciliacaoStatus !== 'todas') {
                const expectedStatus = conciliacaoStatus === 'conciliadas';
                conciliacaoMatch = t.conciliado === expectedStatus;
            }
            return conciliacaoMatch;
        });
    }

    function calculateKPIs(saldoAnterior, transactions, contaId) {
        let totalEntradas = 0;
        let totalSaidas = 0;

        transactions.forEach(t => {
            if (t.type === 'transferencia') {
                // Only count in KPIs if a specific account is selected
                if (contaId !== 'todas') {
                    if (t.contaDestinoId === contaId) totalEntradas += t.valor;
                    if (t.contaOrigemId === contaId) totalSaidas += t.valor;
                }
            } else {
                totalEntradas += t.entrada || 0;
                totalSaidas += t.saida || 0;
            }
        });

        const resultadoLiquido = totalEntradas - totalSaidas;
        const saldoFinal = saldoAnterior + resultadoLiquido;

        return { saldoAnterior, totalEntradas, totalSaidas, resultadoLiquido, saldoFinal };
    }

    function renderKPIs(kpis) {
        kpiSaldoAnterior.textContent = formatCurrency(kpis.saldoAnterior);
        kpiTotalEntradas.textContent = formatCurrency(kpis.totalEntradas);
        kpiTotalSaidas.textContent = formatCurrency(kpis.totalSaidas);
        kpiResultadoLiquido.textContent = formatCurrency(kpis.resultadoLiquido);
        kpiSaldoFinal.textContent = formatCurrency(kpis.saldoFinal);

        kpiResultadoLiquido.classList.toggle('text-red-700', kpis.resultadoLiquido < 0);
        kpiResultadoLiquido.classList.toggle('text-green-700', kpis.resultadoLiquido >= 0);
    }

    function renderExtrato(transactions, saldoInicial) {
        extratoTableBody.innerHTML = '';
        if (transactions.length === 0) {
            extratoTableBody.innerHTML = `<tr><td colspan="12" class="text-center p-8 text-gray-500">Nenhuma transação encontrada para os filtros selecionados.</td></tr>`;
            return;
        }

        const showRealizado = visaoRealizadoCheckbox.checked;
        const showProjetado = visaoProjetadoCheckbox.checked;
        const showBoth = showRealizado && showProjetado;

        let saldoAcumulado = saldoInicial;
        const contaFiltrada = contaBancariaSelect.value;

        transactions.forEach(t => {
            const tr = document.createElement('tr');
            let entrada = t.entrada || 0;
            let saida = t.saida || 0;

            if (t.type === 'transferencia') {
                if (contaFiltrada === 'todas') return;
                if (t.contaDestinoId === contaFiltrada) entrada = t.valor;
                else if (t.contaOrigemId === contaFiltrada) saida = t.valor;
                else return;
            }

            saldoAcumulado += (entrada - saida);

            const rowClass = showBoth && t.isProjected ? 'bg-yellow-50' : (t.conciliado ? 'bg-green-50' : 'bg-white');
            tr.className = rowClass;

            tr.innerHTML = `
                <td class="p-4"><input type="checkbox" class="fluxo-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded" data-id="${t.id}" data-parent-id="${t.parentId}" data-type="${t.type}" ${t.conciliado ? 'checked' : ''} ${t.isProjected ? 'disabled' : ''}></td>
                <td class="px-4 py-2 text-sm text-gray-700">${new Date(t.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                <td class="px-4 py-2 text-sm text-gray-800">${t.descricao}</td>
                <td class="px-4 py-2 text-sm text-gray-600">${t.participante}</td>
                <td class="px-4 py-2 text-sm text-gray-600">${t.planoDeConta}</td>
                <td class="px-4 py-2 text-sm text-gray-600">${new Date(t.dataVencimento + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                <td class="px-4 py-2 text-sm text-right ${t.isProjected ? 'text-blue-500' : 'text-green-600'}">${entrada > 0 ? formatCurrency(entrada) : ''}</td>
                <td class="px-4 py-2 text-sm text-right ${t.isProjected ? 'text-blue-500' : 'text-red-600'}">${saida > 0 ? formatCurrency(saida) : ''}</td>
                <td class="px-4 py-2 text-sm text-right text-orange-600">${t.juros > 0 ? formatCurrency(t.juros) : ''}</td>
                <td class="px-4 py-2 text-sm text-right text-yellow-600">${t.desconto > 0 ? formatCurrency(t.desconto) : ''}</td>
                <td class="px-4 py-2 text-sm text-right font-medium">${formatCurrency(saldoAcumulado)}</td>
            `;
            extratoTableBody.appendChild(tr);
        });
    }

    function renderDRE(transactions) {
        dreTableBody.innerHTML = '';
        if (transactions.length === 0) {
            dreTableBody.innerHTML = `<tr><td colspan="3" class="text-center p-8 text-gray-500">Nenhuma transação encontrada para gerar o DRE.</td></tr>`;
            return;
        }
        const dreData = {
            Operacional: { entradas: 0, saidas: 0, details: {} },
            Investimento: { entradas: 0, saidas: 0, details: {} },
            Financiamento: { entradas: 0, saidas: 0, details: {} },
        };
        let totalEntradasGeral = 0;
        let totalSaidasGeral = 0;

        transactions.forEach(t => {
            if (t.type === 'transferencia') return;

            const atividade = t.tipoAtividade || 'Operacional';
            const categoria = t.categoria || 'Sem Categoria';

            if (!dreData[atividade]) dreData[atividade] = { entradas: 0, saidas: 0, details: {} };
            if (!dreData[atividade].details[categoria]) dreData[atividade].details[categoria] = 0;

            const valorEntrada = t.entrada || 0;
            const valorSaida = t.saida || 0;

            dreData[atividade].details[categoria] += (valorEntrada - valorSaida);
            dreData[atividade].entradas += valorEntrada;
            dreData[atividade].saidas += valorSaida;
            totalEntradasGeral += valorEntrada;
            totalSaidasGeral += valorSaida;
        });

        function createRow(text, value, isHeader = false, isSubHeader = false, isTotal = false, isSubTotal = false, percentageOf = null) {
            const tr = document.createElement('tr');
            let percentageHTML = '';
            if (percentageOf !== null && percentageOf !== 0) {
                const perc = (Math.abs(value) / Math.abs(percentageOf)) * 100;
                percentageHTML = `<td class="px-6 py-3 text-sm text-right text-gray-500">${perc.toFixed(2)}%</td>`;
            } else {
                percentageHTML = `<td class="px-6 py-3"></td>`;
            }

            tr.innerHTML = `
                <td class="px-6 py-3 text-sm ${isHeader ? 'font-bold text-gray-800' : (isSubHeader || isSubTotal ? 'font-semibold pl-10' : 'pl-14')}">${text}</td>
                <td class="px-6 py-3 text-sm text-right font-medium ${value < 0 ? 'text-red-600' : 'text-gray-800'}">${formatCurrency(value)}</td>
                ${percentageHTML}
            `;
            if (isSubTotal) tr.classList.add('bg-gray-50');
            return tr;
        }

        Object.keys(dreData).forEach(atividade => {
            const data = dreData[atividade];
            const fluxoCaixaAtividade = data.entradas - data.saidas;
            dreTableBody.appendChild(createRow(`Fluxo de Caixa das Atividades de ${atividade}`, fluxoCaixaAtividade, true));

            Object.keys(data.details).sort().forEach(categoria => {
                const valorCategoria = data.details[categoria];
                 if(valorCategoria > 0) {
                    dreTableBody.appendChild(createRow(categoria, valorCategoria, false, false, false, false, totalEntradasGeral));
                 } else {
                    dreTableBody.appendChild(createRow(categoria, valorCategoria, false, false, false, false, totalSaidasGeral));
                 }
            });
            dreTableBody.appendChild(createRow(`(=) Saldo das Atividades de ${atividade}`, fluxoCaixaAtividade, false, false, false, true));
        });

         const geracaoLiquida = Object.values(dreData).reduce((acc, curr) => acc + (curr.entradas - curr.saidas), 0);
         dreTableBody.appendChild(createRow('(=) GERAÇÃO LÍQUIDA DE CAIXA', geracaoLiquida, false, false, true, true));
    }

    // --- Chart Rendering ---
    let chartInstances = {};

    function destroyAllCharts() {
        Object.values(chartInstances).forEach(chart => {
            if (chart) chart.destroy();
        });
        chartInstances = {};
    }

    function renderCharts(transactions, saldoAnterior, startDateStr, endDateStr) {
        destroyAllCharts();

        const showRealizado = visaoRealizadoCheckbox.checked;
        const showProjetado = visaoProjetadoCheckbox.checked;

        // 1. Receita x Despesa Mensal
        renderReceitaDespesaMensalChart(showRealizado, showProjetado);

        // 2. Acumulado Mensal
        renderCrescimentoAcumuladoChart(showRealizado, showProjetado);

        // 3. Saldo Acumulado (Realizado vs. Projetado)
        renderSaldoAcumuladoChart(saldoAnterior, transactions);

        // 4. Análise de Despesas por Categoria ao Longo do Tempo
        renderDespesasCategoriaTempoChart();

        // 5. Comparativo de Períodos
        renderComparativoPeriodosChart(startDateStr, endDateStr);

        // 6 & 7. Top 5 Receitas e Despesas (no período)
        renderTop5Charts(transactions);
    }

    async function getMonthlyData(months, showRealizado, showProjetado) {
        const monthlyData = {};
        months.forEach(m => {
            monthlyData[m] = { receitas: 0, despesas: 0 };
        });

        // Process Realizado
        if (showRealizado) {
            const pagamentosSnap = await getDocs(collectionGroup(db, 'pagamentos'));
            pagamentosSnap.forEach(doc => {
                if (doc.ref.path.startsWith(`users/${userId}`)) {
                    const data = doc.data();
                    if (data.dataTransacao) { // Defensive check
                        const month = data.dataTransacao.substring(0, 7);
                        if (monthlyData[month]) {
                            monthlyData[month].despesas += data.valorPrincipal || 0;
                        }
                    }
                }
            });

            const recebimentosSnap = await getDocs(collectionGroup(db, 'recebimentos'));
            recebimentosSnap.forEach(doc => {
                if (doc.ref.path.startsWith(`users/${userId}`)) {
                    const data = doc.data();
                    if (data.dataTransacao) { // Defensive check
                        const month = data.dataTransacao.substring(0, 7);
                        if (monthlyData[month]) {
                            monthlyData[month].receitas += data.valorPrincipal || 0;
                        }
                    }
                }
            });
        }

        // Process Projetado
        if (showProjetado) {
            const despesasQuery = query(collection(db, `users/${userId}/despesas`), where('status', 'in', ['Pendente', 'Vencido', 'Pago Parcialmente']));
            const despesasSnap = await getDocs(despesasQuery);
            despesasSnap.forEach(doc => {
                const data = doc.data();
                if (data.vencimento) { // Defensive check
                    const month = data.vencimento.substring(0, 7);
                    if (monthlyData[month]) {
                        monthlyData[month].despesas += data.valorSaldo || 0;
                    }
                }
            });

            const receitasQuery = query(collection(db, `users/${userId}/receitas`), where('status', 'in', ['Pendente', 'Vencido', 'Recebido Parcialmente']));
            const receitasSnap = await getDocs(receitasQuery);
            receitasSnap.forEach(doc => {
                const data = doc.data();
                const vencimento = data.dataVencimento || data.vencimento;
                if (vencimento) { // Defensive check
                    const month = vencimento.substring(0, 7);
                    if (monthlyData[month]) {
                        monthlyData[month].receitas += data.saldoPendente || 0;
                    }
                }
            });
        }

        return monthlyData;
    }

    async function renderReceitaDespesaMensalChart(showRealizado, showProjetado) {
        const ctx = document.getElementById('receita-despesa-mensal-chart')?.getContext('2d');
        if (!ctx) return;
        const today = new Date();
        const months = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            months.push(d.toISOString().substring(0, 7));
        }

        const monthlyData = await getMonthlyData(months, showRealizado, showProjetado);

        chartInstances.receitaDespesa = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: months.map(m => new Date(m + '-02').toLocaleString('pt-BR', { month: 'short', year: '2-digit' })),
                datasets: [{
                    label: 'Receitas',
                    data: months.map(m => (monthlyData[m]?.receitas || 0) / 100),
                    backgroundColor: 'rgba(75, 192, 192, 0.7)',
                }, {
                    label: 'Despesas',
                    data: months.map(m => (monthlyData[m]?.despesas || 0) / 100),
                    backgroundColor: 'rgba(255, 99, 132, 0.7)',
                }]
            },
            options: {
                responsive: true,
                scales: { y: { beginAtZero: true, ticks: { callback: value => formatCurrency(value * 100) } } }
            }
        });
    }

    async function renderCrescimentoAcumuladoChart(showRealizado, showProjetado) {
        const ctx = document.getElementById('crescimento-acumulado-chart')?.getContext('2d');
        if (!ctx) return;
        const today = new Date();
        const months = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            months.push(d.toISOString().substring(0, 7));
        }

        const monthlyData = await getMonthlyData(months, showRealizado, showProjetado);

        let accReceitas = 0;
        let accDespesas = 0;
        const receitasAcumuladas = months.map(m => accReceitas += (monthlyData[m]?.receitas || 0));
        const despesasAcumuladas = months.map(m => accDespesas += (monthlyData[m]?.despesas || 0));

        chartInstances.crescimentoAcumulado = new Chart(ctx, {
            type: 'line',
            data: {
                labels: months.map(m => new Date(m + '-02').toLocaleString('pt-BR', { month: 'short', year: '2-digit' })),
                datasets: [{
                    label: 'Receita Acumulada',
                    data: receitasAcumuladas.map(v => v / 100),
                    borderColor: 'rgba(75, 192, 192, 1)',
                    tension: 0.1,
                    fill: false
                }, {
                    label: 'Despesa Acumulada',
                    data: despesasAcumuladas.map(v => v / 100),
                    borderColor: 'rgba(255, 99, 132, 1)',
                    tension: 0.1,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                scales: { y: { ticks: { callback: value => formatCurrency(value * 100) } } }
            }
        });
    }

    function renderSaldoAcumuladoChart(saldoAnterior, transactions) {
        const ctx = document.getElementById('saldo-acumulado-chart')?.getContext('2d');
        if (!ctx) return;

        const dailySummary = transactions.reduce((acc, t) => {
            const day = t.data;
            if (!acc[day]) {
                acc[day] = { realizado: 0, projetado: 0 };
            }
            const valor = (t.entrada || 0) - (t.saida || 0);
            if (t.isProjected) {
                acc[day].projetado += valor;
            } else {
                acc[day].realizado += valor;
            }
            return acc;
        }, {});

        const sortedDays = Object.keys(dailySummary).sort();
        let saldoRealizado = saldoAnterior;
        let saldoProjetado = saldoAnterior;
        const labels = [];
        const dataRealizadoPoints = [];
        const dataProjetadoPoints = [];

        sortedDays.forEach(day => {
            labels.push(new Date(day + 'T00:00:00').toLocaleDateString('pt-BR'));
            saldoRealizado += dailySummary[day].realizado;
            dataRealizadoPoints.push(saldoRealizado / 100);

            saldoProjetado += dailySummary[day].realizado + dailySummary[day].projetado;
            dataProjetadoPoints.push(saldoProjetado / 100);
        });

        chartInstances.saldoAcumulado = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Saldo Realizado',
                    data: dataRealizadoPoints,
                    borderColor: 'rgba(54, 162, 235, 1)',
                    fill: false,
                }, {
                    label: 'Saldo Projetado',
                    data: dataProjetadoPoints,
                    borderColor: 'rgba(255, 159, 64, 1)',
                    borderDash: [5, 5],
                    fill: false,
                }]
            },
            options: {
                responsive: true,
                scales: { y: { ticks: { callback: value => formatCurrency(value * 100) } } }
            }
        });
    }

    async function renderDespesasCategoriaTempoChart() {
        const ctx = document.getElementById('despesas-por-categoria-tempo-chart')?.getContext('2d');
        if (!ctx) return;
        const today = new Date();
        const months = [];
        for (let i = 5; i >= 0; i--) { // Last 6 months
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            months.push(d.toISOString().substring(0, 7));
        }

        const pagamentosSnap = await getDocs(collectionGroup(db, 'pagamentos'));
        const despesasMap = new Map();
        const despesasSnap = await getDocs(collection(db, `users/${userId}/despesas`));
        despesasSnap.forEach(doc => despesasMap.set(doc.id, doc.data()));

        const planoContasMap = new Map();
        const planoContasSnap = await getDocs(collection(db, `users/${userId}/planosDeContas`));
        planoContasSnap.forEach(doc => planoContasMap.set(doc.id, doc.data()));

        const monthlyCategoryData = {};
        const allCategories = new Set();

        pagamentosSnap.forEach(doc => {
            if (doc.ref.path.startsWith(`users/${userId}`)) {
                const data = doc.data();
                if (data.dataTransacao) {
                    const month = data.dataTransacao.substring(0, 7);
                    if (months.includes(month)) {
                        const despesa = despesasMap.get(doc.ref.parent.parent.id);
                        if (despesa) {
                            const categoriaDoc = planoContasMap.get(despesa.categoriaId);
                            const categoriaNome = categoriaDoc ? categoriaDoc.nome : 'Sem Categoria';
                            allCategories.add(categoriaNome);
                            if (!monthlyCategoryData[month]) monthlyCategoryData[month] = {};
                            if (!monthlyCategoryData[month][categoriaNome]) monthlyCategoryData[month][categoriaNome] = 0;
                            monthlyCategoryData[month][categoriaNome] += data.valorPrincipal || 0;
                        }
                    }
                }
            }
        });

        const datasets = Array.from(allCategories).map((cat, index) => {
            const colors = ['rgba(255, 99, 132, 0.7)', 'rgba(54, 162, 235, 0.7)', 'rgba(255, 206, 86, 0.7)', 'rgba(75, 192, 192, 0.7)', 'rgba(153, 102, 255, 0.7)'];
            return {
                label: cat,
                data: months.map(m => (monthlyCategoryData[m]?.[cat] || 0) / 100),
                backgroundColor: colors[index % colors.length],
            };
        });

        chartInstances.despesasCategoriaTempo = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: months.map(m => new Date(m + '-02').toLocaleString('pt-BR', { month: 'short', year: '2-digit' })),
                datasets: datasets,
            },
            options: {
                responsive: true,
                scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: value => formatCurrency(value * 100) } } }
            }
        });
    }

    async function renderComparativoPeriodosChart(startDateStr, endDateStr) {
        const ctx = document.getElementById('comparativo-periodos-chart')?.getContext('2d');
        if (!ctx) return;

        const start = new Date(startDateStr + 'T00:00:00');
        const end = new Date(endDateStr + 'T00:00:00');
        const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;

        const prevStart = new Date(start.getTime());
        prevStart.setDate(prevStart.getDate() - diffDays);
        const prevEnd = new Date(start.getTime());
        prevEnd.setDate(prevEnd.getDate() - 1);

        const prevStartStr = prevStart.toISOString().split('T')[0];
        const prevEndStr = prevEnd.toISOString().split('T')[0];

        const [currentPagamentos, currentRecebimentos] = await Promise.all([
             getDocs(query(collectionGroup(db, 'pagamentos'), where('dataTransacao', '>=', startDateStr), where('dataTransacao', '<=', endDateStr))),
             getDocs(query(collectionGroup(db, 'recebimentos'), where('dataTransacao', '>=', startDateStr), where('dataTransacao', '<=', endDateStr)))
        ]);
        const [prevPagamentos, prevRecebimentos] = await Promise.all([
             getDocs(query(collectionGroup(db, 'pagamentos'), where('dataTransacao', '>=', prevStartStr), where('dataTransacao', '<=', prevEndStr))),
             getDocs(query(collectionGroup(db, 'recebimentos'), where('dataTransacao', '>=', prevStartStr), where('dataTransacao', '<=', prevEndStr)))
        ]);

        const sum = (snap) => snap.docs.reduce((acc, doc) => doc.ref.path.startsWith(`users/${userId}`) ? acc + (doc.data().valorPrincipal || 0) : acc, 0);

        const currentEntradas = sum(currentRecebimentos);
        const currentSaidas = sum(currentPagamentos);
        const prevEntradas = sum(prevRecebimentos);
        const prevSaidas = sum(prevPagamentos);

        chartInstances.comparativoPeriodos = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Entradas', 'Saídas'],
                datasets: [{
                    label: 'Período Atual',
                    data: [currentEntradas / 100, currentSaidas / 100],
                    backgroundColor: 'rgba(54, 162, 235, 0.7)',
                }, {
                    label: 'Período Anterior',
                    data: [prevEntradas / 100, prevSaidas / 100],
                    backgroundColor: 'rgba(201, 203, 207, 0.7)',
                }]
            },
            options: {
                responsive: true,
                scales: { y: { beginAtZero: true, ticks: { callback: value => formatCurrency(value * 100) } } }
            }
        });
    }

    function renderTop5Charts(transactions) {
        const topDespesasCtx = document.getElementById('top-despesas-chart')?.getContext('2d');
        const topReceitasCtx = document.getElementById('top-receitas-chart')?.getContext('2d');
        if (!topDespesasCtx || !topReceitasCtx) return;

        const despesaData = transactions.filter(t => t.saida > 0 && !t.isProjected).reduce((acc, t) => {
            const categoria = t.planoDeConta || 'Sem Categoria';
            if (!acc[categoria]) acc[categoria] = 0;
            acc[categoria] += t.saida;
            return acc;
        }, {});

        const receitaData = transactions.filter(t => t.entrada > 0 && !t.isProjected).reduce((acc, t) => {
            const categoria = t.planoDeConta || 'Sem Categoria';
            if (!acc[categoria]) acc[categoria] = 0;
            acc[categoria] += t.entrada;
            return acc;
        }, {});

        const sortAndSlice = (data) => Object.entries(data).sort(([, a], [, b]) => b - a).slice(0, 5);

        const top5Despesas = sortAndSlice(despesaData);
        const top5Receitas = sortAndSlice(receitaData);

        const colorsDespesa = ['#FF6384', '#FF9F40', '#FFCD56', '#C9CBCF', '#4BC0C0'];
        const colorsReceita = ['#36A2EB', '#4BC0C0', '#9966FF', '#FFCD56', '#FF9F40'];

        chartInstances.topDespesas = new Chart(topDespesasCtx, {
            type: 'bar',
            data: {
                labels: top5Despesas.map(item => item[0]),
                datasets: [{
                    label: 'Valor',
                    data: top5Despesas.map(item => item[1] / 100),
                    backgroundColor: colorsDespesa,
                }]
            },
            options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: value => formatCurrency(value * 100) } } } }
        });

        chartInstances.topReceitas = new Chart(topReceitasCtx, {
            type: 'bar',
            data: {
                labels: top5Receitas.map(item => item[0]),
                datasets: [{
                    label: 'Valor',
                    data: top5Receitas.map(item => item[1] / 100),
                    backgroundColor: colorsReceita,
                }]
            },
            options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: value => formatCurrency(value * 100) } } } }
        });
    }

    async function populateContasBancarias() {
        const q = query(collection(db, `users/${userId}/contasBancarias`));
        const snapshot = await getDocs(q);
        allContasBancarias = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        contaBancariaSelect.innerHTML = '<option value="todas">Todas as Contas</option>';
        allContasBancarias.forEach(conta => {
            const option = document.createElement('option');
            option.value = conta.id;
            option.textContent = conta.nome;
            contaBancariaSelect.appendChild(option);
        });

        // Also populate transfer modal dropdowns
        const origemSelect = document.getElementById('transferencia-conta-origem');
        const destinoSelect = document.getElementById('transferencia-conta-destino');
        origemSelect.innerHTML = '<option value="">Selecione a conta de origem</option>';
        destinoSelect.innerHTML = '<option value="">Selecione a conta de destino</option>';
         allContasBancarias.forEach(conta => {
            const opt1 = document.createElement('option');
            opt1.value = conta.id;
            opt1.textContent = conta.nome;
            origemSelect.appendChild(opt1);
            const opt2 = document.createElement('option');
            opt2.value = conta.id;
            opt2.textContent = conta.nome;
            destinoSelect.appendChild(opt2);
        });
    }

    // --- Event Listeners ---
    [periodoDeInput, periodoAteInput, contaBancariaSelect].forEach(el => {
        el.addEventListener('change', calculateAndRenderCashFlow);
    });

    conciliacaoFilterGroup.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            conciliacaoFilterGroup.querySelector('.active').classList.remove('active');
            e.target.classList.add('active');
            activeConciliacaoFilter = e.target.dataset.status;
            calculateAndRenderCashFlow();
        }
    });

    [visaoRealizadoCheckbox, visaoProjetadoCheckbox].forEach(cb => {
        cb.addEventListener('change', calculateAndRenderCashFlow);
    });

    extratoTableBody.addEventListener('change', async (e) => {
        if (e.target.classList.contains('fluxo-checkbox')) {
            const checkbox = e.target;
            const transacaoId = checkbox.dataset.id;
            const parentId = checkbox.dataset.parentId;
            const type = checkbox.dataset.type;
            const isConciliado = checkbox.checked;

            if (!transacaoId || !parentId || !type) {
                console.error("Dados da transação ausentes no checkbox.");
                return;
            }

            const collectionName = type === 'pagamento' ? 'pagamentos' : 'recebimentos';
            const parentCollectionName = type === 'pagamento' ? 'despesas' : 'receitas';

            const docRef = doc(db, `users/${userId}/${parentCollectionName}/${parentId}/${collectionName}/${transacaoId}`);

            try {
                await updateDoc(docRef, { conciliado: isConciliado });
                const row = checkbox.closest('tr');
                row.classList.toggle('bg-green-50', isConciliado);
            } catch (error) {
                console.error("Erro ao atualizar status de conciliação:", error);
                alert("Não foi possível atualizar o status da transação.");
                // Revert checkbox state on error
                checkbox.checked = !isConciliado;
            }
        }
    });

    lancarTransferenciaBtn.addEventListener('click', () => {
        transferenciaModal.classList.remove('hidden');
    });
    closeTransferenciaModalBtn.addEventListener('click', () => transferenciaModal.classList.add('hidden'));
    cancelTransferenciaModalBtn.addEventListener('click', () => transferenciaModal.classList.add('hidden'));

    transferenciaForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const feedbackId = 'transferencia-form-feedback';
        const contaOrigemId = document.getElementById('transferencia-conta-origem').value;
        const contaDestinoId = document.getElementById('transferencia-conta-destino').value;
        const valor = toCents(document.getElementById('transferencia-valor').value);
        const data = document.getElementById('transferencia-data').value;

        if(contaOrigemId === contaDestinoId) {
            showFeedback(feedbackId, "A conta de origem e destino não podem ser a mesma.", true);
            return;
        }
        if(!valor || !data || !contaOrigemId || !contaDestinoId) {
             showFeedback(feedbackId, "Todos os campos são obrigatórios.", true);
            return;
        }

        try {
            const contaOrigemNome = allContasBancarias.find(c => c.id === contaOrigemId).nome;
            const contaDestinoNome = allContasBancarias.find(c => c.id === contaDestinoId).nome;

            await addDoc(collection(db, `users/${userId}/transferencias`), {
                dataTransacao: data,
                valor: valor,
                contaOrigemId,
                contaDestinoId,
                contaOrigemNome,
                contaDestinoNome,
                observacao: document.getElementById('transferencia-obs').value,
                adminId: userId,
                createdAt: serverTimestamp()
            });
            showFeedback(feedbackId, "Transferência salva com sucesso!", false);
            transferenciaForm.reset();
            transferenciaModal.classList.add('hidden');
            calculateAndRenderCashFlow();
        } catch(error) {
            console.error("Erro ao salvar transferência:", error);
            showFeedback(feedbackId, "Erro ao salvar. Tente novamente.", true);
        }
    });

    // --- Initial Load ---
    function setDefaultDates() {
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        periodoDeInput.value = firstDayOfMonth.toISOString().split('T')[0];
        periodoAteInput.value = lastDayOfMonth.toISOString().split('T')[0];
    }

    // Initialize the page
    setDefaultDates();
    populateContasBancarias().then(() => {
        calculateAndRenderCashFlow();
    });

    // Setup tab functionality
    if (fluxoDeCaixaPage) {
        const tabLinks = fluxoDeCaixaPage.querySelectorAll('.fluxo-tab-link');
        const tabContents = fluxoDeCaixaPage.querySelectorAll('.fluxo-tab-content');

        tabLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();

                // Deactivate all tabs
                tabLinks.forEach(item => item.classList.remove('active'));
                tabContents.forEach(content => content.classList.add('hidden'));

                // Activate the clicked tab
                link.classList.add('active');
                const activeContentId = `fluxo-${link.dataset.fluxoTab}-tab`;
                const activeContent = document.getElementById(activeContentId);

                if (activeContent) {
                    activeContent.classList.remove('hidden');
                } else {
                    console.warn(`Tab content with ID '${activeContentId}' not found.`);
                }
            });
        });
    }
}