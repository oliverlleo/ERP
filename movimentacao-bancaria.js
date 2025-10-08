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