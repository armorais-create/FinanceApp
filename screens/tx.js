import { list, put, uid, remove, updateTransaction, deleteTransaction, get } from "../db.js";
import { renderGlobalSearch, wireGlobalSearch, applyGlobalSearch, defaultSearchState } from "./search.js";

function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* =========================================
   TRANSACTIONS SCREEN
   ========================================= */

let _searchState = { ...defaultSearchState };

export async function txScreen() {
    const people = await list("people");
    const accounts = await list("accounts");
    const cards = await list("cards");
    const categories = await list("categories");
    const tags = await list("tags");
    const txs = (await list("transactions")).sort((a, b) => b.date.localeCompare(a.date));
    const settings = (await get("settings", "config")) || { usdRate: 5.0 };

    // Options for Modal
    const catOpts = `<option value="">(Sem Categoria)</option>` + categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    const peoOpts = `<option value="">(Sem Pessoa)</option>` + people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    const tagList = tags.map(t => `<option value="${esc(t.name)}">`).join("");

    return `
    <div id="tx-view-root">
    <div class="card">
        <div><strong>Novo Lançamento</strong></div>
        <form id="txForm" class="form grid">

            <div style="grid-column: span 2; display:flex; gap: 20px; padding-bottom:10px; align-items:center;">
                <label><input type="radio" name="method" value="account" checked> Conta / Dinheiro</label>
                <label><input type="radio" name="method" value="card"> Cartão de Crédito</label>
                
                <!-- Account Installments Toggle (Only visible if Account selected) -->
                <label id="accInstWrapper" style="display:none; margin-left:auto; background:#eee; padding:2px 8px; border-radius:4px;">
                    <input type="checkbox" name="isAccInstallment" id="chkAccInst"> Parcelado? (Boletos)
                </label>
            </div>

            <input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" required />
            
            <div style="display:flex; flex-wrap:wrap; gap:12px;">
                <input name="description" placeholder="Descrição (ex: Almoço)" required style="flex: 1 1 200px;" />
                <div id="billMonthWrapper" style="flex: 1 1 150px;">
                    <input name="billMonth" type="month" placeholder="Fatura (YYYY-MM)" style="width:100%" />
                </div>
            </div>
            
            <select name="type" required>
                <option value="expense">Despesa</option>
                <option value="revenue">Receita</option>
            </select>

            <select name="personId" required>
                <option value="">Pessoa...</option>
                ${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}
            </select>

            <!-- Account Select -->
            <select name="accountId" id="accountSelect">
                <option value="">Conta...</option>
                ${accounts.map(a => `<option value="${a.id}" data-currency="${a.currency}">${esc(a.name)} (${a.currency})</option>`).join("")}
            </select>

            <!-- Card Selects (Hidden by default) -->
            <select name="cardId" id="cardSelect" style="display:none">
                <option value="">Cartão...</option>
                ${cards.map(c => `<option value="${c.id}" data-currency="${c.currency}" data-closing="${c.closingDay}" data-holder="${esc(c.holder)}" data-additional="${esc(c.additional)}">${esc(c.name)}</option>`).join("")}
            </select>

            <select name="cardHolder" id="holderSelect" style="display:none">
                <option value="main">Titular</option>
                <option value="additional">Adicional</option>
            </select>

            <select name="categoryId">
                <option value="">Categoria...</option>
                ${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
            </select>

            <input name="tags" placeholder="Tags (separar por vírgula)" list="tagList" />
            <datalist id="tagList">
                ${tags.map(t => `<option value="${t.name}">`).join("")}
            </datalist>

            <div style="display:flex; gap:10px; align-items:center; grid-column: span 2;">
                <!-- Regular Value Input -->
                <input name="value" type="number" step="0.01" placeholder="Valor" required style="flex:1" id="valueInput" />
                
                <!-- Account Installment Fields -->
                <div id="accInstFields" style="display:none; flex:2; gap:10px; align-items:center;">
                    <input name="instTotal" type="number" min="2" max="999" placeholder="Nº Parc." style="width:80px;" />
                    <span class="small">x de</span>
                    <input name="instValue" type="number" step="0.01" placeholder="Vlr Parcela" style="flex:1;" />
                </div>

                <span id="currencyLabel">BRL</span>
            </div>
            
            <div id="conversionPreview" class="small" style="grid-column: span 2; display:none; gap:10px; align-items:center; color: #666;">
                <div>Câmbio USD:</div>
                <input type="number" name="fxRate" id="fxRateInput" step="0.0001" placeholder="${settings.usdRate}" style="width:80px; padding:2px; font-size:11px;" />
                <div>| Aproximadamente <strong id="brlPreview">R$ 0,00</strong></div>
            </div>

            <button type="submit" style="grid-column: span 2;">Salvar</button>
        </form>
    </div>

    <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
             <button data-action="nav" data-hash="#installments" style="background:#eee; border:1px solid #ccc; font-size:0.9em;">Ver Parcelas (Boletos)</button>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <div><strong>Lançamentos do Mês</strong></div>
            <input type="month" id="filterMonth" value="${new Date().toISOString().substring(0, 7)}" />
        </div>
        
        <div id="txSearchContainer" style="margin-top: 10px;">
            ${renderGlobalSearch(_searchState, categories, tags, people)}
        </div>

        <div class="small" id="txTotalDisplay" style="margin-top: 5px;">Total: ${txs.length}</div>
        <ul class="list" id="txListContainer">
            <!-- Items rendered via refreshList -->
        </ul>
    </div>

    <!-- Edit Transaction Modal -->
    <dialog id="editTxDialog" style="padding:20px; border:1px solid #ccc; border-radius:8px; width: 90%; max-width:400px;">
        <h3>Editar Lançamento</h3>
        <form id="editTxForm" class="form grid">
            <input type="hidden" name="id" />
            <label>Data <input type="date" name="date" required /></label>
            <label>Descrição <input type="text" name="description" required /></label>
            <label>Valor <input type="number" name="value" step="0.01" required /></label>
            
            <label>Mês Fatura (Se Cartão) <input type="month" name="invoiceMonth" /></label>
            
            <!-- Account Select for Edit -->
             <label>Conta (Se Dinheiro)
                <select name="accountId">
                    <option value="">(Nenhuma)</option>
                    ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}
                </select>
            </label>

            <!-- USD Fix Rate Block -->
            <div id="editFxBlock" style="display:none; grid-column:span 2; background:#e1f0fa; padding:10px; border-radius:4px; font-size:11px;">
                <div style="font-weight:bold; color:#0056b3;">Transação Internacional (USD)</div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
                    <div id="editFxLabel">Taxa Usada: R$ 0.00 (Flutuante)</div>
                    <button type="button" id="btnFixFx" style="font-size:10px; padding:4px 8px; background:#17a2b8; color:white; border:none; border-radius:3px;">Fixar Taxa Atual</button>
                    <button type="button" id="btnUnfixFx" style="font-size:10px; padding:4px 8px; background:#dc3545; color:white; border:none; border-radius:3px; display:none;">Descongelar</button>
                    <input type="hidden" name="fxRateTracker" id="fxRateTracker" />
                </div>
            </div>

            <!-- Card Specifics -->
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
            
            <label>Quem Paga <select name="personId">${peoOpts}</select></label>
            <label>Categoria <select name="categoryId">${catOpts}</select></label>
            <label>Tags <input type="text" name="tags" placeholder="tag1, tag2" list="editTagList"/></label>
            <datalist id="editTagList">${tagList}</datalist>

            <div style="display:flex; gap:10px; margin-top:10px;">
                <button type="button" id="cancelEdit" style="background:#999">Cancelar</button>
                <button type="submit">Salvar</button>
            </div>
        </form>
    </dialog>
    </div> <!-- End #tx-view-root -->
    `;
}

