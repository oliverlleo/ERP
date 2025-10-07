// movimentacao-bancaria.js
import { getFirestore, doc, collection, query, where, getDocs, writeBatch, addDoc, serverTimestamp, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

export function initializeMovimentacaoBancaria(db, userId, commonUtils) {
    const { formatCurrency, toCents, fromCents, showFeedback } = commonUtils;

    // --- DOM Elements ---
    const page = document.getElementById('movimentacao-bancaria-page');
    if (!page) return; // Don't run if the page doesn't exist

    const contaBancariaSelect = document.getElementById('mov-conta-bancaria-select');
    const periodoDeInput = document.getElementById('mov-periodo-de');
    const periodoAteInput = document.getElementById('mov-periodo-ate');
    const filtrarBtn = document.getElementById('mov-filtrar-btn');
    const tableBody = document.getElementById('movimentacoes-bancarias-table-body');
    const selectAllCheckbox = document.getElementById('mov-select-all-checkbox');

    // KPIs
    const kpiSaldoInicial = document.getElementById('kpi-mov-saldo-inicial');
    const kpiTotalEntradas = document.getElementById('kpi-mov-total-entradas');
    const kpiTotalSaidas = document.getElementById('kpi-mov-total-saidas');
    const kpiSaldoPeriodo = document.getElementById('kpi-mov-saldo-periodo');
    const kpiSaldoFinal = document.getElementById('kpi-mov-saldo-final');
    const kpiSaldoAConciliar = document.getElementById('kpi-mov-saldo-a-conciliar');

    // Action Buttons
    const novaEntradaBtn = document.getElementById('mov-nova-entrada-btn');
    const novaSaidaBtn = document.getElementById('mov-nova-saida-btn');
    const transferenciaBtn = document.getElementById('mov-transferencia-btn');
    const conciliarBtn = document.getElementById('mov-conciliar-btn');
    const desfazerConciliacaoBtn = document.getElementById('mov-desfazer-conciliacao-btn');
    const estornarBtn = document.getElementById('mov-estornar-btn');

    // Modal de Movimentação Avulsa
    const movAvulsaModal = document.getElementById('movimentacao-avulsa-modal');
    const movAvulsaModalTitle = document.getElementById('mov-avulsa-modal-title');
    const movAvulsaForm = document.getElementById('movimentacao-avulsa-form');
    const movAvulsaTipoInput = document.getElementById('mov-avulsa-tipo');
    const movAvulsaPlanoContasSelect = document.getElementById('mov-avulsa-plano-contas');
    const closeMovAvulsaModalBtn = document.getElementById('close-mov-avulsa-modal-btn');
    const cancelMovAvulsaModalBtn = document.getElementById('cancel-mov-avulsa-modal-btn');


    let allMovimentacoes = [];
    let contasBancariasData = [];

    // --- Initialization ---
    async function init() {
        await populateContasBancarias();
        setDefaultDateFilters();
        addEventListeners();
    }

    async function populateContasBancarias() {
        const contasQuery = query(collection(db, 'users', userId, 'contasBancarias'));
        onSnapshot(contasQuery, (snapshot) => {
            contasBancariasData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            contaBancariaSelect.innerHTML = '<option value="">Selecione uma conta</option>';
            contasBancariasData.forEach(conta => {
                const option = document.createElement('option');
                option.value = conta.id;
                option.textContent = conta.nome;
                contaBancariaSelect.appendChild(option);
            });
        });
    }

    function setDefaultDateFilters() {
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        periodoDeInput.value = firstDayOfMonth.toISOString().split('T')[0];
        periodoAteInput.value = lastDayOfMonth.toISOString().split('T')[0];
    }

    function addEventListeners() {
        filtrarBtn.addEventListener('click', fetchDataAndRender);

        novaEntradaBtn.addEventListener('click', () => openAvulsaModal('ENTRADA'));
        novaSaidaBtn.addEventListener('click', () => openAvulsaModal('SAIDA'));

        closeMovAvulsaModalBtn.addEventListener('click', () => movAvulsaModal.classList.add('hidden'));
        cancelMovAvulsaModalBtn.addEventListener('click', () => movAvulsaModal.classList.add('hidden'));
        movAvulsaForm.addEventListener('submit', handleAvulsaFormSubmit);

        tableBody.addEventListener('change', updateActionButtonsState);
        selectAllCheckbox.addEventListener('change', () => {
            tableBody.querySelectorAll('.mov-checkbox').forEach(checkbox => {
                checkbox.checked = selectAllCheckbox.checked;
            });
            updateActionButtonsState();
        });

        conciliarBtn.addEventListener('click', () => handleConciliacao(true));
        desfacerConciliacaoBtn.addEventListener('click', () => handleConciliacao(false));
        estornarBtn.addEventListener('click', handleEstorno);
    }

    async function fetchDataAndRender() {
        const contaId = contaBancariaSelect.value;
        const de = periodoDeInput.value;
        const ate = periodoAteInput.value;

        if (!contaId) {
            alert("Por favor, selecione uma conta bancária.");
            return;
        }

        const q = query(collection(db, 'users', userId, 'movimentacoesBancarias'),
            where("contaBancariaId", "==", contaId),
            where("dataTransacao", ">=", de),
            where("dataTransacao", "<=", ate)
        );

        try {
            const querySnapshot = await getDocs(q);
            allMovimentacoes = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            allMovimentacoes.sort((a, b) => new Date(a.dataTransacao) - new Date(b.dataTransacao));

            renderTable();
            calculateAndRenderKPIs();
        } catch (error) {
            console.error("Error fetching bank transactions: ", error);
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-red-500">Erro ao carregar os dados.</td></tr>`;
        }
    }

    function renderTable() {
        tableBody.innerHTML = '';
        if (allMovimentacoes.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center p-8 text-gray-500">Nenhuma movimentação encontrada para o período e conta selecionados.</td></tr>`;
            return;
        }

        let saldoCorrente = 0; // This needs to be calculated based on the start balance of the period.

        allMovimentacoes.forEach(mov => {
            const tr = document.createElement('tr');
            const valor = mov.valor || 0;
            saldoCorrente += valor;

            const isEstornado = mov.estornado === true;
            tr.className = isEstornado ? 'bg-gray-200 text-gray-500 line-through' : 'hover:bg-gray-50';

            const statusText = mov.conciliado ? 'Conciliado' : 'Pendente';
            const statusClass = mov.conciliado ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800';

            tr.innerHTML = `
                <td class="p-4"><input type="checkbox" class="mov-checkbox h-4 w-4" data-id="${mov.id}" ${isEstornado ? 'disabled' : ''}></td>
                <td class="px-3 py-2 text-sm">${new Date(mov.dataTransacao + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                <td class="px-3 py-2 text-sm">${mov.descricao || ''}</td>
                <td class="px-3 py-2 text-sm"><a href="#" class="text-blue-600 hover:underline">${mov.origemDescricao || mov.origemTipo || ''}</a></td>
                <td class="px-3 py-2 text-sm text-right text-green-600">${valor > 0 ? formatCurrency(valor) : '-'}</td>
                <td class="px-3 py-2 text-sm text-right text-red-600">${valor < 0 ? formatCurrency(Math.abs(valor)) : '-'}</td>
                <td class="px-3 py-2 text-sm text-right font-mono">${formatCurrency(saldoCorrente)}</td>
                <td class="px-3 py-2 text-center text-sm">
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass}">
                        ${statusText}
                    </span>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    function calculateAndRenderKPIs() {
        // Placeholder for KPI calculation logic
        kpiSaldoInicial.textContent = formatCurrency(0);
        kpiTotalEntradas.textContent = formatCurrency(0);
        kpiTotalSaidas.textContent = formatCurrency(0);
        kpiSaldoPeriodo.textContent = formatCurrency(0);
        kpiSaldoFinal.textContent = formatCurrency(0);
        kpiSaldoAConciliar.textContent = formatCurrency(0);
    }

    function updateActionButtonsState() {
        const selectedIds = Array.from(tableBody.querySelectorAll('.mov-checkbox:checked')).map(cb => cb.dataset.id);
        const selectedCount = selectedIds.length;

        if (selectedCount === 0) {
            conciliarBtn.disabled = true;
            desfazerConciliacaoBtn.disabled = true;
            estornarBtn.disabled = true;
            return;
        }

        const selectedMovs = selectedIds.map(id => allMovimentacoes.find(m => m.id === id));

        const canConciliar = selectedMovs.some(m => m && !m.conciliado);
        const canDesfazer = selectedMovs.some(m => m && m.conciliado);

        conciliarBtn.disabled = !canConciliar;
        desfazerConciliacaoBtn.disabled = !canDesfazer;
        estornarBtn.disabled = selectedCount !== 1;
    }

    async function openAvulsaModal(tipo) {
        movAvulsaForm.reset();
        movAvulsaTipoInput.value = tipo;
        movAvulsaModalTitle.textContent = tipo === 'ENTRADA' ? 'Registrar Nova Entrada' : 'Registrar Nova Saída';

        // Populate plano de contas dropdown
        const contasQuery = query(collection(db, 'users', userId, 'planosDeContas'), where('aceitaLancamento', '==', true));
        const contasSnap = await getDocs(contasQuery);
        const allContas = contasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        movAvulsaPlanoContasSelect.innerHTML = '<option value="">Selecione</option>';
        allContas
            .filter(c => c.inativo !== true)
            .forEach(conta => {
                const option = document.createElement('option');
                option.value = conta.id;
                option.textContent = `${conta.codigo} - ${conta.nome}`;
                option.dataset.codigo = conta.codigo;
                movAvulsaPlanoContasSelect.appendChild(option);
            });

        document.getElementById('mov-avulsa-data').value = new Date().toISOString().split('T')[0];
        movAvulsaModal.classList.remove('hidden');
    }

    async function handleAvulsaFormSubmit(e) {
        e.preventDefault();
        const contaBancariaId = contaBancariaSelect.value;
        if (!contaBancariaId) {
            alert("Selecione a conta bancária onde a movimentação ocorreu.");
            return;
        }

        const tipo = movAvulsaTipoInput.value;
        const valorCents = toCents(document.getElementById('mov-avulsa-valor').value);
        const valorFinal = tipo === 'ENTRADA' ? valorCents : -valorCents;
        const planoContasSelect = document.getElementById('mov-avulsa-plano-contas');
        const selectedOption = planoContasSelect.options[planoContasSelect.selectedIndex];

        const data = {
            contaBancariaId,
            contaBancariaNome: contaBancariaSelect.options[contaBancariaSelect.selectedIndex].text,
            dataTransacao: document.getElementById('mov-avulsa-data').value,
            valor: valorFinal,
            descricao: document.getElementById('mov-avulsa-descricao').value,
            origemTipo: tipo === 'ENTRADA' ? 'OUTRAS_ENTRADAS' : 'OUTRAS_SAIDAS',
            origemId: null,
            origemDescricao: "Lançamento Manual",
            conciliado: false,
            dataConciliacao: null,
            usuarioConciliacao: null,
            estornado: false,
            estornoDeId: null,
            adminId: userId,
            createdAt: serverTimestamp()
        };

        try {
            await addDoc(collection(db, 'users', userId, 'movimentacoesBancarias'), data);
            movAvulsaModal.classList.add('hidden');
            fetchDataAndRender(); // Refresh data
        } catch (error) {
            console.error("Erro ao salvar movimentação avulsa:", error);
            alert("Falha ao salvar a movimentação.");
        }
    }

    async function handleConciliacao(conciliar) {
        const selectedIds = Array.from(tableBody.querySelectorAll('.mov-checkbox:checked')).map(cb => cb.dataset.id);
        if (selectedIds.length === 0) return;

        const batch = writeBatch(db);
        selectedIds.forEach(id => {
            const docRef = doc(db, 'users', userId, 'movimentacoesBancarias', id);
            batch.update(docRef, {
                conciliado: conciliar,
                dataConciliacao: conciliar ? new Date() : null,
                // usuarioConciliacao: userName // needs current user name
            });
        });

        try {
            await batch.commit();
            fetchDataAndRender(); // Refresh data
        } catch (error) {
            console.error("Erro ao (des)conciliar:", error);
            alert("Falha ao atualizar o status de conciliação.");
        }
    }

    async function handleEstorno() {
        const selectedIds = Array.from(tableBody.querySelectorAll('.mov-checkbox:checked')).map(cb => cb.dataset.id);
        if (selectedIds.length !== 1) {
            alert("Por favor, selecione exatamente uma movimentação para estornar.");
            return;
        }
        const movimentacaoId = selectedIds[0];

        const motivo = prompt("Por favor, insira o motivo do estorno:");
        if (!motivo) {
            alert("Estorno cancelado. O motivo é obrigatório.");
            return;
        }

        const movimentacaoRef = doc(db, 'users', userId, 'movimentacoesBancarias', movimentacaoId);

        try {
            await runTransaction(db, async (transaction) => {
                const movDoc = await transaction.get(movimentacaoRef);
                if (!movDoc.exists()) throw new Error("Movimentação não encontrada.");

                const movData = movDoc.data();
                if (movData.estornado) throw new Error("Esta movimentação já foi estornada.");
                if (!['PAGAMENTO_DESPESA', 'RECEBIMENTO_RECEITA'].includes(movData.origemTipo)) {
                    throw new Error("Apenas movimentações originadas de Contas a Pagar ou Receber podem ser estornadas a partir daqui.");
                }

                // 1. Marcar a movimentação original como estornada
                transaction.update(movimentacaoRef, {
                    estornado: true,
                    conciliado: true // An estorno and its source should be considered reconciled to not affect the balance to reconcile.
                });

                // 2. Criar a movimentação de contrapartida (o estorno em si)
                const estornoRef = doc(collection(db, 'users', userId, 'movimentacoesBancarias'));
                transaction.set(estornoRef, {
                    ...movData,
                    valor: -movData.valor, // Inverte o valor
                    descricao: `Estorno: ${movData.descricao}`,
                    origemTipo: 'ESTORNO',
                    origemDescricao: `Estorno de ${movData.origemDescricao}`,
                    estornado: false,
                    estornoDeId: movimentacaoId,
                    conciliado: true, // Nasce conciliado
                    createdAt: serverTimestamp()
                });

                // 3. Reverter o efeito no documento de origem (despesa ou receita)
                const isDespesa = movData.origemTipo === 'PAGAMENTO_DESPESA';
                const parentCollection = isDespesa ? 'despesas' : 'receitas';
                const parentId = movData.origemParentId;
                if (!parentId) throw new Error("ID do documento pai não encontrado na movimentação.");

                const parentRef = doc(db, 'users', userId, parentCollection, parentId);
                const parentDoc = await transaction.get(parentRef);
                if (!parentDoc.exists()) throw new Error("Documento de origem (despesa/receita) não encontrado.");

                const parentData = parentDoc.data();
                const pagamentoRef = doc(parentRef, isDespesa ? 'pagamentos' : 'recebimentos', movData.origemId);
                const pagamentoDoc = await transaction.get(pagamentoRef);
                if (!pagamentoDoc.exists()) throw new Error("Documento de pagamento/recebimento original não encontrado.");

                const pagamentoData = pagamentoDoc.data();

                // Marcar o pagamento/recebimento original como estornado também
                transaction.update(pagamentoRef, { estornado: true });

                // Reverter os valores no documento pai
                if (isDespesa) {
                    const novoTotalPago = (parentData.totalPago || 0) - (pagamentoData.valorPrincipal || 0);
                    const novoSaldo = (parentData.valorSaldo || 0) + (pagamentoData.valorPrincipal || 0);
                    const novoStatus = novoSaldo > 0 ? 'Pago Parcialmente' : 'Pendente'; // Simplified status logic
                    transaction.update(parentRef, {
                        totalPago: novoTotalPago,
                        valorSaldo: novoSaldo,
                        status: novoStatus
                    });
                } else { // É Receita
                    const novoTotalRecebido = (parentData.totalRecebido || 0) - (pagamentoData.valorPrincipal || 0);
                    const novoSaldoPendente = (parentData.saldoPendente || 0) + (pagamentoData.valorPrincipal || 0);
                    const novoStatus = novoSaldoPendente > 0 ? 'Pendente' : 'Recebido'; // Simplified
                    transaction.update(parentRef, {
                        totalRecebido: novoTotalRecebido,
                        saldoPendente: novoSaldoPendente,
                        status: novoStatus
                    });
                }
            });

            alert("Estorno realizado com sucesso!");
            fetchDataAndRender();

        } catch (error) {
            console.error("Erro na transação de estorno:", error);
            alert(`Falha ao realizar estorno: ${error.message}`);
        }
    }

    init();
}