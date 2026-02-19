import { list, put, remove, uid, get, deleteTransaction } from "../db.js";

function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

let currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

// State for filters
let _filters = {
    status: 'all', // all, open, paid
    method: 'all', // all, account, card
    personId: '',  // '' = all
    sort: 'due_asc' // due_asc, paid_desc, amount_desc
};

// State for UI
let _state = {
    showTemplateForm: false,
    editingTemplate: null
};

// Valid options for hardening
const SORT_OPTIONS = {
    'due_asc': 'Vencimento (próximo)',
    'paid_desc': 'Pagamento (recente)',
    'amount_desc': 'Valor (maior)'
};

export async function billsScreen() {
    try {
        // Safe loading (Hardening D1)
        const [templates, categories, subcategories, people, accounts, cards, allBills, settingsList] = await Promise.all([
            list("bill_templates").catch(e => []),
            list("categories").catch(e => []),
            list("subcategories").catch(e => []),
            list("people").catch(e => []),
            list("accounts").catch(e => []),
            list("cards").catch(e => []),
            list("bills").catch(e => []),
            list("settings").catch(e => [])
        ]);

        // Restore filters if available
        const savedFilters = settingsList.find(s => s.id === "ui_bills_filters");
        if (savedFilters && savedFilters.value) {
            _filters = { ..._filters, ...savedFilters.value };
        }

        // 1. Filter by Month
        let bills = allBills.filter(b => b.month === currentMonth);

        // 2. Calculate Totals (Summary) - BEFORE filters
        const totals = {
            BRL: { expected: 0, open: 0, paid: 0 },
            USD: { expected: 0, open: 0, paid: 0 },
            byMethod: { account: 0, card: 0 }
        };

        bills.forEach(b => {
            const cur = b.currency || 'BRL';
            const val = b.amount || 0;

            if (!totals[cur]) totals[cur] = { expected: 0, open: 0, paid: 0 };

            totals[cur].expected += val;

            if (b.status === 'paid') {
                totals[cur].paid += val;
                if (b.paidViaType === 'account') totals.byMethod.account++;
                // We count items for method breakdown
            } else {
                totals[cur].open += val;
            }
        });

        // 3. Apply Quick Filters
        let filtered = bills.filter(b => {
            // Status
            if (_filters.status === 'open' && b.status === 'paid') return false;
            if (_filters.status === 'paid' && b.status !== 'paid') return false;

            // Method
            if (_filters.method !== 'all') {
                if (b.status !== 'paid') return false;
                if (_filters.method === 'account' && b.paidViaType !== 'account') return false;
                if (_filters.method === 'card' && b.paidViaType !== 'card') return false;
            }

            // Person
            if (_filters.personId) {
                if (b.personId !== _filters.personId) return false;
            }

            return true;
        });

        // 4. Sort
        filtered.sort((a, b) => {
            if (_filters.sort === 'due_asc') {
                return a.dueDate.localeCompare(b.dueDate);
            } else if (_filters.sort === 'paid_desc') {
                const dA = a.paidAt || '0000-00-00';
                const dB = b.paidAt || '0000-00-00';
                return dB.localeCompare(dA);
            } else if (_filters.sort === 'amount_desc') {
                return (b.amount || 0) - (a.amount || 0);
            }
            return 0;
        });

        const activeTemplates = templates.filter(t => t.active !== false);

        // Helpers
        const getCatName = (id) => categories.find(c => c.id === id)?.name || "---";
        const getPersonName = (id) => people.find(p => p.id === id)?.name || "";
        const formatDate = (iso) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "--/--";

        // --- RENDER HELPERS ---
        const renderSummary = () => {
            const currencies = Object.keys(totals).filter(k => k.length === 3 && (totals[k].expected > 0));
            if (currencies.length === 0) currencies.push('BRL');

            return currencies.map(cur => {
                const t = totals[cur] || { expected: 0, open: 0, paid: 0 };
                const isUSD = cur === 'USD';
                return `
                 <div style="display:flex; justify-content:space-around; background:#f8f9fa; padding:10px; border-radius:8px; margin-bottom:5px; border:1px solid #eee;">
                    <div style="text-align:center;">
                        <div class="small text-muted">Aberto (${cur})</div>
                        <div style="font-weight:bold; color:#d63384; font-size:1.1em;">${cur} ${t.open.toFixed(2)}</div>
                    </div>
                    <div style="text-align:center;">
                         <div class="small text-muted">Pago (${cur})</div>
                         <div style="font-weight:bold; color:#28a745; font-size:1.1em;">${cur} ${t.paid.toFixed(2)}</div>
                    </div>
                    <div style="text-align:center;">
                        <div class="small text-muted">Previsto</div>
                        <div style="font-weight:bold; color:#666;">${cur} ${t.expected.toFixed(2)}</div>
                    </div>
                 </div>
                 `;
            }).join("");
        };

        const renderMethodBreakdown = () => {
            const paidBills = bills.filter(b => b.status === 'paid');
            const viaAcc = paidBills.filter(b => b.paidViaType === 'account').length;
            const viaCard = paidBills.filter(b => b.paidViaType === 'card').length;
            if (paidBills.length === 0) return "";

            return `
             <div class="small text-muted" style="text-align:center; margin-top:5px; display:flex; gap:15px; justify-content:center;">
                 <span>🏦 Via Conta: <strong>${viaAcc}</strong></span>
                 <span>💳 Via Cartão: <strong>${viaCard}</strong></span>
             </div>
             `;
        };

        const renderFilters = () => {
            return `
             <div style="display:flex; gap:5px; overflow-x:auto; padding-bottom:5px; align-items:center;">
                 <div class="btn-group">
                     <button class="small ${_filters.status === 'all' ? 'primary' : 'secondary'}" data-filter="status" data-val="all">Todos</button>
                     <button class="small ${_filters.status === 'open' ? 'primary' : 'secondary'}" data-filter="status" data-val="open">Abertos</button>
                     <button class="small ${_filters.status === 'paid' ? 'primary' : 'secondary'}" data-filter="status" data-val="paid">Pagos</button>
                 </div>
                 <div style="width:1px; background:#ccc; height:20px; margin:0 5px;"></div>
                 <select id="filterMethod" style="padding:2px; font-size:0.9em; border-radius:4px;">
                     <option value="all" ${_filters.method === 'all' ? 'selected' : ''}>Todas Vias</option>
                     <option value="account" ${_filters.method === 'account' ? 'selected' : ''}>Via Conta</option>
                     <option value="card" ${_filters.method === 'card' ? 'selected' : ''}>Via Cartão</option>
                 </select>
                 <select id="filterPerson" style="padding:2px; font-size:0.9em; border-radius:4px;">
                     <option value="">Todas Pessoas</option>
                     ${people.map(p => `<option value="${p.id}" ${_filters.personId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                 </select>
                 <select id="filterSort" style="padding:2px; font-size:0.9em; border-radius:4px;">
                     ${Object.entries(SORT_OPTIONS).map(([k, v]) => `<option value="${k}" ${_filters.sort === k ? 'selected' : ''}>${v}</option>`).join('')}
                 </select>
             </div>
             `;
        };

        return `
        <div class="card">
            <div style="display:flex; gap:10px; align-items:center; justify-content:space-between; margin-bottom:10px;">
                <div style="font-weight:bold; font-size:1.1em;">Contas a Pagar</div>
                <div style="display:flex; gap:5px;">
                     <input type="month" id="billMonth" value="${currentMonth}" style="padding:5px;">
                     <button id="btnBillToday">Hoje</button>
                </div>
            </div>

            <!-- SUMMARY BOARD -->
            ${renderSummary()}
            ${renderMethodBreakdown()}

            <div style="display:flex; gap:10px; margin-top:10px;">
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
            <!-- FILTERS -->
            ${renderFilters()}

            <hr style="margin: 10px 0; border:0; border-top:1px solid #eee;">

            <strong>Contas de ${currentMonth} (${filtered.length})</strong>
            <div style="margin-top:10px;">
                ${filtered.length === 0 ? '<div class="small text-muted" style="text-align:center; padding:20px;">Nenhuma conta encontrada nos filtros.</div>' : ''}
                <ul class="list">
                    ${filtered.map(b => {
                const isPaid = b.status === "paid";
                const today = new Date().toISOString().slice(0, 10);
                const isOverdue = !isPaid && b.month === new Date().toISOString().slice(0, 7) && b.dueDate < today;

                const statusColor = isPaid ? '#28a745' : (isOverdue ? '#dc3545' : '#ffc107');

                // Resolving Labels
                let paidLabel = "";
                if (isPaid) {
                    if (b.paidViaType === 'account') {
                        const name = b.paidViaLabel || accounts.find(a => a.id === b.paidViaId)?.name || 'Conta';
                        paidLabel = `Pago via: <strong>${esc(name)}</strong>`;
                    } else if (b.paidViaType === 'card') {
                        const name = b.paidViaLabel || cards.find(c => c.id === b.paidViaId)?.name || 'Cartão';
                        const labelToShow = b.paidViaLabel || `${name} (Fatura ${b.invoiceMonth})`;
                        paidLabel = `Pago via: <strong>${esc(labelToShow)}</strong>`;
                    } else {
                        paidLabel = `Pago`;
                    }

                    if (b.paidAt) paidLabel += ` em ${formatDate(b.paidAt)}`;
                } else {
                    // Open
                    if (isOverdue) {
                        paidLabel = `<span style="background:#dc3545; color:white; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:0.9em;">VENCIDA</span>`;
                    } else {
                        paidLabel = `<span style="color:#666;">Vence em: <strong>${formatDate(b.dueDate)}</strong></span>`;
                    }
                }

                const personName = b.personId ? getPersonName(b.personId) : "";

                return `
                        <li class="listItem" style="border-left: 4px solid ${statusColor}; padding-left:8px;">
                            <div style="flex:1;">
                                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                    <div>
                                        <span style="font-weight:bold; font-size:1.05em; ${isPaid ? 'text-decoration:line-through; color:#999' : ''}">${esc(getTemplateName(b, templates))}</span>
                                        ${personName ? `<span class="badge" style="background:#e9ecef; color:#333;">${esc(personName)}</span>` : ''}
                                    </div>
                                    <div style="text-align:right;">
                                        <div style="font-weight:bold;">${b.currency} ${b.amount.toFixed(2)}</div>
                                    </div>
                                </div>

                                <div style="margin-top:4px; display:flex; justify-content:space-between; align-items:center; font-size:0.85em;">
                                     <div style="color:#555;">
                                         ${getCatName(b.categoryId)}
                                     </div>
                                     <div style="text-align:right;">
                                         ${paidLabel}
                                     </div>
                                </div>
                             </div>

                             <div style="display:flex; gap:5px; align-items:center; margin-left:10px;">
                                ${!isPaid ?
                        `<button class="success small" data-action="pay-bill" data-title="Pagar" data-id="${b.id}" style="padding:4px 8px;">💲</button>` :
                        `<button class="secondary small" data-action="undo-bill" data-title="Desfazer" data-id="${b.id}" style="padding:4px 8px;">↩️</button>`
                    }
                                <button class="iconBtn danger" data-del="bills:${b.id}" style="padding:4px 8px;">×</button>
                             </div>
                        </li>
                    `}).join('')}
                </ul>
            </div>
        </div>

        <!--PAY BILL DIALOG-->
        <dialog id="payBillDialog" style="padding:20px; border:1px solid #ccc; border-radius:8px; width: 90%; max-width:450px;">
            <h3>Registrar Pagamento</h3>
            <div id="payBillTitle" style="margin-bottom:10px; font-weight:bold;"></div>

            <form id="payBillForm" class="form">
                <input type="hidden" name="billId">
                <input type="hidden" name="amount">
                <input type="hidden" name="currency">

                <div class="grid" style="gap:10px;">
                    <label>
                        Data do Pagamento
                        <input type="date" name="date" required>
                    </label>
                </div>

                <div style="margin-top:10px; margin-bottom:5px; font-weight:bold;">Pagar usando:</div>
                <div style="display:flex; gap:15px; margin-bottom:10px;">
                    <label style="display:flex; align-items:center; gap:5px; cursor:pointer;">
                        <input type="radio" name="method" value="account" checked> Conta / Dinheiro
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; cursor:pointer;">
                        <input type="radio" name="method" value="card"> Cartão de Crédito
                    </label>
                </div>

                <!-- ACCOUNT SECTION -->
                <div id="payMethodAccount" style="background:#f8f9fa; padding:10px; border-radius:5px;">
                    <label>
                        Conta de Saída
                        <select name="accountId">
                            <option value="">Selecione...</option>
                            ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
                        </select>
                    </label>
                </div>

                <!-- CARD SECTION -->
                <div id="payMethodCard" style="background:#f8f9fa; padding:10px; border-radius:5px; display:none;">
                    <label>
                        Cartão
                        <select name="cardId">
                            <option value="">Selecione...</option>
                            ${cards.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
                        </select>
                    </label>

                    <div class="grid" style="grid-template-columns: 1fr 1fr; gap:5px; margin-top:5px;">
                        <label>
                            Portador
                            <select name="cardHolder">
                                <option value="main">Titular</option>
                                <option value="additional">Adicional</option>
                            </select>
                        </label>
                        <label>
                            Fatura (Ref.)
                            <input type="month" name="invoiceMonth" readonly style="background:#ddd;">
                        </label>
                    </div>
                </div>

                <div style="margin-top:15px; display:flex; gap:10px;">
                    <button type="submit" style="flex:1; background:#28a745;">Confirmar</button>
                    <button type="button" id="btnCancelPay" style="flex:1; background:#6c757d;">Cancelar</button>
                </div>
            </form>
        </dialog>
        `;
    } catch (e) {
        console.error("Bills Screen Error", e);
        return `<div class="card error">Erro ao carregar Contas a Pagar: ${e.message}</div>`;
    }
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

                                <div style="display:flex; gap:10px; margin-top:10px;">
                                    <button type="submit" style="flex:1;">Salvar</button>
                                    <button type="button" id="btnCancelTemplate" style="flex:1; background:#ccc; color:black;">Cancelar</button>
                                </div>
                            </form>`;
}

export async function wireBillsHandlers(rootEl) {
    const refresh = async () => {
        const ev = new Event("hashchange");
        window.dispatchEvent(ev);
    };

    // --- NEW: FILTER HANDLERS ---

    // Helper to save filters
    const saveFilters = async () => {
        const settings = await list("settings");
        await put("settings", { id: "ui_bills_filters", value: _filters });
        refresh();
    };

    // Status Buttons (Delegation)
    const btnGroup = rootEl.querySelector(".btn-group");
    if (btnGroup) {
        btnGroup.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-filter='status']");
            if (btn) {
                _filters.status = btn.dataset.val;
                saveFilters();
            }
        });
    }

    // Method Select
    const selMethod = rootEl.querySelector("#filterMethod");
    if (selMethod) {
        selMethod.addEventListener("change", (e) => {
            _filters.method = e.target.value;
            saveFilters();
        });
    }

    // Person Select
    const selPerson = rootEl.querySelector("#filterPerson");
    if (selPerson) {
        selPerson.addEventListener("change", (e) => {
            _filters.personId = e.target.value;
            saveFilters();
        });
    }


    // Sort Select
    const selSort = rootEl.querySelector("#filterSort");
    if (selSort) {
        selSort.addEventListener("change", (e) => {
            _filters.sort = e.target.value;
            saveFilters();
        });
    }


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

    // PAY BILL HANDLER
    const payDialog = rootEl.querySelector("#payBillDialog");
    const payForm = rootEl.querySelector("#payBillForm");
    const methodRadios = payForm?.querySelectorAll("input[name='method']");
    const accountSection = payForm?.querySelector("#payMethodAccount");
    const cardSection = payForm?.querySelector("#payMethodCard");
    const btnCancel = rootEl.querySelector("#btnCancelPay");
    // monthInput is already declared at top of function


    // Toggle Sections
    if (methodRadios) {
        methodRadios.forEach(radio => {
            radio.addEventListener("change", (e) => {
                const val = e.target.value;
                if (val === "account") {
                    accountSection.style.display = "block";
                    cardSection.style.display = "none";
                } else {
                    accountSection.style.display = "none";
                    cardSection.style.display = "block";
                }
            });
        });
    }

    if (btnCancel) {
        btnCancel.addEventListener("click", () => payDialog.close());
    }

    // Determine current Invoice Month from filter
    // According to req: "usar o mês selecionado no filtro da tela “Contas a Pagar” como invoiceMonth"
    const getInvoiceMonth = () => monthInput ? monthInput.value : new Date().toISOString().slice(0, 7);

    // Open Modal
    const btnPay = rootEl.querySelectorAll("[data-action='pay-bill']");
    btnPay.forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            const bill = await get("bills", id);
            if (!bill) return;

            // Populate Form
            payForm.reset();
            payForm.querySelector("[name='billId']").value = bill.id;
            payForm.querySelector("[name='amount']").value = bill.amount;
            payForm.querySelector("[name='currency']").value = bill.currency;
            payForm.querySelector("[name='date']").value = new Date().toISOString().slice(0, 10);

            // Pre-select account if available
            if (bill.payAccountId) {
                const sel = payForm.querySelector("[name='accountId']");
                if (sel) sel.value = bill.payAccountId;
            }

            // Pre-fill invoice month
            const invMonth = getInvoiceMonth();
            payForm.querySelector("[name='invoiceMonth']").value = invMonth;

            rootEl.querySelector("#payBillTitle").innerText = `Pagar: ${bill.name} (${bill.currency} ${bill.amount.toFixed(2)})`;

            // Reset to Account mode by default
            methodRadios[0].checked = true;
            methodRadios[0].dispatchEvent(new Event("change"));

            payDialog.showModal();
        });
    });

    // Form Submit
    if (payForm) {
        payForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const fd = new FormData(payForm);
            const method = fd.get("method");
            const billId = fd.get("billId");
            const date = fd.get("date");
            const bill = await get("bills", billId);

            if (!bill) return;

            let updates = {
                status: "paid",
                paidAt: date,
                updatedAt: new Date().toISOString()
            };

            let txId = uid("tx");
            let tx = null;
            let val = bill.amount;
            let valBRL = val; // Placeholder, real calc below if needed

            // Currency Conversion Logic (Simple)
            if (bill.currency === "USD") {
                const settings = await get("settings", "config");
                const rate = settings?.usdRate || 0;
                if (rate > 0) valBRL = val * rate;
                else {
                    // In modal we don't prompt. We assume 1:1 or use stored if user didn't set.
                    // IMPORTANT: The requirement says: "escolha simples: usar currency do cartão e tratar bill.amount como valor nessa moeda."
                    // But for Account payment?
                    // Let's keep it simple: if USD, and no rate, just store value=amount (USD).
                    // Ideally we should ask rate, but to avoid complexity in modal now, let's use 1 if no setting.
                    // Or maybe prompt?
                    // Requirement E says: "Se o usuário escolher “Cartão” e o cartão estiver em outra moeda... escolha simples: usar currency do cartão"
                    // Let's implement the prompt only if absolutely needed or just default.
                    // Let's check if we can get rate from previous prompt logic code... it prompted.
                    // Let's prompt here if needed, before closing.
                    if (method === "account") { // Only relevant for account usually or if card is BRL and bill is USD
                        // Actually, let's just stick to 1:1 if not configured to avoid blocking UI, or prompts.
                        // Let's do a prompt if 0.
                        const r = prompt("Cotação USD hoje?", "5.00");
                        if (r) valBRL = val * parseFloat(r.replace(",", "."));
                    }
                }
            }

            if (method === "account") {
                const accId = fd.get("accountId");
                if (!accId) return alert("Selecione a conta.");

                updates.paidViaType = "account";
                updates.paidViaId = accId;
                const accounts = await list("accounts");
                const acc = accounts.find(a => a.id === accId);
                updates.paidViaLabel = acc ? acc.name : "Conta";

                tx = {
                    id: txId,
                    type: "expense",
                    date: date,
                    description: `Pagamento: ${bill.name}`,
                    amount: val,
                    value: val,
                    currency: bill.currency,
                    valueBRL: valBRL,
                    accountId: accId,
                    categoryId: bill.categoryId,
                    subcategoryId: bill.subcategoryId,
                    personId: bill.personId,
                    tags: bill.tags,
                    createdAt: new Date().toISOString()
                };

            } else { // CARD
                const cardId = fd.get("cardId");
                const cardHolder = fd.get("cardHolder");
                const invoiceMonth = fd.get("invoiceMonth");

                if (!cardId) return alert("Selecione o cartão.");

                updates.paidViaType = "card";
                updates.paidViaId = cardId;
                const cards = await list("cards");
                const card = cards.find(c => c.id === cardId);
                updates.paidViaLabel = `${card ? card.name : "Cartão"} (${invoiceMonth})`;

                // Currency check (Req E)
                let finalCurrency = bill.currency;
                if (card && card.currency !== bill.currency) {
                    alert(`Aviso: A conta é em ${bill.currency} mas o cartão é ${card.currency}. O valor será lançado como ${bill.amount} ${card.currency}.`);
                    finalCurrency = card.currency;
                    valBRL = val; // If card is BRL, assumed 1:1 numeric (or user handles conversion). Req says: "usar currency do cartão e tratar bill.amount como valor nessa moeda"
                }

                tx = {
                    id: txId,
                    type: "expense",
                    cardId: cardId,
                    invoiceMonth: invoiceMonth,
                    cardHolder: cardHolder,
                    date: date, // Informative
                    description: `Conta no cartão: ${bill.name}`,
                    value: val, // Amount
                    currency: finalCurrency,
                    valueBRL: valBRL,
                    categoryId: bill.categoryId,
                    subcategoryId: bill.subcategoryId,
                    personId: bill.personId,
                    tags: bill.tags,
                    createdAt: new Date().toISOString()
                };
            }

            // Save
            await put("transactions", tx);

            updates.paidTxId = txId;
            Object.assign(bill, updates);
            await put("bills", bill);

            payDialog.close();
            refresh();
        });
    }

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
            bill.paidViaType = null;
            bill.paidViaId = null;
            bill.paidViaLabel = null;
            bill.updatedAt = new Date().toISOString();
            await put("bills", bill);

            refresh();
        });
    });
}
