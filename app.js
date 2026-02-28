import { list, put, remove, listByIndex, runBackgroundMigrations } from "./db.js?v=v2";
import { settingsScreen, wireSettingsHandlers, renderBudgetDetailsModal, showToast } from "./ui.js?v=2.1";
import { drawLineChart, drawGroupedBarChart, exportChartToPNG, getCanvasClickPosition } from "./utils/charts.js";
import { txScreen, wireTxHandlers } from "./screens/tx.js";
import { invoiceScreen, wireInvoiceHandlers } from "./screens/invoice.js";
import { importScreen, wireImportHandlers } from "./screens/import.js?v=2.2";
import { installmentsScreen, wireInstallmentsHandlers } from "./screens/installments.js";
import { reportsScreen, wireReportsHandlers } from "./screens/reports.js";
import { billsScreen, wireBillsHandlers } from "./screens/bills.js";
import { loansScreen, wireLoansHandlers } from "./screens/loans.js";
import { rejaneReportScreen, wireRejaneReportHandlers } from "./screens/rejaneReport.js";
import { chartsReportScreen, wireChartsReportHandlers } from "./screens/chartsReport.js";
import { searchScreen, wireSearchHandlers } from "./screens/search.js";
import { annualReportScreen, wireAnnualReportHandlers } from "./screens/annualReport.js";
import { monthlyCloseScreen, wireMonthlyCloseHandlers } from "./screens/monthlyClose.js";
import { investmentsScreen, wireInvestmentsHandlers } from "./screens/investments.js";
import { banksScreen, wireBanksHandlers } from "./screens/banks.js";
import { helpScreen } from "./screens/help.js";

// =========================================
// APP VERSION
// =========================================
export const APP_VERSION = "1.0.0";

const titleEl = document.getElementById("title");
const viewEl = document.getElementById("view");
const tabs = Array.from(document.querySelectorAll(".tab"));

