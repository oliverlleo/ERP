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

    // --- Utility Functions (from common) ---
    const { formatCurrency, toCents, fromCents, showFeedback } = common;

    // --- Main Logic ---
    async function calculateAndRenderCashFlow() {
        const startDate = periodoDeInput.value;
        const endDate = periodoAteInput.value;
        const contaId = contaBancariaSelect.value;

        if (!startDate || !endDate) {
            extratoTableBody.innerHTML = `<tr><td colspan="7" class="text-center p-8 text-gray-500">Por favor, selecione um período para começar.</td></tr>`;
            return;
        }

        extratoTableBody.innerHTML = `<tr><td colspan="7" class="text-center p-8 text-gray-500">Carregando dados...</td></tr>`;

        try {
            // 1. Calculate Previous Balance
            const saldoAnterior = await calculateSaldoAnterior(startDate, contaId);

            // 2. Fetch Transactions for the period
            const [pagamentos, recebimentos, transferencias] = await Promise.all([
                fetchCollectionGroup('pagamentos', startDate, endDate),
                fetchCollectionGroup('recebimentos', startDate, endDate),
                fetchCollection('transferencias', startDate, endDate)
            ]);

            // 3. Unify and Enrich Data
            let unifiedTransactions = await enrichAndUnifyTransactions(pagamentos, recebimentos, transferencias);

            // 4. Apply Filters
            unifiedTransactions = applyFilters(unifiedTransactions, contaId, activeConciliacaoFilter);

            // 5. Calculate KPIs
            const kpis = calculateKPIs(saldoAnterior, unifiedTransactions, contaId);

            // 6. Render UI
            renderKPIs(kpis);
            renderExtrato(unifiedTransactions, kpis.saldoAnterior);
            renderDRE(unifiedTransactions);
            renderCharts(unifiedTransactions);

        } catch (error) {
            console.error("Error calculating cash flow:", error);
            extratoTableBody.innerHTML = `<tr><td colspan="7" class="text-center p-8 text-red-500">Ocorreu um erro ao carregar os dados.</td></tr>`;
        }
    }

    async function calculateSaldoAnterior(startDate, contaId) {
        let saldo = 0;
        const [pagamentos, recebimentos, transferencias] = await Promise.all([
            fetchCollectionGroup('pagamentos', null, startDate, false), // before, non-inclusive
            fetchCollectionGroup('recebimentos', null, startDate, false),
            fetchCollection('transferencias', null, startDate, false)
        ]);

        const allTransactions = await enrichAndUnifyTransactions(pagamentos, recebimentos, transferencias);
        const filteredTransactions = applyFilters(allTransactions, contaId, 'todas'); // Conciliation doesn't matter for balance

        filteredTransactions.forEach(t => {
            saldo += (t.entrada || 0) - (t.saida || 0);
        });
        return saldo;
    }

    async function fetchCollectionGroup(groupName, startDate, endDate, inclusive = true) {
        let q = query(collectionGroup(db, groupName), where('adminId', '==', userId));
        if (startDate) {
            q = query(q, where('dataTransacao', inclusive ? '>=' : '<', startDate));
        }
        if (endDate) {
            q = query(q, where('dataTransacao', inclusive ? '<=' : '<', endDate));
        }
        const snapshot = await getDocs(q);
        return snapshot.docs;
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

        for (const doc of pagamentos) {
            const data = doc.data();
            const parentDespesaRef = doc.ref.parent.parent;
            if (parentDespesaRef) {
                const despesaSnap = await getDoc(parentDespesaRef);
                if (despesaSnap.exists()) {
                    const despesaData = despesaSnap.data();
                    unified.push({
                        id: doc.id,
                        parentId: parentDespesaRef.id,
                        data: data.dataTransacao,
                        descricao: despesaData.descricao,
                        categoria: despesaData.planoDeContasNome || 'N/A', // You might need to fetch this
                        tipoAtividade: despesaData.tipoDeAtividade || 'Operacional',
                        entrada: 0,
                        saida: data.valorPrincipal || 0,
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
                    unified.push({
                        id: doc.id,
                        parentId: parentReceitaRef.id,
                        data: data.dataTransacao,
                        descricao: receitaData.descricao,
                        categoria: receitaData.planoDeContasNome || 'N/A',
                        tipoAtividade: receitaData.tipoDeAtividade || 'Operacional',
                        entrada: data.valorPrincipal || 0,
                        saida: 0,
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
                categoria: 'Transferência',
                tipoAtividade: 'N/A',
                valor: data.valor,
                contaOrigemId: data.contaOrigemId,
                contaDestinoId: data.contaDestinoId,
                conciliado: data.conciliado || false, // Assuming transfers can be reconciled
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
            extratoTableBody.innerHTML = `<tr><td colspan="7" class="text-center p-8 text-gray-500">Nenhuma transação encontrada para os filtros selecionados.</td></tr>`;
            return;
        }

        const groupedByDay = transactions.reduce((acc, t) => {
            const day = t.data;
            if (!acc[day]) acc[day] = [];
            acc[day].push(t);
            return acc;
        }, {});

        let saldoAcumulado = saldoInicial;
        const contaFiltrada = contaBancariaSelect.value;

        Object.keys(groupedByDay).sort().forEach(day => {
            const dayTransactions = groupedByDay[day];
            let saldoDia = 0;

            dayTransactions.forEach(t => {
                const tr = document.createElement('tr');
                let entrada = 0;
                let saida = 0;

                if (t.type === 'transferencia') {
                    if (contaFiltrada === 'todas') {
                        // Don't show transfers in the main list for 'All Accounts'
                        return;
                    } else if (t.contaDestinoId === contaFiltrada) {
                        entrada = t.valor;
                    } else if (t.contaOrigemId === contaFiltrada) {
                        saida = t.valor;
                    } else {
                        return; // Not related to the filtered account
                    }
                } else {
                    entrada = t.entrada;
                    saida = t.saida;
                }

                saldoAcumulado += entrada - saida;
                saldoDia += entrada - saida;

                tr.innerHTML = `
                    <td class="p-4"><input type="checkbox" class="fluxo-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded" data-id="${t.id}" data-parent-id="${t.parentId}" data-type="${t.type}" ${t.conciliado ? 'checked' : ''}></td>
                    <td class="px-6 py-3 text-sm text-gray-700">${new Date(t.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td class="px-6 py-3 text-sm text-gray-700">${t.descricao}</td>
                    <td class="px-6 py-3 text-sm text-gray-500">${t.categoria}</td>
                    <td class="px-6 py-3 text-sm text-right text-green-600">${entrada > 0 ? formatCurrency(entrada) : ''}</td>
                    <td class="px-6 py-3 text-sm text-right text-red-600">${saida > 0 ? formatCurrency(saida) : ''}</td>
                    <td class="px-6 py-3 text-sm text-right font-medium"></td>
                `;
                if(t.conciliado) tr.classList.add('bg-green-50');
                extratoTableBody.appendChild(tr);
            });

            // Add daily balance row
            const lastRow = extratoTableBody.querySelector('tr:last-child');
            if(lastRow) {
                lastRow.querySelector('td:last-child').textContent = formatCurrency(saldoAcumulado);
            }
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

    function renderCharts(transactions) {
        renderFluxoDiarioChart(transactions);
        renderComposicaoReceitasChart(transactions);
        renderComposicaoDespesasChart(transactions);
    }

    let fluxoDiarioChartInstance, composicaoReceitasChartInstance, composicaoDespesasChartInstance;

    function renderFluxoDiarioChart(transactions) {
        const ctx = document.getElementById('fluxo-diario-chart').getContext('2d');
        if (fluxoDiarioChartInstance) {
            fluxoDiarioChartInstance.destroy();
        }

        const dailyData = transactions.reduce((acc, t) => {
            const day = t.data;
            if (!acc[day]) acc[day] = { entradas: 0, saidas: 0 };
            acc[day].entradas += t.entrada || 0;
            acc[day].saidas += t.saida || 0;
            return acc;
        }, {});

        const sortedDays = Object.keys(dailyData).sort();

        fluxoDiarioChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sortedDays.map(day => new Date(day + 'T00:00:00').toLocaleDateString('pt-BR')),
                datasets: [{
                    label: 'Entradas',
                    data: sortedDays.map(day => dailyData[day].entradas / 100),
                    backgroundColor: 'rgba(75, 192, 192, 0.5)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1
                }, {
                    label: 'Saídas',
                    data: sortedDays.map(day => dailyData[day].saidas / 100),
                    backgroundColor: 'rgba(255, 99, 132, 0.5)',
                    borderColor: 'rgba(255, 99, 132, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return 'R$ ' + value.toLocaleString('pt-BR');
                            }
                        }
                    }
                }
            }
        });
    }

    function renderComposicaoReceitasChart(transactions) {
        const ctx = document.getElementById('composicao-receitas-chart').getContext('2d');
        if (composicaoReceitasChartInstance) {
            composicaoReceitasChartInstance.destroy();
        }

        const receitaData = transactions
            .filter(t => t.entrada > 0 && t.type === 'recebimento')
            .reduce((acc, t) => {
                const categoria = t.categoria || 'Sem Categoria';
                if (!acc[categoria]) acc[categoria] = 0;
                acc[categoria] += t.entrada;
                return acc;
            }, {});

        composicaoReceitasChartInstance = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: Object.keys(receitaData),
                datasets: [{
                    label: 'Composição de Receitas',
                    data: Object.values(receitaData).map(v => v / 100),
                    backgroundColor: [
                        'rgba(54, 162, 235, 0.7)',
                        'rgba(75, 192, 192, 0.7)',
                        'rgba(255, 206, 86, 0.7)',
                        'rgba(153, 102, 255, 0.7)',
                        'rgba(255, 159, 64, 0.7)'
                    ],
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed !== null) {
                                    label += new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed);
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
    }

    function renderComposicaoDespesasChart(transactions) {
        const ctx = document.getElementById('composicao-despesas-chart').getContext('2d');
        if (composicaoDespesasChartInstance) {
            composicaoDespesasChartInstance.destroy();
        }

        const despesaData = transactions
            .filter(t => t.saida > 0 && t.type === 'pagamento')
            .reduce((acc, t) => {
                const categoria = t.categoria || 'Sem Categoria';
                if (!acc[categoria]) acc[categoria] = 0;
                acc[categoria] += t.saida;
                return acc;
            }, {});

        composicaoDespesasChartInstance = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: Object.keys(despesaData),
                datasets: [{
                    label: 'Composição de Despesas',
                    data: Object.values(despesaData).map(v => v / 100),
                     backgroundColor: [
                        'rgba(255, 99, 132, 0.7)',
                        'rgba(255, 159, 64, 0.7)',
                        'rgba(255, 205, 86, 0.7)',
                        'rgba(75, 192, 192, 0.7)',
                        'rgba(54, 162, 235, 0.7)',
                        'rgba(153, 102, 255, 0.7)',
                        'rgba(201, 203, 207, 0.7)'
                    ],
                }]
            },
             options: {
                responsive: true,
                plugins: {
                    legend: { position: 'top' },
                     tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed !== null) {
                                    label += new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed);
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