import { getFirestore, collection, query, where, getDocs, doc, getDoc, addDoc, serverTimestamp, runTransaction, writeBatch, updateDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// This function will be called from the main script (index.html)
// when the user is authenticated and the Firestore (db) is ready.
export function initializeTesouraria(db, userId, common) {
    const tesourariaPage = document.getElementById('movimentacao-bancaria-page');
    if (!tesourariaPage) {
        // console.log("Página de Tesouraria não encontrada. A inicialização foi pulada.");
        return; // Exit if the page is not in the DOM
    }

    // --- DOM Elements ---
    const contaBancariaSelect = document.getElementById('tesouraria-conta-bancaria');
    const periodoDeInput = document.getElementById('tesouraria-periodo-de');
    const periodoAteInput = document.getElementById('tesouraria-periodo-ate');

    const kpiSaldoInicial = document.getElementById('kpi-tesouraria-saldo-inicial');
    const kpiTotalEntradas = document.getElementById('kpi-tesouraria-total-entradas');
    const kpiTotalSaidas = document.getElementById('kpi-tesouraria-total-saidas');
    const kpiSaldoPeriodo = document.getElementById('kpi-tesouraria-saldo-periodo');
    const kpiSaldoFinal = document.getElementById('kpi-tesouraria-saldo-final');
    const kpiSaldoAConciliar = document.getElementById('kpi-tesouraria-saldo-a-conciliar');

    const tableBody = document.getElementById('tesouraria-table-body');
    const selectAllCheckbox = document.getElementById('tesouraria-select-all-checkbox');

    const novaEntradaBtn = document.getElementById('tesouraria-nova-entrada-btn');
    const novaSaidaBtn = document.getElementById('tesouraria-nova-saida-btn');
    const transferenciaBtn = document.getElementById('tesouraria-transferencia-btn'); // Note: This might open the existing transfer modal
    const conciliarBtn = document.getElementById('tesouraria-conciliar-btn');
    const desfazerConciliacaoBtn = document.getElementById('tesouraria-desfazer-conciliacao-btn');
    const estornarBtn = document.getElementById('tesouraria-estornar-btn');

    const operacaoModal = document.getElementById('tesouraria-operacao-modal');
    const operacaoForm = document.getElementById('tesouraria-operacao-form');
    const operacaoTitle = document.getElementById('tesouraria-operacao-title');
    const closeOperacaoModalBtn = document.getElementById('close-tesouraria-operacao-modal-btn');
    const cancelOperacaoModalBtn = document.getElementById('cancel-tesouraria-operacao-modal-btn');
    const operacaoPlanoContasSelect = document.getElementById('tesouraria-operacao-plano-contas');

    const estornoModal = document.getElementById('tesouraria-estorno-modal');
    const estornoDescricao = document.getElementById('tesouraria-estorno-descricao');
    const estornoMotivoInput = document.getElementById('tesouraria-estorno-motivo');
    const closeEstornoModalBtn = document.getElementById('close-tesouraria-estorno-modal-btn');
    const cancelEstornoBtn = document.getElementById('cancel-tesouraria-estorno-btn');
    const confirmarEstornoBtn = document.getElementById('confirmar-tesouraria-estorno-btn');

    // --- Module State ---
    let allMovimentacoes = [];
    let allContasBancarias = [];
    let selectedMovimentacaoForEstorno = null;

    // --- Common Functions ---
    const { formatCurrency, toCents, fromCents, showFeedback } = common;

    // --- Main Functions ---

    async function calculateSaldoAnterior(contaId, startDate) {
        if (!contaId) return 0;

        // 1. Get initial balance from the account's definition
        const conta = allContasBancarias.find(c => c.id === contaId);
        let saldoAnterior = conta ? (conta.saldoInicial || 0) : 0;

        // 2. Query all movements *before* the start date for that specific account
        const q = query(collection(db, `users/${userId}/movimentacoesBancarias`),
            where("contaBancariaId", "==", contaId),
            where("dataTransacao", "<", startDate)
        );
        const pastMovimentacoesSnap = await getDocs(q);

        // 3. Adjust the initial balance with past movements, filtering out reversed ones client-side
        pastMovimentacoesSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.estornado !== true) {
                saldoAnterior += data.valor;
            }
        });

        return saldoAnterior;
    }

    async function loadInitialData() {
        await populateContasBancarias();
        setDefaultDates();
        await fetchDataAndRender();
    }

    function setDefaultDates() {
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        periodoDeInput.value = firstDayOfMonth.toISOString().split('T')[0];
        periodoAteInput.value = lastDayOfMonth.toISOString().split('T')[0];
    }

    async function populateContasBancarias() {
        const q = query(collection(db, `users/${userId}/contasBancarias`));
        const snapshot = await getDocs(q);
        allContasBancarias = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        contaBancariaSelect.innerHTML = '<option value="">Selecione uma conta</option>'; // Prompt user to select
        allContasBancarias.forEach(conta => {
            const option = document.createElement('option');
            option.value = conta.id;
            option.textContent = conta.nome;
            contaBancariaSelect.appendChild(option);
        });
    }

    async function fetchDataAndRender() {
        const contaId = contaBancariaSelect.value;
        const startDate = periodoDeInput.value;
        const endDate = periodoAteInput.value;

        if (!contaId) {
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center p-8 text-gray-500">Selecione uma conta bancária para ver as movimentações.</td></tr>`;
            resetKPIs();
            return;
        }

        if (!startDate || !endDate) {
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center p-8 text-gray-500">Por favor, selecione um período.</td></tr>`;
            resetKPIs();
            return;
        }

        tableBody.innerHTML = `<tr><td colspan="8" class="text-center p-8 text-gray-500">Carregando dados...</td></tr>`;

        try {
            const saldoAnterior = await calculateSaldoAnterior(contaId, startDate);

            const q = query(collection(db, `users/${userId}/movimentacoesBancarias`),
                where("contaBancariaId", "==", contaId),
                where("dataTransacao", ">=", startDate),
                where("dataTransacao", "<=", endDate)
            );
            const snapshot = await getDocs(q);
            // Filter out reversed transactions on the client side
            allMovimentacoes = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(mov => mov.estornado !== true);
            allMovimentacoes.sort((a, b) => new Date(a.dataTransacao) - new Date(b.dataTransacao));

            // Calculate KPIs based on the fetched movements for the period
            let totalEntradas = 0;
            let totalSaidas = 0;
            let saldoAConciliar = 0;
            allMovimentacoes.forEach(mov => {
                if (mov.valor > 0) totalEntradas += mov.valor;
                else totalSaidas += mov.valor; // Saidas are negative
                if (!mov.conciliado) {
                    saldoAConciliar += mov.valor;
                }
            });
            totalSaidas = -totalSaidas; // Make it a positive number for display

            const saldoPeriodo = totalEntradas - totalSaidas;
            const saldoFinal = saldoAnterior + saldoPeriodo;

            updateKPIs({ saldoAnterior, totalEntradas, totalSaidas, saldoPeriodo, saldoFinal, saldoAConciliar });
            renderTable(allMovimentacoes, saldoAnterior);
            updateActionButtonsState();

        } catch (error) {
            console.error("Erro ao buscar movimentações:", error);
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center p-8 text-red-500">Ocorreu um erro ao carregar os dados.</td></tr>`;
        }
    }

    function updateKPIs(kpis) {
        kpiSaldoInicial.textContent = formatCurrency(kpis.saldoAnterior);
        kpiTotalEntradas.textContent = formatCurrency(kpis.totalEntradas);
        kpiTotalSaidas.textContent = formatCurrency(kpis.totalSaidas);
        kpiSaldoPeriodo.textContent = formatCurrency(kpis.saldoPeriodo);
        kpiSaldoFinal.textContent = formatCurrency(kpis.saldoFinal);
        kpiSaldoAConciliar.textContent = formatCurrency(kpis.saldoAConciliar);

        kpiSaldoPeriodo.classList.toggle('text-red-700', kpis.saldoPeriodo < 0);
        kpiSaldoPeriodo.classList.toggle('text-gray-900', kpis.saldoPeriodo >= 0);
        kpiSaldoFinal.classList.toggle('text-red-700', kpis.saldoFinal < 0);
        kpiSaldoFinal.classList.toggle('text-blue-700', kpis.saldoFinal >= 0);
    }

    function renderTable(movimentacoes, saldoAnterior) {
        tableBody.innerHTML = '';
        if (movimentacoes.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center p-8 text-gray-500">Nenhuma movimentação encontrada para o período.</td></tr>`;
            return;
        }

        let saldoAcumulado = saldoAnterior;

        movimentacoes.forEach(mov => {
            const tr = document.createElement('tr');
            const isEstornado = mov.estornado === true;

            let statusBadge = '';
            if (mov.conciliado) {
                statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Conciliado</span>`;
            } else {
                statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">Pendente</span>`;
            }

            const entrada = mov.valor > 0 ? mov.valor : 0;
            const saida = mov.valor < 0 ? -mov.valor : 0;
            saldoAcumulado += mov.valor;

            tr.innerHTML = `
                <td class="p-4"><input type="checkbox" class="movimentacao-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded" data-id="${mov.id}"></td>
                <td class="px-4 py-2 text-sm text-gray-700">${new Date(mov.dataTransacao + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                <td class="px-4 py-2 text-sm text-gray-800 ${isEstornado ? 'line-through' : ''}">${mov.descricao}</td>
                <td class="px-4 py-2 text-sm text-gray-600"><u>${mov.origemDescricao || 'Manual'}</u></td>
                <td class="px-4 py-2 text-sm text-right text-green-600">${entrada > 0 ? formatCurrency(entrada) : ''}</td>
                <td class="px-4 py-2 text-sm text-right text-red-600">${saida > 0 ? formatCurrency(saida) : ''}</td>
                <td class="px-4 py-2 text-sm text-right font-medium">${formatCurrency(saldoAcumulado)}</td>
                <td class="px-4 py-2 text-center">${statusBadge}</td>
            `;
            tableBody.appendChild(tr);
        });
    }

    function resetKPIs() {
        kpiSaldoInicial.textContent = formatCurrency(0);
        kpiTotalEntradas.textContent = formatCurrency(0);
        kpiTotalSaidas.textContent = formatCurrency(0);
        kpiSaldoPeriodo.textContent = formatCurrency(0);
        kpiSaldoFinal.textContent = formatCurrency(0);
        kpiSaldoAConciliar.textContent = formatCurrency(0);
    }

    async function openOperacaoModal(type) {
        operacaoForm.reset();
        showFeedback('tesouraria-operacao-feedback', '', false); // Clear previous feedback
        document.getElementById('tesouraria-operacao-type').value = type;

        let accountTypes;
        if (type === 'entrada') {
            operacaoTitle.textContent = 'Nova Entrada Manual';
            accountTypes = ['receita', 'investimento'];
        } else { // 'saida'
            operacaoTitle.textContent = 'Nova Saída Manual';
            accountTypes = ['despesa', 'custo', 'investimento'];
        }

        try {
            const q = query(
                collection(db, `users/${userId}/planosDeContas`),
                where('aceitaLancamento', '==', true),
                where('inativo', '!=', true)
            );
            const snapshot = await getDocs(q);
            const contas = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(conta => accountTypes.includes(conta.tipo));

            operacaoPlanoContasSelect.innerHTML = '<option value="">Selecione uma categoria</option>';
            contas.sort((a, b) => a.codigo.localeCompare(b.codigo)).forEach(conta => {
                const option = document.createElement('option');
                option.value = conta.id;
                option.textContent = `${conta.codigo} - ${conta.nome}`;
                operacaoPlanoContasSelect.appendChild(option);
            });

        } catch (error) {
            console.error("Erro ao carregar plano de contas para o modal:", error);
            showFeedback('tesouraria-operacao-feedback', "Erro ao carregar categorias.", true);
        }

        document.getElementById('tesouraria-operacao-data').value = new Date().toISOString().split('T')[0];
        operacaoModal.classList.remove('hidden');
    }

    function updateActionButtonsState() {
        const selectedIds = Array.from(tableBody.querySelectorAll('.movimentacao-checkbox:checked')).map(cb => cb.dataset.id);
        const count = selectedIds.length;

        if (count === 0) {
            conciliarBtn.disabled = true;
            desfazerConciliacaoBtn.disabled = true;
            estornarBtn.disabled = true;
            return;
        }

        const selectedMovs = selectedIds.map(id => allMovimentacoes.find(m => m.id === id));

        const allConciliado = selectedMovs.every(m => m.conciliado);
        const allPendente = selectedMovs.every(m => !m.conciliado);
        const anyEstornado = selectedMovs.some(m => m.estornado);

        conciliarBtn.disabled = !allPendente || anyEstornado;
        desfazerConciliacaoBtn.disabled = !allConciliado || anyEstornado;
        estornarBtn.disabled = count !== 1 || anyEstornado;
    }

    // --- Event Listeners ---
    [contaBancariaSelect, periodoDeInput, periodoAteInput].forEach(el => {
        el.addEventListener('change', fetchDataAndRender);
    });

    novaEntradaBtn.addEventListener('click', () => openOperacaoModal('entrada'));
    novaSaidaBtn.addEventListener('click', () => openOperacaoModal('saida'));
    closeOperacaoModalBtn.addEventListener('click', () => operacaoModal.classList.add('hidden'));
    cancelOperacaoModalBtn.addEventListener('click', () => operacaoModal.classList.add('hidden'));

    operacaoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const feedbackId = 'tesouraria-operacao-feedback';
        const contaBancariaId = contaBancariaSelect.value;
        if (!contaBancariaId) {
            showFeedback(feedbackId, "Por favor, selecione uma conta bancária primeiro.", true);
            return;
        }

        const tipoOperacao = document.getElementById('tesouraria-operacao-type').value;
        const valorCents = toCents(document.getElementById('tesouraria-operacao-valor').value);
        const data = document.getElementById('tesouraria-operacao-data').value;
        const descricao = document.getElementById('tesouraria-operacao-descricao').value;
        const planoContasId = operacaoPlanoContasSelect.value;
        const planoContasText = operacaoPlanoContasSelect.options[operacaoPlanoContasSelect.selectedIndex].text;

        const valorFinal = tipoOperacao === 'entrada' ? valorCents : -valorCents;
        const origemTipo = tipoOperacao === 'entrada' ? 'OUTRAS_ENTRADAS' : 'OUTRAS_SAIDAS';

        try {
            const contaBancariaNome = allContasBancarias.find(c => c.id === contaBancariaId)?.nome || 'N/A';

            await addDoc(collection(db, `users/${userId}/movimentacoesBancarias`), {
                contaBancariaId,
                contaBancariaNome,
                dataTransacao: data,
                valor: valorFinal,
                descricao: descricao,
                planoContasId: planoContasId, // Storing for reference
                origemTipo: origemTipo,
                origemId: null,
                origemDescricao: `Lançamento Manual: ${planoContasText}`,
                conciliado: false,
                estornado: false,
                adminId: userId,
                createdAt: serverTimestamp()
            });

            operacaoModal.classList.add('hidden');
            fetchDataAndRender(); // Refresh data
        } catch (error) {
            console.error("Erro ao salvar operação de tesouraria:", error);
            showFeedback(feedbackId, "Erro ao salvar a operação.", true);
        }
    });

    tableBody.addEventListener('click', (e) => {
        if (e.target.closest('.origem-link')) {
            e.preventDefault();
            const link = e.target.closest('.origem-link');
            const movId = link.dataset.movId;
            const mov = allMovimentacoes.find(m => m.id === movId);

            if (mov && mov.origemPath) {
                const pathParts = mov.origemPath.split('/');
                const parentId = pathParts[pathParts.length - 2]; // The ID of the despesa/receita

                if (mov.origemTipo === 'PAGAMENTO_DESPESA') {
                    window.openVisualizarModal(parentId);
                } else if (mov.origemTipo === 'RECEBIMENTO_RECEITA') {
                    window.openVisualizarReceitaModal(parentId);
                }
            }
        }
    });

    tableBody.addEventListener('change', (e) => {
        if (e.target.classList.contains('movimentacao-checkbox')) {
            updateActionButtonsState();
        }
    });

    conciliarBtn.addEventListener('click', () => updateConciliacaoStatus(true));
    desfazerConciliacaoBtn.addEventListener('click', () => updateConciliacaoStatus(false));

    async function updateConciliacaoStatus(isConciliado) {
        const selectedIds = Array.from(tableBody.querySelectorAll('.movimentacao-checkbox:checked')).map(cb => cb.dataset.id);
        if (selectedIds.length === 0) return;

        const batch = writeBatch(db);
        selectedIds.forEach(id => {
            const docRef = doc(db, `users/${userId}/movimentacoesBancarias`, id);
            batch.update(docRef, {
                conciliado: isConciliado,
                dataConciliacao: isConciliado ? new Date().toISOString().split('T')[0] : null
            });
        });

        try {
            await batch.commit();
            console.log(`Successfully updated ${selectedIds.length} items to conciliado: ${isConciliado}`);
            fetchDataAndRender(); // Refresh the view
        } catch (error) {
            console.error("Error updating conciliation status: ", error);
            alert("Failed to update conciliation status.");
        }
    }

    selectAllCheckbox.addEventListener('change', () => {
        tableBody.querySelectorAll('.movimentacao-checkbox').forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
        });
        updateActionButtonsState();
    });

    estornarBtn.addEventListener('click', () => {
        const selectedIds = Array.from(tableBody.querySelectorAll('.movimentacao-checkbox:checked')).map(cb => cb.dataset.id);
        if (selectedIds.length !== 1) return;

        selectedMovimentacaoForEstorno = allMovimentacoes.find(m => m.id === selectedIds[0]);
        if (selectedMovimentacaoForEstorno) {
            estornoDescricao.textContent = selectedMovimentacaoForEstorno.descricao;
            estornoModal.classList.remove('hidden');
        }
    });

    closeEstornoModalBtn.addEventListener('click', () => estornoModal.classList.add('hidden'));
    cancelEstornoBtn.addEventListener('click', () => estornoModal.classList.add('hidden'));
    confirmarEstornoBtn.addEventListener('click', handleEstorno);

    async function handleEstorno() {
        if (!selectedMovimentacaoForEstorno) return;

        const motivo = estornoMotivoInput.value.trim();
        if (!motivo) {
            alert("O motivo do estorno é obrigatório.");
            return;
        }

        const movOriginal = selectedMovimentacaoForEstorno;
        const movRef = doc(db, `users/${userId}/movimentacoesBancarias`, movOriginal.id);
        const novoEstornoRef = doc(collection(db, `users/${userId}/movimentacoesBancarias`));

        try {
            await runTransaction(db, async (transaction) => {
                const movDoc = await transaction.get(movRef);
                if (!movDoc.exists() || movDoc.data().estornado) {
                    throw new Error("Lançamento não encontrado ou já estornado.");
                }

                transaction.update(movRef, { estornado: true, conciliado: true });
                transaction.set(novoEstornoRef, {
                    ...movOriginal,
                    valor: -movOriginal.valor,
                    descricao: `Estorno: ${movOriginal.descricao}`,
                    origemTipo: 'ESTORNO',
                    estornoDeId: movOriginal.id,
                    conciliado: true,
                    dataConciliacao: new Date().toISOString().split('T')[0],
                    motivoEstorno: motivo,
                    createdAt: serverTimestamp()
                });

                if (movOriginal.origemPath) {
                    const origemRef = doc(db, movOriginal.origemPath);
                    const origemDoc = await transaction.get(origemRef);
                    if (!origemDoc.exists()) throw new Error("Documento de origem não encontrado para o estorno.");

                    const parentRef = origemRef.parent.parent;
                    const parentDoc = await transaction.get(parentRef);
                    if (!parentDoc.exists()) throw new Error("Documento pai (despesa/receita) não encontrado.");

                    const origemData = origemDoc.data();
                    const parentData = parentDoc.data();
                    const valorPrincipalEstornado = origemData.valorPrincipal || 0;

                    if (movOriginal.origemTipo === 'PAGAMENTO_DESPESA') {
                        const novoTotalPago = (parentData.totalPago || 0) - valorPrincipalEstornado;
                        const novoSaldo = (parentData.valorSaldo || 0) + valorPrincipalEstornado;
                        let novoStatus = parentData.status;
                        if (novoTotalPago === 0) {
                            novoStatus = new Date(parentData.vencimento + 'T00:00:00') < new Date() ? 'Vencido' : 'Pendente';
                        } else if (novoSaldo > 0) {
                            novoStatus = 'Pago Parcialmente';
                        }
                        transaction.update(origemRef, { estornado: true });
                        transaction.update(parentRef, { totalPago: novoTotalPago, valorSaldo: novoSaldo, status: novoStatus });

                    } else if (movOriginal.origemTipo === 'RECEBIMENTO_RECEITA') {
                        const novoTotalRecebido = (parentData.totalRecebido || 0) - valorPrincipalEstornado;
                        const novoSaldoPendente = (parentData.saldoPendente || 0) + valorPrincipalEstornado;
                        let novoStatus = parentData.status;
                         if (novoTotalRecebido === 0) {
                            const vencimento = new Date((parentData.dataVencimento || parentData.vencimento) + 'T00:00:00');
                            novoStatus = vencimento < new Date() ? 'Vencido' : 'Pendente';
                        } else if (novoSaldoPendente > 0) {
                            novoStatus = 'Recebido Parcialmente';
                        }
                        transaction.update(origemRef, { estornado: true });
                        transaction.update(parentRef, { totalRecebido: novoTotalRecebido, saldoPendente: novoSaldoPendente, status: novoStatus });
                    }
                }
            });

            alert("Estorno realizado com sucesso!");
            estornoModal.classList.add('hidden');
            fetchDataAndRender();

        } catch (error) {
            console.error("Erro na transação de estorno:", error);
            alert(`Falha ao realizar estorno: ${error.message}`);
        } finally {
            selectedMovimentacaoForEstorno = null;
            estornoMotivoInput.value = '';
        }
    }


    // --- Module Initialization ---
    loadInitialData();
}