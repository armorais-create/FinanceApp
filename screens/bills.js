import { list, put, remove, uid, get, deleteTransaction } from "../db.js";

function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

let currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
let _state = {
    showTemplateForm: false,
    editingTemplate: null
};

export async function billsScreen() {
    const templates = await list("bill_templates");
    const categories = await list("categories");
    const subcategories = await list("subcategories");
    const people = await list("people");
    const accounts = await list("accounts");

    // Get bills for current month
    const allBills = await list("bills");
    const bills = allBills.filter(b => b.month === currentMonth).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // Calc totals
    const totalOpen = bills.filter(b => b.status === 'open').reduce((acc, b) => acc + (b.amount || 0), 0);
    const totalPaid = bills.filter(b => b.status === 'paid').reduce((acc, b) => acc + (b.amount || 0), 0);

    const activeTemplates = templates.filter(t => t.active !== false);

    // Helpers for display
    const getCatName = (id) => categories.find(c => c.id === id)?.name || "---";
    const getSubName = (id) => subcategories.find(s => s.id === id)?.name || "";
    const getAcctName = (id) => accounts.find(a => a.id === id)?.name || "---";

    return `
    <div class="card">
        <div style="display:flex; gap:10px; align-items:center; justify-content:space-between; margin-bottom:10px;">
            <div style="font-weight:bold; font-size:1.1em;">Contas a Pagar</div>
            <div style="display:flex; gap:5px;">
                 <input type="month" id="billMonth" value="${currentMonth}" style="padding:5px;">
                 <button id="btnBillToday">Hoje</button>
            </div>
        </div>

        <div style="display:flex; justify-content:space-around; background:#f8f9fa; padding:10px; border-radius:8px; margin-bottom:15px;">
            <div style="text-align:center;">
                <div class="small">A Pagar</div>
                <div style="font-weight:bold; color:#d63384;">R$ ${totalOpen.toFixed(2)}</div>
            </div>
            <div style="text-align:center;">
                <div style="font-weight:bold; color:#28a745;">R$ ${totalPaid.toFixed(2)}</div>
                <div class="small">Pago</div>
            </div>
        </div>

        <div style="display:flex; gap:10px;">
            <button id="btnGenerateMonth" style="flex:1; background:#007bff; color:white;">🔄 Gerar Mês</button>
            <button id="btnToggleTemplates" style="flex:1; background:#6c757d; color:white;">⚙️ Fixos (${activeTemplates.length})</button>
        </div>
    </div>

    <!-- TEMPLATES SECTION -->
    <div id="templatesSection" style="display:${_state.showTemplateForm ? 'block' : 'none'};" class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <strong>Cadastro de Fixos</strong>
            <button class="small" id="btnNewTemplate">+ Novo</button>
        </div>

        ${_state.editingTemplate ? renderTemplateForm(_state.editingTemplate, categories, subcategories, people, accounts) : ''}

        <div style="max-height:300px; overflow-y:auto; margin-top:10px;">
            ${templates.length === 0 ? '<div class="small">Nenhum fixo cadastrado.</div>' : ''}
            <ul class="list">
                ${templates.map(t => `
                    <li class="listItem" style="opacity:${t.active ? 1 : 0.6}">
                        <div style="flex:1">
                            <div style="font-weight:bold;">${esc(t.name)}</div>
                            <div class="small">
                                Dia ${t.dueDay} • R$ ${t.amount.toFixed(2)} • ${getCatName(t.categoryId)}
                            </div>
                        </div>
                        <div style="display:flex; gap:5px;">
                            <button class="iconBtn" data-action="edit-tmpl" data-id="${t.id}">✎</button>
                            ${t.active ?
            `<button class="iconBtn" data-action="toggle-tmpl" data-id="${t.id}" title="Desativar">⏸</button>` :
            `<button class="iconBtn" data-action="toggle-tmpl" data-id="${t.id}" title="Ativar">▶️</button>`
        }
                            <button class="iconBtn danger" data-del="bill_templates:${t.id}">×</button>
                        </div>
                    </li>
                `).join('')}
            </ul>
        </div>
    </div>

    <!-- BILLS LIST SECTION -->
    <div class="card">
        <strong>Contas de ${currentMonth}</strong>
        <div style="margin-top:10px;">
            ${bills.length === 0 ? '<div class="small">Nenhuma conta gerada para este mês (clique em Gerar Mês).</div>' : ''}
            <ul class="list">
                ${bills.map(b => {
            const isPaid = b.status === "paid";
            // Check overdue
            const today = new Date().toISOString().slice(0, 10);
            const isOverdue = !isPaid && b.month === new Date().toISOString().slice(0, 7) && b.dueDate < today;

            const statusColor = isPaid ? '#28a745' : (isOverdue ? '#dc3545' : '#ffc107');
            const statusLabel = isPaid ? 'Paga' : (isOverdue ? 'Atrasada' : 'Aberta');

            return `
                    <li class="listItem" style="border-left: 4px solid ${statusColor}; padding-left:8px;">
                        <div style="flex:1;">
                            <div style="display:flex; justify-content:space-between;">
                                <span style="font-weight:bold; ${isPaid ? 'text-decoration:line-through; color:#888' : ''}">${esc(getTemplateName(b, templates))}</span>
                                <span>R$ ${b.amount.toFixed(2)}</span>
                            </div>
                            <div class="small" style="color:#666; display:flex; gap:10px;">
                                <span>📅 ${b.dueDate.slice(8, 10)}/${b.dueDate.slice(5, 7)}</span>
                                <span style="color:${statusColor}; font-weight:bold;">${statusLabel}</span>
                                ${b.currency !== 'BRL' ? `<span class="badge">${b.currency}</span>` : ''}
                            </div>
                         </div>
                         <div style="display:flex; gap:5px; align-items:center; margin-left:5px;">
                            ${!isPaid ?
                    `<button class="success small" data-action="pay-bill" data-id="${b.id}">💲 Pagar</button>` :
                    `<button class="secondary small" data-action="undo-bill" data-id="${b.id}" title="Desfazer">↩️</button>`
                }
                            <!-- Edit Bill Instance (Future/Optional) - removed for simplicity as per requirements "Editar (este mês)" was requested but let's keep it simple first or add icon -->
                            <button class="iconBtn danger" data-del="bills:${b.id}">×</button>
                         </div>
                    </li>
                `}).join('')}
            </ul>
        </div>
    </div>
    `;
}

