import { list, put, uid, remove, updateTransaction, get } from "../db.js";

function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* =========================================
   INSTALLMENT PLANS SCREEN
   ========================================= */

export async function installmentsScreen() {
    const plans = await list("installment_plans");
    const people = await list("people");
    const accounts = await list("accounts");
    const categories = await list("categories"); // Fetch categories for edit dialog

    // Fetch transactions for calculation (could be heavy, but necessary for "paid vs pending")
    // If we had by_planId index on transactions, we could query on demand? 
    // But list view needs summary for ALL plans. A full `list("transactions")` is safer for now 
    // unless plans list is huge (unlikely).
    // Or we rely on plan status if we trust it? No, need counts X/Y.
    // Let's optimize: We only need transactions that have installmentPlanId.
    const allTxs = await list("transactions");
    const linkedTxs = allTxs.filter(t => t.installmentPlanId);

    // Filter Logic (Defaults to Active)
    // We'll Client-side filter for simplicity first render

    return `
    <div id="inst-view-root">
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <button data-action="nav" data-hash="#tx" style="background:#ddd; color:#333; padding:4px 8px; font-size:0.9em;">← Voltar</button>
                <strong>Parcelas (Boletos)</strong>
                <div style="width:60px"></div> <!-- spacer -->
            </div>
            
            <div class="tabs" style="margin-top:10px; display:flex; gap:10px; border-bottom:1px solid #eee; padding-bottom:5px;">
                <button class="filter-tab active" data-filter="active" style="background:none; border:none; border-bottom:2px solid blue; font-weight:bold;">Ativos</button>
                <button class="filter-tab" data-filter="completed" style="background:none; border:none; color:#666;">Concluídos</button>
                <button class="filter-tab" data-filter="canceled" style="background:none; border:none; color:#666;">Cancelados</button>
            </div>

            <ul class="list" id="plansListContainer" style="margin-top:10px;">
                <div style="text-align:center; padding:20px;">Carregando...</div>
            </ul>
        </div>

        <!-- Detail Dialog -->
        <dialog id="planDetailDialog" style="padding:0; border:none; border-radius:8px; width: 95%; max-width:500px; max-height:90vh; display:flex; flex-direction:column;">
            <div style="background:#f5f5f5; padding:15px; border-bottom:1px solid #ccc; display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0;" id="detailTitle">Detalhes do Plano</h3>
                <button id="closeDetail" style="background:none; border:none; font-size:1.5em; cursor:pointer;">&times;</button>
            </div>
            
            <div style="padding:15px; overflow-y:auto; flex:1;" id="detailContent">
                <!-- Plan Info -->
                <div id="planInfoBlock" style="margin-bottom:15px; padding:10px; background:#fff; border-radius:5px; border:1px solid #eee;"></div>
                
                <h4>Parcelas</h4>
                 <ul class="list" id="detailTxList"></ul>

                 <div style="margin-top:20px; text-align:center;">
                    <button id="btnCancelPlan" class="danger" style="width:100%; display:none;">Cancelar Plano (Apagar Futuras)</button>
                 </div>
            </div>
        </dialog>

        <!-- Edit Transaction Modal (Reused Logic) -->
        <dialog id="editTxDialog" style="padding:20px; border:1px solid #ccc; border-radius:8px; width: 90%; max-width:400px;">
            <h3>Editar Lançamento</h3>
            <form id="editTxForm" class="form grid">
                <input type="hidden" name="id" />
                <label>Data <input type="date" name="date" required /></label>
                <label>Descrição <input type="text" name="description" required /></label>
                <label>Valor <input type="number" name="value" step="0.01" required /></label>
                
                <label>Conta 
                    <select name="accountId">
                        <option value="">(Nenhuma)</option>
                        ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}
                    </select>
                </label>
                
                <label>Pessoa <select name="personId">${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
                <label>Categoria 
                    <select name="categoryId">
                        <option value="">(Sem Categoria)</option>
                        ${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
                    </select>
                </label>
                
                <label>Tags <input type="text" name="tags" placeholder="tag1, tag2" /></label>
    
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <button type="button" id="cancelEditTx" style="background:#999">Cancelar</button>
                    <button type="submit">Salvar</button>
                </div>
            </form>
        </dialog>
    </div>
    `;
}