export function isInvoicePayment(tx) {
    return tx && tx.kind === "INVOICE_PAYMENT";
}

function renderTxItem(t, people, accounts, cards, categories) {
    const person = people.find(p => p.id === t.personId)?.name || "??";
    const category = categories.find(c => c.id === t.categoryId)?.name || "";

    let sourceName = "";
    if (t.accountId) {
        sourceName = accounts.find(a => a.id === t.accountId)?.name || "Conta?";
    } else if (t.cardId) {
        const card = cards.find(c => c.id === t.cardId);
        const holderLabel = t.cardHolder === "additional" ? " (Adic.)" : "";
        sourceName = `${card?.name || "Cartão?"}${holderLabel}`;
    }

    const curr = t.currency || "BRL";
    const isUSD = curr === "USD";
    const amount = Number(t.value).toFixed(2);
    const amountBRL = t.valueBRL ? Number(t.valueBRL).toFixed(2) : amount;

    // Check if it's an invoice payment or regular revenue
    const isPayment = isInvoicePayment(t) || t.type === "card_payment";
    // ^ Supporting legacy "card_payment" type for backward compatibility, 
    // but moving forward "INVOICE_PAYMENT" kind is preferred.

    // Revenue or Payment = Green
    const isPositive = t.type === "revenue" || isPayment;
    const color = isPositive ? "green" : "red";

    // For payments, we usually show "-", for revenue "+"
    // But invoice payment reduces debt, so it is "outflow" from account but "inflow" to invoice.
    // In Transaction List:
    // Expense: - (Red)
    // Revenue: + (Green)
    // Invoice Payment: (Green? or Neutral?) 
    // User requirement: "Pagamento não deve ser classificado como despesa/receita."
    // It is a transfer. But visually, if I paid a bill, money left my account.
    // However, usually in these apps, paying a bill is neutral or green (settling debt).
    // Let's stick to Green for "Settled" / "Revenue", Red for "Expense".
    // Sign:
    // Revenue: +
    // Expense: -
    // Payment: (No sign? or -?)
    // If I show it in the list of "Transactions", it is money leaving the account usually.
    // But wait, the transaction list is "Lançamentos".
    // If I pay a bill from Account X, it acts like an expense on Account X.
    // If I assume it's just a record of payment.
    // Let's use user's prompt hint: "sinal de exibição pode ser “-” conforme seu padrão".

    const sign = t.type === "revenue" ? "+" : (isPayment ? "" : "-");
    // Removed "-" for payment to distinguish or maybe keep it?
    // Let's keep "-" for payment if it comes from an account, but visually green?
    // User said: "sinal de exibição pode ser “-” conforme seu padrão" -> implying typical expense style but green?
    // Let's use Green color, and "-" sign if it has fromAccountId, or just no sign.
    // Actually, let's keep it simple: Green text to indicate "Good" (Debt paid), prefix with "PGTO" or similar if needed.
    // Let's use the code:

    // JSON data for edit
    const dataJson = esc(JSON.stringify(t));

    // Differentiate description
    const desc = isInvoicePayment(t) ? `[PGTO Fatura] ${t.description}` : esc(t.description);

    return `
    <li class="listItem" style="${isPayment ? 'background-color: #f0fff4;' : ''}">
        <div style="flex:1">
            <div><strong>${desc}</strong> <span class="small" style="opacity:0.7">${esc(category)}</span></div>
            <div class="small">${t.date} · ${esc(person)} · ${esc(sourceName)}</div>
            ${t.tags ? `<div class="small" style="color:#888">#${esc(t.tags.join(" #"))}</div>` : ""}
            ${t.kind === "planned_installment" && !t.paid ? `<span style="background:orange; color:white; padding:1px 4px; border-radius:3px; font-size:0.7em;">PENDENTE</span>` : ""}
            ${t.kind === "planned_installment" && t.paid ? `<span style="background:green; color:white; padding:1px 4px; border-radius:3px; font-size:0.7em;">K PAGO</span>` : ""}
        </div>
        <div style="text-align:right; margin-right:10px;">
            <div style="color:${color}; font-weight:bold;">${sign} ${curr} ${amount}</div>
            ${isUSD ? `<div class="small">R$ ${amountBRL}</div>` : ""}
        </div>
        <div style="display:flex; gap:5px; flex-direction:column; justify-content:center;">
             ${t.kind === "planned_installment" && !t.paid ?
            `<button class="iconBtn payInstBtn" style="padding:2px 6px; background:green; color:white;" data-id="${t.id}" title="Marcar como Pago">✔</button>`
            : ""}
             <button class="iconBtn editTxBtn" style="padding:2px 6px;" data-tx="${dataJson}">✎</button>
             <button class="iconBtn delTxBtn danger" style="padding:2px 6px;" data-id="${t.id}">🗑</button>
        </div>
    </li>
    `;
}

export async function wireTxHandlers(rootEl) {
    const form = rootEl.querySelector("#txForm");
    if (!form) return;

    // START RESTORE FORM LOGIC
    const methodRadios = form.querySelectorAll("input[name='method']");
    const accountSelect = form.querySelector("#accountSelect");
    const cardSelect = form.querySelector("#cardSelect");
    const holderSelect = form.querySelector("#holderSelect");
    const currencyLabel = form.querySelector("#currencyLabel");
    const valueInput = form.querySelector("#valueInput");
    const conversionPreview = form.querySelector("#conversionPreview");
    const brlPreview = form.querySelector("#brlPreview");

    // New Account Installment Inputs
    const chkAccInst = form.querySelector("#chkAccInst");
    const accInstWrapper = form.querySelector("#accInstWrapper");
    const accInstFields = form.querySelector("#accInstFields");
    const instTotalInput = form.querySelector("[name=instTotal]");
    const instValueInput = form.querySelector("[name=instValue]");

    const settings = (await get("settings", "config")) || { usdRate: 5.0 };

    function toggleMethod() {
        const method = form.querySelector("input[name='method']:checked").value;
        const type = form.querySelector("select[name='type']").value;

        if (method === "account") {
            accountSelect.style.display = "block";
            accountSelect.required = true;
            cardSelect.style.display = "none";
            cardSelect.required = false;
            holderSelect.style.display = "none";
            form.querySelector("#billMonthWrapper").style.display = "none";
            currencyLabel.innerText = accountSelect.selectedOptions[0]?.dataset.currency || "BRL";

            // Show "Parcelado?" option
            if (accInstWrapper) accInstWrapper.style.display = "block";

            toggleAccInstallment(); // Check checkbox state

        } else {
            accountSelect.style.display = "none";
            accountSelect.required = false;
            cardSelect.style.display = "block";
            cardSelect.required = true;
            holderSelect.style.display = "block";
            form.querySelector("#billMonthWrapper").style.display = "block";

            const selCard = cardSelect.selectedOptions[0];
            currencyLabel.innerText = selCard?.dataset.currency || "BRL";

            // Hide "Parcelado?" option
            if (accInstWrapper) accInstWrapper.style.display = "none";
            if (accInstFields) accInstFields.style.display = "none";
            if (valueInput) valueInput.style.display = "block";
        }
    }

    function toggleAccInstallment() {
        if (chkAccInst && chkAccInst.checked && accInstWrapper.style.display !== "none") {
            // Installment Mode
            valueInput.style.display = "none";
            valueInput.required = false;
            accInstFields.style.display = "flex";
            instTotalInput.required = true;
            instValueInput.required = true;
        } else {
            // Normal Mode
            valueInput.style.display = "block";
            valueInput.required = true;
            if (accInstFields) accInstFields.style.display = "none";
            if (instTotalInput) instTotalInput.required = false;
            if (instValueInput) instValueInput.required = false;
        }
    }

    if (chkAccInst) chkAccInst.addEventListener("change", toggleAccInstallment);

    methodRadios.forEach(r => r.addEventListener("change", toggleMethod));
    if (accountSelect) accountSelect.addEventListener("change", toggleMethod);
    if (cardSelect) cardSelect.addEventListener("change", toggleMethod);

    const typeSelect = form.querySelector("select[name='type']");
    if (typeSelect) typeSelect.addEventListener("change", toggleMethod);

    toggleMethod();

    const fxRateInput = form.querySelector("#fxRateInput");

    const updatePreview = () => {
        const cur = currencyLabel.innerText;
        if (cur === "USD") {
            const val = parseFloat(valueInput.value) || 0;
            const fxRate = parseFloat(fxRateInput?.value) || settings.usdRate;
            const brl = val * fxRate;
            brlPreview.innerText = `R$ ${brl.toFixed(2)}`;
            conversionPreview.style.display = "flex";
        } else {
            conversionPreview.style.display = "none";
        }
    };

    if (valueInput) valueInput.addEventListener("input", updatePreview);
    if (fxRateInput) fxRateInput.addEventListener("input", updatePreview);

    form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const method = fd.get("method");
        const type = fd.get("type");
        const val = parseFloat(fd.get("value"));
        const cur = currencyLabel.innerText;

        const baseDate = fd.get("date");
        const personId = fd.get("personId");
        const categoryId = fd.get("categoryId");
        const description = fd.get("description");
        const tags = fd.get("tags") ? fd.get("tags").split(",").map(t => t.trim()) : [];
        const createdAt = new Date().toISOString();

        // Check if Account Installment
        if (chkAccInst && chkAccInst.checked && method === "account") {
            const instTotal = parseInt(fd.get("instTotal"));
            const instValue = parseFloat(fd.get("instValue"));

            if (!instTotal || instTotal < 2) {
                alert("Para parcelamento, o número de parcelas deve ser pelo menos 2.");
                return;
            }

            const planId = uid("plan");

            try {
                // 1. Create Plan (Schema: Back1)
                const plan = {
                    id: planId,
                    createdAt,
                    kind: "boleto",
                    personId,
                    accountId: fd.get("accountId"),
                    type, // expense/revenue
                    descriptionBase: description,
                    amount: instValue, // parcel value as amount? or total Amount? Schema says "amount". Usually "amount" in plan means total or parcel? Context implies parcel value is used for tx. Let's store parcel value here to be safe or clarify. User didn't specify. Assuming parcel value.
                    currency: cur,
                    categoryId,
                    subcatId: null, // UI doesn't have it yet
                    tags,
                    startDate: baseDate,
                    totalInstallments: instTotal,
                    status: "ACTIVE"
                };
                await put("installment_plans", plan);

                // 2. Generate Transactions (Planned)
                let currentDate = new Date(baseDate);
                // Fix: preserve day of month if possible
                const startDay = parseInt(baseDate.split("-")[2]);

                for (let i = 1; i <= instTotal; i++) {
                    const year = currentDate.getFullYear();
                    const month = currentDate.getMonth(); // 0-11
                    const dStr = currentDate.toISOString().split('T')[0];

                    const txId = `${planId}:${i}`;

                    // Anti-duplication check
                    const existing = await get("transactions", txId);
                    if (existing) {
                        console.warn(`Installment ${i} already exists, skipping.`);
                        // Move date for next loop
                        currentDate.setMonth(currentDate.getMonth() + 1);
                        continue;
                    }

                    const tx = {
                        id: txId,
                        installmentPlanId: planId,
                        installmentNo: i,
                        installmentTotal: instTotal,

                        kind: "planned_installment",
                        type: type,

                        description: `${description} (${i}/${instTotal})`,
                        value: instValue,
                        currency: cur,

                        personId,
                        categoryId,
                        tags,
                        accountId: fd.get("accountId"),

                        date: dStr,
                        paid: false,

                        createdAt
                    };

                    await put("transactions", tx);

                    // Next Month Logic (Preserve Day)
                    // Set to 1st of next month, then set day.
                    // This avoids "Jan 31 -> Feb 28 -> Mar 28" (drifting).
                    // We want "Jan 31 -> Feb 28 -> Mar 31".

                    // Logic:
                    // 1. Add 1 month to current month variable.
                    // 2. Check max days in that new month.
                    // 3. Set day to Math.min(startDay, maxDays).

                    let nextMonth = new Date(year, month + 1, 1);
                    const daysInNextMonth = new Date(year, month + 2, 0).getDate();
                    const nextDay = Math.min(startDay, daysInNextMonth);
                    nextMonth.setDate(nextDay);
                    currentDate = nextMonth;
                }

                await refreshList(rootEl);
                form.reset();
                form.querySelector("input[value='account']").checked = true;
                toggleMethod();
                alert("Plano de parcelamento (Boletos) criado com sucesso!");
                return;
            } catch (e) {
                console.error(e);
                alert("Erro ao salvar parcelamento. Verifique o console.");
                return;
            }
        }

        // Common Fields
        let tx = {
            id: uid("tx"),
            description,
            value: val,
            currency: cur,
            type,
            personId,
            categoryId,
            tags,
            createdAt,
            date: baseDate
        };

        if (cur === "USD") {
            const rawFx = fd.get("fxRate");
            const parsedFx = parseFloat(rawFx);
            if (!isNaN(parsedFx) && parsedFx > 0) {
                tx.fxRate = parsedFx;
                tx.valueBRL = val * parsedFx;
            } else {
                tx.valueBRL = val * settings.usdRate;
            }
        }

        if (method === "account") {
            tx.accountId = fd.get("accountId");
        } else {
            tx.cardId = fd.get("cardId");
            tx.cardHolder = fd.get("cardHolder");
            tx.invoiceMonth = fd.get("billMonth") || baseDate.substring(0, 7);
            tx.billMonth = tx.invoiceMonth; // Keep both for now if needed, or just invoiceMonth
            tx.purchaseDate = baseDate;
        }

        await put("transactions", tx);

        await refreshList(rootEl); // Re-render list
        form.reset();
        // Restore defaults
        form.querySelector("input[value='account']").checked = true;
        toggleMethod();
        alert("Salvo!");
    };
    // END RESTORE FORM LOGIC

    // Filter Logic
    const filterInput = rootEl.querySelector("#filterMonth");
    if (filterInput) {
        filterInput.addEventListener("change", () => refreshList(rootEl));
    }

    // Initialize Global Search
    wireGlobalSearch(rootEl, _searchState, () => refreshList(rootEl));

    // START EDIT/DELETE LOGIC
    const listContainer = rootEl.querySelector("#txListContainer");

    if (listContainer) {
        listContainer.addEventListener("click", async (e) => {
            // "Load More" handle
            const btnLoadMore = e.target.closest("#btnLoadMoreTx");
            if (btnLoadMore) {
                _searchState.limit += 50;
                refreshList(rootEl);
                return;
            }

            // Mark Pay Handler
            const btnPay = e.target.closest(".payInstBtn");
            if (btnPay) {
                if (confirm("Marcar parcela como PAGA hoje?")) {
                    const id = btnPay.dataset.id;
                    const today = new Date().toISOString().split('T')[0];
                    await updateTransaction(id, { paid: true, paidAt: today, date: today }); // Optional: update date to payment date? Or keep due date? User requirement: "paidAt=hoje". Usually we might want to change date to paidAt for cash flow accuracy. Let's update `date` to today too so it appears in current month's cash flow. Be careful with "Expected vs Actual". For now provided instruction says "set paid=true and paidAt=hoje".
                    refreshList(rootEl);
                }
                return;
            }

            const btnDel = e.target.closest(".delTxBtn");
            if (btnDel) {
                if (confirm("Excluir lançamento?")) {
                    await deleteTransaction(btnDel.dataset.id);
                    refreshList(rootEl);
                }
                return;
            }

            const btnEdit = e.target.closest(".editTxBtn");
            if (btnEdit) {
                const data = JSON.parse(btnEdit.dataset.tx);
                openEditDialog(rootEl, data);
            }
        });
    }

    // Edit Modal
    const editD = rootEl.querySelector("#editTxDialog");
    const editF = rootEl.querySelector("#editTxForm");
    if (editD) {
        rootEl.querySelector("#cancelEdit").onclick = () => editD.close();
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
                tags: fd.get("tags") ? fd.get("tags").split(",").map(s => s.trim()) : []
            };

            if (fd.get("invoiceMonth")) updates.invoiceMonth = fd.get("invoiceMonth");
            if (fd.get("accountId")) updates.accountId = fd.get("accountId");
            if (fd.get("cardHolder")) updates.cardHolder = fd.get("cardHolder");
            if (fd.get("cardType")) updates.cardType = fd.get("cardType");

            // Fx Rate Tracking
            const trackedFx = fd.get("fxRateTracker");
            if (trackedFx === "fixed") {
                // User clicked to fix a floating rate during this edit window
                // Wait, what if they were already fixed? That means they clicked nothing, trackedFx="fixed" will be saved.
                // We don't have to recalculate BRL, we just persist fxRate so the Engine ignores it later.
                // So we need the original tx.valueBRL to compute the exact fx.
                const originalDataRaw = editD.dataset.origTx;
                if (originalDataRaw) {
                    const otx = JSON.parse(originalDataRaw);
                    if (otx.currency === "USD" && !otx.fxRate) {
                        const currentValBRL = parseFloat(otx.valueBRL) || (parseFloat(otx.value) * (settings.usdRate || 5.0)); // Fallback
                        updates.fxRate = currentValBRL / parseFloat(otx.value);
                    }
                }
            } else if (trackedFx === "unfixed") {
                updates.fxRate = null; // Unfix
            }

            // Note: Preventing overwriting other fields not in form? No, updateTransaction merges.

            await updateTransaction(id, updates);
            editD.close();
            refreshList(rootEl);
        }
    }

    // Initial render and deep link handling
    setTimeout(() => {
        const hashParts = location.hash.split("?");
        if (hashParts[1]) {
            const params = new URLSearchParams(hashParts[1]);
            const highlightId = params.get("highlight");
            const month = params.get("month");

            const doHighlight = () => {
                if (!highlightId) return;
                const el = rootEl.querySelector(`[data-id="${highlightId}"]`)?.closest('li');
                if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                    el.style.backgroundColor = "#e2f0d9";
                    el.style.transition = "background-color 2s";
                    setTimeout(() => el.style.backgroundColor = "", 2000);
                }
            };

            if (month && filterInput && filterInput.value !== month) {
                filterInput.value = month;
                refreshList(rootEl).then(doHighlight);
            } else {
                refreshList(rootEl).then(doHighlight);
            }
        } else {
            // Normal initial load without deep link
            refreshList(rootEl);
        }
    }, 50);
}

function openEditDialog(rootEl, tx) {
    const d = rootEl.querySelector("#editTxDialog");
    const f = rootEl.querySelector("#editTxForm");

    f.querySelector("[name=id]").value = tx.id;
    f.querySelector("[name=date]").value = tx.date;
    f.querySelector("[name=description]").value = tx.description;
    f.querySelector("[name=value]").value = tx.value;
    f.querySelector("[name=personId]").value = tx.personId || "";
    f.querySelector("[name=categoryId]").value = tx.categoryId || "";

    // Account
    const accSel = f.querySelector("[name=accountId]");
    if (accSel) accSel.value = tx.accountId || "";

    f.querySelector("[name=tags]").value = (tx.tags || []).join(", ");

    const impInv = f.querySelector("[name=invoiceMonth]");
    if (impInv) impInv.value = tx.invoiceMonth || "";

    // -- FX Logic --
    const fxBlock = f.querySelector("#editFxBlock");
    const valBRLText = f.querySelector("#editFxLabel");
    const btnFix = f.querySelector("#btnFixFx");
    const btnUnfix = f.querySelector("#btnUnfixFx");
    const tracker = f.querySelector("#fxRateTracker");
    tracker.value = ""; // reset

    if (tx.currency === "USD") {
        fxBlock.style.display = "block";
        const isFixed = parseFloat(tx.fxRate) > 0;
        const currentRate = isFixed ? tx.fxRate : ((tx.valueBRL || 0) / tx.value);

        valBRLText.innerHTML = `Taxa: R$ ${currentRate.toFixed(4)} <br/> <small style='color:#666'>(${isFixed ? "Fixada/Congelada" : "Flutuante/Global"})</small>`;

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
    } else {
        fxBlock.style.display = "none";
    }

    d.dataset.origTx = JSON.stringify(tx);
    d.showModal();
}

async function refreshList(rootEl) {
    const people = await list("people");
    const accounts = await list("accounts");
    const cards = await list("cards");
    const categories = await list("categories");

    const filterInput = rootEl.querySelector("#filterMonth");
    const selectedMonth = filterInput ? filterInput.value : new Date().toISOString().substring(0, 7);

    // List all then filter in memory (simple for now)
    let txs = (await list("transactions")).sort((a, b) => b.date.localeCompare(a.date));

    if (selectedMonth) {
        txs = txs.filter(t => t.date.startsWith(selectedMonth));
    }

    // Apply Global Search & Filters
    const tags = await list("tags");
    const searchContainer = rootEl.querySelector("#txSearchContainer");
    if (searchContainer) {
        searchContainer.innerHTML = renderGlobalSearch(_searchState, categories, tags, people);
        wireGlobalSearch(rootEl, _searchState, () => refreshList(rootEl));
    }

    txs = applyGlobalSearch(txs, _searchState, categories, people);

    const totalFiltered = txs.length;
    const paginatedTxs = txs.slice(0, _searchState.limit);

    const ul = rootEl.querySelector("#txListContainer");
    let html = paginatedTxs.length ? paginatedTxs.map(t => renderTxItem(t, people, accounts, cards, categories)).join("") : "Nada encontrado.";

    if (totalFiltered > _searchState.limit) {
        html += `<div style="text-align:center; padding: 15px;">
                    <button id="btnLoadMoreTx" class="secondary">Carregar mais (${Math.min(totalFiltered - _searchState.limit, 50)})</button>
                    <div class="small" style="color:#666; margin-top:5px;">Exibindo ${_searchState.limit} de ${totalFiltered}</div>
                 </div>`;
    }

    ul.innerHTML = html;

    // Update Total Display
    const totalDisplay = rootEl.querySelector("#txTotalDisplay");
    if (totalDisplay) {
        totalDisplay.innerText = `Total: ${totalFiltered}`;
    }
}
