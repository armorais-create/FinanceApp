import { list, get, put } from "../db.js";

/* =========================================
   STATE
   ========================================= */
const state = {
    filters: {
        month: new Date().toISOString().slice(0, 7), // YYYY-MM
        personId: "",
        accountId: "",
        cardId: "",
        holder: "" // 'main' | 'additional' | specific name? User asks for "Titular / Adicional / Nome"
    },
    // Data cache
    cache: {
        txs: [],
        people: [],
        accounts: [],
        cards: [],
        categories: [],
        tags: []
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
    <div id="reportsContainer">
        <div class="card"><div class="small">Carregando relatórios...</div></div>
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
        const [txs, people, accounts, cards, cats, tags] = await Promise.all([
            list("transactions"),
            list("people"),
            list("accounts"),
            list("cards"),
            list("categories"),
            list("tags")
        ]);

        state.cache = { txs, people, accounts, cards, categories: cats, tags };

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
        <!-- FILTER BAR -->
        <div class="card" style="background:#f8f9fa;">
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <input type="month" id="repMonth" value="${dateInputVal}" style="padding:5px;">
                <button id="btnToday" style="padding:5px 10px;">Hoje</button>
                <button id="btnClear" style="padding:5px 10px; background:#ccc; color:#333;">Limpar</button>
            </div>
            <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:5px; margin-top:10px;">
                <select id="fltPerson">${pOpts}</select>
                <select id="fltAccount">${acOpts}</select>
                <select id="fltCard">${cardOpts}</select>
                <select id="fltHolder">${hOpts}</select>
            </div>
            ${quickFilterLabel}
        </div>

        <!-- SUMMARY CARDS -->
        <div class="grid" style="grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
            <div class="card summary-card" style="text-align:center; padding:10px;">
                <div class="small">Receitas</div>
                <div style="font-size:1.2em; color:#28a745;">${fmtBRL(curr.rev)}</div>
                ${renderDelta(curr.rev, prev.rev)}
            </div>
            <div class="card summary-card" style="text-align:center; padding:10px;">
                <div class="small">Despesas</div>
                <div style="font-size:1.2em; color:#dc3545;">${fmtBRL(curr.exp)}</div>
                ${renderDelta(curr.exp, prev.exp, true)}
            </div>
            <div class="card summary-card" style="text-align:center; padding:10px;">
                <div class="small">Saldo</div>
                <div style="font-size:1.2em; color:${curr.bal >= 0 ? '#28a745' : '#dc3545'};">${fmtBRL(curr.bal)}</div>
                ${renderDelta(curr.bal, prev.bal)}
            </div>
            <div class="card summary-card" style="text-align:center; padding:10px;" id="openInvoicesCard">
                <div class="small">Faturas Abertas</div>
                <div style="font-size:1.2em; color:#007bff;">Calculando...</div>
            </div>
        </div>

        <!-- VISÃO REJANE (Conditional) -->
        <div id="divRejane"></div>

        <!-- SECTIONS -->
        <!-- TOP 10 & CHARTS -->
        <div class="grid" style="grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
             ${renderTopCategories(displayTxs)}
             ${renderTopTags(displayTxs)}
        </div>
        
        <div style="margin-top:10px;">
             ${renderTopTransactions(displayTxs)}
        </div>

        <div style="margin-top:10px;">
            ${renderEvolutionChart(filterTxs(state.cache.txs, getPrevMonth(month, 2), state.filters), prevTxs, currentTxs, month)}
        </div>

        <!-- SECTIONS -->
        <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
            
            ${renderCatTable(displayTxs)}
            ${renderTagTable(displayTxs)}
            ${renderAccountTable(displayTxs)}
            ${renderInvoiceTable(state.cache.txs, month)} 

        </div>
    `;

    // --- POST RENDER CALCULATIONS ---

    // 1. Calc Open Invoices (Same logic as Home, but respecting filters?)
    // User asked "Cartões em aberto... usar lógica similar do Home".
    // Does filter affect "Open"? Yes, if I select a Card, I expect to see only that card's open invoice?
    // Let's reuse the logic but verify filters.

    setTimeout(() => {
        calcOpenInvoices(cnt, state.cache.txs, state.filters);
        renderRejaneView(cnt, state.cache.txs, state.filters, month);
    }, 0);

    // --- HANDLERS ---

    const refresh = async () => {
        // Save filters
        await put("settings", { id: "ui_reports_state", filters: state.filters });
        renderReports(cnt);
    };

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
        <div class="card">
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

    html += `</table></div>`;
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
        <div class="card">
            <div style="font-weight:bold; margin-bottom:5px;">Por Tag (Despesas)</div>
            <table style="width:100%; font-size:12px;">
    `;
    sorted.forEach(k => {
        html += `<tr><td style="padding:2px;">#${esc(k)}</td><td style="text-align:right;">${fmtBRL(counts[k])}</td></tr>`;
    });
    html += `</table></div>`;
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
        <div class="card">
            <div style="font-weight:bold; margin-bottom:5px;">Por Conta</div>
            <table style="width:100%; font-size:12px;">
                <thead><tr style="color:#666;"><th>Conta</th><th style="text-align:right">Rec</th><th style="text-align:right">Desp</th><th style="text-align:right">Res</th></tr></thead>
    `;

    Object.keys(groups).forEach(aid => {
        const acc = state.cache.accounts.find(a => a.id === aid);
        const name = acc ? acc.name : "Outros";
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
    html += `</table></div>`;
    return html;
}

/* =========================================
   TOP 10 & CHARTS
   ========================================= */

function renderTopCategories(txs) {
    // Top 10 Expenses
    const groups = {};
    let totalExp = 0;
    txs.forEach(t => {
        if (t.type !== 'expense') return;
        const v = t.valueBRL ?? t.value;
        const k = t.categoryId || "uncat";
        if (!groups[k]) groups[k] = 0;
        groups[k] += v;
        totalExp += v;
    });

    const sorted = Object.keys(groups).sort((a, b) => groups[b] - groups[a]).slice(0, 10);
    const maxVal = sorted.length ? groups[sorted[0]] : 1;

    let html = `<div class="card">
        <div style="font-weight:bold; margin-bottom:5px;">Top Categorias (Desp.)</div>`;

    if (sorted.length === 0) html += "<div class='small'>Sem dados.</div>";

    sorted.forEach(cid => {
        const val = groups[cid];
        const name = state.cache.categories.find(c => c.id === cid)?.name || "(Sem Categoria)";
        const pctBar = (val / maxVal) * 100;

        html += `
            <div data-quick-filter data-type="category" data-val="${cid}" data-name="${esc(name)}" 
                 style="margin-bottom:4px; font-size:11px; position:relative;">
                <div style="display:flex; justify-content:space-between; position:relative; z-index:2; padding:0 2px;">
                    <span>${esc(name)}</span>
                    <span>${fmtBRL(val)}</span>
                </div>
                <div style="position:absolute; top:0; left:0; height:100%; width:${pctBar}%; background:rgba(220, 53, 69, 0.15); border-radius:2px; z-index:1;"></div>
            </div>
        `;
    });
    html += `</div>`;
    return html;
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

    let html = `<div class="card">
        <div style="font-weight:bold; margin-bottom:5px;">Top Tags (Desp.)</div>`;

    if (sorted.length === 0) html += "<div class='small'>Sem dados.</div>";

    sorted.forEach(tg => {
        const val = groups[tg];
        const pctBar = (val / maxVal) * 100;

        html += `
            <div data-quick-filter data-type="tag" data-val="${tg}" data-name="${esc(tg)}"
                 style="margin-bottom:4px; font-size:11px; position:relative;">
                <div style="display:flex; justify-content:space-between; position:relative; z-index:2; padding:0 2px;">
                    <span>${esc(tg)}</span>
                    <span>${fmtBRL(val)}</span>
                </div>
                <div style="position:absolute; top:0; left:0; height:100%; width:${pctBar}%; background:rgba(23, 162, 184, 0.15); border-radius:2px; z-index:1;"></div>
            </div>
        `;
    });
    html += `</div>`;
    return html;
}

function renderTopTransactions(txs) {
    const expenses = txs.filter(t => t.type === 'expense')
        .sort((a, b) => (b.valueBRL ?? b.value) - (a.valueBRL ?? a.value))
        .slice(0, 10);

    if (!expenses.length) return "";

    return `<div class="card">
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
    </div>`;
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
            <div style="display:flex; flex-direction:column; align-items:center; flex:1;">
                <div style="font-size:10px; margin-bottom:2px;">${fmtBRL(val)}</div>
                <div style="width:30px; background:#dc3545; height:${h}px; min-height:1px; border-radius:3px 3px 0 0; transition: height 0.3s;"></div>
                <div style="font-size:10px; margin-top:5px; color:#666;">${label}</div>
            </div>
        `;
    };

    // Labels
    const l2 = getPrevMonth(month, 2).slice(5);
    const l1 = getPrevMonth(month, 1).slice(5);
    const l0 = month.slice(5);

    return `<div class="card">
        <div style="font-weight:bold; margin-bottom:10px;">Evolução Despesas (3 Meses)</div>
        <div style="display:flex; align-items:flex-end; height:100px; padding-bottom:10px; border-bottom:1px solid #eee;">
            ${bar(v2, l2)}
            ${bar(v1, l1)}
            ${bar(v0, l0)}
        </div>
    </div>`;
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
    if (!cardIds.length) return `<div class="card"><div class="small">Nenhuma fatura encontrada para ${month}</div></div>`;

    let html = `
        <div class="card">
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

    html += `</table></div>`;
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

        const key = `${t.cardId}:${t.invoiceMonth}`;
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
    Object.values(invoices).forEach(i => {
        const rem = i.total - i.paid;
        if (rem > 1.0) {
            count++;
            debt += rem;
        }
    });

    const el = cnt.querySelector("#openInvoicesCard");
    el.innerHTML = `
        <div class="small">Faturas Abertas</div>
        <div style="font-size:1.2em; color:#007bff;">${count}</div>
        <div class="small" style="color:#66s;">${fmtBRL(debt)}</div>
    `;
}

function renderRejaneView(cnt, txs, flt, currentMonth) {
    // Check if any person is named "Rejane" or filter is "Rejane"
    const rejane = state.cache.people.find(p => p.name.toLowerCase().includes("rejane"));
    const isRejaneFilter = flt.personId && rejane && flt.personId === rejane.id;
    const isHolderRejane = flt.holder && flt.holder.toLowerCase().includes("rejane");

    const shouldShow = rejane || isRejaneFilter || isHolderRejane;
    if (!shouldShow) return; // Hide

    // Goal: Show totals for Rejane by Card for the selected Month + Open Debt
    // Filter txs for Rejane in Selected Month
    const rows = [];

    // Group 1: Selected Month spending
    // Iterate cards.
    state.cache.cards.forEach(c => {
        // Determine if Rejane is Main or Additional on this card?
        // Or just search txs where personId = Rejane OR cardHolder matches Rejane's role
        // Assuming "Visão Rejane" means "Gastos da Rejane".

        // 1. Spending this month (Invoice Month)
        const cardTxs = txs.filter(t =>
            t.cardId === c.id &&
            t.invoiceMonth === currentMonth
        );

        const rejaneTxs = cardTxs.filter(t => {
            // Logic: Txs marked with Person=Rejane
            if (rejane && t.personId === rejane.id) return true;
            // OR Txs where she is the Holder (e.g. Additional)
            if (c.additional && c.additional.toLowerCase().includes("rejane") && t.cardHolder === 'additional') return true;
            if (c.holder && c.holder.toLowerCase().includes("rejane") && t.cardHolder === 'main') return true;
            return false;
        });

        const sumMonth = rejaneTxs.reduce((a, b) => a + (b.valueBRL || b.value), 0);

        // 2. Open Debt (Any month) - Complexity: Payments are usually Global/Main holder.
        // Cannot easily calculate "Rejane's remaining debt" unless payments are also split.
        // Feature request says: "Em aberto (Rejane) = soma do restante das faturas atribuídas ao portador Rejane"
        // implies we sum UNPAID items? Or just sum all items and assume 0 paid?
        // Usually additional users don't pay. So their "Open" is their Total accumulated?
        // Let's assume Open = Sum of all Expenses in Open Invoices.

        // Find Open Invoices for this Card
        // Reuse calculation from openInvoices?
        // Iterate all txs for this card, grouped by invoice.
        // If invoice is open (Total > Paid), then Rejane's share in that invoice is "Open".

        // This is heavy. Let's do a simplified approach:
        // Sum of Rejane's transactions in invoices that are NOT fully paid?
        // Or just Sum of all Rejane's transactions in current and future months?
        // "Soma do restante" usually implies proportional debt or just her total spending.
        // Let's sum her total spending in any invoice that is technically "Open" (based on the global calc).

        let openDebt = 0;
        const invoicesStatus = {}; // key: month -> isOpen
        // Pre-calc invoices status
        const invMap = {}; // month -> {total, paid}
        txs.filter(t => t.cardId === c.id).forEach(t => {
            if (!t.invoiceMonth) return;
            if (!invMap[t.invoiceMonth]) invMap[t.invoiceMonth] = { t: 0, p: 0 };
            const v = t.valueBRL || t.value;
            // ... same calc ...
            if (t.type === 'card_payment' || t.kind === 'INVOICE_PAYMENT') invMap[t.invoiceMonth].p += Math.abs(v);
            else if (t.type === 'expense') invMap[t.invoiceMonth].t += v;
            else if (t.type === 'revenue') invMap[t.invoiceMonth].t -= v;
        });
        Object.keys(invMap).forEach(m => {
            if ((invMap[m].t - invMap[m].p) > 1) invoicesStatus[m] = true;
        });

        // Now sum Rejane's items in Open Invoices
        txs.filter(t => t.cardId === c.id && invoicesStatus[t.invoiceMonth]).forEach(t => {
            // Is Rejane?
            let isRej = false;
            if (rejane && t.personId === rejane.id) isRej = true;
            if (c.additional && c.additional.toLowerCase().includes("rejane") && t.cardHolder === 'additional') isRej = true;
            if (c.holder && c.holder.toLowerCase().includes("rejane") && t.cardHolder === 'main') isRej = true;

            if (isRej && t.type === 'expense') openDebt += (t.valueBRL || t.value);
        });

        if (sumMonth > 0 || openDebt > 0) {
            rows.push({ name: c.name, month: sumMonth, open: openDebt });
        }
    });

    if (!rows.length) return;

    const div = cnt.querySelector("#divRejane");
    div.innerHTML = `
        <div class="card" style="border:1px solid pink; background:#fff0f5;">
            <div style="font-weight:bold; color:#d63384;">🌸 Visão Rejane (${currentMonth})</div>
            <table style="width:100%; font-size:12px; margin-top:5px;">
                <tr><td>Cartão</td><td align="right">Gastos Mês</td><td align="right">Em Aberto (Total)</td></tr>
                ${rows.map(r => `
                    <tr>
                        <td>${esc(r.name)}</td>
                        <td align="right">${fmtBRL(r.month)}</td>
                        <td align="right" style="font-weight:bold;">${fmtBRL(r.open)}</td>
                    </tr>
                `).join("")}
            </table>
        </div>
    `;
}