function esc(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// =========================================
// GLOBAL ERROR HANDLING (Hardening)
// =========================================
window.onerror = function (msg, source, lineno, colno, error) {
  console.error("[GLOBAL ERROR]", msg, error);
  const toast = document.createElement("div");
  toast.style.cssText = "position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:rgba(255,0,0,0.9); color:white; padding:10px 20px; border-radius:5px; z-index:9999; font-size:14px;";
  toast.innerText = "Erro: " + msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
  return false;
};

window.addEventListener("unhandledrejection", (e) => {
  console.error("[UNHANDLED PROMISE]", e.reason);
  const toast = document.createElement("div");
  toast.style.cssText = "position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:rgba(255,100,0,0.9); color:white; padding:10px 20px; border-radius:5px; z-index:9999; font-size:14px;";
  toast.innerText = "Erro em operação: " + (e.reason?.message || e.reason);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
});

// =========================================
// MIGRATION HELPER
// =========================================
async function migrateLegacyGoals() {
  try {
    const legacyGoals = await list("goals");
    if (legacyGoals.length === 0) return;

    console.log("Migrating", legacyGoals.length, "legacy goals...");

    const uid = (prefix) => prefix + Date.now() + Math.floor(Math.random() * 1000);

    const groups = {};
    for (const g of legacyGoals) {
      const key = `${g.name}|${g.categoryId}|${g.subcategoryId || ''}|${g.personId || ''}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(g);
    }

    for (const key of Object.keys(groups)) {
      const goals = groups[key];
      const first = goals[0];

      // Create Template
      const tmplId = uid("gt");
      const tmpl = {
        id: tmplId,
        name: first.name,
        categoryId: first.categoryId,
        subcategoryId: first.subcategoryId || null,
        personId: first.personId || null,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await put("goal_templates", tmpl);

      // Revision (Baseline)
      goals.sort((a, b) => a.month.localeCompare(b.month));
      const earliest = goals[0];

      await put("goal_revisions", {
        id: uid("gr"),
        templateId: tmplId,
        effectiveFromMonth: earliest.month,
        targetCents: earliest.targetCents,
        createdAt: new Date().toISOString()
      });

      // Overrides (for variations)
      for (let i = 1; i < goals.length; i++) {
        const g = goals[i];
        if (g.targetCents !== earliest.targetCents) {
          await put("goal_overrides", {
            id: uid("go"),
            templateId: tmplId,
            month: g.month,
            targetCents: g.targetCents,
            createdAt: new Date().toISOString()
          });
        }
      }
    }
    console.log("Legacy goals migrated.");
  } catch (e) {
    console.error("Migration Failed", e);
    showToast("error", "Erro na migração de metas: " + e.message);
  }
}

// =========================================
// SCREENS DEFINITION
// =========================================
const screens = {
  home: async () => {
    try {
      // Autosetup/Migration check
      const migr = await list("settings");
      const done = migr.find(s => s.id === "migration_rec_goals");
      if (!done) {
        await migrateLegacyGoals();
        await put("settings", { id: "migration_rec_goals", value: true });
        console.log("Migration to Recurrent Goals finished.");
        location.reload();
        return '<div class="card">Migrando dados...</div>';
      }

      const txs = await list("transactions");
      const goals = await list("goal_templates"); // Recurrent Templates
      const revisions = await list("goal_revisions");
      const overrides = await list("goal_overrides");
      const budgetTemplates = await list("budget_templates") || [];
      const budgetOverrides = await list("budget_overrides") || [];

      const wealthGoals = await list("wealth_goals") || [];
      const wealthGoalLinks = await list("wealth_goal_links") || [];
      const investmentBoxes = await list("investment_boxes") || [];
      const investmentMoves = await list("investment_moves") || [];

      // 1. Calculate Open Invoices
      const invoices = {};
      for (const t of txs) {
        if (!t.cardId || !t.invoiceMonth) continue;
        const key = `${t.cardId}:${t.invoiceMonth}`;
        if (!invoices[key]) {
          invoices[key] = { totalBRL: 0, paidBRL: 0 };
        }

        if (t.kind === "planned_installment" && !t.paid) continue;

        const val = t.valueBRL || t.value;
        const isPay = t.kind === "INVOICE_PAYMENT" || t.type === "card_payment";

        if (isPay) {
          invoices[key].paidBRL += Math.abs(val);
        } else if (t.type === "expense") {
          invoices[key].totalBRL += val;
        } else {
          if (t.type === "revenue") invoices[key].totalBRL -= val;
        }
      }

      let openCount = 0;
      let openTotalBRL = 0;
      Object.values(invoices).forEach(inv => {
        const remaining = inv.totalBRL - inv.paidBRL;
        if (remaining > 1.0) {
          openCount++;
          openTotalBRL += remaining;
        }
      });

      // 2. Recurrent Goals Logic
      const currentMonth = new Date().toISOString().slice(0, 7);
      const activeTemplates = goals.filter(g => g.active);

      const getTarget = (tmplId, month) => {
        const ov = overrides.find(o => o.templateId === tmplId && o.month === month);
        if (ov) return ov.targetCents;

        const effRevs = revisions
          .filter(r => r.templateId === tmplId && r.effectiveFromMonth <= month)
          .sort((a, b) => b.effectiveFromMonth.localeCompare(a.effectiveFromMonth));

        return effRevs.length > 0 ? effRevs[0].targetCents : 0;
      };

      const goalProgress = activeTemplates.map(g => {
        const targetCents = getTarget(g.id, currentMonth);
        if (targetCents <= 0) return null;

        const goalTxs = txs.filter(t => {
          const txDate = t.date ? t.date.slice(0, 7) : "";
          if (txDate !== currentMonth) return false;
          if (t.type !== "expense") return false;

          if (g.scopeType === "tag") {
            if (!t.tags || !Array.isArray(t.tags)) return false;
            const targetTag = (g.scopeValue || "").toLowerCase();
            return t.tags.some(tag => tag.toLowerCase() === targetTag);
          } else {
            if (t.categoryId !== g.categoryId) return false;
            if (g.subcategoryId && t.subcategory !== g.subcategoryId) return false;
          }

          if (g.personId && t.personId !== g.personId) return false;
          return true;
        });

        const spent = goalTxs.reduce((sum, t) => sum + (t.valueBRL || t.value), 0);

        return {
          name: g.name,
          targetCents,
          spent,
          pct: Math.min(100, (spent * 100) / (targetCents / 100))
        };
      }).filter(Boolean);

      const hasGoals = goalProgress.length > 0;

      // 3. Monthly Budgets Logic
      const activeBudgets = budgetTemplates.filter(b => b.active);
      const getBudgetTarget = (tmplId, month) => {
        const ov = budgetOverrides.find(o => o.templateId === tmplId && o.month === month);
        return ov ? ov.targetCents : (activeBudgets.find(b => b.id === tmplId)?.monthlyTargetCents || 0);
      };

      const budgetProgress = activeBudgets.map(b => {
        const targetCents = getBudgetTarget(b.id, currentMonth);
        if (targetCents <= 0) return null;

        const budgetTxs = txs.filter(t => {
          const txDate = t.date ? t.date.slice(0, 7) : "";
          if (txDate !== currentMonth) return false;
          if (t.type !== "expense") return false;

          if (t.categoryId !== b.categoryId) return false;
          if (b.subcategoryId && t.subcategory !== b.subcategoryId) return false;
          if (b.personId && t.personId !== b.personId) return false;
          return true;
        });

        const spent = budgetTxs.reduce((sum, t) => sum + (t.valueBRL || t.value), 0);
        const pct = (spent * 100) / (targetCents / 100);

        return {
          name: b.name,
          targetCents,
          spent,
          pct
        };
      }).filter(Boolean);

      budgetProgress.sort((a, b) => b.pct - a.pct);
      const topBudgets = budgetProgress.slice(0, 5);

      // 4. Wealth Goals (Metas de Patrimônio) Logic
      const boxBalancesMap = {};
      investmentBoxes.forEach(box => {
        const boxMoves = investmentMoves.filter(m => m.boxId === box.id);
        let balance = 0;
        boxMoves.forEach(m => {
          if (m.kind === 'deposit' || m.kind === 'yield') balance += m.value;
          if (m.kind === 'withdraw') balance -= m.value;
        });
        boxBalancesMap[box.id] = balance;
      });

      const activeWealthGoals = wealthGoals.filter(g => g.active);
      const wealthProgress = activeWealthGoals.map(g => {
        const linkedBoxes = wealthGoalLinks.filter(l => l.goalId === g.id);
        const currentBRL = linkedBoxes.reduce((sum, link) => sum + (boxBalancesMap[link.investmentBoxId] || 0), 0);
        const targetBRL = (g.targetCentsBRL || 0) / 100;
        const pctObj = targetBRL > 0 ? (currentBRL / targetBRL) * 100 : 0;

        return {
          id: g.id,
          name: g.name,
          current: currentBRL,
          target: targetBRL,
          pct: pctObj,
          hasLinks: linkedBoxes.length > 0
        };
      });

      // Sort by closest to completion, but not 100% yet
      wealthProgress.sort((a, b) => {
        if (a.pct >= 100 && b.pct < 100) return 1;
        if (b.pct >= 100 && a.pct < 100) return -1;
        return b.pct - a.pct;
      });
      const topWealthGoals = wealthProgress.slice(0, 5);

      // 5. Charts Data Preparation (20A-1)
      const last6Months = [];
      const d = new Date();
      for (let i = 5; i >= 0; i--) {
        const tempD = new Date(d.getFullYear(), d.getMonth() - i, 1);
        last6Months.push(tempD.toISOString().slice(0, 7));
      }

      const evolutionData = last6Months.map(monthStr => {
        const monthSpent = txs.filter(t => t.type === "expense" && t.date && t.date.slice(0, 7) === monthStr)
          .reduce((sum, t) => sum + (t.valueBRL || t.value), 0);
        return { label: monthStr, value: monthSpent };
      });

      const currentMonthIncome = txs.filter(t => t.type === "revenue" && t.date && t.date.slice(0, 7) === currentMonth)
        .reduce((sum, t) => sum + (t.valueBRL || t.value), 0);
      const currentMonthExpense = txs.filter(t => t.type === "expense" && t.date && t.date.slice(0, 7) === currentMonth)
        .reduce((sum, t) => sum + (t.valueBRL || t.value), 0);
      const incExpData = { income: currentMonthIncome, expense: currentMonthExpense };

      // Store in window for wireHomeHandlers to pick up later
      window.__homeChartsData = { evolutionData, incExpData, currentMonth };

      return `
        <div class="card">
          <div><strong style="color:#555;">Atalhos Rápidos</strong></div>
          <div class="grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
            <button class="btn btn-primary" data-action="nav" data-hash="#import">📥 Importar</button>
            <button class="btn btn-primary" data-action="nav" data-hash="#invoices">💳 Ver Faturas</button>
            <button class="btn btn-secondary" data-action="nav" data-hash="#search">🔍 Buscar</button>
            <button class="btn btn-secondary" data-action="nav" data-hash="#reports">📊 Painel</button>
            <button class="btn btn-secondary" data-action="nav" data-hash="#annual-report">📅 Relatório Anual</button>
            <button class="btn btn-secondary" data-action="nav" data-hash="#rejane-report">👩‍💼 Relatório Rejane</button>
            <button class="btn btn-secondary" data-action="nav" data-hash="#investments">📦 Caixinhas</button>
            <button class="btn btn-secondary" id="btnExportPackHome">📦 Backup Rápido</button>
          </div>
        </div>
        
        <div class="card" style="border: 1px solid #17a2b8;">
          <div style="color:#17a2b8;"><strong>Contas a Pagar</strong></div>
          <div class="grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
            <button class="btn btn-primary" data-action="nav" data-hash="#bills" style="background:#17a2b8; color:white; border-color:#17a2b8;">📅 Mês Atual</button>
            <button class="btn btn-secondary" data-action="nav" data-hash="#bills?next" style="background:#fff; color:#17a2b8; border:1px solid #17a2b8;">➡️ Próximos 30 Dias</button>
          </div>
        </div>

        <div class="card" style="border: 1px solid #28a745; margin-top:10px;">
          <div style="color:#28a745;"><strong>Dívidas & Empréstimos</strong></div>
          <div class="grid" style="display:grid; grid-template-columns: 1fr; gap:10px; margin-top:10px;">
            <button class="btn btn-success" data-action="nav" data-hash="#loans" style="padding:10px; background:#28a745; border-color:#28a745;">🤝 Controle de Dívidas</button>
          </div>
        </div>

        <div class="card">
          <div><strong>Resumo de Faturas (Aberto)</strong></div>
          <div style="display:flex; justify-content:space-between; margin-top:10px;">
            <div style="text-align:center">
              <div style="font-size:1.5em; font-weight:bold">${openCount}</div>
              <div class="small">Faturas</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:1.5em; font-weight:bold">R$ ${openTotalBRL.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div class="small">Total a Pagar</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div><strong>Metas de ${currentMonth}</strong></div>
          <div style="margin-top:10px;">
            ${!hasGoals ? '<div class="small">Nenhuma meta ativa para este mês.</div>' : ''}
            ${goalProgress.map(g => {
        const target = g.targetCents / 100;
        const spent = g.spent;
        const color = g.pct >= 100 ? '#dc3545' : (g.pct >= 80 ? '#ffc107' : '#28a745');
        return `
                <div style="margin-bottom:10px;">
                  <div style="display:flex; justify-content:space-between; font-size:0.9em; margin-bottom:2px;">
                    <strong>${esc(g.name)}</strong>
                    <span>R$ ${spent.toFixed(2)} / ${target.toFixed(2)}</span>
                  </div>
                  <div style="background:#eee; height:8px; border-radius:4px; overflow:hidden;">
                    <div style="width:${g.pct}%; background:${color}; height:100%;"></div>
                  </div>
                </div>
              `;
      }).join("")}
          </div>
        </div>

        <div class="card" style="border-left:4px solid #f39c12;">
          <div><strong style="color:#e67e22;">Metas de Patrimônio</strong></div>
          <div style="margin-top:10px;">
            ${activeWealthGoals.length === 0 ? '<div class="small">Nenhuma meta ativa. Configure em Configurações.</div>' : ''}
            ${topWealthGoals.map(g => {
        const boundedPct = Math.min(100, g.pct);
        const color = g.pct >= 100 ? '#27ae60' : (g.pct >= 80 ? '#2980b9' : '#f39c12');
        let alertHtml = '';
        if (!g.hasLinks) alertHtml = '<span title="Sem caixinhas" style="color:#d35400;">⚠️ Sem vínculo</span>';
        else if (g.pct >= 100) alertHtml = '<span title="Meta Concluída" style="color:#27ae60;">🏆 Concluída</span>';
        else if (g.pct >= 90) alertHtml = '<span title="Quase lá" style="color:#2980b9;">🚀 Quase lá</span>';

        return `
                <div style="margin-bottom:12px;">
                  <div style="display:flex; justify-content:space-between; font-size:0.9em; margin-bottom:2px;">
                    <strong>${esc(g.name)} ${alertHtml}</strong>
                    <span>R$ ${g.current.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} / ${(g.target).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div style="background:#ddd; height:8px; border-radius:4px; overflow:hidden;">
                    <div style="width:${boundedPct}%; background:${color}; height:100%;"></div>
                  </div>
                </div>
              `;
      }).join("")}
          </div>
        </div>

        <div class="card">
          <div><strong>Orçamentos (${currentMonth})</strong></div>
          <div style="margin-top:10px;">
            ${budgetProgress.length === 0 ? '<div class="small">Nenhum orçamento configurado.</div>' : ''}
            ${topBudgets.map(b => {
        const target = b.targetCents / 100;
        const spent = b.spent;
        const boundedPct = Math.min(100, b.pct);
        const color = b.pct >= 100 ? '#dc3545' : (b.pct >= 80 ? '#fd7e14' : '#28a745');
        const alertHtml = b.pct >= 100 ? '<span title="Estourado" style="color:#dc3545;">🚨</span>' : (b.pct >= 80 ? '<span title="Atenção" style="color:#fd7e14;">⚠️</span>' : '');
        return `
                <div style="margin-bottom:10px;">
                  <div style="display:flex; justify-content:space-between; font-size:0.9em; margin-bottom:2px;">
                    <strong>${alertHtml} ${esc(b.name)}</strong>
                    <span>R$ ${spent.toFixed(2)} / ${target.toFixed(2)} (${b.pct.toFixed(0)}%)</span>
                  </div>
                  <div style="background:#eee; height:8px; border-radius:4px; overflow:hidden;">
                    <div style="width:${boundedPct}%; background:${color}; height:100%;"></div>
                  </div>
                </div>
              `;
      }).join("")}
          </div>
          ${budgetProgress.length > 5 ? `<div class="small" style="text-align:center; color:#666; margin-top:5px;">Exibindo os 5 mais críticos de ${budgetProgress.length}.</div>` : ''}
        </div>

        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
             <strong>Despesas (Últ. 6 Meses)</strong>
             <button type="button" class="btn btn-secondary small" id="btnExportLine" style="padding:2px 6px; font-size:0.8em; cursor:pointer;">📥 Salvar PNG</button>
          </div>
          <div style="margin-top:10px; width:100%; overflow-x:auto;">
             <canvas id="homeLineChart" width="340" height="180" style="max-width:100%;"></canvas>
          </div>
        </div>
        
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
             <strong>Receitas x Despesas (${currentMonth})</strong>
             <button type="button" class="btn btn-secondary small" id="btnExportGrouped" style="padding:2px 6px; font-size:0.8em; cursor:pointer;">📥 Salvar PNG</button>
          </div>
          <div style="margin-top:10px; width:100%; text-align:center;">
             <canvas id="homeBarChart" width="300" height="180" style="max-width:100%;"></canvas>
          </div>
        </div>

      `;
    } catch (e) {
      console.error("Home Render Error", e);
      return `<div class="card error">Erro ao carregar Home: ${e.message}</div>`;
    }
  },
  tx: async () => await txScreen(),
  invoices: async () => await invoiceScreen(),
  import: async () => await importScreen(),
  settings: async () => await settingsScreen(),
  installments: async () => await installmentsScreen(),
  reports: async () => await reportsScreen(),
  bills: async () => await billsScreen(),
  loans: async () => await loansScreen(),
  "rejane-report": async () => await rejaneReportScreen(),
  "charts-report": async () => await chartsReportScreen(),
  "annual-report": async () => await annualReportScreen(),
  "monthly-close": async () => await monthlyCloseScreen(),
  search: async () => await searchScreen(),
  investments: async () => await investmentsScreen(),
  banks: async () => await banksScreen(),
  help: async () => await helpScreen()
};

// =========================================
// ROUTER (Single Source of Truth)
// =========================================
let currentTab = "";

async function setTab(tabKeyRaw) {
  const parts = tabKeyRaw.split("?");
  const tabKey = parts[0];
  const query = parts[1] || "";

  if (currentTab === tabKeyRaw) {
    // allow re-render
  }
  currentTab = tabKeyRaw;

  console.log("[ROUTER] Loading:", tabKeyRaw);

  tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === tabKey));
  const label = tabs.find(b => b.dataset.tab === tabKey)?.textContent ?? "FinanceApp";
  titleEl.textContent = label;

  viewEl.innerHTML = `<div class="card"><div class="small">Carregando...</div></div>`;

  try {
    const render = screens[tabKey] || (async () => "<div class='card'>Tela não encontrada</div>");
    const html = await render();
    viewEl.innerHTML = html;
    console.log("[ROUTER] Rendered HTML for:", tabKey);

    if (tabKey === "home" || tabKey === "") await wireHomeHandlers(viewEl);
    else if (tabKey === "settings") await wireSettingsHandlers(viewEl);
    else if (tabKey === "tx") await wireTxHandlers(viewEl);
    else if (tabKey === "invoices") await wireInvoiceHandlers(viewEl);
    else if (tabKey === "import") await wireImportHandlers(viewEl);
    else if (tabKey === "installments") await wireInstallmentsHandlers(viewEl);
    else if (tabKey === "reports") await wireReportsHandlers(viewEl);
    else if (tabKey === "bills") await wireBillsHandlers(viewEl);
    else if (tabKey === "loans") await wireLoansHandlers(viewEl);
    else if (tabKey === "rejane-report") await wireRejaneReportHandlers(viewEl);
    else if (tabKey === "charts-report") await wireChartsReportHandlers(viewEl);
    else if (tabKey === "annual-report") await wireAnnualReportHandlers(viewEl);
    else if (tabKey === "monthly-close") await wireMonthlyCloseHandlers(viewEl);
    else if (tabKey === "search") await wireSearchHandlers(viewEl);
    else if (tabKey === "investments") await wireInvestmentsHandlers(viewEl);
    else if (tabKey === "banks") await wireBanksHandlers(viewEl);

    console.log("[ROUTER] Handlers wired for:", tabKey);

  } catch (err) {
    console.error("[ROUTER ERROR]", err);
    viewEl.innerHTML = `
      <div class="card" style="border-left: 5px solid red;">
        <strong>Erro na tela!</strong><br/>
        <p>${err.message}</p>
          <br/><button class="btn btn-primary small" onclick="location.hash='#import'">Ir para Importação</button>
        </div>`;
  }
}

async function wireHomeHandlers(viewEl) {
  if (window.__homeChartsData) {
    const { evolutionData, incExpData, currentMonth } = window.__homeChartsData;

    setTimeout(() => {
      const lineCanvas = viewEl.querySelector("#homeLineChart");
      if (lineCanvas) {
        const lineHitboxes = drawLineChart(lineCanvas, evolutionData);

        lineCanvas.onclick = (e) => {
          if (!lineHitboxes) return;
          const pos = getCanvasClickPosition(lineCanvas, e);
          const hit = lineHitboxes.find(h => {
            const dist = Math.sqrt(Math.pow(pos.x - h.x, 2) + Math.pow(pos.y - h.y, 2));
            return dist <= Math.max(15, h.radius); // Give a good clickable area
          });
          if (hit && hit.data && hit.data.label) {
            location.hash = `#reports ? month = ${hit.data.label} `;
          }
        };

        lineCanvas.style.cursor = "pointer";

        const btn = viewEl.querySelector("#btnExportLine");
        if (btn) btn.onclick = () => exportChartToPNG(lineCanvas, `despesas_6meses_${Date.now()}.png`);
      }

      const barCanvas = viewEl.querySelector("#homeBarChart");
      if (barCanvas) {
        drawGroupedBarChart(barCanvas, incExpData);
        const btn = viewEl.querySelector("#btnExportBars");
        if (btn) btn.onclick = () => exportChartToPNG(barCanvas, `receitas_despesas_${currentMonth}_${Date.now()}.png`);
      }
    }, 50); // Small delay to allow the canvas to be visually placed in the DOM

    const btnExportPackHome = viewEl.querySelector("#btnExportPackHome");
    if (btnExportPackHome) {
      btnExportPackHome.onclick = async () => {
        const { prepareExportPack } = await import("./ui.js?v=2.1");
        await prepareExportPack();
      };
    }
  }
}

