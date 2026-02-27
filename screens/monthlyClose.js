import { list } from "../db.js?v=v2";
import { exportCSV } from "../utils/export.js";

function fmtBRL(val) {
    return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getPrevMonth(m, offset = 1) {
    const d = new Date(m + "-01T00:00:00");
    d.setMonth(d.getMonth() - offset);
    return d.toISOString().slice(0, 7);
}

export async function monthlyCloseScreen() {
    return `
    <style>
        @media print {
            body { background: white; margin: 0; padding: 0; color: #000; }
            nav, .bottom-nav, #titlebar, .no-print { display: none !important; }
            .card { box-shadow: none !important; border: 1px solid #ddd !important; margin-bottom: 20px !important; break-inside: avoid; }
            #monthly-close-container { padding: 0 !important; max-width: 100% !important; margin: 0 !important; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: right; }
            th { background-color: #f8f9fa !important; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            td:first-child, th:first-child { text-align: left; }
            h2, h3 { color: #000; margin-top: 0; }
            .print-header { display: block !important; margin-bottom: 20px; }
            .text-green { color: #000 !important; }
            .text-red { color: #000 !important; }
            .page-break { page-break-after: always; }
        }
        .text-green { color: #28a745; }
        .text-red { color: #dc3545; }
        .monthly-table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px; }
        .monthly-table th, .monthly-table td { border: 1px solid #ddd; padding: 8px; text-align: right; }
        .monthly-table td:first-child, .monthly-table th:first-child { text-align: left; }
        .monthly-table th { background-color: #f8f9fa; font-weight: bold; }
        .monthly-table tfoot td { font-weight: bold; background-color: #f1f1f1; }
        .summary-box { border: 1px solid #ddd; padding: 15px; border-radius: 5px; text-align: center; }
        .summary-label { font-size: 12px; color: #666; margin-bottom: 5px; }
        .summary-val { font-size: 20px; font-weight: bold; }
        .delta-val { font-size: 12px; font-weight: normal; }
        
        /* Modal for Export Settings */
        .export-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center; }
        .export-modal.active { display: flex; }
        .export-content { background: #fff; padding: 20px; border-radius: 8px; width: 90%; max-width: 400px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .export-content h3 { margin-top: 0; margin-bottom: 15px; }
        .export-opt { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
        .export-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
    </style>
    <div id="monthly-close-container" style="padding: 10px; max-width: 900px; margin: 0 auto; padding-bottom: 80px;">
        <div class="card"><div class="small">Carregando fechamento mensal...</div></div>
    </div>
    `;
}

export async function wireMonthlyCloseHandlers(rootEl) {
    const container = rootEl.querySelector("#monthly-close-container");

    let currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    let selectedPerson = "";

    async function loadAndRender() {
        container.innerHTML = `<div class="card"><div class="small">Calculando...</div></div>`;

        try {
            const [txs, categories, tags, people, accounts, cards, bills, loans, loanInstallments] = await Promise.all([
                list("transactions"),
                list("categories"),
                list("tags").catch(() => []),
                list("people"),
                list("accounts"),
                list("cards"),
                list("bills").catch(() => []),
                list("loans").catch(() => []),
                list("loan_installments").catch(() => [])
            ]);

            const prevMonthStr = getPrevMonth(currentMonth);

            const pOpts = `<option value="">Todas Pessoas</option>` +
                people.map(p => `<option value="${p.id}" ${selectedPerson === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join("");

            const filterTxs = (tSet, mStr) => {
                return tSet.filter(t => {
                    const dateRef = t.cardId ? t.invoiceMonth : t.date;
                    if (!dateRef || !dateRef.startsWith(mStr)) return false;
                    if (selectedPerson && t.personId !== selectedPerson) return false;
                    if (t.kind === "planned_installment" && !t.paid) return false; // exclude unpaid plans
                    return true;
                });
            };

            const currTxs = filterTxs(txs, currentMonth);
            const prevTxs = filterTxs(txs, prevMonthStr);

            // Armazena dados calculados em tabelas crúas para exportação CSV futuro
            const csvDataMaps = {
                resumo: [["Métrica", "Mês Atual", "Mês Anterior", "Diferença", "Variação %"]],
                categorias: [["Categoria", "Total (BRL)"]],
                tags: [["Tag", "Total (BRL)"]],
                cartoes: [["Cartão", "Total Compras", "Total Pago", "Restante", "Portador (Titular/Adic)"]],
                bills: [["Obrigação", "Valor (BRL)"]],
                dividas: [["Data Vencimento", "Dívida", "Parcela", "Valor", "Status"]]
            };

            // ==========================================
            // 1. Resumo Financeiro (Caixa)
            // ==========================================

            // Helper for totals
            const calcTotals = (tList) => {
                let r = 0, e = 0;
                tList.forEach(t => {
                    const isPay = t.kind === "INVOICE_PAYMENT" || t.type === "card_payment";
                    if (isPay) return; // Do not mix internal payments with general Revenue/Expense

                    const v = t.valueBRL || t.value || 0;
                    if (t.type === "revenue") r += v;
                    else if (t.type === "expense") e += v;
                });
                return { rev: r, exp: e, bal: r - e };
            };

            const currTotal = calcTotals(currTxs);
            const prevTotal = calcTotals(prevTxs);

            const renderDelta = (currVal, prevVal, inverse = false) => {
                const diff = currVal - (prevVal || 0);
                const pct = prevVal ? (diff / prevVal) * 100 : 0;

                if (!prevVal) return `<div class="delta-val" style="color:#999;">Sem histórico</div>`;
                let color = "gray";
                if (inverse) { color = diff > 0 ? "#dc3545" : (diff < 0 ? "#28a745" : "gray"); }
                else { color = diff > 0 ? "#28a745" : (diff < 0 ? "#dc3545" : "gray"); }
                const arrow = diff > 0 ? "▲" : (diff < 0 ? "▼" : "—");
                return `<div class="delta-val" style="color:${color};">${arrow} ${fmtBRL(Math.abs(diff))} (${Math.abs(pct).toFixed(0)}%)</div>`;
            };

            // Popula matriz de Resumo
            const calcDiff = (c, p) => c - (p || 0);
            const calcPctStr = (c, p) => p ? ((calcDiff(c, p) / p) * 100).toFixed(0) + '%' : '0%';

            csvDataMaps.resumo.push(
                ["Receitas", currTotal.rev, prevTotal.rev, calcDiff(currTotal.rev, prevTotal.rev), calcPctStr(currTotal.rev, prevTotal.rev)],
                ["Despesas", currTotal.exp, prevTotal.exp, calcDiff(currTotal.exp, prevTotal.exp), calcPctStr(currTotal.exp, prevTotal.exp)],
                ["Saldo Líquido", currTotal.bal, prevTotal.bal, calcDiff(currTotal.bal, prevTotal.bal), calcPctStr(currTotal.bal, prevTotal.bal)]
            );

            // ==========================================
            // 2 & 3. Top 10 Categorias e Tags
            // ==========================================
            const catGroups = {};
            const tagGroups = {};

            currTxs.forEach(t => {
                const isPay = t.kind === "INVOICE_PAYMENT" || t.type === "card_payment";
                if (isPay) return;

                if (t.type !== "expense") return;

                const v = t.valueBRL || t.value || 0;

                // Categorias
                const cid = t.categoryId || "uncat";
                if (!catGroups[cid]) catGroups[cid] = 0;
                catGroups[cid] += v;

                // Tags
                if (t.tags && Array.isArray(t.tags)) {
                    t.tags.forEach(tag => {
                        const tk = tag.toLowerCase();
                        if (!tagGroups[tk]) tagGroups[tk] = 0;
                        tagGroups[tk] += v;
                    });
                }
            });

            const sortedCats = Object.keys(catGroups).sort((a, b) => catGroups[b] - catGroups[a]).slice(0, 10);
            let catRows = sortedCats.length === 0 ? `<tr><td colspan="2" style="text-align:center; color:#999;">Sem despesas categorizadas.</td></tr>` : "";
            sortedCats.forEach(cid => {
                const name = categories.find(c => c.id === cid)?.name || "(Sem Categoria)";
                catRows += `<tr><td>${esc(name)}</td><td>${fmtBRL(catGroups[cid])}</td></tr>`;
                csvDataMaps.categorias.push([name, catGroups[cid]]);
            });

            const sortedTags = Object.keys(tagGroups).sort((a, b) => tagGroups[b] - tagGroups[a]).slice(0, 10);
            let tagRows = sortedTags.length === 0 ? `<tr><td colspan="2" style="text-align:center; color:#999;">Sem despesas com tags.</td></tr>` : "";
            sortedTags.forEach(tk => {
                tagRows += `<tr><td>#${esc(tk)}</td><td>${fmtBRL(tagGroups[tk])}</td></tr>`;
                csvDataMaps.tags.push(["#" + tk, tagGroups[tk]]);
            });

            // ==========================================
            // 4. Cartões (Faturas do Mês)
            // ==========================================
            const cardStats = {}; // { cardId: { compras: X, pago: Y, extraFlow: true/false, holders: { main: X, additional: Y, name: Z } } }

            currTxs.forEach(t => {
                const cid = t.cardId;
                if (!cid) return;

                if (!cardStats[cid]) cardStats[cid] = { compras: 0, pago: 0, holders: {} };

                const v = t.valueBRL || t.value || 0;
                const isPay = t.kind === "INVOICE_PAYMENT" || t.type === "card_payment";

                if (isPay) {
                    cardStats[cid].pago += v;
                } else if (t.type === "expense") {
                    cardStats[cid].compras += v;

                    // Holders breakdown
                    const hKey = t.cardHolder || "main"; // Main vs Additional
                    if (!cardStats[cid].holders[hKey]) cardStats[cid].holders[hKey] = 0;
                    cardStats[cid].holders[hKey] += v;
                }
            });

            let cardRows = Object.keys(cardStats).length === 0 ? `<tr><td colspan="4" style="text-align:center; color:#999;">Nenhuma fatura/cartão com movimento neste mês.</td></tr>` : "";
            Object.keys(cardStats).forEach(cid => {
                const stat = cardStats[cid];
                const cObj = cards.find(c => c.id === cid);
                const cName = cObj ? cObj.name : "Cartão";

                // Add main row
                cardRows += `
                    <tr>
                        <td><strong>${esc(cName)}</strong></td>
                        <td class="text-red">${fmtBRL(stat.compras)}</td>
                        <td class="text-green">${fmtBRL(stat.pago)}</td>
                        <td class="${stat.compras - stat.pago > 0 ? 'text-red' : ''}" style="font-weight:bold;">${fmtBRL(Math.max(0, stat.compras - stat.pago))}</td>
                    </tr>
                `;

                let portadoresInfo = "-";

                // Add holders breakdown if there are multiple or if it's explicitly 'additional'
                if (Object.keys(stat.holders).length > 0) {
                    const mVal = stat.holders['main'] || 0;
                    const aVal = stat.holders['additional'] || 0;
                    if (aVal > 0) {
                        const hn1 = cObj?.holder ? String(cObj.holder).trim() : "Titular";
                        const hn2 = cObj?.additional ? String(cObj.additional).trim() : "Adicional";
                        portadoresInfo = `Titular(${mVal})|Adicional(${aVal})`;

                        cardRows += `
                            <tr style="font-size:11px; color:#666; background:#fafafa;">
                                <td colspan="4" style="text-align:left; padding-left:15px;">
                                    ↳ Por Portador: ${esc(hn1)} (${fmtBRL(mVal)}) | ${esc(hn2)} (${fmtBRL(aVal)})
                                </td>
                            </tr>
                         `;
                    }
                }

                csvDataMaps.cartoes.push([cName, stat.compras, stat.pago, Math.max(0, stat.compras - stat.pago), portadoresInfo]);
            });

            // ==========================================
            // 5. Contas a Pagar (Bills)
            // ==========================================
            let billStats = { previsto: 0, pago: 0, aberto: 0, pulado: 0 };

            bills.forEach(b => {
                if (!b.instances) return;
                const mInst = b.instances[currentMonth];
                if (!mInst) return;

                const v = mInst.amountCents / 100;

                if (mInst.status === "skipped") {
                    billStats.pulado += v;
                } else if (mInst.status === "paid" || mInst.paid) {
                    billStats.pago += v;
                    billStats.previsto += v; // Assume the paid value was the 'previsto'
                } else {
                    billStats.aberto += v;
                    billStats.previsto += v;
                }
            });

            const billProgress = billStats.previsto > 0 ? ((billStats.pago / billStats.previsto) * 100).toFixed(0) : 0;

            const billRows = `
                <tr>
                    <td>${fmtBRL(billStats.previsto)}</td>
                    <td class="text-green">${fmtBRL(billStats.pago)}</td>
                    <td class="text-red">${fmtBRL(billStats.aberto)}</td>
                    <td style="color:#999;">${fmtBRL(billStats.pulado)}</td>
                    <td style="font-weight:bold;">${billProgress}%</td>
                </tr>
            `;

            csvDataMaps.bills.push(
                ["Previsto", billStats.previsto],
                ["Pago", billStats.pago],
                ["Aberto", billStats.aberto],
                ["Pulado", billStats.pulado]
            );

            // ==========================================
            // 6. Dívidas / Empréstimos
            // ==========================================
            let debtInsts = [];
            loanInstallments.forEach(inst => {
                if (inst.dueDate && inst.dueDate.startsWith(currentMonth)) {
                    debtInsts.push(inst);
                }
            });

            let debtStats = { aVencer: 0, atrasada: 0 };

            // Sort by Date
            debtInsts.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

            // Determine status and calc
            const todayEndStr = new Date().toISOString().slice(0, 10);

            let debtTableRows = debtInsts.length === 0 ? `<tr><td colspan="5" style="text-align:center; color:#999;">Nenhuma parcela de empréstimo para este mês.</td></tr>` : "";

            debtInsts.forEach((inst, idx) => {
                const v = inst.amountCents / 100;
                let statusLabel = "A Vencer";
                let colorClass = "";

                if (inst.paidAt) {
                    statusLabel = "Paga";
                    colorClass = "text-green";
                } else if (inst.dueDate < todayEndStr) {
                    statusLabel = "Atrasada";
                    colorClass = "text-red";
                    debtStats.atrasada += v;
                } else {
                    statusLabel = "Pendente";
                    debtStats.aVencer += v;
                }

                // Limit rows for visual brevity if many installments exist.
                if (idx < 10) {
                    const lObj = loans.find(l => l.id === inst.loanId);
                    const lName = lObj ? `${lObj.emoji || ''} ${lObj.name}` : "Dívida Apagada";
                    const pDate = inst.dueDate.split("-").reverse().join("/");

                    debtTableRows += `
                        <tr>
                            <td style="text-align:left;">${pDate}</td>
                            <td style="text-align:left;">${esc(lName)}</td>
                            <td style="text-align:left;">${inst.installmentNumber !== null ? inst.installmentNumber : '-'}</td>
                            <td>${fmtBRL(v)}</td>
                            <td class="${colorClass}">${statusLabel}</td>
                        </tr>
                    `;
                }

                const lObj = loans.find(l => l.id === inst.loanId);
                const lNameCsv = lObj ? lObj.name : "Dívida Removida";
                csvDataMaps.dividas.push([inst.dueDate, lNameCsv, inst.installmentNumber || "", v, statusLabel]);
            });
            if (debtInsts.length > 10) {
                debtTableRows += `<tr><td colspan="5" style="text-align:center; color:#999;font-size:11px;">( ... ${debtInsts.length - 10} parcelas não exibidas)</td></tr>`;
            }

            // ==========================================
            // 7. Rejane (Sub-caixa)
            // ==========================================
            let rejaneStats = { ativo: false, status: "Aberto", gastos: 0, recebido: 0 };

            currTxs.forEach(t => {
                const isRejanePerson = t.personId === "person_rejane";
                const hasTags = t.tags && Array.isArray(t.tags);
                const isEventClose = hasTags && t.tags.includes("CUSTO_FECHAMENTO_REJANE");

                if (isRejanePerson || isEventClose) {
                    rejaneStats.ativo = true;
                }

                if (t.type === 'expense' && isRejanePerson) {
                    // Check if it's the specific "CUSTO_FECHAMENTO" ghost-payment
                    if (!hasTags || !t.tags.includes("CUSTO_FECHAMENTO_REJANE")) {
                        rejaneStats.gastos += (t.valueBRL || t.value || 0);
                    }
                } else if (t.type === 'revenue' && isRejanePerson) {
                    rejaneStats.recebido += (t.valueBRL || t.value || 0);
                }

                // If closure event exists, month is closed
                if (isEventClose) {
                    rejaneStats.status = "Fechado";
                }
            });

            const rejSaldo = rejaneStats.recebido - rejaneStats.gastos;

            let rejaneHtml = "";
            if (rejaneStats.ativo) {
                rejaneHtml = `
                    <h3 style="font-size:16px; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px; margin-top:20px;">6. Resumo Sub-Caixa (Rejane)</h3>
                    <table class="monthly-table" style="width:100%; max-width: 500px;">
                        <tbody>
                            <tr>
                                <td style="text-align:left;">Status do Mês</td>
                                <td style="font-weight:bold; color: ${rejaneStats.status === 'Fechado' ? '#007bff' : '#fd7e14'}">${rejaneStats.status}</td>
                            </tr>
                            <tr>
                                <td style="text-align:left;">Gastos Identificados</td>
                                <td class="text-red">${fmtBRL(rejaneStats.gastos)}</td>
                            </tr>
                            <tr>
                                <td style="text-align:left;">Pagamentos Recebidos</td>
                                <td class="text-green">${fmtBRL(rejaneStats.recebido)}</td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr>
                                <td style="text-align:left;">Saldo Residual</td>
                                <td class="${rejSaldo >= 0 ? 'text-green' : 'text-red'}">${fmtBRL(rejSaldo)}</td>
                            </tr>
                        </tfoot>
                    </table>
                `;
            }

            // ==========================================
            // HTML RENDER
            // ==========================================
            container.innerHTML = `
                <!-- NO PRINT / FILTERS HEADER -->
                <div class="card no-print" style="margin-bottom: 20px; position: sticky; top: 60px; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px; flex-wrap:wrap; gap:10px;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <button class="btn btn-outline small" id="btnBack">← Voltar</button>
                            <h3 style="margin:0; font-size:16px;">Fechamento Mensal</h3>
                        </div>
                        <div style="display:flex; gap:10px;">
                            <button class="btn btn-secondary small" id="btnExport" style="background:#5c6bc0; border:none; color:#fff;">📊 Exportar CSV</button>
                            <button class="btn btn-secondary small" id="btnGerar">Gerar</button>
                            <button class="btn btn-primary small" id="btnPrint" style="background:#0056b3;">🖨 Imprimir / PDF</button>
                        </div>
                    </div>
                    
                    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px;">
                        <input type="month" id="inpMonth" class="input" value="${currentMonth}">
                        <select id="selPerson" class="select">${pOpts}</select>
                    </div>
                </div>

                <!-- DOCUMENT TO PRINT -->
                <div class="card" style="background: #fff;">
                    <div style="text-align:center; margin-bottom: 20px;">
                        <h2 style="margin-bottom:5px;">FinanceApp — Fechamento ${currentMonth.split('-').reverse().join('/')}</h2>
                        <div style="color:#666; font-size:12px;">Gerado em: ${new Date().toLocaleString('pt-BR')}</div>
                        ${selectedPerson ? `<div style="color:#666; font-size:12px; margin-top:5px;">Pessoa: ${esc(people.find(p => p.id === selectedPerson)?.name)}</div>` : ''}
                    </div>

                    <h3 style="font-size:16px; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px;">1. Resumo Financeiro Realizado</h3>
                    <div style="display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap;">
                        <div class="summary-box" style="flex: 1; min-width: 150px;">
                            <div class="summary-label">Receitas</div>
                            <div class="summary-val text-green">${fmtBRL(currTotal.rev)}</div>
                            ${renderDelta(currTotal.rev, prevTotal.rev)}
                        </div>
                        <div class="summary-box" style="flex: 1; min-width: 150px;">
                            <div class="summary-label">Despesas</div>
                            <div class="summary-val text-red">${fmtBRL(currTotal.exp)}</div>
                            ${renderDelta(currTotal.exp, prevTotal.exp, true)}
                        </div>
                        <div class="summary-box" style="flex: 1; min-width: 150px; background: #f8f9fa;">
                            <div class="summary-label">Saldo Líquido</div>
                            <div class="summary-val ${currTotal.bal >= 0 ? 'text-green' : 'text-red'}">${fmtBRL(currTotal.bal)}</div>
                            ${renderDelta(currTotal.bal, prevTotal.bal)}
                        </div>
                    </div>

                    <div style="display: flex; gap: 20px; align-items: start; margin-top: 20px; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 250px;">
                            <h3 style="font-size:16px; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px;">2. Top 10 Categorias</h3>
                            <table class="monthly-table">
                                <thead><tr><th style="text-align:left;">Categoria</th><th>Total (BRL)</th></tr></thead>
                                <tbody>${catRows}</tbody>
                            </table>
                        </div>

                        <div style="flex: 1; min-width: 250px;">
                            <h3 style="font-size:16px; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px;">3. Top 10 Tags</h3>
                            <table class="monthly-table">
                                <thead><tr><th style="text-align:left;">Tag</th><th>Total (BRL)</th></tr></thead>
                                <tbody>${tagRows}</tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Page break for long reports (optional based on content size, but safe) -->
                    <div class="page-break"></div>

                    <h3 style="font-size:16px; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px; margin-top: 20px;">4. Cartões x Faturas do Mês</h3>
                    <table class="monthly-table">
                        <thead>
                            <tr>
                                <th style="text-align:left;">Cartão</th>
                                <th>Total Compras</th>
                                <th>Total Pago</th>
                                <th>Restante</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${cardRows}
                        </tbody>
                    </table>

                    <div style="display: grid; grid-template-columns: 1fr; gap: 20px; align-items: start; margin-top: 20px;">
                        <div>
                            <h3 style="font-size:16px; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px;">5. Contas a Pagar (Previsto)</h3>
                            <table class="monthly-table">
                                <thead>
                                    <tr>
                                        <th style="text-align:left;">Previsto</th>
                                        <th>Pago</th>
                                        <th>Aberto</th>
                                        <th>Pulado</th>
                                        <th>Conclusão</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${billRows}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <h3 style="font-size:16px; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px; margin-top: 20px;">6. Dívidas & Empréstimos (Vencimentos no Mês)</h3>
                    
                    <div style="display:flex; gap:20px; margin-bottom: 10px; font-size:13px;">
                        <div><strong>Total Pendente/Vencer:</strong> ${fmtBRL(debtStats.aVencer)}</div>
                        <div class="text-red"><strong>Total Atrasado:</strong> ${fmtBRL(debtStats.atrasada)}</div>
                    </div>

                    <table class="monthly-table">
                        <thead>
                            <tr>
                                <th style="text-align:left;">Data</th>
                                <th style="text-align:left;">Dívida</th>
                                <th style="text-align:left;">Parc.</th>
                                <th>Valor</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${debtTableRows}
                        </tbody>
                    </table>

                    ${rejaneHtml}

                </div>
                
                <!-- CSV Modal -->
                <div class="export-modal" id="modalCsv">
                    <div class="export-content">
                        <h3>Exportar Dados (CSV)</h3>
                        <div style="color:#666; font-size:12px; margin-bottom:15px;">Selecione quais seções deseja baixar em formato Excel (.csv). Múltiplos arquivos serão gerados.</div>
                        
                        <label class="export-opt"><input type="checkbox" id="chkCsvResumo" checked> Resumo Financeiro Realizado</label>
                        <label class="export-opt"><input type="checkbox" id="chkCsvCat" checked> Onde Gastou (Categorias & Tags)</label>
                        <label class="export-opt"><input type="checkbox" id="chkCsvCartoes" checked> Controle de Cartões</label>
                        <label class="export-opt"><input type="checkbox" id="chkCsvBills" checked> Contas a Pagar (Previsto)</label>
                        <label class="export-opt"><input type="checkbox" id="chkCsvDividas" checked> Dívidas Vencendo no Mês</label>

                        <div class="export-actions">
                            <button class="btn btn-outline" id="btnCancelCsv">Cancelar</button>
                            <button class="btn btn-primary" id="btnConfirmCsv">Baixar CSVs</button>
                        </div>
                    </div>
                </div>
            `;

            // Setup listeners
            container.querySelector("#btnBack").onclick = () => location.hash = "#reports";
            container.querySelector("#btnPrint").onclick = () => window.print();

            container.querySelector("#btnGerar").onclick = () => {
                currentMonth = container.querySelector("#inpMonth").value || new Date().toISOString().slice(0, 7);
                selectedPerson = container.querySelector("#selPerson").value;
                loadAndRender();
            };

            const modalCsv = container.querySelector("#modalCsv");
            container.querySelector("#btnExport").onclick = () => modalCsv.classList.add("active");
            container.querySelector("#btnCancelCsv").onclick = () => modalCsv.classList.remove("active");

            container.querySelector("#btnConfirmCsv").onclick = () => {
                const prefix = `FinanceApp_${currentMonth}`;

                if (container.querySelector("#chkCsvResumo").checked) {
                    exportCSV(csvDataMaps.resumo, `${prefix}_resumo.csv`);
                }

                if (container.querySelector("#chkCsvCat").checked) {
                    exportCSV(csvDataMaps.categorias, `${prefix}_categorias.csv`);
                    exportCSV(csvDataMaps.tags, `${prefix}_tags.csv`);
                }

                if (container.querySelector("#chkCsvCartoes").checked) {
                    exportCSV(csvDataMaps.cartoes, `${prefix}_cartoes.csv`);
                }

                if (container.querySelector("#chkCsvBills").checked) {
                    exportCSV(csvDataMaps.bills, `${prefix}_contas_previstas.csv`);
                }

                if (container.querySelector("#chkCsvDividas").checked) {
                    exportCSV(csvDataMaps.dividas, `${prefix}_dividas.csv`);
                }

                modalCsv.classList.remove("active");
            };

        } catch (e) {
            console.error("Monthly Close Error", e);
            container.innerHTML = `<div class="card error">Erro ao processar fechamento mensal: ${e.message}</div>`;
        }
    }

    loadAndRender();
}
