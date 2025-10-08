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

    // Refactored data loading and rendering logic to avoid composite index queries.
    function loadMovimentacoes() {
        const contaId = contaBancariaSelect.value;

        if (currentListenerUnsubscribe) {
            currentListenerUnsubscribe();
        }

        if (!contaId) {
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center p-8 text-gray-500">Selecione uma conta bancária para começar.</td></tr>';
            resetKPIs();
            return;
        }

        // Query only by account ID. Date filtering and sorting will happen client-side.
        const q = query(collection(db, `users/${userId}/movimentacoesBancarias`), where("contaBancariaId", "==", contaId));

        currentListenerUnsubscribe = onSnapshot(q, (querySnapshot) => {
            const allDocsForAccount = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // We pass all docs to the processing function, which will handle filtering and rendering.
            processAndRender(allDocsForAccount);
        }, (error) => {
            console.error("Error fetching movimentacoesBancarias: ", error);
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center p-8 text-red-500">Erro ao carregar movimentações. A consulta pode exigir um índice que não existe.</td></tr>';
        });
    }

    async function processAndRender(allDocsForAccount) {
        const contaId = contaBancariaSelect.value;
        const de = periodoDeInput.value;
        const ate = periodoAteInput.value;

        // 1. Get initial balance of the account
        const contaRef = doc(db, `users/${userId}/contasBancarias`, contaId);
        const contaSnap = await getDoc(contaRef);
        const saldoInicialConta = contaSnap.exists() ? contaSnap.data().saldoInicial || 0 : 0;

        // 2. Calculate "Saldo Anterior" (balance before the start date)
        let saldoAnterior = saldoInicialConta;
        allDocsForAccount.forEach(mov => {
            if (de && mov.dataTransacao < de) {
                if (mov.estornado !== true) {
                    saldoAnterior += mov.valor || 0;
                }
            }
        });

        // 3. Filter transactions for the selected period
        const movimentacoesPeriodo = allDocsForAccount.filter(mov => {
            if (de && mov.dataTransacao < de) return false;
            if (ate && mov.dataTransacao > ate) return false;
            return true;
        }).sort((a, b) => new Date(a.dataTransacao) - new Date(b.dataTransacao) || (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

        // 4. Calculate KPIs for the period
        let totalEntradas = 0;
        let totalSaidas = 0;
        let saldoAConciliar = 0;

        movimentacoesPeriodo.forEach(mov => {
             if (mov.estornado === true) return;
            const valor = mov.valor || 0;
            if (valor > 0) totalEntradas += valor;
            else totalSaidas += valor;
            if (!mov.conciliado) saldoAConciliar += valor;
        });

        const saldoPeriodo = totalEntradas + totalSaidas;
        const saldoFinal = saldoAnterior + saldoPeriodo;

        // 5. Render everything
        kpiSaldoInicial.textContent = formatCurrency(saldoAnterior);
        kpiTotalEntradas.textContent = formatCurrency(totalEntradas);
        kpiTotalSaidas.textContent = formatCurrency(Math.abs(totalSaidas));
        kpiSaldoPeriodo.textContent = formatCurrency(saldoPeriodo);
        kpiSaldoFinal.textContent = formatCurrency(saldoFinal);
        kpiSaldoAConciliar.textContent = formatCurrency(saldoAConciliar);

        renderMovimentacoes(movimentacoesPeriodo, saldoAnterior);
        // Store the filtered list globally for other functions to use
        allMovimentacoes = movimentacoesPeriodo;
        updateActionButtons();
    }

    function renderMovimentacoes(movsToRender, saldoInicial) {
        if (!tableBody) return;
        tableBody.innerHTML = '';
        if (movsToRender.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center p-8 text-gray-500">Nenhuma movimentação encontrada para esta conta no período selecionado.</td></tr>';
            return;
        }

        let saldoCorrente = saldoInicial;

        movsToRender.forEach(mov => {
            const tr = document.createElement('tr');
            tr.dataset.id = mov.id;

            const valor = mov.valor || 0;
            if(mov.estornado !== true) {
                saldoCorrente += valor;
            }

            const isEstornado = mov.estornado === true;
            tr.className = isEstornado ? 'bg-gray-100 text-gray-400' : 'hover:bg-gray-50';

            const statusBadge = mov.conciliado
                ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Conciliado</span>`
                : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-800">Pendente</span>`;

            const descricaoHtml = isEstornado ? `<del>${mov.descricao}</del>` : mov.descricao;
            const origemHtml = mov.origemId ? `<a href="#" class="text-blue-600 hover:underline view-origin-link" data-origin-id="${mov.origemId}" data-origin-type="${mov.origemTipo}">${mov.origemDescricao || 'Ver Origem'}</a>` : (mov.origemDescricao || 'N/A');

            tr.innerHTML = `
                <td class="p-4"><input type="checkbox" class="mov-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" data-id="${mov.id}" ${isEstornado ? 'disabled' : ''}></td>
                <td class="px-4 py-2 text-sm">${new Date(mov.dataTransacao + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                <td class="px-4 py-2 text-sm w-2/5">${descricaoHtml}</td>
                <td class="px-4 py-2 text-sm">${origemHtml}</td>
                <td class="px-4 py-2 text-sm text-right text-green-600">${valor > 0 && !isEstornado ? formatCurrency(valor) : ''}</td>
                <td class="px-4 py-2 text-sm text-right text-red-600">${valor < 0 && !isEstornado ? formatCurrency(Math.abs(valor)) : ''}</td>
                <td class="px-4 py-2 text-sm text-right font-mono">${formatCurrency(saldoCorrente)}</td>
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

    // --- Action Button Logic ---

    function getSelectedMovimentacaoIds() {
        if (!tableBody) return [];
        return Array.from(tableBody.querySelectorAll('.mov-checkbox:checked')).map(cb => cb.dataset.id);
    }

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
    if (estornarBtn) estornarBtn.addEventListener('click', handleEstorno);

    async function handleEstorno() {
        const selectedIds = getSelectedMovimentacaoIds();
        if (selectedIds.length !== 1) {
            showFeedback("Selecione exatamente um lançamento para estornar.", "error");
            return;
        }
        const movId = selectedIds[0];

        estornarBtn.disabled = true; // Disable button immediately to prevent double-clicks

        if (!confirm("Tem certeza que deseja estornar este lançamento? Esta ação é irreversível e irá reabrir a pendência original (se houver).")) {
            estornarBtn.disabled = false; // Re-enable if user cancels
            return;
        }

        const movRef = doc(db, `users/${userId}/movimentacoesBancarias`, movId);

        try {
            await runTransaction(db, async (transaction) => {
                // --- 1. READ PHASE ---
                const movDoc = await transaction.get(movRef);
                if (!movDoc.exists()) throw new Error("Lançamento não encontrado.");
                const movData = movDoc.data();
                if (movData.estornado) throw new Error("Este lançamento já foi estornado.");

                const { origemTipo, origemId, origemPaiId, valor } = movData;
                let parentRef, parentDoc, paymentRef, paymentDoc;

                if (origemTipo === 'PAGAMENTO_DESPESA' && origemPaiId && origemId) {
                    parentRef = doc(db, `users/${userId}/despesas`, origemPaiId);
                    paymentRef = doc(parentRef, 'pagamentos', origemId);
                    [parentDoc, paymentDoc] = await Promise.all([transaction.get(parentRef), transaction.get(paymentRef)]);
                    if (!parentDoc.exists() || !paymentDoc.exists()) throw new Error("Despesa ou pagamento original não encontrado.");

                } else if (origemTipo === 'RECEBIMENTO_RECEITA' && origemPaiId && origemId) {
                    parentRef = doc(db, `users/${userId}/receitas`, origemPaiId);
                    paymentRef = doc(parentRef, 'recebimentos', origemId);
                    [parentDoc, paymentDoc] = await Promise.all([transaction.get(parentRef), transaction.get(paymentRef)]);
                    if (!parentDoc.exists() || !paymentDoc.exists()) throw new Error("Receita ou recebimento original não encontrado.");
                }


                // --- 2. WRITE PHASE ---

                // a. Mark original bank movement as reversed
                transaction.update(movRef, {
                    estornado: true,
                    conciliado: true,
                    dataConciliacao: new Date().toISOString().split('T')[0],
                    usuarioConciliacao: "Sistema (Estorno)"
                });

                // b. Create the new reversal bank movement
                const newMovRef = doc(collection(db, `users/${userId}/movimentacoesBancarias`));
                transaction.set(newMovRef, {
                    ...movData,
                    valor: -valor,
                    descricao: `Estorno de: ${movData.descricao}`,
                    origemTipo: "ESTORNO",
                    origemDescricao: `Estorno Lanç. #${movId.substring(0, 5)}`,
                    estornado: false,
                    estornoDeId: movId,
                    conciliado: true,
                    dataConciliacao: new Date().toISOString().split('T')[0],
                    usuarioConciliacao: "Sistema (Estorno)",
                    createdAt: serverTimestamp()
                });

                // c. Reverse the original financial document (Despesa/Receita)
                if (parentRef && parentDoc && paymentRef && paymentDoc) {
                    const parentData = parentDoc.data();
                    const paymentData = paymentDoc.data();
                    const valorEstornado = Math.abs(paymentData.valorPrincipal || 0);

                    // Mark original payment/receipt as reversed
                    transaction.update(paymentRef, { estornado: true });

                    // Add a new transaction log for the reversal
                    const estornoLogRef = doc(collection(parentRef, paymentRef.parent.id));
                    transaction.set(estornoLogRef, {
                        tipoTransacao: "Estorno",
                        dataTransacao: new Date().toISOString().split('T')[0],
                        valorPrincipal: valorEstornado,
                        usuarioResponsavel: "Sistema", // Replace with actual user if available
                        motivoEstorno: "Reversão via conciliação bancária.",
                        pagamentoOriginalId: origemId,
                        createdAt: serverTimestamp()
                    });

                    // Update the parent document's balance and status
                    if (origemTipo === 'PAGAMENTO_DESPESA') {
                        const novoTotalPago = (parentData.totalPago || 0) - valorEstornado;
                        const novoSaldo = (parentData.valorSaldo || 0) + valorEstornado;
                        const vencimento = new Date(parentData.vencimento + 'T00:00:00');
                        const today = new Date();
                        today.setHours(0,0,0,0);
                        let novoStatus = (novoSaldo > 0 && novoSaldo < parentData.valorOriginal) ? 'Pago Parcialmente' : (vencimento < today ? 'Vencido' : 'Pendente');
                         if (novoSaldo >= parentData.valorOriginal) {
                             novoStatus = vencimento < today ? 'Vencido' : 'Pendente';
                         }


                        transaction.update(parentRef, {
                            totalPago: novoTotalPago,
                            valorSaldo: novoSaldo,
                            status: novoStatus
                        });
                    } else if (origemTipo === 'RECEBIMENTO_RECEITA') {
                        const novoTotalRecebido = (parentData.totalRecebido || 0) - valorEstornado;
                        const novoSaldoPendente = (parentData.saldoPendente || 0) + valorEstornado;
                        const vencimento = new Date((parentData.dataVencimento || parentData.vencimento) + 'T00:00:00');
                         const today = new Date();
                        today.setHours(0,0,0,0);
                        let novoStatus = (novoSaldoPendente > 0 && novoSaldoPendente < parentData.valorOriginal) ? 'Recebido Parcialmente' : (vencimento < today ? 'Vencido' : 'Pendente');
                         if (novoSaldoPendente >= parentData.valorOriginal) {
                             novoStatus = vencimento < today ? 'Vencido' : 'Pendente';
                         }

                        transaction.update(parentRef, {
                            totalRecebido: novoTotalRecebido,
                            saldoPendente: novoSaldoPendente,
                            status: novoStatus
                        });
                    }
                }
            });

            showFeedback("Lançamento estornado com sucesso! A pendência original foi reaberta.", "success");
            selectAllCheckbox.checked = false;
            // No need to re-enable button, onSnapshot will trigger updateActionButtons() which will handle the state.
        } catch (error) {
            console.error("Erro ao estornar lançamento: ", error);
            showFeedback(`Falha no estorno: ${error.message}`, "error");
            estornarBtn.disabled = false; // Re-enable on failure
        }
    }
}