// =========================================
// PWA UPDATE UX (11C-3)
// =========================================
function showUpdateBanner(reg) {
  if (document.getElementById("pwa-update-banner")) return;

  const banner = document.createElement("div");
  banner.id = "pwa-update-banner";
  banner.style.position = "fixed";
  banner.style.left = "12px";
  banner.style.right = "12px";
  banner.style.bottom = "12px";
  banner.style.padding = "12px";
  banner.style.borderRadius = "12px";
  banner.style.background = "white";
  banner.style.border = "1px solid #ddd";
  banner.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)";
  banner.style.zIndex = "9999";
  banner.style.display = "flex";
  banner.style.alignItems = "center";
  banner.style.justifyContent = "space-between";
  banner.style.gap = "12px";

  banner.innerHTML = `
      <div style="font-size:14px; line-height:1.2;">
      <div style="font-weight:600;">Nova versão disponível</div>
      <div style="opacity:0.75;">Toque em “Atualizar agora” para aplicar.</div>
    </div>
      <button id="pwa-update-btn" class="btn btn-primary small">
        Atualizar agora
      </button>
    `;

  document.body.appendChild(banner);

  document.getElementById("pwa-update-btn").addEventListener("click", () => {
    if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  });
}

async function initServiceWorker() {
  // FORCE DISABLE SW
  return;
  if (!("serviceWorker" in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register("./sw.js");
    console.log("[SW] Registered:", reg.scope);

    // Se já existe uma versão nova "waiting", mostra o banner
    if (reg.waiting) showUpdateBanner(reg);

    // Quando detectar update baixando
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        // installed + controller => é UPDATE (não primeira instalação)
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateBanner(reg);
        }
      });
    });

    // Quando o novo SW assumir o controle, recarrega (após clicar “Atualizar agora”)
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });

  } catch (err) {
    console.warn("[SW] Registration failed:", err);
  }
}

