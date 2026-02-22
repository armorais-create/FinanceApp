import { list } from "../db.js";

function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

let _currentMonth = "";

export async function rejaneReportScreen() {
    try {
        // Extract month from URL or use current
        const hashParts = location.hash.split("?");
        if (hashParts[1] && hashParts[1].startsWith("month=")) {
            _currentMonth = hashParts[1].split("=")[1];
        } else {
            _currentMonth = new Date().toISOString().slice(0, 7);
        }

        const [people, cards, balanceEvents, transactions] = await Promise.all([
            list("people").catch(() => []),
            list("cards").catch(() => []),
            list("balance_events").catch(() => []),
            list("transactions").catch(() => [])
        ]);

        const rejanePerson = people.find(p => p.name.toLowerCase().includes("rejane"));
        if (!rejanePerson) {
            return `<div class="card error">Erro: Perfil "Rejane" não encontrado.</div>`;
        }

        const rejaneCards = cards.filter(c => c.additional && c.additional.toLowerCase().includes("rejane"));

        // 1. Get Monthly Events
        const monthEvents = balanceEvents.filter(e => e.personId === rejanePerson.id && e.month === _currentMonth);

        let isClosed = false;
        let chargesAmount = 0;
        let isEstimated = false;

        const chargeEvent = monthEvents.find(e => e.type === "charges");
        if (chargeEvent) {
            isClosed = true;
            chargesAmount = chargeEvent.amountCentsBRL / 100;
        } else {
            // Calculate estimated charges
            isEstimated = true;
            transactions.forEach(t => {
                if (t.type === "expense" && t.cardHolder === "additional" && t.invoiceMonth === _currentMonth) {
                    if (rejaneCards.some(c => c.id === t.cardId)) {
                        if (t.kind !== "INVOICE_PAYMENT" && t.type !== "card_payment") {
                            chargesAmount += (t.valueBRL ?? t.value);
                        }
                    }
                }
            });
        }

        // 2. Breakdown by Card
        const chargesByCard = {};
        transactions.forEach(t => {
            if (t.type === "expense" && t.cardHolder === "additional" && t.invoiceMonth === _currentMonth) {
                if (rejaneCards.some(c => c.id === t.cardId)) {
                    if (t.kind !== "INVOICE_PAYMENT" && t.type !== "card_payment") {
                        const cardName = cards.find(c => c.id === t.cardId)?.name || "Cartão";
                        chargesByCard[cardName] = (chargesByCard[cardName] || 0) + (t.valueBRL ?? t.value);
                    }
                }
            }
        });

        // 3. Payments Received
        const payments = monthEvents.filter(e => e.type === "payment");
        const totalPayments = payments.reduce((sum, p) => sum + Math.abs(p.amountCentsBRL / 100), 0);

        // 4. Adjustments
        const adjustments = monthEvents.filter(e => e.type === "adjustment");
        const totalAdjustments = adjustments.reduce((sum, a) => sum + (a.amountCentsBRL / 100), 0);

        // 5. Calculate Balances
        let startBalanceCents = 0;
        balanceEvents.forEach(e => {
            if (e.personId === rejanePerson.id && e.month < _currentMonth) {
                startBalanceCents += e.amountCentsBRL;
            }
        });

        const startBalance = startBalanceCents / 100;

        // Month Delta (Charges + Payments + Adjustments)
        // Note: chargeEvent amount is already positive in balance_events
        // Payment amounts are negative in balance_events
        let monthDeltaCents = 0;

        if (isClosed) {
            monthDeltaCents += chargeEvent.amountCentsBRL;
        } else {
            monthDeltaCents += Math.round(chargesAmount * 100);
        }

        monthDeltaCents -= Math.round(totalPayments * 100);
        monthDeltaCents += Math.round(totalAdjustments * 100);

        const monthDelta = monthDeltaCents / 100;
        const endBalance = startBalance + monthDelta;

        const generationDate = new Date().toLocaleString("pt-BR");

        const msgText = `Rejane, segue o ${isClosed ? 'fechamento do mês' : 'resumo (prévia, mês ainda não fechado)'} de ${_currentMonth}:
• Saldo anterior: R$ ${startBalance.toFixed(2)}
• Gastos no mês: R$ ${chargesAmount.toFixed(2)}
• Pagamentos recebidos: R$ ${totalPayments.toFixed(2)}${totalAdjustments !== 0 ? `\n• Ajustes: R$ ${totalAdjustments.toFixed(2)}` : ''}
• Saldo final em aberto: R$ ${endBalance.toFixed(2)}

Resumo por cartão:${Object.keys(chargesByCard).length > 0 ? '\n' + Object.keys(chargesByCard).map(card => `- ${esc(card)}: R$ ${chargesByCard[card].toFixed(2)}`).join('\n') : ' (Nenhum)'}

Vou te enviar o PDF do relatório em anexo.`;

        return `
            <div class="print-container">
                <div class="no-print" style="margin-bottom: 20px; display: flex; gap: 10px; align-items: center; justify-content: space-between;">
                    <button class="secondary" id="btnBackRejane">← Voltar</button>
                    <div style="display:flex; align-items:center; gap:10px;">
                        Mês: <input type="month" id="repMonth" value="${_currentMonth}">
                        <button class="primary" id="btnReloadRejane">Gerar relatório</button>
                    </div>
                    <button class="primary" id="btnPrint" style="background: #000; border-color: #000;">🖨️ Imprimir / Salvar PDF</button>
                </div>

                <div class="no-print card" style="margin-bottom: 20px; background: #e9ecef; border: 1px solid #ced4da;">
                    <div style="font-weight: bold; margin-bottom: 5px;">Mensagem para enviar (WhatsApp)</div>
                    <textarea id="rejaneMsgText" style="width: 100%; height: 230px; padding: 10px; border-radius: 5px; border: 1px solid #ccc; font-family: monospace; resize: vertical;" readonly>${msgText}</textarea>
                    <div style="margin-top: 10px; display: flex; justify-content: flex-end; gap: 10px; align-items: center;">
                        <span class="small" style="color: #6c757d; font-weight: bold;">(Lembre-se de anexar o PDF que você salvou)</span>
                        <button class="primary" id="btnCopyRejaneMsg">Copiar mensagem</button>
                    </div>
                </div>

                <div class="report-page card" style="padding: 30px; border-radius: 0; box-shadow: none;">
                    
                    <!-- 1. Cabeçalho -->
                    <div style="text-align: center; border-bottom: 2px solid #eee; padding-bottom: 15px; margin-bottom: 20px;">
                        <h2 style="margin: 0 0 10px 0;">Relatório Rejane — Mês ${_currentMonth}</h2>
                        <div style="color: #666; font-size: 0.9em;">Gerado em: ${generationDate}</div>
                        <div style="margin-top: 10px; font-weight: bold; font-size: 1.1em;">
                            Status: ${isClosed ? '<span style="color:#28a745;">Mês fechado ✅</span>' : '<span style="color:#dc3545;">Mês não fechado ⏳</span>'}
                        </div>
                    </div>

                    <!-- 2. Resumo do Mês -->
                    <div style="margin-bottom: 30px; background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #dee2e6;">
                        <h3 style="margin-top: 0; border-bottom: 1px solid #ccc; padding-bottom: 5px;">Resumo Financeiro</h3>
                        <table style="width: 100%; border-collapse: collapse; font-size: 1.1em;">
                            <tr>
                                <td style="padding: 6px 0;">Saldo Anterior:</td>
                                <td style="text-align: right; padding: 6px 0;">R$ ${startBalance.toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td style="padding: 6px 0;">Gastos no Mês ${isEstimated ? '<small>(Estimado)</small>' : ''}:</td>
                                <td style="text-align: right; padding: 6px 0;">R$ ${chargesAmount.toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td style="padding: 6px 0;">Pagamentos Recebidos:</td>
                                <td style="text-align: right; padding: 6px 0; color: #28a745;">- R$ ${totalPayments.toFixed(2)}</td>
                            </tr>
                            ${totalAdjustments !== 0 ? `
                            <tr>
                                <td style="padding: 6px 0;">Ajustes:</td>
                                <td style="text-align: right; padding: 6px 0;">R$ ${totalAdjustments.toFixed(2)}</td>
                            </tr>
                            ` : ''}
                            <tr style="border-top: 2px solid #ccc; font-weight: bold; font-size: 1.2em;">
                                <td style="padding: 10px 0;">Saldo Final (Em Aberto):</td>
                                <td style="text-align: right; padding: 10px 0; color: ${endBalance > 0 ? '#dc3545' : '#111'};">R$ ${endBalance.toFixed(2)}</td>
                            </tr>
                        </table>
                    </div>

                    <!-- 3. Gastos por Cartão -->
                    <div style="margin-bottom: 30px;">
                        <h3 style="border-bottom: 1px solid #ccc; padding-bottom: 5px;">Detalhamento: Gastos por Cartão</h3>
                        ${Object.keys(chargesByCard).length === 0 ? '<p>Nenhum gasto registrado neste mês.</p>' : `
                        <table class="report-table" style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                            <thead>
                                <tr style="background: #f1f1f1;">
                                    <th style="text-align: left; padding: 8px; border: 1px solid #dee2e6;">Cartão</th>
                                    <th style="text-align: right; padding: 8px; border: 1px solid #dee2e6;">Total do Mês (BRL)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${Object.keys(chargesByCard).map(card => `
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #dee2e6;">${esc(card)}</td>
                                    <td style="text-align: right; padding: 8px; border: 1px solid #dee2e6;">R$ ${chargesByCard[card].toFixed(2)}</td>
                                </tr>
                                `).join('')}
                            </tbody>
                            <tfoot>
                                <tr style="background: #f8f9fa; font-weight: bold;">
                                    <td style="padding: 8px; border: 1px solid #dee2e6;">Total Geral</td>
                                    <td style="text-align: right; padding: 8px; border: 1px solid #dee2e6;">R$ ${Object.values(chargesByCard).reduce((a, b) => a + b, 0).toFixed(2)}</td>
                                </tr>
                            </tfoot>
                        </table>
                        `}
                    </div>

                    <!-- 4. Pagamentos -->
                    <div style="margin-bottom: 30px;">
                        <h3 style="border-bottom: 1px solid #ccc; padding-bottom: 5px;">Pagamentos Recebidos</h3>
                        ${payments.length === 0 ? '<p>Nenhum pagamento registrado neste mês.</p>' : `
                        <table class="report-table" style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                            <thead>
                                <tr style="background: #f1f1f1;">
                                    <th style="text-align: left; padding: 8px; border: 1px solid #dee2e6;">Data</th>
                                    <th style="text-align: right; padding: 8px; border: 1px solid #dee2e6;">Valor (BRL)</th>
                                    <th style="text-align: left; padding: 8px; border: 1px solid #dee2e6;">Nota</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${payments.map(p => `
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #dee2e6;">${p.createdAt.slice(0, 10)}</td>
                                    <td style="text-align: right; padding: 8px; border: 1px solid #dee2e6; color: #28a745;">R$ ${Math.abs(p.amountCentsBRL / 100).toFixed(2)}</td>
                                    <td style="padding: 8px; border: 1px solid #dee2e6;">${esc(p.note || '')}</td>
                                </tr>
                                `).join('')}
                            </tbody>
                        </table>
                        `}
                    </div>

                    <!-- 5. Ajustes -->
                    ${adjustments.length > 0 ? `
                    <div style="margin-bottom: 30px;">
                        <h3 style="border-bottom: 1px solid #ccc; padding-bottom: 5px;">Ajustes</h3>
                        <table class="report-table" style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                            <thead>
                                <tr style="background: #f1f1f1;">
                                    <th style="text-align: left; padding: 8px; border: 1px solid #dee2e6;">Data</th>
                                    <th style="text-align: right; padding: 8px; border: 1px solid #dee2e6;">Valor (BRL)</th>
                                    <th style="text-align: left; padding: 8px; border: 1px solid #dee2e6;">Nota</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${adjustments.map(a => `
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #dee2e6;">${a.createdAt.slice(0, 10)}</td>
                                    <td style="text-align: right; padding: 8px; border: 1px solid #dee2e6;">R$ ${(a.amountCentsBRL / 100).toFixed(2)}</td>
                                    <td style="padding: 8px; border: 1px solid #dee2e6;">${esc(a.note || '')}</td>
                                </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    ` : ''}

                    <!-- 6. Rodapé -->
                    <div style="margin-top: 50px; text-align: center; color: #666; font-size: 0.9em; border-top: 1px solid #eee; padding-top: 20px;">
                        Este relatório é um resumo dos gastos no cartão (portador Rejane) e do saldo em aberto com André.
                    </div>

                </div>
            </div>
        `;
    } catch (e) {
        console.error("Rejane Report Error", e);
        return `<div class="card error">Erro ao gerar relatório: ${e.message}</div>`;
    }
}

export async function wireRejaneReportHandlers(rootEl) {
    const btnBack = rootEl.querySelector("#btnBackRejane");
    if (btnBack) {
        btnBack.addEventListener("click", () => {
            location.hash = "#loans";
        });
    }

    const btnReload = rootEl.querySelector("#btnReloadRejane");
    const repMonthInput = rootEl.querySelector("#repMonth");

    if (btnReload && repMonthInput) {
        btnReload.addEventListener("click", () => {
            location.hash = `#rejane-report?month=${repMonthInput.value}`;
        });
    }

    const btnPrint = rootEl.querySelector("#btnPrint");
    if (btnPrint) {
        btnPrint.addEventListener("click", () => {
            window.print();
        });
    }

    const btnCopy = rootEl.querySelector("#btnCopyRejaneMsg");
    if (btnCopy) {
        btnCopy.addEventListener("click", async () => {
            const ta = rootEl.querySelector("#rejaneMsgText");
            const text = ta.value;
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                    btnCopy.textContent = "Copiado! ✅";
                    setTimeout(() => btnCopy.textContent = "Copiar mensagem", 2000);
                } else {
                    throw new Error("Clipboard API not available");
                }
            } catch (err) {
                ta.select();
                try {
                    const successful = document.execCommand('copy');
                    if (successful) {
                        btnCopy.textContent = "Copiado! ✅";
                        setTimeout(() => btnCopy.textContent = "Copiar mensagem", 2000);
                    } else {
                        throw new Error("execCommand copy failed");
                    }
                } catch (err2) {
                    alert("Não consegui copiar automaticamente. Selecione o texto e copie (Cmd+C).");
                }
            }
        });
    }
}