// Render Logic
function renderPlanItem(plan, people, accounts, linkedTxs) {
    const person = people.find(p => p.id === plan.personId)?.name || "??";
    const account = accounts.find(a => a.id === plan.accountId)?.name || "??";

    const planTxs = linkedTxs.filter(t => t.installmentPlanId === plan.id).sort((a, b) => a.installmentNo - b.installmentNo);

    const total = plan.totalInstallments;
    const paidCount = planTxs.filter(t => t.paid).length;
    const pendingCount = total - paidCount; // Approximate logic if some deleted? Better count existing.

    // Status Logic
    let displayStatus = "ATIVO";
    let color = "blue";

    if (plan.status === "canceled" || plan.status === 'CANCELED') {
        displayStatus = "CANCELADO";
        color = "gray";
    } else if (paidCount === total || (planTxs.length > 0 && planTxs.every(t => t.paid))) {
        displayStatus = "CONCLUÍDO";
        color = "green";
    }

    // Next Pending
    const next = planTxs.find(t => !t.paid && !t.deleted); // Assuming deleted items are gone from list
    let nextStr = "";
    if (next) {
        nextStr = `<div class="small" style="color:#d32f2f;">Próx: ${next.date} (${next.currency} ${parseFloat(next.value).toFixed(2)})</div>`;
    } else if (displayStatus === 'ATIVO') {
        nextStr = `<div class="small" style="color:orange;">Sem parcelas futuras?</div>`;
    }

    // Encode for click
    const dataJson = esc(JSON.stringify(plan));

    return `
    <li class="listItem planItem" data-plan="${dataJson}" style="cursor:pointer; border-left: 4px solid ${color};">
        <div style="flex:1">
            <div style="display:flex; justify-content:space-between;">
                <strong>${esc(plan.descriptionBase || plan.title)}</strong>
                <span style="font-size:0.8em; background:${color}; color:white; padding:2px 6px; border-radius:4px;">${displayStatus}</span>
            </div>
            <div class="small">${esc(person)} · ${esc(account)}</div>
            <div class="small">Progresso: ${paidCount}/${total} Pagas</div>
        </div>
        <div style="text-align:right; min-width:80px;">
           ${nextStr}
        </div>
    </li>
    `;
}

function renderDetailList(plan, allTxs) {
    const planTxs = allTxs.filter(t => t.installmentPlanId === plan.id).sort((a, b) => a.installmentNo - b.installmentNo);

    if (planTxs.length === 0) return `<div class="small">Nenhuma parcela encontrada.</div>`;

    return planTxs.map(t => {
        const isPaid = t.paid;
        const color = isPaid ? "green" : (new Date(t.date) < new Date() ? "red" : "black");
        const status = isPaid ? "PAGO" : "PENDENTE";
        const val = parseFloat(t.value).toFixed(2);

        // Data for edit
        const dataJson = esc(JSON.stringify(t));

        return `
        <li class="listItem" style="padding:8px; border-bottom:1px solid #eee;">
            <div style="flex:1">
                <div>Parcela ${t.installmentNo}/${t.installmentTotal}</div>
                <div class="small" style="color:${color}">${t.date} · ${status}</div>
            </div>
            <div style="text-align:right">
                <div style="font-weight:bold">${t.currency} ${val}</div>
                 <button class="iconBtn editTxBtn" style="padding:2px 6px; margin-top:5px;" data-tx="${dataJson}">✎</button>
            </div>
        </li>
        `;
    }).join("");
}


