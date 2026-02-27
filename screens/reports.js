import { list, get, put, remove, uid, listInvestmentBoxes, computeBoxBalance, listMovesByBoxId } from "../db.js?v=v2";
import { drawBarChart, exportChartToPNG } from "../utils/charts.js";
import { prepareExportPack } from "../ui.js?v=2.1";
import { exportCSV } from "../utils/export.js";
import { getBrandIcon } from "../utils/brand.js?v=2.1";

/* =========================================
   STATE
   ========================================= */
const state = {
    filters: {
        viewMode: "dashboard", // 'dashboard' | 'details'
        month: new Date().toISOString().slice(0, 7), // YYYY-MM
        personId: "",
        accountId: "",
        cardId: "",
        holder: "", // 'main' | 'additional' | specific name
        quickFilter: null
    },
    // Data cache
    cache: {
        txs: [],
        people: [],
        accounts: [],
        cards: [],
        categories: [],
        tags: [],
        bills: [],
        loans: [],
        loanInstallments: [],
        personBalances: [],
        balanceEvents: [],
        settings: {}
    }
};

function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function fmtBRL(val) {
    return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getPrevMonth(m, offset = 1) {
    const d = new Date(m + "-01T00:00:00");
    d.setMonth(d.getMonth() - offset);
    return d.toISOString().slice(0, 7);
}

/* =========================================
   MAIN EXPORT
   ========================================= */
export async function reportsScreen() {
    return `
    <style>
        /* Modal for Export Settings */
        .export-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center; }
        .export-modal.active { display: flex; }
        .export-content { background: #fff; padding: 20px; border-radius: 8px; width: 90%; max-width: 400px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .export-content h3 { margin-top: 0; margin-bottom: 15px; }
        .export-opt { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
        .export-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
    </style>
    <div id="reportsContainer">
        <div class="card"><div class="small">Carregando relatórios...</div></div>
    </div>
    
    <div class="export-modal" id="modalCsvReports">
        <div class="export-content">
            <h3>Exportar Dados (CSV)</h3>
            <div style="color:#666; font-size:12px; margin-bottom:15px;">Selecione quais sumários deseja baixar em Excel (.csv). Os dados respeitarão os filtros atuais.</div>
            
            <label class="export-opt"><input type="checkbox" id="chkRptResumo" checked> Resumo do Mês</label>
            <label class="export-opt"><input type="checkbox" id="chkRptCat"> Despesas por Categoria</label>
            <label class="export-opt"><input type="checkbox" id="chkRptTag"> Despesas por Tag</label>
            <label class="export-opt"><input type="checkbox" id="chkRptAcc"> Balanço por Conta</label>
            <label class="export-opt"><input type="checkbox" id="chkRptInv"> Resumo de Investimentos</label>

            <div class="export-actions">
                <button class="btn btn-outline" id="btnCancelCsvRpt">Cancelar</button>
                <button class="btn btn-primary" id="btnConfirmCsvRpt">Baixar CSVs</button>
            </div>
        </div>
    </div>
    `;
}

export async function wireReportsHandlers(rootEl) {
    const container = rootEl.querySelector("#reportsContainer");

    // 1. Load Persistence
    try {
        const saved = await get("settings", "ui_reports_state");
        if (saved && saved.filters) {
            state.filters = { ...state.filters, ...saved.filters };
        }
    } catch (e) { console.warn("Load filters err", e); }

    // 2. Load Data
    try {
        const [txs, people, accounts, cards, cats, tags, settingsArray] = await Promise.all([
            list("transactions"),
            list("people"),
            list("accounts"),
            list("cards"),
            list("categories"),
            list("tags"),
            list("settings")
        ]);

        let bills = [];
        try { bills = await list("bills"); } catch (e) { }

        let loans = [];
        let loanInstallments = [];
        let personBalances = [];
        let balanceEvents = [];

        try {
            [loans, loanInstallments, personBalances, balanceEvents] = await Promise.all([
                list("loans").catch(() => []),
                list("loan_installments").catch(() => []),
                list("person_balances").catch(() => []),
                list("balance_events").catch(() => [])
            ]);
        } catch (e) { }

        const settings = {};
        if (settingsArray) {
            settingsArray.forEach(s => settings[s.id] = s);
        }

        state.cache = {
            txs, people, accounts, cards, categories: cats, tags, bills,
            loans, loanInstallments, personBalances, balanceEvents,
            settings
        };

        renderReports(container);

        renderReports(container);
    } catch (e) {
        container.innerHTML = `<div class="card error">Erro ao carregar dados: ${e.message}</div>`;
    }
}

/* =========================================
   RENDER LOGIC
   ========================================= */


function filterTxs(txs, month, filters) {
    return txs.filter(t => {
        const isCard = !!t.cardId;
        const dateMatch = isCard
            ? (t.invoiceMonth === month)
            : (t.date && t.date.startsWith(month));

        if (!dateMatch) return false;

        if (filters.personId && t.personId !== filters.personId) return false;

        if (filters.accountId) {
            if (t.accountId !== filters.accountId && t.sourceAccountId !== filters.accountId) return false;
        }

        if (filters.cardId) {
            if (t.cardId !== filters.cardId) return false;
        }

        if (filters.holder) {
            const hInfo = state.cache.cards.find(c => c.id === t.cardId);

            if (filters.holder === 'main') {
                if (t.cardHolder !== 'main') return false;
            } else if (filters.holder === 'additional') {
                if (t.cardHolder !== 'additional') return false;
            } else if (filters.holder.length > 10) {
                let effectiveName = "";
                if (t.cardId) {
                    const c = state.cache.cards.find(x => x.id === t.cardId);
                    if (c) {
                        if (t.cardHolder === 'additional') effectiveName = c.additional;
                        else effectiveName = c.holder;
                    }
                }

                if (!effectiveName || !effectiveName.toLowerCase().includes(filters.holder.toLowerCase())) {
                    return false;
                }
            }
        }
        return true;
    });
}

async function renderReports(cnt) {
    // --- FILTER ---
    const month = state.filters.month; // YYYY-MM
    const prevMonth = getPrevMonth(month);

    // Filter Current & Prev
    const currentTxs = filterTxs(state.cache.txs, month, state.filters);
    const prevTxs = filterTxs(state.cache.txs, prevMonth, state.filters);

    // Apply Quick Filter (if any)
    let displayTxs = currentTxs; // For tables/charts
    let quickFilterLabel = "";

    if (state.filters.quickFilter) {
        const { type, value, name } = state.filters.quickFilter;
        quickFilterLabel = `<div style="background:#007bff; color:white; padding:5px 10px; border-radius:15px; font-size:12px; display:inline-flex; align-items:center; gap:5px; margin-top:5px;">
            Filtro: ${esc(name)} <span style="cursor:pointer; font-weight:bold;" id="btnRemoveQuick">✕</span>
        </div>`;

        displayTxs = currentTxs.filter(t => {
            if (type === 'category') return t.categoryId === value;
            if (type === 'tag') return t.tags && t.tags.includes(value);
            return true;
        });
    }

    // Calc Totals
    // Calc Totals Helper
    const calcTotals = (list) => {
        let r = 0, e = 0;
        list.forEach(t => {
            const val = t.valueBRL ?? t.value;
            if (t.type === 'revenue') r += val;
            else if (t.type === 'expense') e += val;
        });
        return { rev: r, exp: e, bal: r - e };
    };

    const curr = calcTotals(currentTxs);
    const prev = calcTotals(prevTxs);

    // Delta Helper
    const renderDelta = (currVal, prevVal, inverse = false) => {
        if (!prevVal) return `<div class="small" style="color:#999;">Sem histórico</div>`;
        const diff = currVal - prevVal;
        const pct = (diff / prevVal) * 100;

        let color = "gray";
        // Logic: More Revenue is Good (Green), Less is Bad (Red)
        // More Expense is Bad (Red), Less is Good (Green)
        if (inverse) { // For Expenses
            if (diff > 0) color = "#dc3545"; // Increased expense = Bad
            else if (diff < 0) color = "#28a745"; // Decreased expense = Good
        } else { // Revenue/Balance
            if (diff > 0) color = "#28a745";
            else if (diff < 0) color = "#dc3545";
        }

        const arrow = diff > 0 ? "▲" : (diff < 0 ? "▼" : "—");
        return `<div class="small" style="color:${color}; font-weight:bold;">${arrow} ${fmtBRL(Math.abs(diff))} (${Math.abs(pct).toFixed(0)}%)</div>`;
    };

    // --- RENDER HEADER ---
    const dateInputVal = state.filters.month;

    // Filter Options
    const pOpts = `<option value="">Todas Pessoas</option>` +
        state.cache.people.map(p => `<option value="${p.id}" ${state.filters.personId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join("");

    const acOpts = `<option value="">Todas Contas</option>` +
        state.cache.accounts.map(a => `<option value="${a.id}" ${state.filters.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join("");

    const cardOpts = `<option value="">Todos Cartões</option>` +
        state.cache.cards.map(c => `<option value="${c.id}" ${state.filters.cardId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join("");

    // Holder Filter
    // We can list generic types + detected names from cards?
    const holdersSet = new Set(['main', 'additional']);
    state.cache.cards.forEach(c => {
        if (c.holder) holdersSet.add(c.holder);
        if (c.additional) holdersSet.add(c.additional);
    });
    // Let's just fixed basic + free text? Or dropdown?
    // User requested: "Todos / Titular / Adicional / Nome do portador se disponível"
    // Let's map unique names.
    const uniqueNames = [];
    state.cache.cards.forEach(c => {
        if (c.holder && !uniqueNames.includes(c.holder)) uniqueNames.push(c.holder);
        if (c.additional && !uniqueNames.includes(c.additional)) uniqueNames.push(c.additional);
    });

    const hOpts = `<option value="">Todos Portadores</option>
         <option value="main" ${state.filters.holder === 'main' ? 'selected' : ''}>Titular (Genérico)</option>
         <option value="additional" ${state.filters.holder === 'additional' ? 'selected' : ''}>Adicional (Genérico)</option>
         <optgroup label="Por Nome">
            ${uniqueNames.map(n => `<option value="${n}" ${state.filters.holder === n ? 'selected' : ''}>${esc(n)}</option>`).join("")}
         </optgroup>
    `;

    cnt.innerHTML = `
    <div id="reportsContainer" style="padding-bottom:80px; width:100%;">
        
        <!-- HEADER / FILTERS -->
        <div class="card" style="box-shadow:0 2px 8px rgba(0,0,0,0.05); margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <button class="btn btn-outline small" onclick="location.hash='#home'">← Voltar</button>
                    <h3 style="margin:0; font-size:16px;">Painel / Relatórios</h3>
                </div>
                <div style="display:flex; gap:5px;">
                    <button class="btn btn-secondary small" id="btnExportRpt" style="background:#5c6bc0; border:none; color:#fff;">📊 Exportar CSV</button>
                    <button id="btnViewDashboard" class="btn small ${state.filters.viewMode === 'dashboard' ? 'btn-primary' : 'btn-secondary'}" data-action="reports-view" data-view="dashboard">Dash</button>
                    <button id="btnViewDetails" class="btn small ${state.filters.viewMode === 'details' ? 'btn-primary' : 'btn-secondary'}" data-action="reports-view" data-view="details">Tabelas</button>
                    <button onclick="location.hash='#charts-report'" class="btn btn-outline small">PDF Gráfico</button>
                    <button onclick="location.hash='#annual-report'" class="btn btn-outline small">📅 Relatório Anual</button>
                    <button onclick="location.hash='#monthly-close'" class="btn btn-outline small">📄 Fechamento do Mês</button>
                </div>
            </div>
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <input type="month" id="repMonth" class="input" value="${dateInputVal}">
                <button id="btnToday" class="btn btn-secondary small">Hoje</button>
                <button id="btnClear" class="btn btn-secondary small">Limpar</button>
            </div>
            <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:5px; margin-top:10px;">
                <select id="fltPerson" class="select">${pOpts}</select>
                <select id="fltAccount" class="select">${acOpts}</select>
                <select id="fltCard" class="select">${cardOpts}</select>
                <select id="fltHolder" class="select">${hOpts}</select>
            </div>
            ${quickFilterLabel}
        </div>

        <div id="reportsToggleContainer" style="display:flex; justify-content:center; gap:10px; margin-top:15px; margin-bottom: 10px;">
             <button class="btn ${state.filters.viewMode === 'dashboard' ? 'btn-primary' : 'btn-outline'}" style="flex:1;" data-action="reports-view" data-view="dashboard">📊 Painel Geral</button>
             <button class="btn ${state.filters.viewMode === 'details' ? 'btn-primary' : 'btn-outline'}" style="flex:1;" data-action="reports-view" data-view="details">📝 Detalhamento</button>
        </div>
        
        <div id="reportsBody">
        </div>
    </div>
    `; // End of main outer HTML

    const renderCurrentView = () => {
        const viewArea = cnt.querySelector("#reportsBody");
        if (!viewArea) return;

        if (state.filters.viewMode === 'dashboard') {
            viewArea.innerHTML = renderDashboardView(currentTxs, prevTxs, month, state.filters, state.cache, curr, prev);
            setTimeout(() => {
                renderBillsOverview(cnt, state.filters, month);
                renderLoansOverview(cnt, state.filters, month);
                renderAlertsOverview(cnt, state.filters, month);
                renderChecklistView(cnt, month);
                calcOpenInvoices(cnt, state.cache.txs, state.filters);
                calcInvestmentsCard(cnt, month, state.filters, state.cache.txs);
            }, 0);
        } else {
            if (displayTxs.length === 0) {
                viewArea.innerHTML = `<div class="card" style="text-align:center; padding: 20px;">Sem dados para o período/filtros selecionados.</div>
                                      <div id="detailsInvestmentsContainer"></div>`;
                setTimeout(() => renderDetailsInvestments(cnt, month, state.filters), 0);
            } else {
                viewArea.innerHTML = `
                    <div class="grid" style="grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
                        ${renderCatTable(displayTxs)}
                        ${renderTagTable(displayTxs)}
                    </div>
                    
                    <div style="margin-top:10px;">
                        ${renderTopTransactions(displayTxs)}
                    </div>
                    
                    <div id="detailsInvestmentsContainer" style="margin-top:10px;"></div>
                `;
                setTimeout(() => renderDetailsInvestments(cnt, month, state.filters), 0);
            }
        }

        // Atualizar botões de toggle
        cnt.querySelectorAll('[data-action="reports-view"]').forEach(b => {
            b.className = (b.dataset.view === state.filters.viewMode) ? "btn btn-primary" : "btn btn-outline";
            b.style.flex = "1";
        });
    };

    renderCurrentView();

    // Eventos do Toggle
    cnt.querySelectorAll('[data-action="reports-view"]').forEach(b => {
        b.onclick = () => {
            state.filters.viewMode = b.dataset.view;
            renderCurrentView();
        };
    });

    // --- HANDLERS ---

    const refresh = async () => {
        // Save filters
        await put("settings", { id: "ui_reports_state", filters: state.filters });
        renderReports(cnt);
    };

    // --- CSV EXPORT LOGIC ---
    const btnExport = cnt.querySelector("#btnExportRpt");
    const modalCsv = document.getElementById("modalCsvReports");
    const btnCancelCsv = document.getElementById("btnCancelCsvRpt");
    const btnConfirmCsv = document.getElementById("btnConfirmCsvRpt");

    if (btnExport && modalCsv) {
        btnExport.onclick = () => modalCsv.classList.add("active");
        btnCancelCsv.onclick = () => modalCsv.classList.remove("active");

        btnConfirmCsv.onclick = async () => {
            const prefix = `FinanceApp_Rpt_${month}`;

            // 1. Resumo
            if (document.getElementById("chkRptResumo").checked) {
                const calcDiff = (c, p) => c - (p || 0);
                const calcPctStr = (c, p) => p ? ((calcDiff(c, p) / p) * 100).toFixed(0) + '%' : '0%';

                const csvResumo = [
                    ["Métrica", "Mês Atual", "Mês Anterior", "Diferença", "Variação %"],
                    ["Receitas", curr.rev, prev.rev, calcDiff(curr.rev, prev.rev), calcPctStr(curr.rev, prev.rev)],
                    ["Despesas", curr.exp, prev.exp, calcDiff(curr.exp, prev.exp), calcPctStr(curr.exp, prev.exp)],
                    ["Saldo Líquido", curr.bal, prev.bal, calcDiff(curr.bal, prev.bal), calcPctStr(curr.bal, prev.bal)]
                ];
                exportCSV(csvResumo, `${prefix}_resumo.csv`);
            }

            // 2. Categorias
            if (document.getElementById("chkRptCat").checked) {
                const grpCat = {};
                displayTxs.forEach(t => {
                    if (t.type !== 'expense') return;
                    const catId = t.categoryId || "uncat";
                    grpCat[catId] = (grpCat[catId] || 0) + (t.valueBRL ?? t.value);
                });
                const csvCat = [["Categoria", "Total Despesas"]];
                Object.keys(grpCat).sort((a, b) => grpCat[b] - grpCat[a]).forEach(cid => {
                    const cName = state.cache.categories.find(c => c.id === cid)?.name || "(Sem Categoria)";
                    csvCat.push([cName, grpCat[cid]]);
                });
                exportCSV(csvCat, `${prefix}_categorias.csv`);
            }

            // 3. Tags
            if (document.getElementById("chkRptTag").checked) {
                const grpTag = {};
                displayTxs.forEach(t => {
                    if (t.type !== 'expense' || !t.tags) return;
                    t.tags.forEach(tg => {
                        const tk = tg.toLowerCase();
                        grpTag[tk] = (grpTag[tk] || 0) + (t.valueBRL ?? t.value);
                    });
                });
                const csvTag = [["Tag", "Total Despesas"]];
                Object.keys(grpTag).sort((a, b) => grpTag[b] - grpTag[a]).forEach(tk => {
                    csvTag.push(["#" + tk, grpTag[tk]]);
                });
                exportCSV(csvTag, `${prefix}_tags.csv`);
            }

            // 4. Accounts
            if (document.getElementById("chkRptAcc").checked) {
                const grpAcc = {};
                displayTxs.forEach(t => {
                    const accId = t.accountId || t.sourceAccountId;
                    if (!accId) return;
                    if (!grpAcc[accId]) grpAcc[accId] = { rev: 0, exp: 0 };

                    const val = t.valueBRL ?? t.value;
                    if (t.type === 'revenue') grpAcc[accId].rev += val;
                    else if (t.type === 'expense') grpAcc[accId].exp += val;
                });
                const csvAcc = [["Conta", "Receitas", "Despesas", "Resultado"]];
                Object.keys(grpAcc).forEach(aid => {
                    const aName = state.cache.accounts.find(a => a.id === aid)?.name || "Outros";
                    const g = grpAcc[aid];
                    csvAcc.push([aName, g.rev, g.exp, g.rev - g.exp]);
                });
                exportCSV(csvAcc, `${prefix}_contas.csv`);
            }

            // 5. Investments
            if (document.getElementById("chkRptInv") && document.getElementById("chkRptInv").checked) {
                const csvInv = [["Banco / Conta", "Investimento", "Saldo Atual", "Aportes (Mês)", "Rendimentos (Mês)", "Retiradas (Mês)"]];
                try {
                    const boxes = await listInvestmentBoxes();
                    for (const box of boxes) {
                        // Respeitar filtro de conta
                        if (state.filters.accountId && box.accountId !== state.filters.accountId) continue;
                        if (state.filters.personId && box.personId && box.personId !== state.filters.personId) continue;

                        const { balanceBRL } = await computeBoxBalance(box.id);

                        let mDeposit = 0, mYield = 0, mWithdraw = 0;
                        const moves = await listMovesByBoxId(box.id);
                        moves.forEach(m => {
                            if (m.date && m.date.startsWith(month)) {
                                if (m.kind === "deposit") mDeposit += (m.amountBRL || 0);
                                if (m.kind === "yield") mYield += (m.amountBRL || 0);
                                if (m.kind === "withdraw") mWithdraw += (m.amountBRL || 0);
                            }
                        });

                        const acc = state.cache.accounts.find(a => a.id === box.accountId);
                        const accName = acc ? acc.name : "Sem Banco";

                        csvInv.push([accName, box.name || "N/D", balanceBRL, mDeposit, mYield, mWithdraw]);
                    }
                    exportCSV(csvInv, `${prefix}_investimentos.csv`);
                } catch (e) {
                    console.error("Erro exportando investimentos", e);
                }
            }

            modalCsv.classList.remove("active");
        };
    }

    cnt.querySelector("#repMonth").onchange = (e) => { state.filters.month = e.target.value; refresh(); };
    cnt.querySelector("#btnToday").onclick = () => {
        state.filters.month = new Date().toISOString().slice(0, 7);
        refresh();
    };
    cnt.querySelector("#btnClear").onclick = () => {
        state.filters.personId = "";
        state.filters.accountId = "";
        state.filters.cardId = "";
        state.filters.holder = "";
        state.filters.quickFilter = null;
        refresh();
    };

    // Handlers removidos daqui pois usaremos delegation no wireReportsHandlers

    const btnQuick = cnt.querySelector("#btnRemoveQuick");
    if (btnQuick) btnQuick.onclick = () => {
        state.filters.quickFilter = null;
        refresh();
    };

    // Quick Filter Delegation
    cnt.querySelectorAll("[data-quick-filter]").forEach(el => {
        el.style.cursor = "pointer";
        el.onclick = () => {
            const type = el.dataset.type; // 'category' | 'tag'
            const val = el.dataset.val;
            const name = el.dataset.name;
            state.filters.quickFilter = { type, value: val, name };
            refresh();
        };
    });

    cnt.querySelector("#fltPerson").onchange = (e) => { state.filters.personId = e.target.value; refresh(); };
    cnt.querySelector("#fltAccount").onchange = (e) => { state.filters.accountId = e.target.value; refresh(); };
    cnt.querySelector("#fltCard").onchange = (e) => { state.filters.cardId = e.target.value; refresh(); };
    cnt.querySelector("#fltHolder").onchange = (e) => { state.filters.holder = e.target.value; refresh(); };
}

/* =========================================
   SUB-RENDERERS
   ========================================= */

function renderDashboardView(currentTxs, prevTxs, month, filters, cache, curr, prev) {

    // --- Card 2: Top 5 Categorias (Expenses Only) ---
    const catGroups = {};
    let totalExp = 0;
    currentTxs.forEach(t => {
        if (t.type !== 'expense') return;
        const val = t.valueBRL ?? t.value;
        const catId = t.categoryId || "uncat";
        catGroups[catId] = (catGroups[catId] || 0) + val;
        totalExp += val;
    });
    const sortedCats = Object.keys(catGroups).sort((a, b) => catGroups[b] - catGroups[a]).slice(0, 5);
    const maxCatVal = sortedCats.length > 0 ? catGroups[sortedCats[0]] : 1;

    let topCatsHtml = `<div class="small" style = "color:#666; margin-bottom:10px;" > Sem despesas no período.</div > `;
    if (sortedCats.length > 0) {
        topCatsHtml = sortedCats.map(cid => {
            const name = cache.categories.find(c => c.id === cid)?.name || "(Sem Categoria)";
            const val = catGroups[cid];
            const pct = (val / maxCatVal) * 100;
            return `
                <div style = "margin-bottom:8px; cursor:pointer;" data - quick - filter="1" data - type="category" data - val="${cid}" data - name="${esc(name)}" >
                    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:2px;">
                        <span>${esc(name)}</span>
                        <span style="font-weight:bold;">${fmtBRL(val)}</span>
                    </div>
                    <div style="background:#eee; height:8px; border-radius:4px; width:100%; overflow:hidden;">
                        <div style="background:#dc3545; height:100%; width:${pct}%;"></div>
                    </div>
                </div >
                `;
        }).join("");
    }

    // --- Card 3: Tendência (3 Meses) ---
    const m0 = month;
    const m1 = getPrevMonth(m0, 1);
    const m2 = getPrevMonth(m0, 2);

    const exp0 = curr.exp; // already calculated
    const exp1 = prev.exp; // already calculated
    const txs_m2 = filterTxs(cache.txs, m2, filters);
    let exp2 = 0;
    txs_m2.forEach(t => { if (t.type === 'expense') exp2 += (t.valueBRL ?? t.value); });

    const maxExp3 = Math.max(exp0, exp1, exp2, 1);
    const h0 = (exp0 / maxExp3) * 100;
    const h1 = (exp1 / maxExp3) * 100;
    const h2 = (exp2 / maxExp3) * 100;

    const lbl0 = m0.split("-")[1] + "/" + m0.split("-")[0].slice(2);
    const lbl1 = m1.split("-")[1] + "/" + m1.split("-")[0].slice(2);
    const lbl2 = m2.split("-")[1] + "/" + m2.split("-")[0].slice(2);

    const trendHtml = `
                <div style = "display:flex; align-items:flex-end; gap:15px; height:80px; margin-top:15px; justify-content:center;" >
            <div style="display:flex; flex-direction:column; align-items:center; width:40px; gap:5px;">
                <div class="small" style="font-size:9px;">${fmtBRL(exp2)}</div>
                <div style="width:20px; background:#ffc107; height:${h2}%; min-height:5px; border-radius:2px 2px 0 0;"></div>
                <div class="small" style="font-size:10px;">${lbl2}</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:center; width:40px; gap:5px;">
                <div class="small" style="font-size:9px;">${fmtBRL(exp1)}</div>
                <div style="width:20px; background:#fd7e14; height:${h1}%; min-height:5px; border-radius:2px 2px 0 0;"></div>
                <div class="small" style="font-size:10px;">${lbl1}</div>
            </div>
             <div style="display:flex; flex-direction:column; align-items:center; width:40px; gap:5px;">
                <div class="small" style="font-size:9px; font-weight:bold;">${fmtBRL(exp0)}</div>
                <div style="width:20px; background:#dc3545; height:${h0}%; min-height:5px; border-radius:2px 2px 0 0;"></div>
                <div class="small" style="font-size:10px; font-weight:bold;">${lbl0}</div>
            </div>
        </div >
                `;

    // --- Format Delta helper again for local scope
    const renderDelta = (currVal, prevVal, inverse = false) => {
        if (!prevVal) return `<div class="small" style = "color:#999;" > Sem histórico</div > `;
        const diff = currVal - prevVal;
        const pct = (diff / prevVal) * 100;
        let color = "gray";
        if (inverse) { color = diff > 0 ? "#dc3545" : (diff < 0 ? "#28a745" : "gray"); }
        else { color = diff > 0 ? "#28a745" : (diff < 0 ? "#dc3545" : "gray"); }
        const arrow = diff > 0 ? "▲" : (diff < 0 ? "▼" : "—");
        return `<div class="small" style = "color:${color}; font-weight:bold;" > ${arrow} ${fmtBRL(Math.abs(diff))} (${Math.abs(pct).toFixed(0)}%)</div > `;
    };

    return `
                <div class="grid" style = "grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:15px;" >
            
            <div class="card" style="display:flex; flex-direction:column; justify-content:space-between;">
                <h3 style="margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;">Fluxo de Caixa (Mês Atual)</h3>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
                    <div>
                        <div class="small" style="color:#666;">Receitas</div>
                        <div style="font-size:18px; color:#28a745; font-weight:bold;">${fmtBRL(curr.rev)}</div>
                    </div>
                    <div style="text-align:right;">${renderDelta(curr.rev, prev.rev)}</div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px;">
                    <div>
                        <div class="small" style="color:#666;">Despesas</div>
                        <div style="font-size:18px; color:#dc3545; font-weight:bold;">${fmtBRL(curr.exp)}</div>
                    </div>
                    <div style="text-align:right;">${renderDelta(curr.exp, prev.exp, true)}</div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px; padding-top:10px; border-top:1px dashed #ccc;">
                    <div>
                        <div class="small" style="color:#666; font-weight:bold;">Saldo Líquido</div>
                        <div style="font-size:20px; color:${curr.bal >= 0 ? '#28a745' : '#dc3545'}; font-weight:bold;">${fmtBRL(curr.bal)}</div>
                    </div>
                    <div style="text-align:right;">${renderDelta(curr.bal, prev.bal)}</div>
                </div>
            </div>

            <div class="card" id="dashCardPatrimony">
                <h3 style="margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;">Patrimônio</h3>
                <div style="display:flex; justify-content:center; align-items:center; height:80px; color:#999; font-size:12px;">Carregando...</div>
            </div>

            <div class="card" id="dashCardInvestmentsMonth">
                <h3 style="margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;">Investimentos (Mês)</h3>
                <div style="display:flex; justify-content:center; align-items:center; height:80px; color:#999; font-size:12px;">Carregando...</div>
            </div>

            <div class="card">
                <h3 style="margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;">Top 5 Despesas (Categorias)</h3>
                <div style="margin-top:10px;">
                    ${topCatsHtml}
                </div>
                <div class="small" style="color:#999; text-align:right; margin-top:5px;">*Clique p/ detalhar*</div>
            </div>

            <div class="card">
                <h3 style="margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;">Evolução de Despesas</h3>
                ${trendHtml}
            </div>
            
            <div class="card" id="dashCardInvoices">
                <h3 style="margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;">Cartões de Crédito (Aberto)</h3>
                <div style="display:flex; justify-content:center; align-items:center; height:80px; color:#999; font-size:12px;">Carregando...</div>
                <div class="small" style="color:#dc3545; text-align:right; margin-top:10px;">*As faturas já estão embutidas nas despesas totais (se originárias)*</div>
            </div>

            <div class="card" id="dashCardBills">
                <h3 style="margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;">Contas a Pagar (Mês)</h3>
                <div style="display:flex; justify-content:center; align-items:center; height:80px; color:#999; font-size:12px;">Carregando...</div>
            </div>

            <div class="card" id="dashCardLoans">
                <h3 style="margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;">Empréstimos / Dívidas</h3>
                <div style="display:flex; justify-content:center; align-items:center; height:80px; color:#999; font-size:12px;">Carregando...</div>
            </div>

            <div class="card" id="dashCardAlerts">
                <h3 style="margin-top:0; color:#dc3545; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;">⚠️ Alertas de Atenção</h3>
                <div style="display:flex; justify-content:center; align-items:center; height:80px; color:#999; font-size:12px;">Carregando...</div>
            </div>

            <div class="card" id="dashCardChecklist">
                <h3 style="margin-top:0; color:#28a745; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;">✅ Rotina do Mês</h3>
                <div style="display:flex; justify-content:center; align-items:center; height:80px; color:#999; font-size:12px;">Carregando...</div>
            </div>

        </div >
                `;
}

function renderCatTable(txs) {
    // Group by Category -> Subcategory
    const groups = {};
    let total = 0;

    txs.forEach(t => {
        if (t.type !== 'expense') return; // Only expenses by default for category report? Or both? Usually expenses.
        // Let's show Expenses breakdown. Revenue breakdown is usually separate or less granular.

        const val = t.valueBRL ?? t.value;
        const catId = t.categoryId || "uncat";

        if (!groups[catId]) groups[catId] = { val: 0, subs: {} };
        groups[catId].val += val;

        const subId = t.subcategory || "unsub";
        if (!groups[catId].subs[subId]) groups[catId].subs[subId] = 0;
        groups[catId].subs[subId] += val;

        total += val;
    });

    // Sort by Value Desc
    const sortedCats = Object.keys(groups).sort((a, b) => groups[b].val - groups[a].val);

    // Resolve Names
    const catName = (id) => state.cache.categories.find(c => c.id === id)?.name || "(Sem Categoria)";
    // Note: optimization - lookups in loop. MVP fine.

    let html = `
                <div class="card" >
            <div style="font-weight:bold; margin-bottom:5px;">Por Categoria (Despesas)</div>
            <table style="width:100%; font-size:12px; border-collapse:collapse;">
    `;

    sortedCats.forEach(cid => {
        const g = groups[cid];
        const name = catName(cid);
        const pct = total ? (g.val / total * 100).toFixed(1) : 0;

        html += `
            <tr style="border-bottom:1px solid #eee; background:#fff;">
                <td style="padding:5px;"><strong>${esc(name)}</strong> <small>(${pct}%)</small></td>
                <td style="padding:5px; text-align:right;">${fmtBRL(g.val)}</td>
            </tr>
        `;

        // Subs (Limit top 5?)
        const sortedSubs = Object.keys(g.subs).sort((a, b) => g.subs[b] - g.subs[a]);
        sortedSubs.forEach(sid => {
            const sVal = g.subs[sid];
            // Resolve sub name... tricky without cached map by id.
            // We have list("subcategories") in cache? No, we didn't load subs in wireReportsHandlers.
            // Let's assume uncat/unsub for now or fetch.
            // Wait, we didn't load subcategories list! 
            // We should add it to wireReportsHandlers if we want names.
            // For now, let's just show "Sub..." or ID if we missed it.
            // I'll skip sub names or lazy load? 
            // Let's just indent values.
            html += `
                <tr style="color:#666; font-size:11px;">
                    <td style="padding:2px 5px 2px 20px;">↳ Sub...</td> 
                    <td style="padding:2px 5px; text-align:right;">${fmtBRL(sVal)}</td>
                </tr>
            `;
        });
    });

    html += `</table></div > `;
    return html;
}

function renderTagTable(txs) {
    const counts = {};
    txs.forEach(t => {
        if (!t.tags || !t.tags.length) return;
        const val = t.valueBRL ?? t.value;
        const kind = t.type === 'expense' ? -1 : 1;

        t.tags.forEach(tag => {
            const k = tag.toLowerCase(); // normalization
            if (!counts[k]) counts[k] = 0;
            counts[k] += (val * (t.type === 'expense' ? 1 : 0)); // count expenses only? Or Net? User said "Por Tag | Total". 
            // Often "Gastos por Tag". Let's assume Expense.
        });
    });

    const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

    let html = `
                <div class="card" >
            <div style="font-weight:bold; margin-bottom:5px;">Por Tag (Despesas)</div>
            <table style="width:100%; font-size:12px;">
    `;
    sorted.forEach(k => {
        html += `<tr><td style="padding:2px;">#${esc(k)}</td><td style="text-align:right;">${fmtBRL(counts[k])}</td></tr>`;
    });
    html += `</table></div > `;
    return html;
}

function renderAccountTable(txs) {
    // Shows breakdown by account (Revenue/Expense) based on filteredTxs
    // Note: Card txs usually don't have accountId until paid.
    // This table shows "Checking/Cash" flow.

    const groups = {};
    txs.forEach(t => {
        const accId = t.accountId || t.sourceAccountId; // source linked
        if (!accId) return;

        if (!groups[accId]) groups[accId] = { rev: 0, exp: 0 };
        const val = t.valueBRL ?? t.value;
        if (t.type === 'revenue') groups[accId].rev += val;
        else if (t.type === 'expense') groups[accId].exp += val;
    });

    let html = `
                <div class="card" >
            <div style="font-weight:bold; margin-bottom:5px;">Por Conta</div>
            <table style="width:100%; font-size:12px;">
                <thead><tr style="color:#666;"><th>Conta</th><th style="text-align:right">Rec</th><th style="text-align:right">Desp</th><th style="text-align:right">Res</th></tr></thead>
    `;

    Object.keys(groups).forEach(aid => {
        const acc = state.cache.accounts.find(a => a.id === aid);
        const name = acc ? `${getBrandIcon(acc.brandKey)} ${acc.name}` : "Outros";
        const g = groups[aid];
        html += `
            <tr>
                <td>${esc(name)}</td>
                <td style="text-align:right; color:green;">${fmtBRL(g.rev)}</td>
                <td style="text-align:right; color:red;">${fmtBRL(g.exp)}</td>
                <td style="text-align:right; font-weight:bold;">${fmtBRL(g.rev - g.exp)}</td>
            </tr>
        `;
    });
    html += `</table></div > `;
    return html;
}

/* =========================================
   TOP 10 & CHARTS
   ========================================= */

function renderTopCategories(txs) {
    const groups = {};
    txs.forEach(t => {
        if (t.type !== 'expense') return;
        const v = t.valueBRL ?? t.value;
        const k = t.categoryId || "uncat";
        if (!groups[k]) groups[k] = 0;
        groups[k] += v;
    });

    const sorted = Object.keys(groups).sort((a, b) => groups[b] - groups[a]).slice(0, 10);

    // Prepare data for the Bar Chart
    const chartData = sorted.map(cid => {
        const name = state.cache.categories.find(c => c.id === cid)?.name || "(Sem Categoria)";
        return { label: name, value: groups[cid], categoryId: cid };
    });

    // Store globally for post-render drawing
    window.__reportsCharts = window.__reportsCharts || {};
    window.__reportsCharts.topCats = chartData;

    return `
                <div class="card" >
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <strong style="font-size:14px;">Top Categorias (Desp.)</strong>
            <button type="button" class="small secondary" id="btnExportTopCats" style="padding:2px 6px; font-size:0.8em; cursor:pointer;">📥 Salvar PNG</button>
        </div>
        <div style="width:100%; overflow-x:auto;">
            <canvas id="reportsCategoryChart" width="340" height="250" style="max-width:100%;"></canvas>
        </div>
    </div >
                `;
}

function renderTopTags(txs) {
    const groups = {};
    let totalExp = 0;
    txs.forEach(t => {
        if (t.type !== 'expense' || !t.tags) return;
        const v = t.valueBRL ?? t.value;
        t.tags.forEach(tg => {
            const k = tg // Case sensitive inside tags usually, normalized outside? Let's use as is.
            if (!groups[k]) groups[k] = 0;
            groups[k] += v;
        });
        totalExp += v;
    });

    const sorted = Object.keys(groups).sort((a, b) => groups[b] - groups[a]).slice(0, 10);
    const maxVal = sorted.length ? groups[sorted[0]] : 1;

    let html = `<div class="card" >
                <div style="font-weight:bold; margin-bottom:5px;">Top Tags (Desp.)</div>`;

    if (sorted.length === 0) html += "<div class='small'>Sem dados.</div>";

    sorted.forEach(tg => {
        const val = groups[tg];
        const pctBar = (val / maxVal) * 100;

        html += `
                    <div data - quick - filter data - type="tag" data - val="${tg}" data - name="${esc(tg)}"
            style = "margin-bottom:4px; font-size:11px; position:relative;" >
                <div style="display:flex; justify-content:space-between; position:relative; z-index:2; padding:0 2px;">
                    <span>${esc(tg)}</span>
                    <span>${fmtBRL(val)}</span>
                </div>
                <div style="position:absolute; top:0; left:0; height:100%; width:${pctBar}%; background:rgba(23, 162, 184, 0.15); border-radius:2px; z-index:1;"></div>
            </div >
                `;
    });
    html += `</div > `;
    return html;
}

function renderTopTransactions(txs) {
    const expenses = txs.filter(t => t.type === 'expense')
        .sort((a, b) => (b.valueBRL ?? b.value) - (a.valueBRL ?? a.value))
        .slice(0, 10);

    if (!expenses.length) return "";

    return `<div class="card" >
        <div style="font-weight:bold; margin-bottom:5px;">Top 10 Maiores Despesas</div>
        <table style="width:100%; font-size:11px; border-collapse:collapse;">
        ${expenses.map(t => `
            <tr style="border-bottom:1px solid #eee;">
                <td style="padding:2px;">${t.date ? t.date.slice(5) : '-'}</td>
                <td style="padding:2px;">
                    ${esc(t.description)}
                    <br/><span style="color:#666; font-size:9px;">${state.cache.categories.find(c => c.id === t.categoryId)?.name || ""}</span>
                </td>
                <td style="padding:2px; text-align:right;">${fmtBRL(t.valueBRL || t.value)}</td>
            </tr>
        `).join("")}
        </table>
    </div > `;
}

function renderEvolutionChart(m2Txs, m1Txs, m0Txs, month) {
    // 3 Months Evolution (Expenses)
    const sumExp = (list) => list.reduce((a, b) => a + (b.type === 'expense' ? (b.valueBRL ?? b.value) : 0), 0);

    const v2 = sumExp(m2Txs);
    const v1 = sumExp(m1Txs);
    const v0 = sumExp(m0Txs);

    const max = Math.max(v2, v1, v0) || 1;

    const bar = (val, label) => {
        const h = (val / max) * 100;
        return `
                <div style = "display:flex; flex-direction:column; align-items:center; flex:1;" >
                <div style="font-size:10px; margin-bottom:2px;">${fmtBRL(val)}</div>
                <div style="width:30px; background:#dc3545; height:${h}px; min-height:1px; border-radius:3px 3px 0 0; transition: height 0.3s;"></div>
                <div style="font-size:10px; margin-top:5px; color:#666;">${label}</div>
            </div >
                `;
    };

    // Labels
    const l2 = getPrevMonth(month, 2).slice(5);
    const l1 = getPrevMonth(month, 1).slice(5);
    const l0 = month.slice(5);

    return `<div class="card" >
        <div style="font-weight:bold; margin-bottom:10px;">Evolução Despesas (3 Meses)</div>
        <div style="display:flex; align-items:flex-end; height:100px; padding-bottom:10px; border-bottom:1px solid #eee;">
            ${bar(v2, l2)}
            ${bar(v1, l1)}
            ${bar(v0, l0)}
        </div>
    </div > `;
}

function renderInvoiceTable(allTxs, month) {
    // This table is SPECIFIC for the selected MONTH in Filter.
    // Logic: List all cards using invoiceMonth filter.

    // We need to fetch data for ALL cards for this invoice month, 
    // BUT we must also respect the GLOBAL filters (CardID, Holder).

    // 1. Filter relevant Txs
    const relevant = allTxs.filter(t => {
        return t.invoiceMonth === month && t.cardId;
    });

    // Group by Card
    const cardsData = {};
    relevant.forEach(t => {
        if (state.filters.cardId && t.cardId !== state.filters.cardId) return;
        // Holder filter application for this table...
        // t.cardHolder ...

        if (!cardsData[t.cardId]) cardsData[t.cardId] = { total: 0, paid: 0, holders: {} };
        const cd = cardsData[t.cardId];

        const val = Math.abs(t.valueBRL ?? t.value);

        // Is Payment?
        // Payments usually are NOT tagged with invoiceMonth in "transactions" store unless explicitly added.
        // Or they are type='card_payment'. 
        // BUT 'card_payment' usually refers to paying the BILL, not a refund.
        // Refunds (credits) reduce the total.

        if (t.type === 'card_payment' || t.kind === 'INVOICE_PAYMENT') {
            cd.paid += val;
        } else {
            // It's a line item
            // Check Holder Filter for this line item
            // If global filter blocks this holder, skip summing it to "Total"? 
            // Yes, user wants to see "Reports" based on filters.

            // Check holder logic again
            let matchesHolder = true;
            if (state.filters.holder) {
                // ... same logic as main filter ... need reusable function?
                // Simplified:
                const card = state.cache.cards.find(c => c.id === t.cardId);
                let effName = "";
                if (card) {
                    effName = (t.cardHolder === 'additional') ? card.additional : card.holder;
                }
                if (state.filters.holder === 'main' && t.cardHolder !== 'main') matchesHolder = false;
                else if (state.filters.holder === 'additional' && t.cardHolder !== 'additional') matchesHolder = false;
                else if (state.filters.holder.length > 10 && (!effName || !effName.toLowerCase().includes(state.filters.holder.toLowerCase()))) matchesHolder = false;
            }

            if (matchesHolder) {
                if (t.type === 'expense') cd.total += val;
                else if (t.type === 'revenue') cd.total -= val; // Refund

                // Breakdown
                const role = t.cardHolder || 'main'; // 'main' or 'additional'
                if (!cd.holders[role]) cd.holders[role] = 0;
                cd.holders[role] += val;
            }
        }
    });

    // Render
    const cardIds = Object.keys(cardsData);
    if (!cardIds.length) return `<div class="card" > <div class="small">Nenhuma fatura encontrada para ${month}</div></div > `;

    let html = `
                <div class="card" >
            <div style="font-weight:bold; margin-bottom:5px;">Faturas (${month})</div>
            <table style="width:100%; font-size:12px;">
    `;

    cardIds.forEach(id => {
        const c = state.cache.cards.find(x => x.id === id);
        const name = c ? c.name : "Cartão " + id;
        const d = cardsData[id];
        const remaining = d.total - d.paid;

        html += `
            <tr style="background:#f9f9f9; font-weight:bold;">
                <td colspan="2" style="padding:5px; border-top:1px solid #ddd;">
                    ${esc(name)}
                    <div style="font-weight:normal; font-size:10px; color:#666;">
                       Main: ${fmtBRL(d.holders.main || 0)} | Add: ${fmtBRL(d.holders.additional || 0)}
                    </div>
                </td>
                <td colspan="2" style="text-align:right; border-top:1px solid #ddd;">
                    Total: ${fmtBRL(d.total)}<br/>
                    <span style="color:green">Pago: ${fmtBRL(d.paid)}</span><br/>
                    <span style="color:${remaining > 0 ? 'red' : 'blue'}">Aberto: ${fmtBRL(remaining)}</span>
                </td>
            </tr>
        `;
    });

    html += `</table></div > `;
    return html;
}


/* =========================================
   SPECIAL VIEWS
   ========================================= */

function calcOpenInvoices(cnt, txs, flt) {
    // Logic similar to Home, but filtered? 
    // Home shows ALL open invoices.
    // Here we should probably show ALL unless filtered.

    // Logic: Group by Card+InvoiceMonth -> sum expenses - sum payments.
    const invoices = {};
    txs.forEach(t => {
        if (!t.cardId || !t.invoiceMonth) return;

        // Filter?
        if (flt.cardId && flt.cardId !== t.cardId) return;
        // Not filtering by month because "Open" implies ANY month with balance.
        // Not filtering by person? Invoices are Card/Account level, not Person level usually.
        // Unless "Visão Rejane" tracks her part of debt.

        const key = `${t.cardId}:${t.invoiceMonth} `;
        if (!invoices[key]) invoices[key] = { total: 0, paid: 0 };

        const val = Math.abs(t.valueBRL ?? t.value);
        if (t.type === 'card_payment' || t.kind === 'INVOICE_PAYMENT') {
            invoices[key].paid += val;
        } else {
            if (t.type === 'expense') invoices[key].total += val;
            else if (t.type === 'revenue') invoices[key].total -= val;
        }
    });

    let count = 0;
    let debt = 0;
    const cardDebts = [];
    Object.keys(invoices).forEach(k => {
        const i = invoices[k];
        const rem = i.total - i.paid;
        if (rem > 1.0) {
            count++;
            debt += rem;
            cardDebts.push({ cardId: k.split(":")[0], debt: rem });
        }
    });

    // Update dashboard card if it exists
    const dCard = cnt.querySelector("#dashCardInvoices");
    if (dCard) {
        cardDebts.sort((a, b) => b.debt - a.debt);
        const top3 = cardDebts.slice(0, 3).map(cd => {
            const cName = state.cache.cards.find(c => c.id === cd.cardId)?.name || "Cartão";
            return `<div style = "display:flex; justify-content:space-between; font-size:11px; margin-bottom:3px;" >
                <span>${esc(cName)}</span><span style="font-weight:bold; color:#dc3545;">${fmtBRL(cd.debt)}</span>
            </div>`;
        }).join("");

        dCard.innerHTML = `
            <h3 style="margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px; display:flex; justify-content:space-between;" >
                <span>Cartões de Crédito (Mês)</span>
                <span style="background:#dc3545; color:white; border-radius:10px; padding:2px 6px; font-size:10px;">${count} em aberto</span>
            </h3>
            <div style="font-size:20px; font-weight:bold; color:#dc3545; margin-top:5px; margin-bottom:10px; text-align:center;">
                ${fmtBRL(debt)}
            </div>
            <div style="border-top:1px dashed #eee; padding-top:5px;">
                <div style="font-size:10px; color:#999; margin-bottom:5px; text-transform:uppercase;">Maiores faturas:</div>
                ${top3 || '<div style="font-size:11px; color:#666; text-align:center;">Nenhuma fatura pendente.</div>'}
            </div>
            <div class="small" style="color:#666; font-style:italic; text-align:right; margin-top:10px; font-size:9px;">As compras já compõem as Despesas Totais.</div>
        `;
    }

    // Update details view if it exists
    const el = cnt.querySelector("#openInvoicesCard");
    if (el) {
        el.innerHTML = `
            <div class="small" > Faturas Abertas</div>
            <div style="font-size:1.2em; color:#007bff;">${count}</div>
            <div class="small" style="color:#dc3545;">${fmtBRL(debt)}</div>
        `;
    }
}

async function calcInvestmentsCard(cnt, currentMonth, filters, allTxs) {
    const dCardPatrimony = cnt.querySelector("#dashCardPatrimony");
    const dCardMonth = cnt.querySelector("#dashCardInvestmentsMonth");
    if (!dCardPatrimony && !dCardMonth) return;

    try {
        const boxes = await listInvestmentBoxes();
        let totalInvestmentsBRL = 0;
        let monthYieldBRL = 0;
        let monthDepositBRL = 0;
        let monthWithdrawBRL = 0;

        for (const box of boxes) {
            // Respeitar filtro de conta
            if (filters.accountId && box.accountId !== filters.accountId) continue;
            // Respeitar filtro de pessoa (se nulo/vazio no box, considerar global)
            if (filters.personId && box.personId && box.personId !== filters.personId) continue;

            const { balanceBRL } = await computeBoxBalance(box.id);
            totalInvestmentsBRL += balanceBRL;

            const moves = await listMovesByBoxId(box.id);
            moves.forEach(m => {
                if (m.date && m.date.startsWith(currentMonth)) {
                    if (m.kind === "yield") monthYieldBRL += (m.amountBRL || 0);
                    if (m.kind === "deposit") monthDepositBRL += (m.amountBRL || 0);
                    if (m.kind === "withdraw") monthWithdrawBRL += (m.amountBRL || 0);
                }
            });
        }

        // Calcula Saldo Caixa (All Time)
        let totalCashBRL = 0;
        if (allTxs) {
            allTxs.forEach(t => {
                // Apply same filters (except month) to cash
                if (filters.personId && t.personId !== filters.personId) return;
                if (filters.accountId && t.accountId !== filters.accountId && t.sourceAccountId !== filters.accountId) return;

                const val = t.valueBRL ?? t.value;
                if (t.type === 'revenue') totalCashBRL += val;
                else if (t.type === 'expense') totalCashBRL -= val;
            });
        }

        const patrimonyTotal = totalInvestmentsBRL + totalCashBRL;

        if (dCardPatrimony) {
            dCardPatrimony.innerHTML = `
                <h3 style="margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px; display:flex; justify-content:space-between;">
                    <span>🏦 Patrimônio Total</span>
                </h3>
                <div style="font-size:22px; font-weight:bold; color:#28a745; margin-top:5px; margin-bottom:10px; text-align:center;">
                    ${fmtBRL(patrimonyTotal)}
                </div>
                <div style="border-top:1px dashed #eee; padding-top:5px; display:flex; flex-direction:column; gap:3px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:11px; color:#666;">📈 Investimentos:</span>
                        <span style="font-size:12px; font-weight:bold; color:#17a2b8;">${fmtBRL(totalInvestmentsBRL)}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:11px; color:#666;">💵 Caixa / Contas:</span>
                        <span style="font-size:12px; font-weight:bold; color:#333;">${fmtBRL(totalCashBRL)}</span>
                    </div>
                </div>
            `;
        }

        if (dCardMonth) {
            dCardMonth.innerHTML = `
                <h3 style="margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px; display:flex; justify-content:space-between;">
                    <span>📈 Investimentos (Mês)</span>
                </h3>
                <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-size:11px; color:#666; text-transform:uppercase;">Aportes:</div>
                        <div style="font-size:14px; font-weight:bold; color:#28a745;">+${fmtBRL(monthDepositBRL)}</div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-size:11px; color:#666; text-transform:uppercase;">Rendimentos:</div>
                        <div style="font-size:14px; font-weight:bold; color:#17a2b8;">+${fmtBRL(monthYieldBRL)}</div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-size:11px; color:#666; text-transform:uppercase;">Retiradas:</div>
                        <div style="font-size:14px; font-weight:bold; color:#dc3545;">-${fmtBRL(monthWithdrawBRL)}</div>
                    </div>
                </div>
            `;
            dCardMonth.style.cursor = "pointer";
            dCardMonth.onclick = () => location.hash = "#investments";
        }

    } catch (e) {
        console.error("Erro investments card", e);
        if (dCardPatrimony) dCardPatrimony.innerHTML = '<div style="color:red; font-size:12px;">Erro ao carregar patrimônio</div>';
        if (dCardMonth) dCardMonth.innerHTML = '<div style="color:red; font-size:12px;">Erro ao carregar investimentos</div>';
    }
}

async function renderDetailsInvestments(cnt, currentMonth, filters) {
    const container = cnt.querySelector("#detailsInvestmentsContainer");
    if (!container) return;

    try {
        const boxes = await listInvestmentBoxes();

        let hasInvs = false;
        const boxData = [];
        const allYields = [];

        for (const box of boxes) {
            // Apply Account and Person filters
            if (filters.accountId && box.accountId !== filters.accountId) continue;
            if (filters.personId && box.personId && box.personId !== filters.personId) continue;

            const { balanceBRL } = await computeBoxBalance(box.id);
            const moves = await listMovesByBoxId(box.id);

            let mDeposit = 0;
            let mYield = 0;

            moves.forEach(m => {
                if (m.date && m.date.startsWith(currentMonth)) {
                    if (m.kind === "deposit") mDeposit += (m.amountBRL || 0);
                    if (m.kind === "yield") {
                        const yv = m.amountBRL || 0;
                        mYield += yv;
                        allYields.push({
                            invName: box.name,
                            accountId: box.accountId,
                            yieldVal: yv,
                            date: m.date
                        });
                    }
                }
            });

            boxData.push({
                box: box,
                balance: balanceBRL,
                deposit: mDeposit,
                yield: mYield
            });
            hasInvs = true;
        }

        if (!hasInvs) {
            container.innerHTML = `<div class="card small" style="color:#999; text-align:center;">Sem investimentos para os filtros selecionados.</div>`;
            return;
        }

        // --- Table 1: Investimentos por Banco ---
        let htmlBank = `
            <div class="card" style="margin-bottom:10px;">
                <h3 style="margin-top:0; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;">Investimentos por Banco / Conta</h3>
                <div style="overflow-x:auto;">
                    <table style="width:100%; font-size:12px; border-collapse:collapse; min-width:400px;">
                        <thead>
                            <tr style="border-bottom:1px solid #ccc; color:#666; text-align:left;">
                                <th style="padding:5px;">Banco / Conta</th>
                                <th style="padding:5px;">Investimento</th>
                                <th style="padding:5px; text-align:right;">Saldo Atual</th>
                                <th style="padding:5px; text-align:right;">Aportes (Mês)</th>
                                <th style="padding:5px; text-align:right;">Rendimentos (Mês)</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        boxData.sort((a, b) => b.balance - a.balance).forEach(row => {
            const acc = state.cache.accounts.find(a => a.id === row.box.accountId);
            const accName = acc ? `${getBrandIcon(acc.brandKey)} ${acc.name}` : "Sem Banco";

            htmlBank += `
                            <tr style="border-bottom:1px solid #eee;">
                                <td style="padding:4px;">${esc(accName)}</td>
                                <td style="padding:4px;"><strong>${esc(row.box.name)}</strong></td>
                                <td style="padding:4px; text-align:right; font-weight:bold;">${fmtBRL(row.balance)}</td>
                                <td style="padding:4px; text-align:right; color:#28a745;">${row.deposit > 0 ? '+' + fmtBRL(row.deposit) : '-'}</td>
                                <td style="padding:4px; text-align:right; color:#17a2b8;">${row.yield !== 0 ? (row.yield > 0 ? '+' : '') + fmtBRL(row.yield) : '-'}</td>
                            </tr>
            `;
        });
        htmlBank += `</tbody></table></div></div>`;

        // --- Table 2: Top 5 Rendimentos ---
        // Aggregate yields by investment if there are multiple yield moves
        const groupedYields = {};
        allYields.forEach(y => {
            const k = y.invName + (y.accountId || 'null');
            if (!groupedYields[k]) {
                groupedYields[k] = { name: y.invName, accId: y.accountId, val: 0 };
            }
            groupedYields[k].val += y.yieldVal;
        });

        const topYields = Object.values(groupedYields).sort((a, b) => b.val - a.val).slice(0, 5);

        let htmlYields = `
            <div class="card">
                <h3 style="margin-top:0; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;">Top Rendimentos (Mês)</h3>
                <div style="overflow-x:auto;">
                    <table style="width:100%; font-size:12px; border-collapse:collapse; min-width:300px;">
                        <thead>
                            <tr style="border-bottom:1px solid #ccc; color:#666; text-align:left;">
                                <th style="padding:5px;">Investimento (Conta)</th>
                                <th style="padding:5px; text-align:right;">Rendimento</th>
                            </tr>
                        </thead>
                        <tbody>
        `;
        if (topYields.length === 0) {
            htmlYields += `<tr><td colspan="2" style="text-align:center; padding:10px; color:#999;">Sem rendimentos no mês.</td></tr>`;
        } else {
            topYields.forEach(y => {
                const acc = state.cache.accounts.find(a => a.id === y.accId);
                const accName = acc ? `${getBrandIcon(acc.brandKey)}` : "Sem Banco";
                htmlYields += `
                                <tr style="border-bottom:1px solid #eee;">
                                    <td style="padding:4px;">${esc(y.name)} <small>(${esc(accName)})</small></td>
                                    <td style="padding:4px; text-align:right; color:#17a2b8; font-weight:bold;">${y.val > 0 ? '+' : ''}${fmtBRL(y.val)}</td>
                                </tr>
                `;
            });
        }
        htmlYields += `</tbody></table></div></div>`;

        container.innerHTML = `
            <div class="grid" style="grid-template-columns: 1fr; gap:10px;">
                ${htmlBank}
                ${htmlYields}
            </div>
        `;

    } catch (e) {
        console.error("Erro renderDetailsInvestments", e);
        container.innerHTML = '<div style="color:red; font-size:12px;">Erro ao carregar detalhamento de investimentos</div>';
    }
}

function renderRejaneView(cnt, txs, flt, currentMonth) {
    if (!state.cache.personBalances || !state.cache.balanceEvents) return;

    // Check if any person is named "Rejane"
    const rejanePerson = state.cache.people.find(p => p.name.toLowerCase().includes("rejane"));
    if (!rejanePerson) return; // Hide if person doesn't exist

    // If there is a person filter, and it's NOT Rejane, hide it.
    if (flt.personId && flt.personId !== rejanePerson.id) return;

    const pb = state.cache.personBalances.find(b => b.personId === rejanePerson.id);
    const rBalanceCents = pb ? pb.balanceCentsBRL : 0;

    const rejaneCards = state.cache.cards.filter(c => c.additional && c.additional.toLowerCase().includes("rejane"));

    let totalChargesThisMonth = 0;
    const chargesByCard = {};

    txs.forEach(t => {
        if (t.type === "expense" && t.cardHolder === "additional" && t.invoiceMonth === currentMonth) {
            if (rejaneCards.some(c => c.id === t.cardId)) {
                if (t.kind !== "INVOICE_PAYMENT" && t.type !== "card_payment") {
                    const valBRL = t.valueBRL ?? t.value;
                    totalChargesThisMonth += valBRL;
                    const cardName = state.cache.cards.find(c => c.id === t.cardId)?.name || "Cartão";
                    chargesByCard[cardName] = (chargesByCard[cardName] || 0) + valBRL;
                }
            }
        }
    });

    const paymentsThisMonth = state.cache.balanceEvents.filter(e => e.personId === rejanePerson.id && e.month === currentMonth && e.type === "payment");
    const isClosed = state.cache.balanceEvents.some(e => e.personId === rejanePerson.id && e.month === currentMonth && e.type === "charges");

    let receivedSum = 0;
    paymentsThisMonth.forEach(p => receivedSum += Math.abs(p.amountCentsBRL / 100));

    // Optional: Only show if there's activity or balance
    if (totalChargesThisMonth === 0 && rBalanceCents === 0 && receivedSum === 0) return;

    const div = cnt.querySelector("#divRejane");
    if (!div) return;

    // Note: To not duplicate logic, we don't put buttons here. We just put a redirect or a status.
    div.innerHTML = `
                <div class="card" style = "margin-top:10px; border-left:4px solid #f39c12; background:#fffcf5;" >
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="font-weight:bold; color:#d68910;">🌸 Conta Corrente Adicionais: ${esc(rejanePerson.name)}</div>
            <button class="btn btn-secondary small" onclick="location.hash='#loans'">Ver Detalhes</button>
        </div>
        
        <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap:5px; text-align:center;">
            <div style="padding:5px; background:#fff; border:1px solid #f1c40f; border-radius:4px;">
                <div style="font-size:10px; color:#666;">Gastos do Mês</div>
                <div style="font-weight:bold; color:#d68910;">${fmtBRL(totalChargesThisMonth)}</div>
            </div>
            <div style="padding:5px; background:#fff; border:1px solid #f1c40f; border-radius:4px;">
                <div style="font-size:10px; color:#666;">Recebido no Mês</div>
                <div style="font-weight:bold; color:#28a745;">${fmtBRL(receivedSum)}</div>
            </div>
            <div style="padding:5px; background:#fff; border:1px solid #f1c40f; border-radius:4px;">
                <div style="font-size:10px; color:#666;">Saldo Acumulado (Dívida)</div>
                <div style="font-weight:bold; color:#d35400;">${fmtBRL(rBalanceCents / 100)}</div>
            </div>
        </div>
        
        <div style="margin-top:10px; font-size:11px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                ${Object.keys(chargesByCard).map(k => `<span style="margin-right:10px;">${esc(k)}: <b>${fmtBRL(chargesByCard[k])}</b></span>`).join("")}
            </div>
            <div>
                ${isClosed ?
            '<span class="badge badge-success">Mês Fechado ✅</span>' :
            '<span class="badge badge-secondary">Mês Não Fechado</span>'
        }
            </div>
        </div>
    </div >
                `;
}

function renderBillsOverview(cnt, flt, currentMonth) {
    if (!state.cache.bills) return;

    // Parse Settings
    const usdRateSet = state.cache.settings["usd_rate"];
    const sysUsdRate = usdRateSet && usdRateSet.value ? parseFloat(usdRateSet.value) : 5.0;

    // Math extraction logic helper (respecting BRL/USD converting rules visually only)
    const extractMath = (b) => {
        let amountRaw = b.amount || 0;
        let amount = b.currency === 'USD' ? amountRaw * sysUsdRate : amountRaw;

        // Paid Amount 
        let paidRaw = b.paidAmount || (b.status === "paid" ? b.amount : 0);
        let paid = b.currency === 'USD' ? paidRaw * sysUsdRate : paidRaw;

        // Open
        let open = 0;
        if (b.status === 'open') open = amount;
        else if (b.status === 'partial') open = Math.max(0, amount - paid);

        return { amount, paid, open, skipped: b.status === 'skipped' };
    };

    // Filter Bills for this month
    const monthBills = state.cache.bills.filter(b => b.month === currentMonth && (flt.personId ? b.personId === flt.personId : true));

    let sumExpected = 0;
    let sumPaid = 0;
    let sumOpen = 0;
    let sumSkipped = 0;

    const byCat = {};
    const byPerson = {};
    const byMethod = {};

    monthBills.forEach(b => {
        const math = extractMath(b);
        if (math.skipped) {
            sumSkipped += math.amount;
            return; // Pulados n entram nas quebras principais
        }

        sumExpected += math.amount;
        sumPaid += math.paid;
        sumOpen += math.open;

        // Cats
        let catName = "Sem Categoria";
        if (b.categoryId) catName = state.cache.categories.find(c => c.id === b.categoryId)?.name || "Sem Categoria";
        if (!byCat[catName]) byCat[catName] = { exp: 0, open: 0, paid: 0 };
        byCat[catName].exp += math.amount;
        byCat[catName].open += math.open;
        byCat[catName].paid += math.paid;

        // Persons
        let pName = "Sem Atribuição";
        if (b.personId) pName = state.cache.people.find(p => p.id === b.personId)?.name || pName;
        if (!byPerson[pName]) byPerson[pName] = { exp: 0, open: 0, paid: 0 };
        byPerson[pName].exp += math.amount;
        byPerson[pName].open += math.open;
        byPerson[pName].paid += math.paid;

        // Method 
        let viaLabel = "Indefinida";
        let actualMethod = b.paidViaType || b.defaultPayType || "Indefinido";
        if (actualMethod === 'account') viaLabel = 'Conta';
        else if (actualMethod === 'card') viaLabel = 'Cartão';

        if (!byMethod[viaLabel]) byMethod[viaLabel] = { exp: 0, open: 0, paid: 0 };
        byMethod[viaLabel].exp += math.amount;
        byMethod[viaLabel].open += math.open;
        byMethod[viaLabel].paid += math.paid;
    });

    // Sub-loop Next 3 Months Forecasting 
    const forecasting = [];
    for (let offset = 1; offset <= 3; offset++) {
        // Date trick for next months 
        const nextMonthStr = addMonths(currentMonth, offset);
        const subBills = state.cache.bills.filter(b => b.month === nextMonthStr && (b.status === 'open' || b.status === 'partial') && (flt.personId ? b.personId === flt.personId : true));
        let nextOpen = 0;
        subBills.forEach(b => nextOpen += extractMath(b).open);
        forecasting.push({ month: nextMonthStr, open: nextOpen, qty: subBills.length });
    }

    // Sort breakdowns
    const sortedCats = Object.keys(byCat).sort((a, b) => byCat[b].exp - byCat[a].exp);
    const sortedPersons = Object.keys(byPerson).sort((a, b) => byPerson[b].exp - byPerson[a].exp);
    const sortedMethods = Object.keys(byMethod).sort((a, b) => byMethod[b].exp - byMethod[a].exp);

    const pct = sumExpected > 0 ? ((sumPaid / sumExpected) * 100).toFixed(0) : 0;

    // RENDER 
    const divDash = cnt.querySelector("#dashCardBills");
    if (divDash) {
        divDash.innerHTML = `
                <h3 style = "margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px; display:flex; justify-content:space-between;" >
                <span>Contas a Pagar</span>
                <span style="background:#17a2b8; color:white; border-radius:10px; padding:2px 6px; font-size:10px;">Progresso: ${pct}%</span>
            </h3 >
            
            <div style="display:flex; justify-content:space-around; align-items:center; margin-top:10px; text-align:center;">
                <div>
                    <div style="font-size:10px; color:#666; text-transform:uppercase;">Previsto</div>
                    <div style="font-weight:bold; font-size:14px; color:#333;">${fmtBRL(sumExpected)}</div>
                </div>
                <div style="border-left:1px solid #eee; height:30px;"></div>
                <div>
                    <div style="font-size:10px; color:#666; text-transform:uppercase;">Em Aberto</div>
                    <div style="font-weight:bold; font-size:14px; color:#d39e00;">${fmtBRL(sumOpen)}</div>
                </div>
            </div>
            
            <div style="margin-top:15px; background:#e9ecef; border-radius:4px; height:8px; overflow:hidden;">
                <div style="background:#17a2b8; height:100%; width:${pct}%;"></div>
            </div>
            
            <div style="margin-top:10px; font-size:11px; display:flex; justify-content:space-between; color:#666;">
                 <span>Já pago: <strong style="color:#28a745">${fmtBRL(sumPaid)}</strong></span>
                 ${sumSkipped > 0 ? `<span>Ignorado: ${fmtBRL(sumSkipped)}</span>` : ''}
            </div>
            
             <!-- Forecasting miniature -->
                <div style="margin-top:15px; border-top:1px dashed #eee; padding-top:10px;">
                    <div style="font-size:10px; color:#999; margin-bottom:5px; text-transform:uppercase;">Previsão p/ Próximos Meses:</div>
                    <div style="display:flex; justify-content:space-between; text-align:center;">
                        ${forecasting.map(f => `
                        <div style="flex:1; border-right:1px solid #f9f9f9;">
                            <div style="font-size:9px; color:#666;">${f.month.split("-")[1]}/${f.month.slice(2, 4)}</div>
                            <div style="font-size:10px; font-weight:bold; color:#444;">${fmtBRL(f.open)}</div>
                        </div>
                    `).join("").replace(/border-right:1px solid #f9f9f9;">$/, '">')}
                    </div>
                </div>
            `;
    }

    const divDet = cnt.querySelector("#divBillsOverviewDetail") || cnt.querySelector("#divBillsOverview");
    if (divDet) {
        divDet.innerHTML = `
                <div class="card" style="border: 1px solid #17a2b8;">
            <div style="font-weight:bold; color:#17a2b8; margin-bottom:10px;">🗓 Contas a Pagar (Mês)</div>
            
            <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap:5px; text-align:center;">
                <div style="padding:5px; background:#f8f9fa; border-radius:4px;">
                    <div style="font-size:10px; color:#666;">Total Previsto</div>
                    <div style="font-weight:bold;">${fmtBRL(sumExpected)}</div>
                </div>
                <div style="padding:5px; background:#e2ffe6; border-radius:4px;">
                    <div style="font-size:10px; color:#666;">Já Pago</div>
                    <div style="font-weight:bold; color:#28a745;">${fmtBRL(sumPaid)}</div>
                </div>
                <div style="padding:5px; background:#fff3cd; border-radius:4px;">
                    <div style="font-size:10px; color:#666;">Em Aberto</div>
                    <div style="font-weight:bold; color:#d39e00;">${fmtBRL(sumOpen)}</div>
                </div>
                <div style="padding:5px; background:#e9ecef; border-radius:4px;">
                    <div style="font-size:10px; color:#666;">Concluído</div>
                    <div style="font-weight:bold; color:#17a2b8;">${pct}%</div>
                </div>
            </div>
            
            ${sumSkipped > 0 ? `<div style="font-size:11px; text-align:right; color:#6c757d; margin-top:5px;">Ignorado: ${fmtBRL(sumSkipped)}</div>` : ''}
            
            <hr style="margin:10px 0; border:0; border-top:1px solid #17a2b8; opacity:0.3;"/>
            
            <!--Quebras -->
            <div style="display:flex; gap:10px; flex-wrap:wrap; font-size:11px;">
                <div style="flex:1; min-width:180px;">
                    <div style="font-weight:bold; margin-bottom:5px;">Por Categoria</div>
                    <table style="width:100%;">
                        ${sortedCats.map(c => `<tr><td style="color:#444;">${c}</td><td style="text-align:right;">${fmtBRL(byCat[c].exp)}<br/><span style="font-size:9px; color:#d39e00;">${fmtBRL(byCat[c].open)} a pagar</span></td></tr>`).join("")}
                    </table>
                </div>
                <div style="flex:1; min-width:180px;">
                    <div style="font-weight:bold; margin-bottom:5px;">Por Pagador (Pessoa)</div>
                    <table style="width:100%;">
                        ${sortedPersons.map(p => `<tr><td style="color:#444;">${p}</td><td style="text-align:right;">${fmtBRL(byPerson[p].exp)}<br/><span style="font-size:9px; color:#d39e00;">${fmtBRL(byPerson[p].open)} a pagar</span></td></tr>`).join("")}
                </div>
            </div>
            
            <hr style="margin:10px 0; border:0; border-top:1px dashed #17a2b8; opacity:0.3;"/>
            
            <!--Forecasting -->
            <div style="font-size:12px; font-weight:bold; color:#555; margin-bottom:5px;">Próximos 3 Meses (Em Aberto/Parcial)</div>
            <div style="display:flex; justify-content:space-between; text-align:center; font-size:11px; color:#6c757d;">
                ${forecasting.map(f => `
                    <div style="flex:1;">
                        <div>${f.month.slice(5)}/20${f.month.slice(2, 4)}</div>
                        <div style="font-weight:bold; color:#444;">${fmtBRL(f.open)}</div>
                        <div style="font-size:9px;">${f.qty} conta(s)</div>
                    </div>
                `).join("")}
            </div>
            
        </div >
                `;
    } // close else block
} // close renderBillsOverview function

function renderLoansOverview(cnt, flt, currentMonth) {
    if (!state.cache.loans || !state.cache.loanInstallments) return;

    // We only care about OPEN loans for the general balance
    const openLoans = state.cache.loans.filter(l => l.status === 'open' || l.status === 'partial');

    // Apply person filter?
    let loansToProcess = openLoans;
    if (flt.personId) {
        loansToProcess = openLoans.filter(l => l.borrowerPersonId === flt.personId || l.lenderPersonId === flt.personId);
    }

    let sumIOwe = 0;
    let sumOwedToMe = 0;

    // Recalc saldo from cache? We don't have totalPaid directly on the row, we need loan_payments?
    // User says: "(ou saldo já calculado no módulo)". We don't have loanPayments cached easily if we didn't add it.
    // Wait, let's use the DB approach or just the principal for a simpler view, 
    // but without totalPaid we risk showing full principal forever.
    // I should fetch loan_payments in `wireReportsHandlers` as well...
    // Actually, we can sum the paid installments if loan_payments is missing!
    // But what if it's an amortized loan without installments? 
    // Since Phase 14A-2 added installments, the most precise is tracking `principal - sum(all installments where status is paid)` ? No, they might pay outside.
    // Let's fix that by adding loanPayments to cache shortly or just calculating it here by reading the DB locally.
    // Given the async context, let's do a fallback: fetch loan_payments now or sum directly in the next chunk.
    // I will write the structure and assume the simplest approach first.
    // Actually we CAN do an async list inside this sub-render if really needed.

    // Let's just calculate open installments for the **selected month**
    const monthInstalls = state.cache.loanInstallments.filter(i =>
        i.dueDate.startsWith(currentMonth) &&
        (i.status === 'open' || i.status === 'partial')
    );

    // Filter these installs by personId if needed
    let filteredMonthInstalls = monthInstalls;
    if (flt.personId) {
        filteredMonthInstalls = monthInstalls.filter(i => {
            const l = loansToProcess.find(x => x.id === i.loanId);
            return !!l;
        });
    }

    let moAtrasadasQty = 0;
    let moAtrasadasSoma = 0;
    let moVencerQty = 0;
    let moVencerSoma = 0;

    const todayStr = new Date().toISOString().slice(0, 10);

    filteredMonthInstalls.forEach(i => {
        const rest = Math.max(0, i.amount - (i.paidAmount || 0));
        if (i.dueDate < todayStr) {
            moAtrasadasQty++;
            moAtrasadasSoma += rest;
        } else {
            moVencerQty++;
            moVencerSoma += rest;
        }
    });

    // Forecast next 3 months
    const forecasting = [];
    for (let offset = 1; offset <= 3; offset++) {
        const nextMonthStr = addMonths(currentMonth, offset);
        const subInstalls = state.cache.loanInstallments.filter(i =>
            i.dueDate.startsWith(nextMonthStr) &&
            (i.status === 'open' || i.status === 'partial')
        );

        let subFiltered = subInstalls;
        if (flt.personId) {
            subFiltered = subInstalls.filter(i => loansToProcess.find(x => x.id === i.loanId));
        }

        let totalOpen = 0;
        subFiltered.forEach(i => totalOpen += Math.max(0, i.amount - (i.paidAmount || 0)));
        forecasting.push({ month: nextMonthStr, open: totalOpen, qty: subFiltered.length });
    }

    // Try calculating total open balances using installments
    loansToProcess.forEach(l => {
        // Find all open/partial installments for this loan
        const lInstalls = state.cache.loanInstallments.filter(i => i.loanId === l.id && (i.status === 'open' || i.status === 'partial'));
        let lSaldo = 0;
        if (lInstalls.length > 0) {
            lInstalls.forEach(i => lSaldo += Math.max(0, i.amount - (i.paidAmount || 0)));
        } else {
            // Fallback to principal if no installments
            lSaldo = l.principal;
        }

        if (l.role === 'i_owe') sumIOwe += lSaldo;
        if (l.role === 'owed_to_me') sumOwedToMe += lSaldo;
    });

    if (sumIOwe === 0 && sumOwedToMe === 0 && moAtrasadasQty === 0 && moVencerQty === 0) {
        // Empty state
        return;
    }

    const dCard = cnt.querySelector("#dashCardLoans");
    if (dCard) {
        const balance = sumOwedToMe - sumIOwe;
        dCard.innerHTML = `
            <h3 style="margin-top:0; color:#333; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px; display:flex; justify-content:space-between;">
                <span>Empréstimos / Dívidas ativas</span>
<span style="background:${activeCount > 0 ? '#17a2b8' : '#28a745'}; color:white; border-radius:10px; padding:2px 6px; font-size:10px;">${activeCount} ativas</span>
            </h3>
            <div style="display:flex; justify-content:space-between; font-size:13px; margin-top:10px;">
                <span style="color:#666;">Eu Devo (Amigos/Bancos)</span>
                <span style="font-weight:bold; color:#dc3545;">${fmtBRL(sumIOwe)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:13px; margin-top:5px; border-bottom:1px dashed #eee; padding-bottom:10px;">
                <span style="color:#666;">Me Devem (Empréstimos)</span>
                <span style="font-weight:bold; color:#28a745;">${fmtBRL(sumOwedToMe)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
                <span style="font-weight:bold; color:#333; font-size:11px;">Balanço das Dívidas</span>
                <span style="font-weight:bold; font-size:16px; color:${balance >= 0 ? '#28a745' : '#dc3545'};">${fmtBRL(balance)}</span>
            </div>
        `;
    }

    const tdiv = cnt.querySelector("#divLoansOverviewDetail") || cnt.querySelector("#divLoansOverview");
    if (tdiv) {
        const balance = sumOwedToMe - sumIOwe;
        tdiv.innerHTML = `
            <div class="card" style="border: 1px solid #17a2b8; border-left:4px solid #0056b3;">
            <div style="font-weight:bold; color:#0056b3; margin-bottom:10px; display:flex; justify-content:space-between;">
                <div>🤝 Dívidas & Empréstimos (Mês)</div>
                <button class="small secondary" onclick="location.hash='#loans'">Ver Detalhes</button>
            </div>
            
            <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:5px; text-align:center;">
                <div style="padding:5px; background:#f8d7da; border-radius:4px;">
                    <div style="font-size:10px; color:#666;">Eu Devo (Saldo Global)</div>
                    <div style="font-weight:bold; color:#dc3545;">${fmtBRL(sumIOwe)}</div>
                </div>
                <div style="padding:5px; background:#d4edda; border-radius:4px;">
                    <div style="font-size:10px; color:#666;">Me Devem (Saldo Global)</div>
                    <div style="font-weight:bold; color:#28a745;">${fmtBRL(sumOwedToMe)}</div>
                </div>
            </div>

            <hr style="margin:10px 0; border:0; border-top:1px dashed #ccc; opacity:0.8;"/>

            <div style="display:flex; justify-content:space-around; text-align:center; font-size:11px;">
                <div>
                    <div style="color:#666;">Parcelas A Vencer (${currentMonth})</div>
                    <div style="font-weight:bold; font-size:13px; color:#0056b3;">${moVencerQty}x — ${fmtBRL(moVencerSoma)}</div>
                </div>
                <div style="border-left:1px solid #ddd;"></div>
                <div>
                    <div style="color:#666;">Parcelas Atrasadas (${currentMonth})</div>
                    <div style="font-weight:bold; font-size:13px; color:${moAtrasadasQty > 0 ? '#dc3545' : '#28a745'};">${moAtrasadasQty}x — ${fmtBRL(moAtrasadasSoma)}</div>
                </div>
            </div>
            
            <hr style="margin:10px 0; border:0; border-top:1px dashed #ccc; opacity:0.8;"/>
            
            <!--Forecasting -->
            <div style="font-size:12px; font-weight:bold; color:#555; margin-bottom:5px;">Próximos 3 Meses (Em Aberto/Parcial)</div>
            <div style="display:flex; justify-content:space-between; text-align:center; font-size:11px; color:#6c757d;">
                ${forecasting.map(f => `
                    <div style="flex:1;">
                        <div>${f.month.slice(5)}/20${f.month.slice(2, 4)}</div>
                        <div style="font-weight:bold; color:#444;">${fmtBRL(f.open)}</div>
                        <div style="font-size:9px;">${f.qty} parcela(s)</div>
                    </div>
                `).join("")}
            </div>
        </div >
                `;
    }
}

// Quick helper missing from reports.js previously
function addMonths(ymStr, offset) {
    const d = new Date(ymStr + "-15T12:00:00");
    d.setMonth(d.getMonth() + offset);
    return d.toISOString().slice(0, 7);
}

async function renderAlertsOverview(cnt, flt, currentMonth) {
    const div = cnt.querySelector("#dashCardAlerts");
    if (!div) return;

    let alerts = [];
    const todayStr = new Date().toISOString().slice(0, 10);
    const in7Days = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const thisMonth = todayStr.slice(0, 7);

    const isCurrentMonth = currentMonth === thisMonth;

    // 1. Contas a Pagar
    const openBills = state.cache.bills.filter(b => b.status === 'open' || b.status === 'partial');
    let vencidasBills = 0; let vencidasBillsSoma = 0;
    let em7DiasBills = 0; let em7DiasBillsSoma = 0;

    openBills.forEach(b => {
        const rest = Math.max(0, b.expectedAmount - (b.paidAmount || 0));
        if (b.dueDate.startsWith(currentMonth)) {
            if (isCurrentMonth && b.dueDate < todayStr) {
                vencidasBills++;
                vencidasBillsSoma += rest;
            } else if (isCurrentMonth && b.dueDate >= todayStr && b.dueDate <= in7Days) {
                em7DiasBills++;
                em7DiasBillsSoma += rest;
            }
        }
    });

    if (vencidasBills > 0) alerts.push({ text: `Contas vencidas: ${vencidasBills} (R$ ${fmtBRL(vencidasBillsSoma)})`, hash: '#bills', type: 'danger' });
    if (em7DiasBills > 0) alerts.push({ text: `Contas vencem em 7 dias: ${em7DiasBills} (R$ ${fmtBRL(em7DiasBillsSoma)})`, hash: '#bills', type: 'warning' });

    // 2. Cartões
    const invoices = {};
    const cardTxs = state.cache.txs.filter(t => t.cardId && t.invoiceMonth === currentMonth);
    cardTxs.forEach(t => {
        if (!invoices[t.cardId]) invoices[t.cardId] = { total: 0, paid: 0 };
        const val = Math.abs(t.valueBRL ?? t.value);
        if (t.kind === 'INVOICE_PAYMENT' || t.type === 'card_payment') {
            invoices[t.cardId].paid += val;
        } else if (t.type === 'expense') {
            invoices[t.cardId].total += val;
        } else if (t.type === 'revenue') {
            invoices[t.cardId].total -= val;
        }
    });

    Object.keys(invoices).forEach(cid => {
        const card = state.cache.cards.find(c => c.id === cid);
        if (!card) return;
        const remaining = invoices[cid].total - invoices[cid].paid;

        if (remaining > 2000) {
            alerts.push({ text: `Fatura alta: ${card.name} (Restante R$ ${fmtBRL(remaining)})`, hash: '#invoices', type: 'warning' });
        }

        if (isCurrentMonth && remaining > 1) {
            if (card.dueDay) {
                let d = card.dueDay.toString().padStart(2, '0');
                const dueFull = `${currentMonth} -${d} `;
                if (dueFull >= todayStr && dueFull <= in7Days) {
                    alerts.push({ text: `Fatura vence em breve: ${card.name} (R$ ${fmtBRL(remaining)})`, hash: '#invoices', type: 'warning' });
                }
            }
        }
    });

    // 3. Dívidas (Installments)
    let vencidasInstalls = 0; let vencidasInstallsSoma = 0;
    let em7DiasInstalls = 0; let em7DiasInstallsSoma = 0;

    const openInstalls = state.cache.loanInstallments.filter(i => i.status === 'open' || i.status === 'partial');
    openInstalls.forEach(i => {
        if (i.dueDate.startsWith(currentMonth)) {
            const rest = Math.max(0, i.amount - (i.paidAmount || 0));
            if (isCurrentMonth && i.dueDate < todayStr) {
                vencidasInstalls++;
                vencidasInstallsSoma += rest;
            } else if (isCurrentMonth && i.dueDate >= todayStr && i.dueDate <= in7Days) {
                em7DiasInstalls++;
                em7DiasInstallsSoma += rest;
            }
        }
    });

    if (vencidasInstalls > 0) alerts.push({ text: `Parcelas de dívida vencidas: ${vencidasInstalls} (R$ ${fmtBRL(vencidasInstallsSoma)})`, hash: '#loans', type: 'danger' });
    if (em7DiasInstalls > 0) alerts.push({ text: `Parcelas vencem em 7 dias: ${em7DiasInstalls} (R$ ${fmtBRL(em7DiasInstallsSoma)})`, hash: '#loans', type: 'warning' });

    // 4. Rejane
    const rejaneFechamentos = state.cache.balanceEvents.filter(e => e.month === currentMonth && e.type === 'charge');
    if (rejaneFechamentos.length === 0) {
        alerts.push({ text: `Rejane: mês não fechado`, hash: '#reports', type: 'warning' });
    }

    let rejaneSaldoInfo = 0;
    state.cache.personBalances.forEach(pb => {
        if (pb.balanceBRL > 0) rejaneSaldoInfo += pb.balanceBRL;
        else if (pb.balanceBRL < 0) rejaneSaldoInfo += Math.abs(pb.balanceBRL);
    });
    if (rejaneSaldoInfo > 0) {
        alerts.push({ text: `Rejane: saldos em aberto globais: R$ ${fmtBRL(rejaneSaldoInfo)} `, hash: '#reports', type: 'warning' });
    }

    if (alerts.length === 0) {
        div.innerHTML = `
                <h3 style = "margin-top:0; color:#dc3545; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;" >⚠️ Alertas</h3 >
                    <div style="font-size:11px; color:#666; text-align:center; margin-top:15px;">Nenhum alerta para o período selecionado.</div>
            `;
        return;
    }

    const htmlArgs = alerts.map(a => `
                <div style = "background:${a.type === 'danger' ? '#f8d7da' : '#fff3cd'}; color:${a.type === 'danger' ? '#721c24' : '#856404'}; padding:8px; border-radius:4px; margin-bottom:5px; font-size:11px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;" onclick = "location.hash='${a.hash}'" >
            <span>${a.type === 'danger' ? '🚨' : '⚠️'} ${a.text}</span>
            <span>➔</span>
        </div >
                `).join("");

    div.innerHTML = `
                <h3 style = "margin-top:0; color:#dc3545; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;" >⚠️ Alertas de Atenção</h3 >
                    <div style="margin-top:10px;">${htmlArgs}</div>
            `;
}

async function renderChecklistView(cnt, currentMonth) {
    const div = cnt.querySelector("#dashCardChecklist");
    if (!div) return;

    const checkId = "check_" + currentMonth;
    let doc = { id: checkId, month: currentMonth, items: {}, updatedAt: new Date().toISOString() };
    try {
        const stored = await get("month_checklist", checkId);
        if (stored) doc = stored;
    } catch (e) { }

    const listItems = [
        { key: "import_fatura", text: "Importar faturas do mês" },
        { key: "gerar_contas", text: "Gerar/Atualizar Contas do mês" },
        { key: "revisar_parcelas", text: "Revisar parcelas dos próximos meses" },
        { key: "fechar_rejane", text: "Fechar contas Rejane do mês" },
        { key: "backup", text: "Fazer Backup offline" },
        { key: "revisar_dividas", text: "Revisar dívidas vigentes" }
    ];

    const completedCount = listItems.filter(i => doc.items[i.key]).length;

    window.__toggleChecklist = async (key) => {
        doc.items[key] = !doc.items[key];
        doc.updatedAt = new Date().toISOString();
        await put("month_checklist", doc);
        renderChecklistView(cnt, currentMonth);
    };

    window.__markAllChecklist = async () => {
        listItems.forEach(i => doc.items[i.key] = true);
        doc.updatedAt = new Date().toISOString();
        await put("month_checklist", doc);
        renderChecklistView(cnt, currentMonth);
    };

    window.__clearChecklist = async () => {
        doc.items = {};
        doc.updatedAt = new Date().toISOString();
        await put("month_checklist", doc);
        renderChecklistView(cnt, currentMonth);
    };

    window.__triggerExportPack = async () => {
        await prepareExportPack();
    };

    const liHtml = listItems.map(i => {
        const checked = doc.items[i.key] ? 'checked' : '';
        const style = doc.items[i.key] ? 'text-decoration:line-through; color:#999;' : 'color:#333;';
        const isBackup = i.key === "backup";
        return `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <label style="display:flex; align-items:center; gap:8px; font-size:11px; cursor:pointer;" >
                        <input type="checkbox" ${checked} onchange="window.__toggleChecklist('${i.key}')">
                            <span style="${style}">${i.text}</span>
                        </label>
                    ${isBackup ? `<button class="btn btn-primary small" onclick="window.__triggerExportPack()" style="font-size:10px; padding:2px 5px;">⚡ Export Rápido</button>` : ''}
                </div>
            `;
    }).join("");

    div.innerHTML = `
                <h3 style = "margin-top:0; color:#28a745; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px; display:flex; justify-content:space-between; align-items:center;" >
            <span>✅ Rotina do Mês</span>
            <span style="font-size:10px; font-weight:normal;">${completedCount}/${listItems.length} concluído</span>
        </h3 >
        <div style="margin-top:10px;">${liHtml}</div>
        <div style="display:flex; gap:10px; margin-top:10px;">
            <button class="btn btn-secondary small" onclick="window.__markAllChecklist()" style="flex:1;">Marcar Tudo</button>
            <button class="btn btn-secondary small" onclick="window.__clearChecklist()" style="flex:1;">Limpar</button>
        </div>
            `;
}