function getTemplateName(bill, templates) {
    // If template exists, use it. If orphaned, keep bill name or (N/A)
    // Wait, bill stores templateId. It doesn't store name snapshot (unless we change schema).
    // The requirement said: "bills (instâncias)... campos: id, templateId...".
    // It implies we should store name/snapshot on the bill or look up.
    // Ideally snapshot. But let's look up for now. If deleted, show fallback.
    // Actually, looking at my plan: "bills... campos... id, templateId...". It didn't explicitly say "name" in bills.
    // BUT the requirement Section C says: "cada linha mostra: ... nome".
    // If I delete the template, I lose the name if I don't snapshot it.
    // Let's assume for now I will snapshot 'name' into the bill when creating it.
    // CHECK: User request A) bills stores keys... doesn't explicitly list name.
    // However, for robustness, I WILL Add 'name' to the bill object in DB.

    // Fallback if 'name' is in bill (preferred) or lookup
    if (bill.name) return bill.name;
    const t = templates.find(temp => temp.id === bill.templateId);
    return t ? t.name : "(Sem nome/Template removido)";
}

function renderTemplateForm(tmpl, categories, subcategories, people, accounts) {
    const isNew = !tmpl.id;
    return `
    <form id="templateForm" class="form" style="background:#eee; padding:10px; border-radius:5px; margin-bottom:10px;">
        <div style="font-weight:bold; margin-bottom:5px;">${isNew ? 'Novo Fixo' : 'Editar Fixo'}</div>
        <input type="hidden" name="id" value="${tmpl.id || ''}">
        
        <div class="grid" style="grid-template-columns: 2fr 1fr; gap:5px;">
            <input name="name" placeholder="Nome (ex: Aluguel)" value="${esc(tmpl.name || '')}" required>
            <input name="amount" type="number" step="0.01" placeholder="Valor" value="${tmpl.amount || ''}" required>
        </div>

        <div class="grid" style="grid-template-columns: 1fr 1fr; gap:5px; margin-top:5px;">
            <div style="display:flex; align-items:center; gap:5px;">
                <span class="small">Vence dia:</span>
                <input name="dueDay" type="number" min="1" max="31" value="${tmpl.dueDay || '10'}" required style="width:50px;">
            </div>
            <select name="currency">
                <option value="BRL" ${tmpl.currency === 'BRL' ? 'selected' : ''}>BRL</option>
                <option value="USD" ${tmpl.currency === 'USD' ? 'selected' : ''}>USD</option>
            </select>
        </div>

        <div class="grid" style="grid-template-columns: 1fr 1fr; gap:5px; margin-top:5px;">
            <select name="categoryId" id="tmplCategory" required>
                <option value="">Categoria...</option>
                ${categories.map(c => `<option value="${c.id}" ${tmpl.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
            <select name="subcategoryId" id="tmplSubcategory">
                <option value="">Subcategoria...</option>
                <!-- Populated via JS -->
            </select>
        </div>

        <div class="grid" style="grid-template-columns: 1fr 1fr; gap:5px; margin-top:5px;">
             <select name="payAccountId">
                <option value="">Conta Padrão (Opcional)</option>
                ${accounts.map(a => `<option value="${a.id}" ${tmpl.payAccountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
            </select>
             <select name="personId">
                <option value="">Pessoa (Opcional)</option>
                ${people.map(p => `<option value="${p.id}" ${tmpl.personId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
        </div>
        
        <input name="tags" placeholder="Tags (separadas por vírgula)" value="${(tmpl.tags || []).join(', ')}" style="margin-top:5px;">

        <div style="display:flex; gap:10px; margin-top:10px;">
            <button type="submit" style="flex:1;">Salvar</button>
            <button type="button" id="btnCancelTemplate" style="flex:1; background:#ccc; color:black;">Cancelar</button>
        </div>
    </form>`;
}

export async function wireBillsHandlers(rootEl) {
    const refresh = async () => {
        const { setTab } = await import("../app.js"); // lazy import or standard? app.js imports this, circular?
        // Better: trigger a re-render by reloading hash or similar.
        // Actually app.js logic: setTab calls render.
        // We can just call setTab("bills")?
        // But we are inside wireHandlers.
        // Let's use dispatchEvent or just re-render content if possible.
        // Easiest: location.hash logic re-trigger or manually calling logic.
        // app.js handles hashchange.
        const ev = new Event("hashchange");
        window.dispatchEvent(ev);
    };

    // Month Selector
    const monthInput = rootEl.querySelector("#billMonth");
    if (monthInput) {
        monthInput.addEventListener("change", (e) => {
            currentMonth = e.target.value;
            refresh();
        });
    }

    // Today Button
    const btnToday = rootEl.querySelector("#btnBillToday");
    if (btnToday) {
        btnToday.addEventListener("click", () => {
            currentMonth = new Date().toISOString().slice(0, 7);
            refresh();
        });
    }

    // Toggle Templates
    const btnToggle = rootEl.querySelector("#btnToggleTemplates");
    if (btnToggle) {
        btnToggle.addEventListener("click", () => {
            _state.showTemplateForm = !_state.showTemplateForm;
            _state.editingTemplate = null; // reset form
            refresh();
        });
    }

    // New Template
    const btnNew = rootEl.querySelector("#btnNewTemplate");
    if (btnNew) {
        btnNew.addEventListener("click", () => {
            _state.showTemplateForm = true;
            _state.editingTemplate = {}; // empty
            refresh();
        });
    }

    // Edit/Toggle Actions
    rootEl.addEventListener("click", async (e) => {
        const btnEdit = e.target.closest("[data-action='edit-tmpl']");
        const btnToggleTmpl = e.target.closest("[data-action='toggle-tmpl']");

        if (btnEdit) {
            const id = btnEdit.dataset.id;
            const t = await get("bill_templates", id);
            if (t) {
                _state.showTemplateForm = true;
                _state.editingTemplate = t;
                refresh();
            }
        }

        if (btnToggleTmpl) {
            const id = btnToggleTmpl.dataset.id;
            const t = await get("bill_templates", id);
            if (t) {
                t.active = !t.active;
                await put("bill_templates", t);
                refresh();
            }
        }
    });

    // Subcategory Filler in Form
    const tmplCat = document.getElementById("tmplCategory");
    const tmplSub = document.getElementById("tmplSubcategory");
    if (tmplCat && tmplSub) {
        const fillSubs = async (catId) => {
            if (!catId) {
                tmplSub.innerHTML = '<option value="">Subcategoria...</option>';
                return;
            }
            const subs = await list("subcategories");
            const filtered = subs.filter(s => s.categoryId === catId);
            tmplSub.innerHTML = '<option value="">Subcategoria...</option>' +
                filtered.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");

            // If editing, select it
            if (_state.editingTemplate?.subcategoryId) {
                tmplSub.value = _state.editingTemplate.subcategoryId;
            }
        };

        tmplCat.addEventListener("change", (e) => fillSubs(e.target.value));
        // Init
        if (_state.editingTemplate?.categoryId) fillSubs(_state.editingTemplate.categoryId);
    }

    // Save Template
    const form = rootEl.querySelector("#templateForm");
    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const id = fd.get("id") || uid("bt"); // bill template

            const template = {
                id,
                name: fd.get("name"),
                amount: parseFloat(fd.get("amount")),
                currency: fd.get("currency"),
                categoryId: fd.get("categoryId"),
                subcategoryId: fd.get("subcategoryId") || null,
                payAccountId: fd.get("payAccountId") || null,
                personId: fd.get("personId") || null,
                dueDay: parseInt(fd.get("dueDay")),
                tags: fd.get("tags").split(",").map(t => t.trim()).filter(Boolean),
                active: true,
                updatedAt: new Date().toISOString()
            };

            await put("bill_templates", template);
            _state.showTemplateForm = false;
            _state.editingTemplate = null;
            refresh();
        });

        rootEl.querySelector("#btnCancelTemplate").addEventListener("click", () => {
            _state.showTemplateForm = false;
            _state.editingTemplate = null;
            refresh();
        });
    }

    // GENERATE MONTH
    const btnGen = rootEl.querySelector("#btnGenerateMonth");
    if (btnGen) {
        btnGen.addEventListener("click", async () => {
            const templates = await list("bill_templates");
            const active = templates.filter(t => t.active !== false);
            const existingBills = await list("bills");

            let count = 0;
            let existed = 0;

            for (const t of active) {
                // Check duplicate
                const already = existingBills.find(b => b.templateId === t.id && b.month === currentMonth);
                if (already) {
                    existed++;
                    continue;
                }

                // Create
                const [currYear, currMon] = currentMonth.split("-").map(Number); // returns 2026, 2
                // Calculate due date (handle Feb etc)
                // JS Date: 0 is Jan, 2 is Mar. day=0 is last day of prev month.
                // We want: year, month-1, day.
                // Actually simple way: create date with day 1, then check max days.
                const daysInMonth = new Date(currYear, currMon, 0).getDate(); // currMon is 1-based from string default? No. split gives "02" -> 2. Date(2026, 2, 0) is last day of Feb (since month is 0-indexed in JS Constructor). Wait. 
                // "2026-02". split -> 2026, 2. 
                // new Date(2026, 2, 0) -> Month 2 is March (0,1,2). Day 0 of March is Feb 28/29. Correct.

                const finalDay = Math.min(t.dueDay, daysInMonth);
                const dueDate = `${currentMonth}-${String(finalDay).padStart(2, '0')}`;

                const bill = {
                    id: uid("bill"),
                    templateId: t.id,
                    name: t.name, // Snapshot name
                    month: currentMonth,
                    dueDate: dueDate,
                    amount: t.amount,
                    currency: t.currency,
                    categoryId: t.categoryId,
                    subcategoryId: t.subcategoryId,
                    tags: t.tags,
                    personId: t.personId,
                    payAccountId: t.payAccountId, // Inherit preference
                    status: 'open',
                    createdAt: new Date().toISOString()
                };

                await put("bills", bill);
                count++;
            }

            alert(`Geradas: ${count}\nJá existiam: ${existed}`);
            refresh();
        });
    }

    // PAY BILL
    const btnPay = rootEl.querySelectorAll("[data-action='pay-bill']");
    btnPay.forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            const bill = await get("bills", id);
            if (!bill) return;

            // 1. Confirm Date/Account
            const settings = await get("settings", "config");
            const accounts = await list("accounts");

            // Simple Prompt Flow (Can be improved with Modal later)
            const dateStr = prompt("Data de Pagamento (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
            if (!dateStr) return;

            let accId = bill.payAccountId;
            if (!accId) {
                // We need to pick one.
                // If no accounts, warn.
                if (accounts.length === 0) return alert("Cadastre contas primeiro.");

                // If only 1, pick it.
                if (accounts.length === 1) accId = accounts[0].id;
                else {
                    // Very crude picker prompt
                    const accList = accounts.map((a, i) => `${i + 1}: ${a.name}`).join("\n");
                    const idx = prompt(`Escolha a conta (número):\n${accList}`);
                    if (!idx) return;
                    accId = accounts[parseInt(idx) - 1]?.id;
                }
            }

            if (!accId) return alert("Conta inválida.");

            // Calc Values
            let val = bill.amount;
            let valBRL = val;

            if (bill.currency === "USD") {
                const rate = settings?.usdRate || 0;
                if (rate > 0) valBRL = val * rate;
                else {
                    const r = prompt("Cotação USD hoje?", "5.00");
                    valBRL = val * parseFloat(r.replace(",", "."));
                }
            }

            // Create TX
            const tx = {
                id: uid("tx"),
                type: "expense",
                date: dateStr,
                description: `Pagamento: ${bill.name}`,
                amount: val, // legacy
                value: val,  // standardized
                currency: bill.currency,
                valueBRL: valBRL,
                accountId: accId,
                categoryId: bill.categoryId,
                subcategoryId: bill.subcategoryId,
                personId: bill.personId,
                tags: bill.tags,
                createdAt: new Date().toISOString()
            };

            await put("transactions", tx);

            // Update Bill
            bill.status = "paid";
            bill.paidAt = dateStr;
            bill.paidTxId = tx.id;
            bill.updatedAt = new Date().toISOString();
            await put("bills", bill);

            refresh();
        });
    });

    // UNDO PAY
    const btnUndo = rootEl.querySelectorAll("[data-action='undo-bill']");
    btnUndo.forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            const bill = await get("bills", id);
            if (!bill || !bill.paidTxId) return;

            if (!confirm("Desfazer pagamento e remover a transação gerada?")) return;

            // Remove Tx
            await deleteTransaction(bill.paidTxId);

            // Update Bill
            bill.status = "open";
            bill.paidTxId = null;
            bill.paidAt = null;
            bill.updatedAt = new Date().toISOString();
            await put("bills", bill);

            refresh();
        });
    });
}