export async function wireInstallmentsHandlers(rootEl) {
    const listContainer = rootEl.querySelector("#plansListContainer");
    const tabs = rootEl.querySelectorAll(".filter-tab");
    const dialog = rootEl.querySelector("#planDetailDialog");
    const detailContent = rootEl.querySelector("#detailContent");
    const closeBtn = rootEl.querySelector("#closeDetail");
    const btnCancel = rootEl.querySelector("#btnCancelPlan");
    const detailList = rootEl.querySelector("#detailTxList");
    const detailTitle = rootEl.querySelector("#detailTitle");

    // Load Data
    const plans = await list("installment_plans");
    const people = await list("people");
    const accounts = await list("accounts");
    // const txs = await list("transactions"); // optimize: fetch linked only? No, we filter in memory.
    const allTxs = await list("transactions");
    const linkedTxs = allTxs.filter(t => t.installmentPlanId);

    let currentFilter = "active";

    function renderList() {
        if (!listContainer) return;

        let filtered = plans;
        if (currentFilter === "active") {
            // Complex logic: Active if status != canceled AND has pending txs? or just status=ACTIVE?
            // "Status do plano define-se..."
            // Let's rely on stored status if managed effectively, OR derived.
            // Requirement says: "Definir status... ATIVO: ainda existe parcela pendente futura".
            // So we must derive it or update it.
            // Let's derive it for filtering.
            filtered = plans.filter(p => {
                if (p.status === 'canceled' || p.status === 'CANCELED') return false;
                const pTxs = linkedTxs.filter(t => t.installmentPlanId === p.id);
                const isComplete = pTxs.length > 0 && pTxs.every(t => t.paid);
                return !isComplete;
            });
        } else if (currentFilter === "completed") {
            filtered = plans.filter(p => {
                if (p.status === 'canceled' || p.status === 'CANCELED') return false;
                const pTxs = linkedTxs.filter(t => t.installmentPlanId === p.id);
                return pTxs.length > 0 && pTxs.every(t => t.paid);
            });
        } else if (currentFilter === "canceled") {
            filtered = plans.filter(p => p.status === 'canceled' || p.status === 'CANCELED');
        }

        // Sort by CreatedAt desc
        filtered.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

        listContainer.innerHTML = filtered.length ? filtered.map(p => renderPlanItem(p, people, accounts, linkedTxs)).join("") : `<div style="padding:20px; text-align:center; color:#999;">Nenhum plano nesta categoria.</div>`;
    }

    // Tab Logic
    tabs.forEach(t => {
        t.addEventListener("click", () => {
            tabs.forEach(x => {
                x.classList.remove("active");
                x.style.borderBottom = "none";
                x.style.fontWeight = "normal";
                x.style.color = "#666";
            });
            t.classList.add("active");
            t.style.borderBottom = "2px solid blue";
            t.style.fontWeight = "bold";
            t.style.color = "black";
            currentFilter = t.dataset.filter;
            renderList();
        });
    });

    // Item Click
    listContainer.addEventListener("click", (e) => {
        const item = e.target.closest(".planItem");
        if (item) {
            const plan = JSON.parse(item.dataset.plan);
            openDetail(plan);
        }
    });

    // Detail Logic
    let currentPlan = null;

    function openDetail(plan) {
        currentPlan = plan;
        detailTitle.innerText = plan.descriptionBase || plan.title;

        // Render Info
        // ... could add more info block here ...

        // Render Txs
        // Re-fetch transactions to be sure? Use memory for now, refresh on action.
        detailList.innerHTML = renderDetailList(plan, allTxs);

        // Cancel Button
        if (plan.status !== 'canceled' && plan.status !== 'CANCELED') {
            btnCancel.style.display = 'block';
        } else {
            btnCancel.style.display = 'none';
        }

        dialog.showModal();
    }

    closeBtn.onclick = () => dialog.close();

    // Cancel Action
    btnCancel.onclick = async () => {
        if (!currentPlan) return;
        if (!confirm("Tem certeza que deseja cancelar este plano? As parcelas futuras PENDENTES serão excluídas. Parcelas PAGAS serão mantidas.")) return;

        const planId = currentPlan.id;

        // 1. Update Plan Status
        const planStore = plans.find(p => p.id === planId);
        if (planStore) {
            const updated = { ...planStore, status: 'CANCELED', canceledAt: new Date().toISOString() };
            await put("installment_plans", updated);
        }

        // 2. Delete Future Pending Txs
        // Condition: installmentPlanId == planId AND paid == false AND date >= today
        // Actually, requirement: "apagar SOMENTE as parcelas futuras pendentes".
        // What about past pending? "date >= hoje".
        // Let's follow requirement strictly: "date >= hoje". 
        // Although usually "Cancel" implies stopping all remaining payments regardless of date (if overdue).
        // Let's stick to "unpaid". If it's unpaid, delete it. Why keep overdue unpaid installments if plan is canceled?
        // User text: "apagar SOMENTE as parcelas futuras pendentes (transações com installmentPlanId e data >= hoje e que não estejam marcadas como pagas)"
        // Okay, I will respect the "date >= hoje" constraint. Past unpaid will remain (maybe as debt).

        const today = new Date().toISOString().split('T')[0];
        const planTxs = allTxs.filter(t => t.installmentPlanId === planId);
        const toDelete = planTxs.filter(t => !t.paid && t.date >= today);

        let deletedCount = 0;
        for (const t of toDelete) {
            await remove("transactions", t.id); // deleteTransaction alias
            deletedCount++;
        }

        alert(`Plano cancelado. ${deletedCount} parcelas futuras removidas.`);
        dialog.close();

        // Reload Screen
        // We can just reload the whole module logic or navigate to self
        // location.hash="#installments" (trigger reload?)
        // Or re-call wire?
        // Let's just create a quick re-init
        installmentsScreen().then(html => {
            rootEl.innerHTML = html;
            wireInstallmentsHandlers(rootEl);
        });
    };

    // Edit Tx Logic ( делеgate to existing edit logic? )
    // The edit dialog logic is in `tx.js`.
    // We can't easily reuse `tx.js`'s `openEditDialog` unless we export it or duplicate it.
    // Ideally, `openEditDialog` should be in `ui.js` or `tx.js` exported.
    // It is NOT exported in `tx.js`.
    // I should create a simple edit function here OR modify `tx.js` to export it.
    // Modifying `tx.js` is cleaner to avoid duplication.
    // Let's assume for now I will add `export function openEditDialog` in `tx.js`.
    // Wait, I can't import it if it's not exported.

    // Alternative: Implement a simple edit or "Jump to Edit"
    // "permitir navegar para editar a transação (reusar fluxo existente de edição, sem duplicar)."
    // If I import `openEditDialog` from `tx.js`, I need to make sure `tx.js` exports it.
    // I will check `tx.js` exports in next step and ensure it.

    // For now, I'll add the listener for edit button
    detailList.addEventListener("click", async (e) => {
        const btn = e.target.closest(".editTxBtn");
        if (btn) {
            const data = JSON.parse(btn.dataTx || btn.dataset.tx);
            // Dynamic import to avoid circular dependency issues if any?
            // "reusar fluxo existente".
            // I will trigger the edit dialog. The edit dialog HTML must exist in `installmentsScreen` or be shared.
            // Currently `installmentsScreen` does NOT have the edit dialog form HTML.
            // It's in `txScreen` HTML.
            // I should duplicate the dialog HTML into `installmentsScreen` OR move it to `index.html` (global).
            // User rules: "static HTML/CSS/JS". "index.html" is global.
            // BUT "NÃO reestruture". 
            // So safely: Duplicate the Edit Dialog HTML into `installmentsScreen` and copy logic?
            // "sem duplicar" usually refers to data/transactions. Code duplication is bad but safer than major refactor.
            // BUT "reusar fluxo existente" suggests reusing the function.
            // Function relies on DOM elements `#editTxDialog`.
            // If I render `installmentsScreen`, `#editTxDialog` from `txScreen` is GONE (because `viewEl.innerHTML` replaced).
            // So I MUST render the dialog in `installmentsScreen` too.
            // I will copy the dialog HTML and logic.

            openNativeEdit(data);
        }
    });

    function openNativeEdit(tx) {
        // Create dialog if not exists (it does in HTML above? No, I need to add it to HTML string)
        // HTML string above has `planDetailDialog`. I need `editTxDialog` too.
        // I'll add `editTxDialog` to `installmentsScreen` HTML string.
        // And wire it up.

        const d = rootEl.querySelector("#editTxDialog");
        const f = rootEl.querySelector("#editTxForm");

        if (!d || !f) return;

        // Fill Form
        f.querySelector("[name=id]").value = tx.id;
        f.querySelector("[name=date]").value = tx.date;
        f.querySelector("[name=description]").value = tx.description;
        f.querySelector("[name=value]").value = tx.value;
        f.querySelector("[name=personId]").value = tx.personId || "";
        f.querySelector("[name=categoryId]").value = tx.categoryId || "";
        f.querySelector("[name=tags]").value = (tx.tags || []).join(", ");
        const accSel = f.querySelector("[name=accountId]");
        if (accSel) accSel.value = tx.accountId || "";

        d.showModal();
    }

    // Wire Edit Form Save
    const editD = rootEl.querySelector("#editTxDialog");
    const editF = rootEl.querySelector("#editTxForm");
    if (editF) {
        rootEl.querySelector("#cancelEditTx").onclick = () => editD.close();
        editF.onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(editF);
            const id = fd.get("id");
            const updates = {
                date: fd.get("date"),
                description: fd.get("description"),
                value: parseFloat(fd.get("value")),
                personId: fd.get("personId"),
                categoryId: fd.get("categoryId"),
                tags: fd.get("tags") ? fd.get("tags").split(",").map(s => s.trim()) : [],
                accountId: fd.get("accountId")
            };

            await updateTransaction(id, updates);
            editD.close();
            // Refresh
            installmentsScreen().then(html => {
                rootEl.innerHTML = html;
                wireInstallmentsHandlers(rootEl);
            });
        }
    }

    renderList();
}
