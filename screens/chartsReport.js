import { list, get } from "../db.js";
import { drawLineChart, drawBarChart, drawGroupedBarChart } from "../utils/charts.js";

/* =========================================
   CHARTS REPORT (Printable)
   ========================================= */

function fmtBRL(val) {
    return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getPrevMonth(m, offset = 1) {
    const d = new Date(m + "-01T00:00:00");
    d.setMonth(d.getMonth() - offset);
    return d.toISOString().slice(0, 7);
}

export async function chartsReportScreen() {
    return `
    <style>
        @media print {
            body { background: white; margin: 0; padding: 0; }
            nav, .bottom-nav, #titlebar, .no-print { display: none !important; }
            .card { box-shadow: none !important; border: 1px solid #ccc !important; margin-bottom: 20px !important; break-inside: avoid; }
            #charts-report-container { padding: 0 !important; max-width: 100% !important; }
            .print-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
            h2 { margin-top: 0; }
        }
    </style>
    <div id="charts-report-container" style="padding: 10px; max-width: 800px; margin: 0 auto;">
        <div class="card"><div class="small">Gerando relatório...</div></div>
    </div>
    `;
}

export async function wireChartsReportHandlers(rootEl) {
    const container = rootEl.querySelector("#charts-report-container");

    // 1. Load Month from Reports State (or default to current)
    let selectedMonth = new Date().toISOString().slice(0, 7);
    let personId = "";
    try {
        const saved = await get("settings", "ui_reports_state");
        if (saved && saved.filters) {
            if (saved.filters.month) selectedMonth = saved.filters.month;
            if (saved.filters.personId) personId = saved.filters.personId;
        }
    } catch (e) { console.warn("Load filters err", e); }

    // 2. Load Data
    try {
        const [txs, categories, people, budgets] = await Promise.all([
            list("transactions"),
            list("categories"),
            list("people"),
            list("budget_templates").catch(() => [])
        ]);

        // Filter globally if person is selected
        let scopedTxs = txs;
        if (personId) {
            scopedTxs = scopedTxs.filter(t => t.personId === personId);
        }

        const personName = personId ? (people.find(p => p.id === personId)?.name || "") : "Todos";

        // --- 1. Line Chart Data (6 months expenses) ---
        const last6Months = [];
        const baseDate = new Date(selectedMonth + "-01T12:00:00");
        for (let i = 5; i >= 0; i--) {
            const d = new Date(baseDate.getFullYear(), baseDate.getMonth() - i, 1);
            last6Months.push(d.toISOString().slice(0, 7));
        }
        const evolutionData = last6Months.map(mStr => {
            const spent = scopedTxs.filter(t => t.type === "expense" && t.date && t.date.slice(0, 7) === mStr)
                .reduce((acc, t) => acc + (t.valueBRL || t.value), 0);
            return { label: mStr, value: spent };
        });

        // --- 2. Grouped Bars (Income vs Expense) current month ---
        const currIncome = scopedTxs.filter(t => t.type === "revenue" && t.date && t.date.slice(0, 7) === selectedMonth)
            .reduce((acc, t) => acc + (t.valueBRL || t.value), 0);
        const currExpense = scopedTxs.filter(t => t.type === "expense" && t.date && t.date.slice(0, 7) === selectedMonth)
            .reduce((acc, t) => acc + (t.valueBRL || t.value), 0);
        const incExpData = { income: currIncome, expense: currExpense };

        // --- 3. Top 10 Categories (Expenses) current month ---
        const currTxs = scopedTxs.filter(t => t.date && t.date.slice(0, 7) === selectedMonth);
        const groups = {};
        currTxs.forEach(t => {
            if (t.type !== 'expense') return;
            const v = t.valueBRL || t.value;
            const k = t.categoryId || "uncat";
            if (!groups[k]) groups[k] = 0;
            groups[k] += v;
        });
        const sortedCats = Object.keys(groups).sort((a, b) => groups[b] - groups[a]).slice(0, 10);
        const topCatsData = sortedCats.map(cid => {
            const name = categories.find(c => c.id === cid)?.name || "(Sem Categoria)";
            return { label: name, value: groups[cid] };
        });

        // RENDER HTML
        container.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
                <h2>Relatório Gráfico: ${selectedMonth.split('-')[1]}/${selectedMonth.split('-')[0]} ${personId ? `(${personName})` : ''}</h2>
                <div class="no-print" style="display:flex; gap:10px;">
                    <button class="secondary" onclick="location.hash='#reports'">Voltar</button>
                    <button onclick="window.print()" style="background:#0056b3; color:white;">🖨 Imprimir / PDF</button>
                </div>
            </div>

            <div class="card">
                <h3>Evolução de Despesas (6 Meses)</h3>
                <div style="width:100%; text-align:center;">
                    <canvas id="crLine" width="700" height="250" style="max-width:100%; height:auto;"></canvas>
                </div>
            </div>

            <div class="print-grid">
                <div class="card">
                    <h3>Receitas x Despesas</h3>
                    <div style="width:100%; text-align:center;">
                        <canvas id="crGroup" width="350" height="250" style="max-width:100%; height:auto;"></canvas>
                    </div>
                </div>

                <div class="card">
                    <h3>Top Categorias (Desp.)</h3>
                    <div style="width:100%; text-align:center;">
                        <canvas id="crBars" width="350" height="250" style="max-width:100%; height:auto;"></canvas>
                    </div>
                </div>
            </div>
            
            <div style="text-align:center; margin-top:20px; font-size:11px; color:#999;">
                Gerado pelo FinanceApp em ${new Date().toLocaleString('pt-BR')}
            </div>
        `;

        // Draw Canvas Delay
        setTimeout(() => {
            const cLine = container.querySelector("#crLine");
            if (cLine) drawLineChart(cLine, evolutionData);

            const cGroup = container.querySelector("#crGroup");
            if (cGroup) drawGroupedBarChart(cGroup, incExpData);

            const cBars = container.querySelector("#crBars");
            if (cBars) drawBarChart(cBars, topCatsData);
        }, 100);

    } catch (e) {
        container.innerHTML = `<div class="card error">Erro ao montar relatório gráfico: ${e.message}</div>`;
        console.error(e);
    }
}
