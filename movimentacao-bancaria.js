import { collection, query, where, onSnapshot, doc, getDoc, writeBatch, runTransaction, serverTimestamp, addDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// This module will be initialized from the main script
export function initializeMovimentacaoBancaria(db, userId, commonUtils) {
    if (!userId) return;

    const { formatCurrency, fromCents, toCents, showFeedback } = commonUtils;

    // DOM Elements
    const contaBancariaSelect = document.getElementById('mov-conta-bancaria-select');
    const periodoDeInput = document.getElementById('mov-periodo-de');
    const periodoAteInput = document.getElementById('mov-periodo-ate');
    const tableBody = document.getElementById('movimentacoes-bancarias-table-body');
    const selectAllCheckbox = document.getElementById('mov-select-all-checkbox');

    // KPIs
    const kpiSaldoInicial = document.getElementById('kpi-saldo-inicial');
    const kpiTotalEntradas = document.getElementById('kpi-total-entradas-mov');
    const kpiTotalSaidas = document.getElementById('kpi-total-saidas-mov');
    const kpiSaldoPeriodo = document.getElementById('kpi-saldo-periodo');
    const kpiSaldoFinal = document.getElementById('kpi-saldo-final-mov');
    const kpiSaldoAConciliar = document.getElementById('kpi-saldo-a-conciliar');

    // Action Buttons
    const conciliarBtn = document.getElementById('mov-conciliar-btn');
    const desfazerBtn = document.getElementById('mov-desfazer-conciliacao-btn');
    const estornarBtn = document.getElementById('mov-estornar-lancamento-btn');


    let currentListenerUnsubscribe = null;
    let allMovimentacoes = [];

    // --- Main Logic ---

    // Load data when filters change
    contaBancariaSelect.addEventListener('change', loadMovimentacoes);
    periodoDeInput.addEventListener('change', loadMovimentacoes);
    periodoAteInput.addEventListener('change', loadMovimentacoes);

    function loadMovimentacoes() {
        const contaId = contaBancariaSelect.value;
        const de = periodoDeInput.value;
        const ate = periodoAteInput.value;

        if (currentListenerUnsubscribe) {
            currentListenerUnsubscribe();
        }

        if (!contaId) {
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center p-8 text-gray-500">Selecione uma conta bancária para começar.</td></tr>';
            resetKPIs();
            return;
        }

        let q = query(collection(db, `users/${userId}/movimentacoesBancarias`), where("contaBancariaId", "==", contaId));

        if (de) {
            q = query(q, where("dataTransacao", ">=", de));
        }
        if (ate) {
            q = query(q, where("dataTransacao", "<=", ate));
        }
        // Firestore doesn't support ordering by a field different from the range filter field.
        // We'll have to sort client-side.

        currentListenerUnsubscribe = onSnapshot(q, (querySnapshot) => {
            allMovimentacoes = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            allMovimentacoes.sort((a, b) => new Date(a.dataTransacao) - new Date(b.dataTransacao) || a.createdAt.toMillis() - b.createdAt.toMillis());
            renderMovimentacoes();
            calculateAndRenderKPIs();
        }, (error) => {
            console.error("Error fetching movimentacoesBancarias: ", error);
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center p-8 text-red-500">Erro ao carregar movimentações.</td></tr>';
        });
    }

    function renderMovimentacoes() {
        if (!tableBody) return;
        tableBody.innerHTML = '';
        if (allMovimentacoes.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center p-8 text-gray-500">Nenhuma movimentação encontrada para esta conta no período selecionado.</td></tr>';
            return;
        }

        let saldoCorrente = 0; // This will be calculated based on KPIs later
        const saldoInicial = toCents(kpiSaldoInicial.textContent);
        saldoCorrente = saldoInicial;


        allMovimentacoes.forEach(mov => {
            const tr = document.createElement('tr');
            tr.dataset.id = mov.id;

            const valor = mov.valor || 0;
            saldoCorrente += valor;

            const isEstornado = mov.estornado === true;
            tr.className = isEstornado ? 'bg-gray-100 text-gray-400' : 'hover:bg-gray-50';

            const statusBadge = mov.conciliado
                ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Conciliado</span>`
                : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-800">Pendente</span>`;

            const descricaoHtml = isEstornado ? `<del>${mov.descricao}</del>` : mov.descricao;
            const origemHtml = mov.origemId ? `<a href="#" class="text-blue-600 hover:underline view-origin-link" data-origin-id="${mov.origemId}" data-origin-type="${mov.origemTipo}">${mov.origemDescricao || 'Ver Origem'}</a>` : (mov.origemDescricao || 'N/A');


            tr.innerHTML = `
                <td class="p-4"><input type="checkbox" class="mov-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" data-id="${mov.id}"></td>
                <td class="px-4 py-2 text-sm">${new Date(mov.dataTransacao + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                <td class="px-4 py-2 text-sm w-2/5">${descricaoHtml}</td>
                <td class="px-4 py-2 text-sm">${origemHtml}</td>
                <td class="px-4 py-2 text-sm text-right text-green-600">${valor > 0 ? formatCurrency(valor) : ''}</td>
                <td class="px-4 py-2 text-sm text-right text-red-600">${valor < 0 ? formatCurrency(Math.abs(valor)) : ''}</td>
                <td class="px-4 py-2 text-sm text-right font-mono">${formatCurrency(saldoCorrente)}</td>
                <td class="px-4 py-2 text-center">${statusBadge}</td>
            `;
            tableBody.appendChild(tr);
        });
    }

     async function calculateAndRenderKPIs() {
        const contaId = contaBancariaSelect.value;
        if (!contaId) return;

        const de = periodoDeInput.value;

        // 1. Get initial balance of the account
        const contaRef = doc(db, `users/${userId}/contasBancarias`, contaId);
        const contaSnap = await getDoc(contaRef);
        const saldoInicialConta = contaSnap.exists() ? contaSnap.data().saldoInicial || 0 : 0;

        // 2. Get all movements before the start date to calculate the initial balance for the period
        let saldoAnterior = saldoInicialConta;
        if (de) {
            const qAnterior = query(
                collection(db, `users/${userId}/movimentacoesBancarias`),
                where("contaBancariaId", "==", contaId),
                where("dataTransacao", "<", de)
            );
            const snapAnterior = await getDocs(qAnterior);
            snapAnterior.docs.forEach(doc => {
                 if (doc.data().estornado !== true) {
                    saldoAnterior += doc.data().valor || 0;
                 }
            });
        }

        // 3. Calculate KPIs for the current period from the already fetched `allMovimentacoes`
        let totalEntradas = 0;
        let totalSaidas = 0;
        let saldoAConciliar = 0;

        allMovimentacoes.forEach(mov => {
             if (mov.estornado === true) return; // Ignore estornados from calculations

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
        const saldoFinal = saldoAnterior + saldoPeriodo;

        // 4. Render KPIs
        kpiSaldoInicial.textContent = formatCurrency(saldoAnterior);
        kpiTotalEntradas.textContent = formatCurrency(totalEntradas);
        kpiTotalSaidas.textContent = formatCurrency(Math.abs(totalSaidas));
        kpiSaldoPeriodo.textContent = formatCurrency(saldoPeriodo);
        kpiSaldoFinal.textContent = formatCurrency(saldoFinal);
        kpiSaldoAConciliar.textContent = formatCurrency(saldoAConciliar);

        // Re-render table with correct running balance
        renderMovimentacoes();
    }


    function resetKPIs() {
        kpiSaldoInicial.textContent = formatCurrency(0);
        kpiTotalEntradas.textContent = formatCurrency(0);
        kpiTotalSaidas.textContent = formatCurrency(0);
        kpiSaldoPeriodo.textContent = formatCurrency(0);
        kpiSaldoFinal.textContent = formatCurrency(0);
        kpiSaldoAConciliar.textContent = formatCurrency(0);
    }

    // --- Action Button Logic ---

    function updateActionButtons() {
        const selectedIds = getSelectedMovimentacaoIds();
        const selectedCount = selectedIds.length;

        if (selectedCount === 0) {
            conciliarBtn.disabled = true;
            desfazerBtn.disabled = true;
            estornarBtn.disabled = true;
            return;
        }

        const selectedMovs = selectedIds.map(id => allMovimentacoes.find(m => m.id === id));
        const anyConciliado = selectedMovs.some(m => m.conciliado);
        const anyNaoConciliado = selectedMovs.some(m => !m.conciliado);
        const anyEstornado = selectedMovs.some(m => m.estornado);

        conciliarBtn.disabled = anyConciliado || anyEstornado;
        desfazerBtn.disabled = anyNaoConciliado || anyEstornado;
        estornarBtn.disabled = selectedCount !== 1 || anyEstornado;
    }

    if (tableBody) {
        tableBody.addEventListener('change', e => {
            if (e.target.classList.contains('mov-checkbox')) {
                updateActionButtons();
            }
        });
    }

     if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', () => {
            tableBody.querySelectorAll('.mov-checkbox').forEach(checkbox => {
                checkbox.checked = selectAllCheckbox.checked;
            });
            updateActionButtons();
        });
    }

    async function handleConciliacao(conciliar) {
        const selectedIds = getSelectedMovimentacaoIds();
        if (selectedIds.length === 0) return;

        const batch = writeBatch(db);
        selectedIds.forEach(id => {
            const ref = doc(db, `users/${userId}/movimentacoesBancarias`, id);
            batch.update(ref, {
                conciliado: conciliar,
                dataConciliacao: conciliar ? new Date().toISOString().split('T')[0] : null,
                usuarioConciliacao: conciliar ? "currentUserName" : null // Replace with actual user name
            });
        });

        try {
            await batch.commit();
            alert(`Operação concluída para ${selectedIds.length} lançamento(s).`);
            selectAllCheckbox.checked = false;
            updateActionButtons();
        } catch (error) {
            console.error("Erro ao atualizar conciliação:", error);
            alert("Falha ao atualizar conciliação.");
        }
    }

    if (conciliarBtn) conciliarBtn.addEventListener('click', () => handleConciliacao(true));
    if (desfazerBtn) desfazerBtn.addEventListener('click', () => handleConciliacao(false));

}