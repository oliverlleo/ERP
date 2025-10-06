import { getFirestore, collection, query, where, getDocs, doc, getDoc, addDoc, serverTimestamp, runTransaction, updateDoc, collectionGroup } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// This function will be called from the main script when the user is authenticated.
export function initializeFluxoDeCaixa(db, userId, common) {
    const fluxoDeCaixaPage = document.getElementById('fluxo-de-caixa-page');
    if (!fluxoDeCaixaPage) return;

    // --- DOM Elements ---
    const periodoDeInput = document.getElementById('fluxo-periodo-de');
    const periodoAteInput = document.getElementById('fluxo-periodo-ate');
    const contaBancariaSelect = document.getElementById('fluxo-conta-bancaria');
    const conciliacaoFilterGroup = document.getElementById('fluxo-conciliacao-filter-group');
    const kpiSaldoAnterior = document.getElementById('kpi-saldo-anterior');
    const kpiTotalEntradas = document.getElementById('kpi-total-entradas');
    const kpiTotalSaidas = document.getElementById('kpi-total-saidas');
    const kpiResultadoLiquido = document.getElementById('kpi-resultado-liquido');
    const kpiSaldoFinal = document.getElementById('kpi-saldo-final');
    const extratoTableBody = document.getElementById('fluxo-extrato-table-body');
    const dreTableBody = document.getElementById('fluxo-dre-table-body');
    const lancarTransferenciaBtn = document.getElementById('lancar-transferencia-btn');
    const transferenciaModal = document.getElementById('transferencia-modal');
    const closeTransferenciaModalBtn = document.getElementById('close-transferencia-modal-btn');
    const cancelTransferenciaModalBtn = document.getElementById('cancel-transferencia-modal-btn');
    const transferenciaForm = document.getElementById('transferencia-form');

    // --- State ---
    let allContasBancarias = [];
    let activeConciliacaoFilter = 'todas';
    let drilldownCategoryFilter = null;
    const visaoRealizadoCheckbox = document.getElementById('visao-realizado-checkbox');
    const visaoProjetadoCheckbox = document.getElementById('visao-projetado-checkbox');

    // --- Utility Functions (from common) ---
    const { formatCurrency, toCents, fromCents, showFeedback } = common;

    // --- Main Logic ---
    async function fetchTransactionsEfficiently(parentCollectionName, subcollectionName, startDate, endDate, inclusive = true) {
        const parentDocsSnapshot = await getDocs(collection(db, `users/${userId}/${parentCollectionName}`));
        const promises = parentDocsSnapshot.docs.map(parentDoc => {
            let subcollectionQuery = collection(parentDoc.ref, subcollectionName);
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

        const despesasQuery = collection(db, `users/${userId}/despesas`);
        const despesasSnap = await getDocs(despesasQuery);
        despesasSnap.forEach(doc => {
            const despesaData = doc.data();
            const status = despesaData.status || 'Pendente';
            if (['Pendente', 'Vencido', 'Pago Parcialmente'].includes(status) && despesaData.vencimento >= startDate && despesaData.vencimento <= endDate) {
                const categoria = planoContasMap.get(despesaData.categoriaId);
                unifiedProjected.push({
                    id: doc.id, isProjected: true, data: despesaData.vencimento, descricao: `(Projetado) ${despesaData.descricao}`, participante: despesaData.favorecidoNome || 'N/A', planoDeConta: categoria ? categoria.nome : 'N/A', dataVencimento: despesaData.vencimento, entrada: 0, saida: despesaData.valorSaldo || despesaData.valorOriginal, juros: 0, desconto: 0, conciliado: false, type: 'despesa_projetada'
                });
            }
        });

        const receitasQuery = collection(db, `users/${userId}/receitas`);
        const receitasSnap = await getDocs(receitasQuery);
        receitasSnap.forEach(doc => {
            const receitaData = doc.data();
            const status = receitaData.status || 'Pendente';
            const dataVencimento = receitaData.dataVencimento || receitaData.vencimento;
            if (['Pendente', 'Vencido', 'Recebido Parcialmente'].includes(status) && dataVencimento >= startDate && dataVencimento <= endDate) {
                const categoria = planoContasMap.get(receitaData.categoriaId);
                unifiedProjected.push({
                    id: doc.id, isProjected: true, data: dataVencimento, descricao: `(Projetado) ${receitaData.descricao}`, participante: receitaData.clienteNome || 'N/A', planoDeConta: categoria ? categoria.nome : 'N/A', dataVencimento: dataVencimento, entrada: receitaData.saldoPendente || receitaData.valorOriginal, saida: 0, juros: 0, desconto: 0, conciliado: false, type: 'receita_projetada'
                });
            }
        });
        return unifiedProjected;
    }

    async function calculateAndRenderCashFlow() {
        extratoTableBody.innerHTML = `<tr><td colspan="12" class="text-center p-8 text-gray-500">Carregando dados...</td></tr>`;
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
            renderCharts([], { saldoAnterior: 0, totalEntradas: 0, totalSaidas: 0 }, { previousEntradas: 0, previousSaidas: 0 });
            renderDRE([]);
            return;
        }

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
            unifiedTransactions = applyFilters(unifiedTransactions, contaId, activeConciliacaoFilter);
            const kpis = calculateKPIs(saldoAnterior, unifiedTransactions, contaId);
            renderKPIs(kpis);
            renderExtrato(unifiedTransactions, kpis.saldoAnterior);
            renderDRE(unifiedTransactions);
            const { previousStartDate, previousEndDate } = getPreviousPeriod(startDate, endDate);
            const previousPeriodTotals = await fetchAndCalculatePreviousPeriodTotals(previousStartDate, previousEndDate, contaId);
            renderCharts(unifiedTransactions, kpis, previousPeriodTotals);
        } catch (error) {
            console.error("Error calculating cash flow:", error);
            extratoTableBody.innerHTML = `<tr><td colspan="12" class="text-center p-8 text-red-500">Ocorreu um erro ao carregar os dados. Verifique o console para mais detalhes.</td></tr>`;
        }
    }

    function getPreviousPeriod(currentStart, currentEnd) {
        const start = new Date(currentStart + 'T00:00:00');
        const end = new Date(currentEnd + 'T00:00:00');

        const duration = (end.getTime() - start.getTime()) / (1000 * 3600 * 24) + 1;

        const previousEndDate = new Date(start.getTime());
        previousEndDate.setDate(previousEndDate.getDate() - 1);

        const previousStartDate = new Date(previousEndDate.getTime());
        previousStartDate.setDate(previousStartDate.getDate() - (duration - 1));

        return {
            previousStartDate: previousStartDate.toISOString().split('T')[0],
            previousEndDate: previousEndDate.toISOString().split('T')[0]
        };
    }

    async function fetchAndCalculatePreviousPeriodTotals(startDate, endDate, contaId) {
        try {
            const [pagamentos, recebimentos, transferencias] = await Promise.all([
                fetchTransactionsEfficiently('despesas', 'pagamentos', startDate, endDate),
                fetchTransactionsEfficiently('receitas', 'recebimentos', startDate, endDate),
                fetchCollection('transferencias', startDate, endDate)
            ]);

            const allTransactions = await enrichAndUnifyTransactions(pagamentos, recebimentos, transferencias);
            const filteredTransactions = applyFilters(allTransactions, contaId, 'todas');

            let previousEntradas = 0;
            let previousSaidas = 0;

            filteredTransactions.forEach(t => {
                if (t.type === 'transferencia') {
                    if (contaId !== 'todas') {
                        if (t.contaDestinoId === contaId) previousEntradas += t.valor;
                        if (t.contaOrigemId === contaId) previousSaidas += t.valor;
                    }
                } else {
                    previousEntradas += t.entrada || 0;
                    previousSaidas += t.saida || 0;
                }
            });

            return { previousEntradas, previousSaidas };
        } catch (error) {
            console.error("Error fetching previous period totals:", error);
            return { previousEntradas: 0, previousSaidas: 0 };
        }
    }

    async function calculateSaldoAnterior(startDate, contaId) {
        let saldo = 0;
        const [pagamentos, recebimentos, transferencias] = await Promise.all([
            fetchTransactionsEfficiently('despesas', 'pagamentos', null, startDate, false),
            fetchTransactionsEfficiently('receitas', 'recebimentos', null, startDate, false),
            fetchCollection('transferencias', null, startDate, false)
        ]);

        const allTransactions = await enrichAndUnifyTransactions(pagamentos, recebimentos, transferencias);
        const filteredTransactions = applyFilters(allTransactions, contaId, 'todas');

        filteredTransactions.forEach(t => {
            saldo += (t.entrada || 0) - (t.saida || 0);
        });
        return saldo;
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
                        id: doc.id, parentId: parentDespesaRef.id, data: data.dataTransacao, descricao: despesaData.descricao, participante: despesaData.favorecidoNome || 'N/A', planoDeConta: categoria ? categoria.nome : 'N/A', dataVencimento: despesaData.vencimento, tipoAtividade: categoria ? categoria.tipoDeAtividade : 'Operacional', entrada: 0, saida: data.valorPrincipal || 0, juros: data.jurosPagos || 0, desconto: data.descontosAplicados || 0, contaId: data.contaSaidaId, conciliado: data.conciliado || false, type: 'pagamento'
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
                        id: doc.id, parentId: parentReceitaRef.id, data: data.dataTransacao, descricao: receitaData.descricao, participante: receitaData.clienteNome || 'N/A', planoDeConta: categoria ? categoria.nome : 'N/A', dataVencimento: receitaData.dataVencimento, tipoAtividade: categoria ? categoria.tipoDeAtividade : 'Operacional', entrada: data.valorPrincipal || 0, saida: 0, juros: data.jurosRecebidos || 0, desconto: data.descontosConcedidos || 0, contaId: data.contaEntradaId, conciliado: data.conciliado || false, type: 'recebimento'
                    });
                }
            }
        }

        for (const doc of transferencias) {
            const data = doc.data();
            unified.push({
                id: doc.id, data: data.dataTransacao, descricao: `Transferência de ${data.contaOrigemNome} para ${data.contaDestinoNome}`, participante: 'Interno', planoDeConta: 'Transferência', dataVencimento: data.dataTransacao, tipoAtividade: 'N/A', valor: data.valor, juros: 0, desconto: 0, contaOrigemId: data.contaOrigemId, contaDestinoId: data.contaDestinoId, conciliado: data.conciliado || false, type: 'transferencia'
            });
        }

        return unified.sort((a, b) => new Date(a.data) - new Date(b.data));
    }

    function applyFilters(transactions, contaId, conciliacaoStatus) {
        return transactions.filter(t => {
            let contaMatch = true;
            if (contaId !== 'todas') {
                if (t.type === 'transferencia') {
                    contaMatch = t.contaOrigemId === contaId || t.contaDestinoId === contaId;
                } else {
                    contaMatch = t.contaId === contaId;
                }
            }
            if (!contaMatch) return false;

            let conciliacaoMatch = true;
            if (conciliacaoStatus !== 'todas') {
                const expectedStatus = conciliacaoStatus === 'conciliadas';
                conciliacaoMatch = t.conciliado === expectedStatus;
            }
            if (!conciliacaoMatch) return false;

            if (drilldownCategoryFilter) {
                if (t.planoDeConta !== drilldownCategoryFilter) {
                    return false;
                }
            }

            return true;
        });
    }

    function calculateKPIs(saldoAnterior, transactions, contaId) {
        let totalEntradas = 0;
        let totalSaidas = 0;

        transactions.forEach(t => {
            if (t.type === 'transferencia') {
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
            const categoria = t.planoDeConta || 'Sem Categoria';
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

    function renderCharts(transactions, kpis, previousPeriodTotals) {
        renderEvolucaoCaixaChart(transactions, kpis.saldoAnterior);
        renderComparativoPeriodosChart(kpis, previousPeriodTotals);
        renderTopCategoriasCharts(transactions.filter(t => !t.isProjected));
    }

    let evolucaoCaixaChartInstance, comparativoPeriodosChartInstance, topReceitasChartInstance, topDespesasChartInstance;

    function renderTopCategoriasCharts(realizedTransactions) {
        const processAndRender = (ctx, transactions, type, label) => {
            if (!ctx) return null;

            const isReceita = type === 'receita';
            const valueField = isReceita ? 'entrada' : 'saida';
            const typeFilter = isReceita ? 'recebimento' : 'pagamento';

            const dataByCategory = realizedTransactions
                .filter(t => t.type === typeFilter && t[valueField] > 0)
                .reduce((acc, t) => {
                    const categoria = t.planoDeConta || 'Sem Categoria';
                    if (!acc[categoria]) acc[categoria] = 0;
                    acc[categoria] += t[valueField];
                    return acc;
                }, {});

            const sortedData = Object.entries(dataByCategory)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5);

            const chartLabels = sortedData.map(entry => entry[0]);
            const chartData = sortedData.map(entry => entry[1] / 100);

            const chart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: chartLabels,
                    datasets: [{
                        label: label,
                        data: chartData,
                        backgroundColor: isReceita ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)',
                        borderColor: isReceita ? 'rgba(22, 163, 74, 1)' : 'rgba(220, 38, 38, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const clickedIndex = elements[0].index;
                            const category = chart.data.labels[clickedIndex];

                            drilldownCategoryFilter = category;

                            const extratoTabLink = document.querySelector('.fluxo-tab-link[data-fluxo-tab="extrato"]');
                            if (extratoTabLink) extratoTabLink.click();

                            calculateAndRenderCashFlow();
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value); }
                            }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.x);
                                }
                            }
                        }
                    }
                }
            });
            return chart;
        };

        const receitaCtx = document.getElementById('top-receitas-chart')?.getContext('2d');
        if (topReceitasChartInstance) topReceitasChartInstance.destroy();
        topReceitasChartInstance = processAndRender(receitaCtx, realizedTransactions, 'receita', 'Top 5 Receitas');

        const despesaCtx = document.getElementById('top-despesas-chart')?.getContext('2d');
        if (topDespesasChartInstance) topDespesasChartInstance.destroy();
        topDespesasChartInstance = processAndRender(despesaCtx, realizedTransactions, 'despesa', 'Top 5 Despesas');
    }

    function renderComparativoPeriodosChart(currentPeriodTotals, previousPeriodTotals) {
        const ctx = document.getElementById('comparativo-periodos-chart')?.getContext('2d');
        if (!ctx) return;

        if (comparativoPeriodosChartInstance) {
            comparativoPeriodosChartInstance.destroy();
        }

        const labels = ['Período Anterior', 'Período Atual'];

        comparativoPeriodosChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Entradas',
                        data: [
                            previousPeriodTotals.previousEntradas / 100,
                            currentPeriodTotals.totalEntradas / 100
                        ],
                        backgroundColor: '#16a34a', // green-600
                    },
                    {
                        label: 'Saídas',
                        data: [
                            previousPeriodTotals.previousSaidas / 100,
                            currentPeriodTotals.totalSaidas / 100
                        ],
                        backgroundColor: '#dc2626', // red-600
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
                            }
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
    }

    function renderEvolucaoCaixaChart(transactions, saldoAnterior) {
        const ctx = document.getElementById('evolucao-caixa-chart')?.getContext('2d');
        if (!ctx) return;

        if (evolucaoCaixaChartInstance) {
            evolucaoCaixaChartInstance.destroy();
        }

        const startDate = new Date(periodoDeInput.value + 'T00:00:00');
        const endDate = new Date(periodoAteInput.value + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dailyNetChanges = {};
        const labels = [];

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateString = d.toISOString().split('T')[0];
            labels.push(dateString);
            dailyNetChanges[dateString] = 0;
        }

        transactions.forEach(t => {
            const dateString = t.data;
            if (dailyNetChanges.hasOwnProperty(dateString)) {
                dailyNetChanges[dateString] += (t.entrada || 0) - (t.saida || 0);
            }
        });

        const balances = [];
        let currentBalance = saldoAnterior;
        labels.forEach(dateString => {
            currentBalance += dailyNetChanges[dateString];
            balances.push(currentBalance / 100);
        });

        const todayString = today.toISOString().split('T')[0];
        const todayIndex = labels.indexOf(todayString);
        const realizadoData = balances.map((val, i) => (i <= todayIndex ? val : null));
        const projetadoData = balances.map((val, i) => {
            if (i < todayIndex) return null;
            if (i === todayIndex) return realizadoData[todayIndex];
            return val;
        });

        evolucaoCaixaChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels.map(l => new Date(l + 'T00:00:00').toLocaleDateString('pt-BR')),
                datasets: [{
                    label: 'Saldo Realizado',
                    data: realizadoData,
                    borderColor: '#1d4ed8',
                    backgroundColor: '#1d4ed8',
                    tension: 0.1,
                    pointRadius: 2,
                    spanGaps: true
                }, {
                    label: 'Saldo Projetado',
                    data: projetadoData,
                    borderColor: '#60a5fa',
                    backgroundColor: '#60a5fa',
                    borderDash: [5, 5],
                    tension: 0.1,
                    pointRadius: 2,
                    spanGaps: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        ticks: {
                            callback: function(value) {
                                return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
                            }
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                }
            }
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
        const eventType = el.type === 'date' ? 'input' : 'change';
        el.addEventListener(eventType, () => {
            drilldownCategoryFilter = null;
            calculateAndRenderCashFlow();
        });
    });

    conciliacaoFilterGroup.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            drilldownCategoryFilter = null;
            conciliacaoFilterGroup.querySelector('.active').classList.remove('active');
            e.target.classList.add('active');
            activeConciliacaoFilter = e.target.dataset.status;
            calculateAndRenderCashFlow();
        }
    });

    [visaoRealizadoCheckbox, visaoProjetadoCheckbox].forEach(cb => {
        cb.addEventListener('change', () => {
            drilldownCategoryFilter = null;
            calculateAndRenderCashFlow();
        });
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
                dataTransacao: data, valor: valor, contaOrigemId, contaDestinoId, contaOrigemNome, contaDestinoNome, observacao: document.getElementById('transferencia-obs').value, adminId: userId, createdAt: serverTimestamp()
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
        const firstDayOfYear = new Date(today.getFullYear(), 0, 1); // January 1st of the current year
        const lastDayOfYear = new Date(today.getFullYear(), 11, 31); // December 31st of the current year
        periodoDeInput.value = firstDayOfYear.toISOString().split('T')[0];
        periodoAteInput.value = lastDayOfYear.toISOString().split('T')[0];
    }

    setDefaultDates();
    populateContasBancarias();

    fluxoDeCaixaPage.addEventListener('show-page', () => {
        console.log("Fluxo de Caixa page shown, fetching data...");
        calculateAndRenderCashFlow();
    });

    const tabLinks = fluxoDeCaixaPage.querySelectorAll('.fluxo-tab-link');
    const tabContents = fluxoDeCaixaPage.querySelectorAll('.fluxo-tab-content');
    tabLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            tabLinks.forEach(item => item.classList.remove('active'));
            tabContents.forEach(content => content.classList.add('hidden'));
            link.classList.add('active');
            const activeContent = document.getElementById(`fluxo-${link.dataset.fluxoTab}-tab`);
            if (activeContent) activeContent.classList.remove('hidden');
        });
    });
}