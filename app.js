import { list, put, remove } from "./db.js";
import { settingsScreen, wireSettingsHandlers } from "./ui.js";
import { txScreen, wireTxHandlers } from "./screens/tx.js";
import { invoiceScreen, wireInvoiceHandlers } from "./screens/invoice.js";
import { importScreen, wireImportHandlers } from "./screens/import.js";
import { installmentsScreen, wireInstallmentsHandlers } from "./screens/installments.js";
import { reportsScreen, wireReportsHandlers } from "./screens/reports.js";
import { billsScreen, wireBillsHandlers } from "./screens/bills.js?v=1.0";
import { loansScreen, wireLoansHandlers } from "./screens/loans.js";
import { rejaneReportScreen, wireRejaneReportHandlers } from "./screens/rejaneReport.js";
import { searchScreen, wireSearchHandlers } from "./screens/search.js";
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
    alert("Erro na migração de metas: " + e.message);
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

      return `
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

        <div class="card">
          <div><strong>Atalhos Rápidos</strong></div>
          <div style="margin-top:10px; margin-bottom:10px;">
            <button data-action="nav" data-hash="#search" style="width:100%; background:#e83e8c; color:white; padding:12px; font-weight:bold; font-size:1.1em;">🔍 Busca Avançada</button>
          </div>
          <div class="grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <button data-action="nav" data-hash="#reports" style="background:#007bff; color:white;">📊 Painel / Relatórios</button>
            <button data-action="nav" data-hash="#tx">Novo Lançamento</button>
            <button data-action="nav" data-hash="#import">Importar Planilha</button>
            <button data-action="nav" data-hash="#invoices" style="background:#6c757d; color:white;">Ver Faturas</button>
            <button data-action="nav" data-hash="#settings" style="background:#555; color:white; grid-column: span 2;">Configurações</button>
          </div>
        </div>
        
        <div class="card" style="border: 1px solid #17a2b8;">
          <div style="color:#17a2b8;"><strong>Contas a Pagar</strong></div>
          <div class="grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
            <button data-action="nav" data-hash="#bills" style="background:#17a2b8; color:white;">📅 Mês Atual</button>
            <button data-action="nav" data-hash="#bills?next" style="background:#fff; color:#17a2b8; border:1px solid #17a2b8;">➡️ Próximos 30 Dias</button>
          </div>
        </div>

        <div class="card" style="border: 1px solid #28a745; margin-top:10px;">
          <div style="color:#28a745;"><strong>Dívidas & Empréstimos</strong></div>
          <div class="grid" style="display:grid; grid-template-columns: 1fr; gap:10px; margin-top:10px;">
            <button data-action="nav" data-hash="#loans" style="background:#28a745; color:white; padding:10px;">🤝 Controle de Dívidas</button>
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
  search: async () => await searchScreen()
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

    if (tabKey === "settings") await wireSettingsHandlers(viewEl);
    else if (tabKey === "tx") await wireTxHandlers(viewEl);
    else if (tabKey === "invoices") await wireInvoiceHandlers(viewEl);
    else if (tabKey === "import") await wireImportHandlers(viewEl);
    else if (tabKey === "installments") await wireInstallmentsHandlers(viewEl);
    else if (tabKey === "reports") await wireReportsHandlers(viewEl);
    else if (tabKey === "bills") await wireBillsHandlers(viewEl);
    else if (tabKey === "loans") await wireLoansHandlers(viewEl);
    else if (tabKey === "rejane-report") await wireRejaneReportHandlers(viewEl);
    else if (tabKey === "search") await wireSearchHandlers(viewEl);

    console.log("[ROUTER] Handlers wired for:", tabKey);

  } catch (err) {
    console.error("[ROUTER ERROR]", err);
    viewEl.innerHTML = `
      <div class="card" style="border-left: 5px solid red;">
        <strong>Erro na tela!</strong><br/>
        <p>${err.message}</p>
        <button onclick="location.hash='#home'">Voltar Home</button>
      </div>
    `;
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
    <button id="pwa-update-btn" style="padding:10px 12px; border-radius:10px; border:1px solid #ccc; cursor:pointer; background:#f7f7f7;">
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
});
