import { list } from "../db.js?v=v2";
import { getBrandIcon } from "../utils/brand.js?v=2.1";

function fmtBRL(val) {
    return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

const monthsList = [
    { num: '01', name: 'Janeiro' },
    { num: '02', name: 'Fevereiro' },
    { num: '03', name: 'Março' },
    { num: '04', name: 'Abril' },
    { num: '05', name: 'Maio' },
    { num: '06', name: 'Junho' },
    { num: '07', name: 'Julho' },
    { num: '08', name: 'Agosto' },
    { num: '09', name: 'Setembro' },
    { num: '10', name: 'Outubro' },
    { num: '11', name: 'Novembro' },
    { num: '12', name: 'Dezembro' }
];

export async function annualReportScreen() {
    return `
    <style>
        @media print {
            body { background: white; margin: 0; padding: 0; color: #000; }
            nav, .bottom-nav, #titlebar, .no-print { display: none !important; }
            .card { box-shadow: none !important; border: 1px solid #ddd !important; margin-bottom: 20px !important; break-inside: avoid; }
            #annual-report-container { padding: 0 !important; max-width: 100% !important; margin: 0 !important; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: right; }
            th { background-color: #f8f9fa !important; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            td:first-child, th:first-child { text-align: left; }
            h2, h3 { color: #000; margin-top: 0; }
            .print-header { display: block !important; margin-bottom: 20px; }
            .text-green { color: #000 !important; }
            .text-red { color: #000 !important; }
        }
        .text-green { color: #28a745; }
        .text-red { color: #dc3545; }
        .annual-table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px; }
        .annual-table th, .annual-table td { border: 1px solid #ddd; padding: 8px; text-align: right; }
        .annual-table td:first-child, .annual-table th:first-child { text-align: left; }
        .annual-table th { background-color: #f8f9fa; font-weight: bold; }
        .annual-table tfoot td { font-weight: bold; background-color: #f1f1f1; }
    </style>
    <div id="annual-report-container" style="padding: 10px; max-width: 900px; margin: 0 auto; padding-bottom: 80px;">
        <div class="card"><div class="small">Carregando relatório anual...</div></div>
    </div>
    `;
}

export async function wireAnnualReportHandlers(rootEl) {
    const container = rootEl.querySelector("#annual-report-container");

    let currentYear = new Date().getFullYear().toString();
    let selectedPerson = "";
    let selectedAccount = "";
    let selectedCard = "";

    async function loadAndRender() {
        container.innerHTML = `<div class="card"><div class="small">Calculando...</div></div>`;

        try {
            const [txs, categories, people, accounts, cards] = await Promise.all([
                list("transactions"),
                list("categories"),
                list("people"),
                list("accounts"),
                list("cards")
            ]);

            const pOpts = `<option value="">Todas Pessoas</option>` +
                people.map(p => `<option value="${p.id}" ${selectedPerson === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join("");

            const acOpts = `<option value="">Todas Contas</option>` +
                accounts.map(a => `<option value="${a.id}" ${selectedAccount === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join("");

            const cardOpts = `<option value="">Todos Cartões</option>` +
                cards.map(c => `<option value="${c.id}" ${selectedCard === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join("");

            // Filter Txs globally
            const filteredTxs = txs.filter(t => {
                const dateRef = t.cardId ? t.invoiceMonth : t.date;
                if (!dateRef || !dateRef.startsWith(currentYear)) return false;

                if (selectedPerson && t.personId !== selectedPerson) return false;
                if (selectedAccount && t.accountId !== selectedAccount && t.sourceAccountId !== selectedAccount) return false;
                if (selectedCard && t.cardId !== selectedCard) return false;

                // Exclude unconfirmed planned installments
                if (t.kind === "planned_installment" && !t.paid) return false;

                return true;
            });

            // 1. Resumo por Mês
            const monthData = {};
            monthsList.forEach(m => monthData[m.num] = { rev: 0, exp: 0 });

            let totalYearRev = 0;
            let totalYearExp = 0;

            filteredTxs.forEach(t => {
                const dateRef = t.cardId ? t.invoiceMonth : t.date;
                if (!dateRef || dateRef.length < 7) return;
                const m = dateRef.slice(5, 7); // YYYY-MM
                if (!monthData[m]) return;

                const val = t.valueBRL || t.value || 0;

                // Do not count INVOICE_PAYMENT/card_payment in the general revenue/expense flow, 
                // because card expenses are already counted as 'expense' when made.
                const isPay = t.kind === "INVOICE_PAYMENT" || t.type === "card_payment";
                if (isPay) return;

                if (t.type === "revenue") {
                    monthData[m].rev += val;
                    totalYearRev += val;
                } else if (t.type === "expense") {
                    monthData[m].exp += val;
                    totalYearExp += val;
                }
            });

            let tableMonthRows = "";
            monthsList.forEach(m => {
                const d = monthData[m.num];
                const bal = d.rev - d.exp;
                const balClass = bal >= 0 ? 'text-green' : 'text-red';
                tableMonthRows += `
                    <tr>
                        <td>${m.name}</td>
                        <td class="text-green">${fmtBRL(d.rev)}</td>
                        <td class="text-red">${fmtBRL(d.exp)}</td>
                        <td class="${balClass}" style="font-weight:bold;">${fmtBRL(bal)}</td>
                    </tr>
                `;
            });

            // 2. Top Categorias do Ano
            const catGroups = {};
            filteredTxs.forEach(t => {
                const isPay = t.kind === "INVOICE_PAYMENT" || t.type === "card_payment";
                if (isPay) return;

                if (t.type !== "expense") return;
                const cid = t.categoryId || "uncat";
                if (!catGroups[cid]) catGroups[cid] = 0;
                catGroups[cid] += (t.valueBRL || t.value || 0);
            });
            const sortedCats = Object.keys(catGroups).sort((a, b) => catGroups[b] - catGroups[a]).slice(0, 10);

            let tableCatRows = sortedCats.length === 0 ? `<tr><td colspan="2" style="text-align:center; color:#999;">Sem despesas no ano.</td></tr>` : "";
            sortedCats.forEach(cid => {
                const name = categories.find(c => c.id === cid)?.name || "(Sem Categoria)";
                tableCatRows += `
                    <tr>
                        <td>${esc(name)}</td>
                        <td>${fmtBRL(catGroups[cid])}</td>
                    </tr>
                `;
            });

            // 3. Por Conta
            const accGroups = {};
            filteredTxs.forEach(t => {
                const isPay = t.kind === "INVOICE_PAYMENT" || t.type === "card_payment";
                const aid = t.accountId || t.sourceAccountId;
                if (!aid) return;

                if (!accGroups[aid]) accGroups[aid] = { rev: 0, exp: 0 };
                const val = t.valueBRL || t.value || 0;
                if (t.type === "revenue") accGroups[aid].rev += val;
                else if (t.type === "expense" || isPay) accGroups[aid].exp += val;
            });

            let tableAccRows = Object.keys(accGroups).length === 0 ? `<tr><td colspan="4" style="text-align:center; color:#999;">Sem movimentações em contas.</td></tr>` : "";
            Object.keys(accGroups).forEach(aid => {
                const acc = accounts.find(a => a.id === aid);
                const name = acc ? `${getBrandIcon(acc.brandKey)} ${acc.name}` : "Outros / Apagado";
                const d = accGroups[aid];
                const bal = d.rev - d.exp;
                tableAccRows += `
                    <tr>
                        <td>${esc(name)}</td>
                        <td class="text-green">${fmtBRL(d.rev)}</td>
                        <td class="text-red">${fmtBRL(d.exp)}</td>
                        <td class="${bal >= 0 ? 'text-green' : 'text-red'}" style="font-weight:bold;">${fmtBRL(bal)}</td>
                    </tr>
                `;
            });

            // 4. Cartões (Resumo Anual)
            const cardGroups = {};
            filteredTxs.forEach(t => {
                const cid = t.cardId;
                if (!cid) return;

                if (!cardGroups[cid]) cardGroups[cid] = { compras: 0, pagos: 0 };
                const val = t.valueBRL || t.value || 0;

                const isPay = t.kind === "INVOICE_PAYMENT" || t.type === "card_payment";
                if (isPay) {
                    cardGroups[cid].pagos += val;
                } else if (t.type === "expense") {
                    cardGroups[cid].compras += val;
                }
            });

            let tableCardRows = Object.keys(cardGroups).length === 0 ? `<tr><td colspan="3" style="text-align:center; color:#999;">Sem movimentações de cartões.</td></tr>` : "";
            Object.keys(cardGroups).forEach(cid => {
                const name = cards.find(c => c.id === cid)?.name || "Cartão Apagado";
                const d = cardGroups[cid];
                tableCardRows += `
                    <tr>
                        <td>${esc(name)}</td>
                        <td class="text-red">${fmtBRL(d.compras)}</td>
                        <td class="text-green">${fmtBRL(d.pagos)}</td>
                    </tr>
                `;
            });

            // HTML RENDER
            container.innerHTML = `
                <!-- NO PRINT / FILTERS HEADER -->
                <div class="card no-print" style="margin-bottom: 20px; position: sticky; top: 60px; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px; flex-wrap:wrap; gap:10px;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <button class="btn btn-outline small" id="btnBack">← Voltar</button>
                            <h3 style="margin:0; font-size:16px;">Relatório Anual</h3>
                        </div>
                        <div style="display:flex; gap:10px;">
                            <button class="btn btn-secondary small" id="btnGerar">Gerar</button>
                            <button class="btn btn-primary small" id="btnPrint" style="background:#0056b3;">🖨 Imprimir / PDF</button>
                        </div>
                    </div>
                    
                    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px;">
                        <input type="number" id="inpYear" class="input" value="${currentYear}" min="2000" max="2100" placeholder="Ano (YYYY)">
                        <select id="selPerson" class="select">${pOpts}</select>
                        <select id="selAccount" class="select">${acOpts}</select>
                        <select id="selCard" class="select">${cardOpts}</select>
                    </div>
                </div>

                <!-- DOCUMENT TO PRINT -->
                <div class="card" style="background: #fff;">
                    <div style="text-align:center; margin-bottom: 20px;">
                        <h2 style="margin-bottom:5px;">FinanceApp — Relatório Anual ${currentYear}</h2>
                        <div style="color:#666; font-size:12px;">Gerado em: ${new Date().toLocaleString('pt-BR')}</div>
                        <div style="color:#666; font-size:12px; margin-top:5px;">
                            Filtros: 
                            Pessoa: ${selectedPerson ? esc(people.find(p => p.id === selectedPerson)?.name) : 'Todas'} |
                            Conta: ${selectedAccount ? (() => {
                    const acc = accounts.find(a => a.id === selectedAccount);
                    return acc ? `${getBrandIcon(acc.brandKey)} ${esc(acc.name)}` : 'Todas';
                })() : 'Todas'} |
                            Cartão: ${selectedCard ? esc(cards.find(c => c.id === selectedCard)?.name) : 'Todos'}
                        </div>
                    </div>

                    <h3 style="font-size:16px; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px;">1. Resumo por Mês</h3>
                    <table class="annual-table">
                        <thead>
                            <tr>
                                <th>Mês</th>
                                <th>Receitas</th>
                                <th>Despesas</th>
                                <th>Saldo Líquido</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableMonthRows}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td>TOTAL DO ANO</td>
                                <td class="text-green">${fmtBRL(totalYearRev)}</td>
                                <td class="text-red">${fmtBRL(totalYearExp)}</td>
                                <td class="${(totalYearRev - totalYearExp) >= 0 ? 'text-green' : 'text-red'}">${fmtBRL(totalYearRev - totalYearExp)}</td>
                            </tr>
                        </tfoot>
                    </table>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; margin-top: 20px;">
                        <div>
                            <h3 style="font-size:16px; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px;">2. Top 10 Categorias</h3>
                            <table class="annual-table">
                                <thead>
                                    <tr>
                                        <th>Categoria</th>
                                        <th>Total (BRL)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tableCatRows}
                                </tbody>
                            </table>
                        </div>

                        <div>
                            <h3 style="font-size:16px; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px;">3. Por Conta</h3>
                            <table class="annual-table">
                                <thead>
                                    <tr>
                                        <th>Conta</th>
                                        <th>Receitas</th>
                                        <th>Despesas</th>
                                        <th>Saldo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tableAccRows}
                                </tbody>
                            </table>

                            <h3 style="font-size:16px; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px; margin-top: 20px;">4. Cartões (Visão Anual)</h3>
                            <table class="annual-table">
                                <thead>
                                    <tr>
                                        <th>Cartão</th>
                                        <th>Total Compras</th>
                                        <th>Total Pago</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tableCardRows}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;

            // Setup listeners
            container.querySelector("#btnBack").onclick = () => location.hash = "#reports";
            container.querySelector("#btnPrint").onclick = () => window.print();

            container.querySelector("#btnGerar").onclick = () => {
                currentYear = container.querySelector("#inpYear").value || new Date().getFullYear().toString();
                selectedPerson = container.querySelector("#selPerson").value;
                selectedAccount = container.querySelector("#selAccount").value;
                selectedCard = container.querySelector("#selCard").value;
                loadAndRender();
            };

        } catch (e) {
            console.error("Annual Report Error", e);
            container.innerHTML = `<div class="card error">Erro ao gerar relatório: ${e.message}</div>`;
        }
    }

    loadAndRender();
}
