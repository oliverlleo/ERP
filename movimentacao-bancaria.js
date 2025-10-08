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

    // Modal de Transferência
    const transferenciaModal = document.getElementById('transferencia-modal');
    const closeTransferenciaModalBtn = document.getElementById('close-transferencia-modal-btn');
    const cancelTransferenciaModalBtn = document.getElementById('cancel-transferencia-modal-btn');
    const transferenciaForm = document.getElementById('transferencia-form');
    const transferenciaContaOrigemSelect = document.getElementById('transferencia-conta-origem');
    const transferenciaContaDestinoSelect = document.getElementById('transferencia-conta-destino');


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
        desfazerConciliacaoBtn.addEventListener('click', () => handleConciliacao(false));
        estornarBtn.addEventListener('click', handleEstorno);

        // Listeners para o Modal de Transferência
        transferenciaBtn.addEventListener('click', openTransferenciaModal);
        closeTransferenciaModalBtn.addEventListener('click', () => transferenciaModal.classList.add('hidden'));
        cancelTransferenciaModalBtn.addEventListener('click', () => transferenciaModal.classList.add('hidden'));
        transferenciaForm.addEventListener('submit', handleTransferenciaSubmit);
    }

    async function fetchDataAndRender() {
        const contaId = contaBancariaSelect.value;
        const de = periodoDeInput.value;
        const ate = periodoAteInput.value;

        if (!contaId) {
            alert("Por favor, selecione uma conta bancária.");
            return;
        }

        // Query only by the mandatory field to avoid composite indexes
        const q = query(collection(db, 'users', userId, 'movimentacoesBancarias'),
            where("contaBancariaId", "==", contaId)
        );

        try {
            const querySnapshot = await getDocs(q);
            // Perform date filtering on the client side
            allMovimentacoes = querySnapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(mov => {
                    if (!de || !ate) return true;
                    return mov.dataTransacao >= de && mov.dataTransacao <= ate;
                });

            allMovimentacoes.sort((a, b) => {
                const dateA = new Date(a.dataTransacao);
                const dateB = new Date(b.dataTransacao);
                if (dateA < dateB) return -1;
                if (dateA > dateB) return 1;
                // If dates are the same, check for creation timestamp to maintain order
                const timeA = a.createdAt?.toMillis() || 0;
                const timeB = b.createdAt?.toMillis() || 0;
                return timeA - timeB;
            });

            const saldoInicialPeriodo = await calculateAndRenderKPIs();
            renderTable(saldoInicialPeriodo);

        } catch (error) {
            console.error("Error fetching bank transactions: ", error);
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-red-500">Erro ao carregar os dados.</td></tr>`;
        }
    }

    function renderTable(saldoInicialPeriodo = 0) {
        tableBody.innerHTML = '';
        if (allMovimentacoes.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center p-8 text-gray-500">Nenhuma movimentação encontrada para o período e conta selecionados.</td></tr>`;
            return;
        }

        let saldoCorrente = saldoInicialPeriodo;

        allMovimentacoes.forEach(mov => {
            const tr = document.createElement('tr');
            const valor = mov.valor || 0;

            if (!mov.estornado) {
                saldoCorrente += valor;
            }

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

    async function calculateAndRenderKPIs() {
        const contaId = contaBancariaSelect.value;
        const de = periodoDeInput.value;
        const ate = periodoAteInput.value;

        if (!contaId || !de) {
            // Clear KPIs
            kpiSaldoInicial.textContent = formatCurrency(0);
            kpiTotalEntradas.textContent = formatCurrency(0);
            kpiTotalSaidas.textContent = formatCurrency(0);
            kpiSaldoPeriodo.textContent = formatCurrency(0);
            kpiSaldoFinal.textContent = formatCurrency(0);
            kpiSaldoAConciliar.textContent = formatCurrency(0);
            return 0;
        }

        const conta = contasBancariasData.find(c => c.id === contaId);
        const saldoInicialConta = conta ? (conta.saldoInicial || 0) : 0;

        // Query for all movements for the account, then filter by date on the client-side
        const qAllForAccount = query(collection(db, 'users', userId, 'movimentacoesBancarias'),
            where("contaBancariaId", "==", contaId)
        );
        const snapshotAll = await getDocs(qAllForAccount);
        let ajusteSaldoInicial = 0;
        snapshotAll.forEach(doc => {
            const data = doc.data();
            // Client-side filtering for transactions before the start date
            if (data.dataTransacao < de) {
                // Only count non-voided transactions for balance calculation
                if (!data.estornado) {
                    ajusteSaldoInicial += data.valor || 0;
                }
            }
        });

        const saldoInicialPeriodo = saldoInicialConta + ajusteSaldoInicial;

        // Calculate metrics for the period using the already-fetched 'allMovimentacoes'
        let totalEntradas = 0;
        let totalSaidas = 0;
        let saldoAConciliar = 0;

        allMovimentacoes.forEach(mov => {
            // Ignore voided transactions for period totals
            if (mov.estornado) return;

            const valor = mov.valor || 0;
            if (valor > 0) {
                totalEntradas += valor;
            } else {
                totalSaidas += valor;
            }
            if (!mov.conciliado) {
                saldoAConciliar += valor;
            }
        });

        const saldoPeriodo = totalEntradas + totalSaidas;
        const saldoFinal = saldoInicialPeriodo + saldoPeriodo;

        // Render KPIs
        kpiSaldoInicial.textContent = formatCurrency(saldoInicialPeriodo);
        kpiTotalEntradas.textContent = formatCurrency(totalEntradas);
        kpiTotalSaidas.textContent = formatCurrency(Math.abs(totalSaidas));
        kpiSaldoPeriodo.textContent = formatCurrency(saldoPeriodo);
        kpiSaldoFinal.textContent = formatCurrency(saldoFinal);
        kpiSaldoAConciliar.textContent = formatCurrency(saldoAConciliar);

        return saldoInicialPeriodo;
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
        const movimentacaoParaEstornar = allMovimentacoes.find(m => m.id === movimentacaoId);

        if (!movimentacaoParaEstornar) {
            alert("Erro: Movimentação não encontrada nos dados carregados.");
            return;
        }

        const { origemTipo, origemId, origemParentId } = movimentacaoParaEstornar;

        if (!['PAGAMENTO_DESPESA', 'RECEBIMENTO_RECEITA'].includes(origemTipo)) {
            alert("Apenas movimentações originadas de Contas a Pagar ou Receber podem ser estornadas a partir desta tela.");
            return;
        }
         if (!origemParentId || !origemId) {
            alert("Erro: A movimentação selecionada não tem informações de origem completas para o estorno.");
            return;
        }

        const motivo = prompt("Por favor, insira o motivo do estorno:");
        if (!motivo) {
            alert("Estorno cancelado. O motivo é obrigatório.");
            return;
        }

        const movimentacaoRef = doc(db, 'users', userId, 'movimentacoesBancarias', movimentacaoId);
        const isDespesa = origemTipo === 'PAGAMENTO_DESPESA';
        const parentCollectionName = isDespesa ? 'despesas' : 'receitas';
        const subCollectionName = isDespesa ? 'pagamentos' : 'recebimentos';

        const parentRef = doc(db, 'users', userId, parentCollectionName, origemParentId);
        const pagamentoOuRecebimentoRef = doc(parentRef, subCollectionName, origemId);

        try {
            await runTransaction(db, async (transaction) => {
                const movDoc = await transaction.get(movimentacaoRef);
                const parentDoc = await transaction.get(parentRef);
                const pagamentoOuRecebimentoDoc = await transaction.get(pagamentoOuRecebimentoRef);

                if (!movDoc.exists() || !parentDoc.exists() || !pagamentoOuRecebimentoDoc.exists()) {
                    throw new Error("Um dos documentos necessários para o estorno não foi encontrado (movimentação, documento pai, ou pagamento/recebimento).");
                }

                const movData = movDoc.data();
                if (movData.estornado) throw new Error("Esta movimentação já foi estornada.");

                const pagamentoOuRecebimentoData = pagamentoOuRecebimentoDoc.data();
                if (pagamentoOuRecebimentoData.estornado) throw new Error("O pagamento/recebimento de origem já foi estornado.");

                // 1. Marcar movimentação original como estornada
                transaction.update(movimentacaoRef, { estornado: true, conciliado: true });

                // 2. Marcar pagamento/recebimento original como estornado
                transaction.update(pagamentoOuRecebimentoRef, { estornado: true });

                // 3. Criar registro de estorno na subcoleção (pagamentos ou recebimentos)
                const novoEstornoSubcolecaoRef = doc(collection(parentRef, subCollectionName));
                transaction.set(novoEstornoSubcolecaoRef, {
                    tipoTransacao: "Estorno",
                    dataTransacao: new Date().toISOString().split('T')[0],
                    valorPrincipal: pagamentoOuRecebimentoData.valorPrincipal || 0,
                    usuarioResponsavel: currentUserName || "N/A",
                    motivoEstorno: motivo,
                    pagamentoOriginalId: isDespesa ? origemId : null,
                    recebimentoOriginalId: !isDespesa ? origemId : null,
                    createdAt: serverTimestamp()
                });

                // 4. Criar movimentação de contrapartida
                const estornoMovimentacaoRef = doc(collection(db, 'users', userId, 'movimentacoesBancarias'));
                transaction.set(estornoMovimentacaoRef, {
                    ...movData,
                    valor: -movData.valor,
                    descricao: `Estorno: ${movData.descricao}`,
                    origemTipo: 'ESTORNO',
                    origemId: novoEstornoSubcolecaoRef.id,
                    origemDescricao: `Estorno de ${movData.origemDescricao}`,
                    estornado: false,
                    estornoDeId: movimentacaoId,
                    conciliado: true, // Nasce conciliado
                    createdAt: serverTimestamp()
                });

                // 5. Reverter valores e status no documento pai
                const parentData = parentDoc.data();
                const valorPrincipalEstornado = pagamentoOuRecebimentoData.valorPrincipal || 0;
                const today = new Date(); today.setHours(0, 0, 0, 0);

                if (isDespesa) {
                    const novoTotalPago = (parentData.totalPago || 0) - valorPrincipalEstornado;
                    const novoSaldo = (parentData.valorSaldo || 0) + valorPrincipalEstornado;
                    let novoStatus;
                    const vencimento = new Date(parentData.vencimento + 'T00:00:00');
                    if (novoSaldo >= parentData.valorOriginal) {
                        novoStatus = vencimento < today ? 'Vencido' : 'Pendente';
                    } else if (novoSaldo > 0) {
                        novoStatus = 'Pago Parcialmente';
                    } else {
                        novoStatus = 'Pago';
                    }
                    transaction.update(parentRef, { totalPago: novoTotalPago, valorSaldo: novoSaldo, status: novoStatus });
                } else { // É Receita
                    const novoTotalRecebido = (parentData.totalRecebido || 0) - valorPrincipalEstornado;
                    const novoSaldoPendente = (parentData.saldoPendente || 0) + valorPrincipalEstornado;
                    let novoStatus;
                    const vencimento = new Date((parentData.dataVencimento || parentData.vencimento) + 'T00:00:00');
                    if (novoSaldoPendente <= 0) {
                        novoStatus = 'Recebido';
                    } else if (novoTotalRecebido > 0) {
                        novoStatus = 'Recebido Parcialmente';
                    } else {
                        novoStatus = vencimento < today ? 'Vencido' : 'Pendente';
                    }
                    transaction.update(parentRef, { totalRecebido: novoTotalRecebido, saldoPendente: novoSaldoPendente, status: novoStatus });
                }
            });

            alert("Estorno realizado com sucesso!");
            fetchDataAndRender(); // Refresh data after successful transaction

        } catch (error) {
            console.error("Erro na transação de estorno:", error);
            alert(`Falha ao realizar estorno: ${error.message}`);
        }
    }

    init();

    function openTransferenciaModal() {
        transferenciaForm.reset();

        // Populate dropdowns
        transferenciaContaOrigemSelect.innerHTML = '<option value="">Selecione a conta de origem</option>';
        transferenciaContaDestinoSelect.innerHTML = '<option value="">Selecione a conta de destino</option>';
        contasBancariasData.forEach(conta => {
            const optionOrigem = document.createElement('option');
            optionOrigem.value = conta.id;
            optionOrigem.textContent = conta.nome;
            transferenciaContaOrigemSelect.appendChild(optionOrigem);

            const optionDestino = document.createElement('option');
            optionDestino.value = conta.id;
            optionDestino.textContent = conta.nome;
            transferenciaContaDestinoSelect.appendChild(optionDestino);
        });

        document.getElementById('transferencia-data').value = new Date().toISOString().split('T')[0];
        transferenciaModal.classList.remove('hidden');
    }

    async function handleTransferenciaSubmit(e) {
        e.preventDefault();

        const contaOrigemId = transferenciaContaOrigemSelect.value;
        const contaDestinoId = transferenciaContaDestinoSelect.value;
        const valorCents = toCents(document.getElementById('transferencia-valor').value);
        const dataTransacao = document.getElementById('transferencia-data').value;
        const obs = document.getElementById('transferencia-obs').value;

        if (!contaOrigemId || !contaDestinoId || !valorCents || !dataTransacao) {
            alert("Todos os campos são obrigatórios.");
            return;
        }

        if (contaOrigemId === contaDestinoId) {
            alert("A conta de origem e destino não podem ser a mesma.");
            return;
        }

        if (valorCents <= 0) {
            alert("O valor da transferência deve ser positivo.");
            return;
        }

        const contaOrigemNome = transferenciaContaOrigemSelect.options[transferenciaContaOrigemSelect.selectedIndex].text;
        const contaDestinoNome = transferenciaContaDestinoSelect.options[transferenciaContaDestinoSelect.selectedIndex].text;

        const transferenciaId = doc(collection(db, 'users')).id;

        const batch = writeBatch(db);
        const movimentacoesRef = collection(db, 'users', userId, 'movimentacoesBancarias');

        const saidaRef = doc(movimentacoesRef);
        batch.set(saidaRef, {
            contaBancariaId: contaOrigemId,
            contaBancariaNome: contaOrigemNome,
            dataTransacao: dataTransacao,
            valor: -valorCents,
            descricao: `Transferência para ${contaDestinoNome}. ${obs}`,
            origemTipo: 'TRANSFERENCIA_SAIDA',
            origemId: transferenciaId,
            origemDescricao: "Transferência entre contas",
            conciliado: false,
            adminId: userId,
            createdAt: serverTimestamp(),
            estornado: false,
            estornoDeId: null
        });

        const entradaRef = doc(movimentacoesRef);
        batch.set(entradaRef, {
            contaBancariaId: contaDestinoId,
            contaBancariaNome: contaDestinoNome,
            dataTransacao: dataTransacao,
            valor: valorCents,
            descricao: `Transferência de ${contaOrigemNome}. ${obs}`,
            origemTipo: 'TRANSFERENCIA_ENTRADA',
            origemId: transferenciaId,
            origemDescricao: "Transferência entre contas",
            conciliado: false,
            adminId: userId,
            createdAt: serverTimestamp(),
            estornado: false,
            estornoDeId: null
        });

        try {
            await batch.commit();
            alert("Transferência registrada com sucesso!");
            transferenciaModal.classList.add('hidden');
            fetchDataAndRender();
        } catch (error) {
            console.error("Erro ao registrar transferência:", error);
            alert("Falha ao registrar a transferência.");
        }
    }
}