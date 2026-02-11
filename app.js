import { list, put, remove } from "./db.js";
import { settingsScreen, wireSettingsHandlers } from "./ui.js";
import { txScreen, wireTxHandlers } from "./screens/tx.js";
import { invoiceScreen, wireInvoiceHandlers } from "./screens/invoice.js";
import { importScreen, wireImportHandlers } from "./screens/import.js";
import { installmentsScreen, wireInstallmentsHandlers } from "./screens/installments.js";

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
  // Optional: showing a small toast instead of alert for non-critical
  const toast = document.createElement("div");
  toast.style.cssText = "position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:rgba(255,0,0,0.9); color:white; padding:10px 20px; border-radius:5px; z-index:9999; font-size:14px;";
  toast.innerText = "Erro: " + msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
  return false; // let default handler run too
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
        // If target differs from baseline, override it.
        // Note: if user changed target back and forth, overrides capture it.
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

        const effRevs = revisions.filter(r => r.templateId === tmplId && r.effectiveFromMonth <= month)
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

          // Scope Logic
          if (g.scopeType === "tag") {
            // Tag Match (Case Insensitive)
            if (!t.tags || !Array.isArray(t.tags)) return false;
            const targetTag = (g.scopeValue || "").toLowerCase();
            return t.tags.some(tag => tag.toLowerCase() === targetTag);
          } else {
            // Category Match (Default)
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
        <div><strong>Atalhos</strong></div>
        <div class="grid" style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; margin-top:10px;">
            <button data-action="nav" data-hash="#tx">Novo Lançamento</button>
            <button data-action="nav" data-hash="#invoices">Ver Faturas</button>
            <button data-action="nav" data-hash="#import">Importar</button>
            <button data-action="nav" data-hash="#settings">Configurações</button>
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
  installments: async () => await installmentsScreen()
};

// =========================================
// ROUTER (Single Source of Truth)
// =========================================
let currentTab = "";

async function setTab(tabKey) {
  if (currentTab === tabKey) {
    // Optional: force refresh? For now, allow re-render.
  }
  currentTab = tabKey;

  console.log("[ROUTER] Loading:", tabKey);

  // UI Updates
  tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === tabKey));
  const label = tabs.find(b => b.dataset.tab === tabKey)?.textContent ?? "FinanceApp";
  titleEl.textContent = label;

  viewEl.innerHTML = `<div class="card"><div class="small">Carregando...</div></div>`;

  try {
    const render = screens[tabKey] || (async () => "<div class='card'>Tela não encontrada</div>");
    const html = await render();
    viewEl.innerHTML = html;
    console.log("[ROUTER] Rendered HTML for:", tabKey);

    // Wire Handlers (Safe Wrappers)
    if (tabKey === "settings") await wireSettingsHandlers(viewEl);
    else if (tabKey === "tx") await wireTxHandlers(viewEl);
    else if (tabKey === "invoices") await wireInvoiceHandlers(viewEl);
    else if (tabKey === "import") await wireImportHandlers(viewEl);
    else if (tabKey === "installments") await wireInstallmentsHandlers(viewEl);

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
// GLOBAL EVENTS (Delegation)
// =========================================

// 1. Click Handling (Navigation & Actions)
document.body.addEventListener("click", async (e) => {
  // A. Navigation (data-action="nav" or data-hash)
  const navBtn = e.target.closest("[data-action='nav'], [data-hash], [data-tab]");
  if (navBtn) {
    // 1. data-tab support (Bottom Nav)
    if (navBtn.dataset.tab) {
      e.preventDefault();
      location.hash = "#" + navBtn.dataset.tab;
      return;
    }

    // 2. data-action="nav" support (Shortcuts)
    const hash = navBtn.dataset.hash || navBtn.getAttribute("href");
    if (hash && hash.startsWith("#")) {
      e.preventDefault();
      location.hash = hash;
      return;
    }
  }

  // B. Delete Generic (data-del)
  if (e.target.matches("[data-del]")) {
    if (!confirm("Tem certeza que deseja excluir este item?")) return;
    const [store, id] = e.target.dataset.del.split(":");
    await remove(store, id);
    // Refresh current screen
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
});