// =========================================
// GLOBAL EVENTS (Delegation)
// =========================================

// 1. Click Handling (Navigation & Actions)
document.body.addEventListener("click", async (e) => {
  const navBtn = e.target.closest("[data-action='nav'], [data-hash], [data-tab]");
  if (navBtn) {
    if (navBtn.dataset.tab) {
      e.preventDefault();
      location.hash = "#" + navBtn.dataset.tab;
      return;
    }

    const hash = navBtn.dataset.hash || navBtn.getAttribute("href");
    if (hash && hash.startsWith("#")) {
      e.preventDefault();
      location.hash = hash;
      return;
    }
  }

  const btnDetails = e.target.closest("[data-action='open-budget-details']");
  if (btnDetails) {
    const tmplId = btnDetails.dataset.id;
    renderBudgetDetailsModal(tmplId);
    return;
  }

  if (e.target.matches("[data-del]")) {
    if (!confirm("Tem certeza que deseja excluir este item?")) return;
    const [store, id] = e.target.dataset.del.split(":");
    await remove(store, id);
    const screen = location.hash.replace("#", "") || "home";
    await setTab(screen);
  }
});

// 2. Hash Change Handling
window.addEventListener("hashchange", () => {
  const hash = location.hash.replace("#", "") || "home";
  setTab(hash);
});

// 3. Init
window.addEventListener("DOMContentLoaded", () => {
  const hash = location.hash.replace("#", "") || "home";
  setTab(hash);

  // PWA: registra SW após DOM estar pronto (banner usa document.body)
  initServiceWorker();
  runBackgroundMigrations();
});
