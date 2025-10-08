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
            alert("Selecione exatamente um lançamento para estornar.");
            return;
        }
        const movId = selectedIds[0];

        if (!confirm("Tem certeza que deseja estornar este lançamento? Esta ação irá reabrir a pendência original (se houver) e não pode ser desfeita.")) {
            return;
        }

        const movRef = doc(db, `users/${userId}/movimentacoesBancarias`, movId);

        try {
            await runTransaction(db, async (transaction) => {
                // ETAPA 1: LER TODOS OS DOCUMENTOS NECESSÁRIOS PRIMEIRO
                const movDoc = await transaction.get(movRef);
                if (!movDoc.exists()) {
                    throw new Error("Lançamento bancário não encontrado.");
                }

                const movData = movDoc.data();
                if (movData.estornado) {
                    throw new Error("Este lançamento já foi estornado.");
                }

                let origemDocRef, origemParentDocRef, origemParentDoc, pagamentosCollectionRef;
                let valorPrincipalEstornado = 0;
                let jurosEstornados = 0;
                let descontosEstornados = 0;

                // Identifica e prepara as referências para os documentos de origem
                if ((movData.origemTipo === 'PAGAMENTO_DESPESA' || movData.origemTipo === 'RECEBIMENTO_RECEITA') && movData.origemId && movData.origemParentId) {
                    const parentCollection = movData.origemTipo === 'PAGAMENTO_DESPESA' ? 'despesas' : 'receitas';
                    const subCollection = movData.origemTipo === 'PAGAMENTO_DESPESA' ? 'pagamentos' : 'recebimentos';

                    origemParentDocRef = doc(db, `users/${userId}/${parentCollection}`, movData.origemParentId);
                    origemDocRef = doc(origemParentDocRef, subCollection, movData.origemId);
                    pagamentosCollectionRef = collection(origemParentDocRef, subCollection);

                    const origemDoc = await transaction.get(origemDocRef);
                    const origemParentDocRaw = await transaction.get(origemParentDocRef);

                    if (!origemDoc.exists() || !origemParentDocRaw.exists()) {
                        throw new Error("O documento de pagamento/recebimento original ou seu título pai não foi encontrado.");
                    }
                    if (origemDoc.data().estornado) {
                        throw new Error("O pagamento/recebimento de origem já foi estornado anteriormente.");
                    }

                    const origemData = origemDoc.data();
                    valorPrincipalEstornado = origemData.valorPrincipal || 0;
                    jurosEstornados = origemData.jurosPagos || origemData.jurosRecebidos || 0;
                    descontosEstornados = origemData.descontosAplicados || origemData.descontosConcedidos || 0;
                    origemParentDoc = origemParentDocRaw.data();
                }

                // ETAPA 2: EXECUTAR TODAS AS ESCRITAS DE FORMA ATÔMICA

                // 2.1. Marca a movimentação bancária original como estornada
                transaction.update(movRef, {
                    estornado: true,
                    conciliado: true,
                    dataConciliacao: new Date().toISOString().split('T')[0],
                    usuarioConciliacao: "Sistema (Estorno)"
                });

                // 2.2. Cria a movimentação de contrapartida (o estorno no extrato)
                const newMovRef = doc(collection(db, `users/${userId}/movimentacoesBancarias`));
                transaction.set(newMovRef, {
                    ...movData,
                    valor: -movData.valor,
                    descricao: `Estorno de: ${movData.descricao}`,
                    origemTipo: "ESTORNO",
                    origemDescricao: `Estorno Lanç. #${movDoc.id.substring(0, 5)}`,
                    estornado: false,
                    estornoDeId: movDoc.id,
                    conciliado: true,
                    dataConciliacao: new Date().toISOString().split('T')[0],
                    usuarioConciliacao: "Sistema (Estorno)",
                    createdAt: serverTimestamp()
                });

                // 2.3. Se houver uma origem (despesa/receita), reverte o estado dela
                if (origemParentDocRef && origemParentDoc) {
                    // Marca o pagamento/recebimento original como estornado
                    transaction.update(origemDocRef, { estornado: true });

                    // Adiciona um registro de "Estorno" no histórico do título para rastreabilidade
                    const novoEstornoRef = doc(pagamentosCollectionRef);
                    transaction.set(novoEstornoRef, {
                        tipoTransacao: "Estorno",
                        dataTransacao: new Date().toISOString().split('T')[0],
                        valorPrincipal: valorPrincipalEstornado,
                        usuarioResponsavel: "Sistema",
                        motivoEstorno: "Estornado via Conciliação Bancária",
                        createdAt: serverTimestamp()
                    });

                    // Recalcula saldos e status do título PAI (despesa ou receita)
                    const updateData = {};
                    const today = new Date(); today.setHours(0, 0, 0, 0);

                    if (movData.origemTipo === 'PAGAMENTO_DESPESA') {
                        updateData.totalPago = (origemParentDoc.totalPago || 0) - valorPrincipalEstornado;
                        updateData.totalJuros = (origemParentDoc.totalJuros || 0) - jurosEstornados;
                        updateData.totalDescontos = (origemParentDoc.totalDescontos || 0) - descontosEstornados;
                        updateData.valorSaldo = (origemParentDoc.valorOriginal + updateData.totalJuros) - updateData.totalPago - updateData.totalDescontos;

                        const vencimento = new Date(origemParentDoc.vencimento + 'T00:00:00');
                        if (updateData.totalPago <= 0) {
                            updateData.status = vencimento < today ? 'Vencido' : 'Pendente';
                        } else {
                            updateData.status = 'Pago Parcialmente';
                        }
                    } else { // RECEBIMENTO_RECEITA
                        updateData.totalRecebido = (origemParentDoc.totalRecebido || 0) - valorPrincipalEstornado;
                        updateData.totalJuros = (origemParentDoc.totalJuros || 0) - jurosEstornados;
                        updateData.totalDescontos = (origemParentDoc.totalDescontos || 0) - descontosEstornados;
                        updateData.saldoPendente = (origemParentDoc.valorOriginal + updateData.totalJuros) - updateData.totalRecebido - updateData.totalDescontos;

                        const vencimento = new Date((origemParentDoc.dataVencimento || origemParentDoc.vencimento) + 'T00:00:00');
                        if (updateData.totalRecebido <= 0) {
                             updateData.status = vencimento < today ? 'Vencido' : 'Pendente';
                        } else {
                            updateData.status = 'Recebido Parcialmente';
                        }
                    }
                    transaction.update(origemParentDocRef, updateData);
                }
            });

            showFeedback("Lançamento estornado com sucesso! O título original foi reaberto.", "success");
            if(selectAllCheckbox) selectAllCheckbox.checked = false;
        } catch (error) {
            console.error("Erro ao estornar lançamento: ", error);
            showFeedback(`Falha no estorno: ${error.message}`, "error");
        }
    }
}