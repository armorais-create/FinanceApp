
import { list, put, uid, get, deleteInvoice, deleteTransaction, updateTransaction, addInvoicePayment, listInvoicePaymentsByInvoiceKey, deleteInvoicePayment, makeInvoiceKey } from "../db.js";
import { renderGlobalSearch, wireGlobalSearch, applyGlobalSearch, defaultSearchState } from "./search.js";
import { isInvoicePayment } from "./tx.js";

function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

let currentCardId = "";
let currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
let _searchState = { ...defaultSearchState };

export function setInvoiceState(cardId, month) {
    if (cardId) currentCardId = cardId;
    if (month) currentMonth = month;
}

export async function invoiceScreen() {
    // Parse deep link params before rendering
    const hashParts = location.hash.split("?");
    if (hashParts[1]) {
        const params = new URLSearchParams(hashParts[1]);
        if (params.get("card")) currentCardId = params.get("card");
        if (params.get("month")) currentMonth = params.get("month");
    }

    const cards = await list("cards");
    const accounts = await list("accounts");

    // Default selection logic
    if (!currentCardId && cards.length > 0) currentCardId = cards[0].id;

    return renderInvoiceView(cards, accounts);
}

async function renderInvoiceView(cards, accounts) {
    if (!cards.length) return `<div class="card">Cadastre cartões primeiro na aba Config.</div>`;

    // Ensure currentCardId is valid or fallback
    if (cards.length && !cards.find(c => c.id === currentCardId)) currentCardId = cards[0].id;

    // --- Fetch Transactions ---
    const allTxs = await list("transactions");
    let invoiceTxs = allTxs.filter(t =>
        t.cardId === currentCardId &&
        t.invoiceMonth === currentMonth
    ).sort((a, b) => b.date.localeCompare(a.date));

    // --- Fetch Payments ---
    const invoiceKey = makeInvoiceKey(currentCardId, currentMonth);
    let invoicePayments = await listInvoicePaymentsByInvoiceKey(invoiceKey);
    // Sort payments by date descending
    invoicePayments.sort((a, b) => b.date.localeCompare(a.date));

    // Categories/People/Tags for Edit Modal and Search
    const categories = await list("categories");
    const people = await list("people");
    const tags = await list("tags");

    // Apply specific Global Search functionality
    let filteredInvoiceTxs = applyGlobalSearch(invoiceTxs, _searchState, categories, people);
    let filteredInvoicePayments = applyGlobalSearch(invoicePayments.map(p => ({ ...p, name: `Pagamento Fatura ${p.holder === 'main' ? 'Titular' : 'Adicional'}` })), _searchState, categories, people);
    // Unmap the fake name property so it doesn't leak or just let it be. Only used for search.

    const isExp = (t) => t.type === "expense" && t.kind !== "INVOICE_PAYMENT";

    const mainExpenses = filteredInvoiceTxs.filter(t => (t.cardHolder === "main" || !t.cardHolder) && isExp(t));
    const mainPayments = filteredInvoicePayments.filter(t => t.holder === "main");

    const addExpenses = filteredInvoiceTxs.filter(t => t.cardHolder === "additional" && isExp(t));
    const addPayments = filteredInvoicePayments.filter(t => t.holder === "additional");

    const sumVal = (arr, key = "value") => arr.reduce((sum, t) => sum + (t.valueBRL || t[key] || 0), 0);

    const totalMain = sumVal(mainExpenses, "value");
    const paidMain = sumVal(mainPayments, "amount");
    const remainingMain = Math.max(0, totalMain - paidMain);

    const totalAdd = sumVal(addExpenses, "value");
    const paidAdd = sumVal(addPayments, "amount");
    const remainingAdd = Math.max(0, totalAdd - paidAdd);

    const totalGlobal = totalMain + totalAdd;
    const paidGlobal = paidMain + paidAdd;
    const remainingGlobal = Math.max(0, totalGlobal - paidGlobal);

    // Status Determination
    let status = "ABERTA";
    if (remainingGlobal <= 0.01 && totalGlobal > 0) status = "PAGA";
    else if (paidGlobal > 0.01 && remainingGlobal > 0.01) status = "PARCIAL";

    const statusColors = {
        "ABERTA": "orange",
        "PARCIAL": "blue",
        "PAGA": "green"
    };

    const card = cards.find(c => c.id === currentCardId);
    const currency = card?.currency || "BRL";

    // Define options locally
    const catOpts = `<option value="">(Sem Categoria)</option>` + categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    const peopleOpts = `<option value="">(Sem Pessoa)</option>` + people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    const tagList = tags.map(t => `<option value="${esc(t.name)}">`).join("");

    return `
    <div id="invoice-view-root">
    <!--Header -->
    <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:start;">
            <div>
                <strong>Fatura de Cartão</strong>
                <div class="small">Fechamento dia ${card.closingDay} · Vencimento dia ${card.dueDay}</div>
            </div>
            <div style="text-align:right">
                 <span style="background:${statusColors[status]}; color:white; padding:2px 8px; border-radius:4px; font-size:0.8em;">${status}</span>
            </div>
        </div>
        <div class="form grid" style="margin-top:10px;">
            <select id="invCardSelect">
                ${cards.map(c => `<option value="${c.id}" ${c.id === currentCardId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
            </select>
            <input id="invMonthInput" type="month" value="${currentMonth}" />
        </div>
        <div style="margin-top:5px; text-align:right;">
             <button id="btnDeleteInvoice" class="danger small" style="padding:4px 8px;">Excluir Fatura</button>
        </div>
        
        <div id="invSearchContainer" style="margin-top: 10px;">
            ${renderGlobalSearch(_searchState, categories, people, tags)}
        </div>
    </div>

    <!--Summary -->
    <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>Total Fatura</strong>
            <div style="text-align:right">
                <div style="font-size:1.2em; font-weight:bold;">${currency} ${remainingGlobal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
                <div class="small">Total: ${totalGlobal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · Pago: ${paidGlobal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
            </div>
        </div>
    </div>

    <!--Main Holder-->
    <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>Titular (${esc(card.holder)})</strong>
            <div style="text-align:right">
                <span style="font-weight:bold">${currency} ${remainingMain.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                <span class="small"> (${totalMain.toFixed(2)} - ${paidMain.toFixed(2)})</span>
            </div>
        </div>
        <ul class="list" id="mainInvoiceList">
            ${mainExpenses.length ? mainExpenses.map(t => renderItem(t)).join("") : `<div class="small">Nenhuma compra.</div>`}
            ${mainPayments.length ? `<div class="small" style="margin-top:10px; font-weight:bold; color:green">Pagamentos:</div>` : ""}
            ${mainPayments.map(p => renderPaymentItem(p)).join("")}
        </ul>
        ${remainingMain > 0.01 ? `
        <div style="margin-top:10px; text-align:right;">
             <button class="payBtn" data-holder="main" data-amount="${remainingMain.toFixed(2)}">Registrar Pagamento (Titular)</button>
        </div>` : ""}
    </div>

    <!--Additional Holder-->
    ${card.additional ? `
    <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>Adicional (${esc(card.additional)})</strong>
            <div style="text-align:right">
                <span style="font-weight:bold">${currency} ${remainingAdd.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                <span class="small"> (${totalAdd.toFixed(2)} - ${paidAdd.toFixed(2)})</span>
            </div>
        </div>
        <ul class="list" id="addInvoiceList">
            ${addExpenses.length ? addExpenses.map(t => renderItem(t)).join("") : `<div class="small">Nenhuma compra.</div>`}
            ${addPayments.length ? `<div class="small" style="margin-top:10px; font-weight:bold; color:green">Pagamentos:</div>` : ""}
            ${addPayments.map(p => renderPaymentItem(p)).join("")}
        </ul>
        ${remainingAdd > 0.01 ? `
        <div style="margin-top:10px; text-align:right;">
             <button class="payBtn" data-holder="additional" data-amount="${remainingAdd.toFixed(2)}">Registrar Pagamento (Adicional)</button>
        </div>` : ""}
    </div>
    ` : ""
        }

    <!--Payment Modal-->
    <dialog id="payDialog" style="padding:20px; border:1px solid #ccc; border-radius:8px; width: 90%; max-width:400px;">
        <h3>Registrar Pagamento</h3>
        <form id="payForm" class="form">
            <input id="payDesc" disabled style="font-weight:bold; border:none; background:transparent;" />
            
            <label>Data
                <input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" required />
            </label>

            <label>Conta de Origem (Opcional)
                <select name="accountId">
                    <option value="">(Nenhuma / Dinheiro)</option>
                    ${accounts.map(a => `<option value="${a.id}">${esc(a.name)} (${a.currency})</option>`).join("")}
                </select>
            </label>
            
            <label>Valor
                <input name="value" type="number" step="0.01" id="payValue" required />
            </label>
            
            <div style="display:flex; gap:10px; margin-top:20px;">
                <button type="button" id="cancelPay" style="background:#999">Cancelar</button>
                <button type="submit" style="background:green">Confirmar</button>
            </div>
        </form>
    </dialog>

    <!--Edit / Delete Transaction Modal-->
    <dialog id="editTxDialog" style="padding:20px; border:1px solid #ccc; border-radius:8px; width: 90%; max-width:400px;">
        <h3>Editar Lançamento</h3>
        <form id="editTxForm" class="form grid">
            <input type="hidden" name="id" />
            <label>Data <input type="date" name="date" required /></label>
            <label>Descrição <input type="text" name="description" required /></label>

            <label>Portador
                <select name="cardHolder">
                    <option value="main">Titular</option>
                    <option value="additional">Adicional</option>
                </select>
            </label>

            <label>Tipo Cartão
                <select name="cardType">
                    <option value="fisico">Físico</option>
                    <option value="virtual">Virtual</option>
                </select>
            </label>

            <!-- Moeda e Valor -->
            <div style="display:grid; grid-template-columns: 100px 1fr; gap:10px; align-items:end;">
                <label>Moeda
                    <select name="currency" id="editCurrency">
                        <option value="BRL">BRL</option>
                        <option value="USD">USD</option>
                    </select>
                </label>
                <label>Valor (Final BRL)
                    <input type="number" name="value" step="0.01" required id="editValueBRL" />
                </label>
            </div>

            <!-- Campos extras para USD -->
            <div id="usdFields" style="display:none; background:#eee; padding:5px; margin:5px 0;">
                <label>Valor Original (USD) <input type="number" name="amountUSD" step="0.01" id="editAmountUSD" /></label>
                <label>Taxa Base Usada <input type="number" name="exchangeRate" step="0.0001" id="editExchangeRate" /></label>
                
                <div id="editFxBlock" style="display:none; grid-column:span 2; background:#e1f0fa; padding:10px; border-radius:4px; font-size:11px; margin-top:5px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div id="editFxLabel">Estado: R$ 0.00 (Flutuante)</div>
                        <button type="button" id="btnFixFx" style="font-size:10px; padding:4px 8px; background:#17a2b8; color:white; border:none; border-radius:3px;">Fixar Taxa Interna</button>
                        <button type="button" id="btnUnfixFx" style="font-size:10px; padding:4px 8px; background:#dc3545; color:white; border:none; border-radius:3px; display:none;">Descongelar</button>
                        <input type="hidden" name="fxRateTracker" id="fxRateTracker" />
                    </div>
                </div>
            </div>

            <label>Quem Paga <select name="personId">${peopleOpts}</select></label>
            <label>Categoria <select name="categoryId">${catOpts}</select></label>
            <label>Subcategoria <input type="text" name="subcategory" placeholder="Ex: Mercado" /></label>
            <label>Tags <input type="text" name="tags" placeholder="tag1, tag2" list="editTagList" /></label>
            <datalist id="editTagList">${tagList}</datalist>

            <div style="display:flex; gap:10px; margin-top:10px;">
                <button type="button" id="cancelEdit" style="background:#999">Cancelar</button>
                <button type="submit">Salvar</button>
            </div>
        </form>
    </dialog>
    </div><!--End #invoice-view-root-->
    `;
}

function renderPaymentItem(p) {
    const amount = Number(p.amount).toFixed(2);
    // p has: accountId (optional), personId (optional), txId (linked)
    // We can show minimal info.
    const desc = `[PGTO] Pagamento Fatura ${p.holder === "main" ? "Titular" : "Adicional"}`;

    return `
    <li class="listItem" style="background:#f0fff4; border-left:4px solid green;">
        <div style="flex:1">
            <strong>${desc}</strong>
            <div class="small">${p.date}</div>
        </div>
        <div style="text-align:right; color:green; margin-right:10px;">
            <div>${amount}</div>
        </div>
        <div style="display:flex; gap:5px;">
            <button class="iconBtn delPayBtn danger" data-id="${p.id}" data-txid="${p.txId || ''}" title="Excluir Pagamento">🗑</button>
        </div>
    </li>
    `;
}

function renderItem(t, isPayment = false) {
    const isUSD = t.currency === "USD";
    const amount = Number(t.value).toFixed(2);
    const amountBRL = t.valueBRL ? Number(t.valueBRL).toFixed(2) : amount;
    const color = isPayment ? "green" : "black";
    // Payment shows as normal number (since it's a payment record), or negative if we think of "due amount reduction"
    // But usually in a list of items:
    // Expense: 100.00
    // Payment: 100.00 (marked as payment)
    const sign = isPayment ? "" : ""; // No sign, rely on color and context

    // Store data in data attributes for Edit
    const dataJson = esc(JSON.stringify(t));

    // Installment Label
    let instLabel = "";
    if (t.installmentTotal > 1) {
        instLabel = `<span class="small" style="background:#eee; padding:1px 4px; border-radius:3px; margin-left:5px;">${t.installmentNumber} /${t.installmentTotal}</span>`;
    }

    // Special desc for payments
    const desc = isPayment ? `[PGTO] ${t.description} ` : esc(t.description);

    return `
    <li class="listItem" style="${isPayment ? 'background:#f0fff4; border-left:4px solid green;' : ''}">
        <div style="flex:1">
            <strong>${desc}</strong> ${instLabel}
            <div class="small">${t.date}</div>
        </div>
        <div style="text-align:right; color:${color}; margin-right:10px;">
            <div>${t.currency} ${amount}</div>
            ${isUSD ? `<div class="small">R$ ${amountBRL}</div>` : ""}
        </div>
        <div style="display:flex; gap:5px;">
            <button class="iconBtn editTxBtn" data-tx="${dataJson}">✎</button>
            <button class="iconBtn delTxBtn danger" data-id="${t.id}" title="Excluir Lançamento">🗑</button>
        </div>
    </li>
    `;
}

export async function wireInvoiceHandlers(rootEl) {
    // 1. Refresh Handlers
    const cardSelect = rootEl.querySelector("#invCardSelect");
    const monthInput = rootEl.querySelector("#invMonthInput");
    if (cardSelect) cardSelect.onchange = (e) => { currentCardId = e.target.value; refreshInvoice(rootEl); };
    if (monthInput) monthInput.onchange = (e) => { currentMonth = e.target.value; refreshInvoice(rootEl); };

    // Initialize Global Search
    wireGlobalSearch(rootEl, _searchState, () => refreshInvoice(rootEl));

    // 2. Delete Invoice + Payments (Cascaded)
    const delInvBtn = rootEl.querySelector("#btnDeleteInvoice");
    if (delInvBtn) {
        delInvBtn.onclick = async () => {
            if (confirm("ATENÇÃO: Excluir esta fatura removerá TODOS os lançamentos e PAGAMENTOS vinculados a ela. Deseja continuar?")) {
                const invoiceKey = makeInvoiceKey(currentCardId, currentMonth);

                // 1. Delete Payments & Linked Txs
                const payments = await listInvoicePaymentsByInvoiceKey(invoiceKey);
                for (const p of payments) {
                    if (p.txId) await deleteTransaction(p.txId);
                    await deleteInvoicePayment(p.id);
                }

                // 2. Delete Expenses via index
                await deleteInvoice(currentCardId, currentMonth);

                alert("Fatura e pagamentos excluídos.");
                refreshInvoice(rootEl);
            }
        };
    }

    // 3. Edit/Delete Transactions (Delegation)
    const container = rootEl.querySelector("#invoice-view-root");
    if (container) {
        container.addEventListener("click", async (e) => {
            // Delete Payment
            const btnDelPay = e.target.closest(".delPayBtn");
            if (btnDelPay) {
                const id = btnDelPay.dataset.id;
                const txId = btnDelPay.dataset.txid;
                if (confirm("Excluir este pagamento?")) {
                    if (txId) await deleteTransaction(txId);
                    await deleteInvoicePayment(id);
                    refreshInvoice(rootEl);
                }
                return;
            }

            const btnDel = e.target.closest(".delTxBtn");
            if (btnDel) {
                const id = btnDel.dataset.id;
                if (confirm("Excluir este item?")) {
                    await deleteTransaction(id);
                    refreshInvoice(rootEl);
                }
                return;
            }

            const btnEdit = e.target.closest(".editTxBtn");
            if (btnEdit) {
                const txData = JSON.parse(btnEdit.dataset.tx);
                openEditDialog(rootEl, txData);
            }
        });
    }

    // 4. Payment Logic
    const payDialog = rootEl.querySelector("#payDialog");
    const payForm = rootEl.querySelector("#payForm");

    // "Registrar Pagamento" Buttons
    rootEl.querySelectorAll(".payBtn").forEach(btn => {
        btn.onclick = () => {
            const holder = btn.dataset.holder; // 'main' or 'additional'
            const amt = btn.dataset.amount;
            const label = holder === "main" ? "Titular" : "Adicional";
            const cardName = cardSelect.selectedOptions[0].text;

            // Pre-fill
            const descInput = rootEl.querySelector("#payDesc");
            if (descInput) descInput.value = `Pagamento Fatura ${currentMonth} - ${label} `;

            const valInput = rootEl.querySelector("#payValue");
            if (valInput) valInput.value = amt;

            // Context
            if (payForm) payForm.dataset.context = JSON.stringify({ cardId: currentCardId, holder, month: currentMonth, label });
            if (payDialog) payDialog.showModal();
        }
    });

    if (payDialog && payForm) {
        const btnCancel = rootEl.querySelector("#cancelPay");
        if (btnCancel) btnCancel.onclick = () => payDialog.close();

        payForm.onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(payForm);
            const ctx = JSON.parse(payForm.dataset.context || "{}");
            const date = fd.get("date");
            const val = parseFloat(fd.get("value"));
            const accountId = fd.get("accountId") || null; // Optional

            if (val <= 0) {
                alert("Valor deve ser positivo.");
                return;
            }

            // 1. Create Transaction (Linked)
            const txId = uid("tx");
            const tx = {
                id: txId,
                kind: "INVOICE_PAYMENT",
                type: "invoice_payment",

                date: date,
                description: `Pagamento Fatura ${ctx.label}`,
                value: -Math.abs(val), // Negative as requested
                currency: "BRL",

                accountId: accountId,
                cardId: ctx.cardId,
                invoiceMonth: ctx.month,

                cardHolder: ctx.holder,

                createdAt: new Date().toISOString()
            };

            // 2. Create Payment Record
            const payment = {
                id: uid("inv_pay"),
                invoiceKey: makeInvoiceKey(ctx.cardId, ctx.month),
                cardId: ctx.cardId,
                invoiceMonth: ctx.month,
                holder: ctx.holder,
                personId: null, // To be implemented in UI
                accountId: accountId,
                date: date,
                amount: Math.abs(val),
                txId: txId,
                createdAt: new Date().toISOString()
            };

            await put("transactions", tx);
            await addInvoicePayment(payment);

            payDialog.close();
            refreshInvoice(rootEl);
        };
    }

    // 5. Edit Modal Logic (Existing kept mostly same)
    const editDialog = rootEl.querySelector("#editTxDialog");
    const editForm = rootEl.querySelector("#editTxForm");

    if (editDialog && editForm) {
        const btnCancelEdit = rootEl.querySelector("#cancelEdit");
        if (btnCancelEdit) btnCancelEdit.onclick = () => editDialog.close();

        // USD Logic
        const currSel = editForm.querySelector("#editCurrency");
        const usdDiv = editForm.querySelector("#usdFields");
        const valBRLInput = editForm.querySelector("#editValueBRL");
        const valUSDInput = editForm.querySelector("#editAmountUSD");
        const fxInput = editForm.querySelector("#editExchangeRate");

        const updateVisibility = () => {
            if (currSel && currSel.value === "USD") {
                if (usdDiv) usdDiv.style.display = "block";
                if (valBRLInput) {
                    valBRLInput.readOnly = true;
                    valBRLInput.style.background = "#eee";
                }
            } else {
                if (usdDiv) usdDiv.style.display = "none";
                if (valBRLInput) {
                    valBRLInput.readOnly = false;
                    valBRLInput.style.background = "#fff";
                }
            }
        };

        const autoCalc = () => {
            if (currSel && currSel.value === "USD") {
                const usd = parseFloat(valUSDInput.value) || 0;
                const fx = parseFloat(fxInput.value) || 0;
                if (valBRLInput) valBRLInput.value = (usd * fx).toFixed(2);
            }
        };

        if (currSel) currSel.onchange = () => { updateVisibility(); autoCalc(); };
        if (valUSDInput) valUSDInput.oninput = autoCalc;
        if (fxInput) fxInput.oninput = autoCalc;

        editForm.onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(editForm);
            const id = fd.get("id");
            const currency = fd.get("currency");

            const updates = {
                date: fd.get("date"),
                purchaseDate: fd.get("date"),
                description: fd.get("description"),
                value: parseFloat(fd.get("value")), // Always BRL value final
                currency: currency,
                amountUSD: currency === "USD" ? parseFloat(fd.get("amountUSD")) : null,
                exchangeRate: currency === "USD" ? parseFloat(fd.get("exchangeRate")) : null,
                valueBRL: currency === "USD" ? parseFloat(fd.get("value")) : null,

                cardHolder: fd.get("cardHolder"),
                personId: fd.get("personId"),
                categoryId: fd.get("categoryId"),
                subcategory: fd.get("subcategory"),
                tags: fd.get("tags") ? fd.get("tags").split(",").map(s => s.trim()) : []
            };

            const trackedFx = fd.get("fxRateTracker");
            if (trackedFx === "fixed") {
                const originalDataRaw = editDialog.dataset.origTx;
                if (originalDataRaw) {
                    const otx = JSON.parse(originalDataRaw);
                    if (otx.currency === "USD" && !otx.fxRate) {
                        // Uses the values present in the form fields. (Updates object).
                        updates.fxRate = updates.valueBRL / (updates.amountUSD || Math.max(0.01, (parseFloat(otx.value) / (otx.fxRate || 5))));
                    }
                }
            } else if (trackedFx === "unfixed") {
                updates.fxRate = null;
            }

            await updateTransaction(id, updates);
            editDialog.close();
            refreshInvoice(rootEl);
        };
    }

    // Deep Link Highlight
    setTimeout(() => {
        const hashParts = location.hash.split("?");
        if (hashParts[1]) {
            const params = new URLSearchParams(hashParts[1]);
            const highlightId = params.get("highlight");
            if (highlightId) {
                const el = rootEl.querySelector(`[data-id="${highlightId}"]`)?.closest('li');
                if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                    el.style.backgroundColor = "#e2f0d9";
                    el.style.transition = "background-color 2s";
                    setTimeout(() => el.style.backgroundColor = "", 2000);
                }
            }
        }
    }, 50);
}

function openEditDialog(rootEl, tx) {
    const d = rootEl.querySelector("#editTxDialog");
    const f = rootEl.querySelector("#editTxForm");
    if (!d || !f) return;

    f.querySelector("[name=id]").value = tx.id;
    f.querySelector("[name=date]").value = tx.date;
    f.querySelector("[name=description]").value = tx.description;
    f.querySelector("[name=cardHolder]").value = tx.cardHolder || "main";
    f.querySelector("[name=personId]").value = tx.personId || "";
    f.querySelector("[name=categoryId]").value = tx.categoryId || "";
    f.querySelector("[name=tags]").value = (tx.tags || []).join(", ");
    f.querySelector("[name=subcategory]").value = tx.subcategory || "";

    const currSel = f.querySelector("[name=currency]");
    const cur = tx.currency || "BRL";
    if (currSel) currSel.value = cur;

    f.querySelector("#editValueBRL").value = tx.value;

    if (cur === "USD") {
        f.querySelector("[name=amountUSD]").value = tx.amountUSD || "";
        f.querySelector("[name=exchangeRate]").value = tx.exchangeRate || "";
    } else {
        f.querySelector("[name=amountUSD]").value = "";
        f.querySelector("[name=exchangeRate]").value = "";
    }

    if (currSel) {
        const event = new Event("change");
        currSel.dispatchEvent(event);
    }

    // Connect Fx tracking view to display
    const fxBlock = f.querySelector("#editFxBlock");
    const valBRLText = f.querySelector("#editFxLabel");
    const btnFix = f.querySelector("#btnFixFx");
    const btnUnfix = f.querySelector("#btnUnfixFx");
    const tracker = f.querySelector("#fxRateTracker");
    if (tracker) tracker.value = ""; // reset

    if (cur === "USD" && fxBlock) {
        fxBlock.style.display = "block";
        const isFixed = parseFloat(tx.fxRate) > 0;

        valBRLText.innerHTML = `<small style='color:#666'>(${isFixed ? "<b>Câmbio Congelado</b>" : "Flutuante/Global"})</small>`;

        if (isFixed) {
            btnFix.style.display = "none";
            btnUnfix.style.display = "inline-block";
        } else {
            btnFix.style.display = "inline-block";
            btnUnfix.style.display = "none";
        }

        btnFix.onclick = () => {
            tracker.value = "fixed";
            btnFix.style.display = "none";
            valBRLText.innerHTML += " <strong style='color:green'>(Será Fixada!)</strong>";
        };

        btnUnfix.onclick = () => {
            tracker.value = "unfixed";
            btnUnfix.style.display = "none";
            valBRLText.innerHTML += " <strong style='color:red'>(Será Descongelada!)</strong>";
        };
    } else if (fxBlock) {
        fxBlock.style.display = "none";
    }

    d.dataset.origTx = JSON.stringify(tx);
    d.showModal();
}

async function refreshInvoice(rootEl) {
    const cards = await list("cards");
    const accounts = await list("accounts");

    // Check if we need to apply search UI first before full re-render
    const categories = await list("categories");
    const tags = await list("tags");
    const people = await list("people");

    // We already do a full re-render, so just update it
    rootEl.innerHTML = await renderInvoiceView(cards, accounts);

    // Need to apply search logic over the lists
    // Actually, renderInvoiceView doesn't apply the search filtering. I need to fix it.
    // I am modifying renderInvoiceView to apply the search. 
    wireInvoiceHandlers(rootEl);
}
