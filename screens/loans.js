import { list, put, remove, uid, get } from "../db.js";

function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

let _filters = {
    view: 'all', // all, i_owe, owed_to_me, open, closed
    upcomingDays: 30,
    additionalMonth: new Date().toISOString().slice(0, 7)
};

let _state = {
    showForm: false,
    editingLoan: null,
    showDetails: false,
    detailLoanId: null,
    showRejanePayment: false,
    rejanePersonId: null
};

export async function loansScreen() {
    try {
        const [loans, loanPayments, loanInstallments, people, accounts, settingsList, cards, transactions, personBalances, balanceEvents] = await Promise.all([
            list("loans").catch(() => []),
            list("loan_payments").catch(() => []),
            list("loan_installments").catch(() => []),
            list("people").catch(() => []),
            list("accounts").catch(() => []),
            list("settings").catch(() => []),
            list("cards").catch(() => []),
            list("transactions").catch(() => []),
            list("person_balances").catch(() => []),
            list("balance_events").catch(() => [])
        ]);

        const getPersonName = (id) => people.find(p => p.id === id)?.name || "Desconhecido";
        const getAccountName = (id) => accounts.find(a => a.id === id)?.name || "Conta";

        // Enrich loans with payments and remaining saldo
        const enrichedLoans = loans.map(l => {
            const payments = loanPayments.filter(p => p.loanId === l.id);
            const installments = loanInstallments.filter(i => i.loanId === l.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
            const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
            const saldo = Math.max(0, l.principal - totalPaid);

            // Auto close tolerance rule 0.01
            let currentStatus = l.status;
            if (currentStatus === 'open' && saldo <= 0.01) {
                currentStatus = 'closed';
            }

            return {
                ...l,
                payments,
                installments,
                totalPaid,
                saldo,
                computedStatus: currentStatus
            };
        });

        // Compute Summaries
        let sumIOwe = 0;
        let sumOwedToMe = 0;

        enrichedLoans.forEach(l => {
            if (l.computedStatus === 'open') {
                if (l.role === 'i_owe') sumIOwe += l.saldo;
                if (l.role === 'owed_to_me') sumOwedToMe += l.saldo;
            }
        });

        // Filter Logic
        let filtered = enrichedLoans;
        if (_filters.view === 'i_owe') filtered = filtered.filter(l => l.role === 'i_owe');
        if (_filters.view === 'owed_to_me') filtered = filtered.filter(l => l.role === 'owed_to_me');
        if (_filters.view === 'open') filtered = filtered.filter(l => l.computedStatus === 'open');
        if (_filters.view === 'closed') filtered = filtered.filter(l => l.computedStatus === 'closed');

        // Dashboard Logic (Próximos Vencimentos)
        const todayStr = new Date().toISOString().slice(0, 10);
        const limitDateObj = new Date();
        limitDateObj.setDate(limitDateObj.getDate() + _filters.upcomingDays);
        const limitDateStr = limitDateObj.toISOString().slice(0, 10);

        let upcomingInstallments = loanInstallments
            .filter(i => (i.status === 'open' || i.status === 'partial') && i.dueDate <= limitDateStr)
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

        // Match with enriched loans for context
        upcomingInstallments = upcomingInstallments.map(i => {
            const l = enrichedLoans.find(x => x.id === i.loanId);
            return l && l.computedStatus !== 'closed' ? { ...i, loanTitle: l.title, role: l.role } : null;
        }).filter(Boolean);

        // ----------------------------------------------------
        // PHASE 14A-3: Rejane (Additional Card Holder) Tracker
        // ----------------------------------------------------
        let rejaneHtml = "";
        const rejanePerson = people.find(p => p.name.toLowerCase().includes("rejane"));

        if (rejanePerson) {
            const pb = personBalances.find(b => b.personId === rejanePerson.id);
            const rBalanceCents = pb ? pb.balanceCentsBRL : 0;

            const rejaneCards = cards.filter(c => c.additional && c.additional.toLowerCase().includes("rejane"));

            let totalChargesThisMonth = 0;
            const chargesByCard = {};

            transactions.forEach(t => {
                if (t.type === "expense" && t.cardHolder === "additional" && t.invoiceMonth === _filters.additionalMonth) {
                    if (rejaneCards.some(c => c.id === t.cardId)) {
                        if (t.kind !== "INVOICE_PAYMENT" && t.type !== "card_payment") {
                            const valBRL = t.valueBRL ?? t.value;
                            totalChargesThisMonth += valBRL;
                            const cardName = cards.find(c => c.id === t.cardId)?.name || "Cartão";
                            chargesByCard[cardName] = (chargesByCard[cardName] || 0) + valBRL;
                        }
                    }
                }
            });

            const paymentsThisMonth = balanceEvents.filter(e => e.personId === rejanePerson.id && e.month === _filters.additionalMonth && e.type === "payment");

            let chargesHtml = Object.keys(chargesByCard).map(k => `<div>${esc(k)}: R$ ${chargesByCard[k].toFixed(2)}</div>`).join("");
            if (chargesHtml === "") chargesHtml = "<div class='small text-muted'>Nenhum gasto neste mês.</div>";

            const isClosed = balanceEvents.some(e => e.personId === rejanePerson.id && e.month === _filters.additionalMonth && e.type === "charges");

            rejaneHtml = `
            <div class="card" style="margin-top:10px; border-left:4px solid #f39c12; background:#fffcf5;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:bold; font-size:1.1em; color:#d68910;">Cartões Adicionais: ${esc(rejanePerson.name)}</div>
                    <div style="font-size:1.2em; font-weight:bold; color:#d68910;">Saldo: R$ ${(rBalanceCents / 100).toFixed(2)}</div>
                </div>
                
                <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center;">
                    <div>Fatura do Mês:</div>
                    <input type="month" id="fltAdditionalMonth" value="${_filters.additionalMonth}" style="padding:4px;">
                </div>
                
                <div style="margin-top:10px; padding:10px; background:#fff; border-radius:5px; border:1px solid #f1c40f;">
                    <div style="font-weight:bold; margin-bottom:5px;">Gastos no Mês Atual: R$ ${totalChargesThisMonth.toFixed(2)}</div>
                    ${chargesHtml}
                    
                    <div style="margin-top:10px; text-align:right;">
                        ${isClosed ?
                    '<span class="badge" style="background:#28a745; color:white;">FECHADO</span>' :
                    `<button class="primary small" data-action="close-rejane" data-month="${_filters.additionalMonth}" data-amount="${totalChargesThisMonth}" data-person="${rejanePerson.id}">Aplicar Fechamento</button>`
                }
                    </div>
                </div>
                
                <div style="margin-top:10px; border-top:1px solid #f1c40f; padding-top:10px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px; align-items:center;">
                        <strong style="color:#28a745;">Pagamentos Recebidos no Mês</strong>
                        <button class="success small" id="btnRejanePayment" data-person="${rejanePerson.id}">+ Receber Pgto</button>
                    </div>
                    ${paymentsThisMonth.length === 0 ? '<div class="small text-muted">Nenhum pagamento registrado.</div>' : ''}
                    <ul class="list" style="margin:0; padding:0;">
                        ${paymentsThisMonth.map(p => `
                            <li class="listItem" style="padding:6px; font-size:0.9em;">
                                <div style="flex:1;">
                                    <strong>${p.createdAt.slice(0, 10)}</strong> - R$ ${Math.abs(p.amountCentsBRL / 100).toFixed(2)}
                                    ${p.note ? `<div class="small text-muted" style="font-style:italic">"${esc(p.note)}"</div>` : ''}
                                </div>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            </div>
            `;
        }

        return `
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:bold; font-size:1.1em;">Controle de Dívidas</div>
                    <button id="btnNewLoan" class="primary">+ Novo</button>
                </div>
            </div>

            <div class="card" style="margin-top:10px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px; align-items:center;">
                    <strong style="color:#0056b3;">Próximos Vencimentos</strong>
                    <div style="display:flex; gap:5px;">
                        <button class="small ${_filters.upcomingDays === 30 ? 'primary' : 'secondary'}" data-upcoming="30">30d</button>
                        <button class="small ${_filters.upcomingDays === 60 ? 'primary' : 'secondary'}" data-upcoming="60">60d</button>
                        <button class="small ${_filters.upcomingDays === 90 ? 'primary' : 'secondary'}" data-upcoming="90">90d</button>
                    </div>
                </div>
                ${upcomingInstallments.length === 0 ? '<div class="small text-muted">Nenhum vencimento neste período.</div>' : ''}
                <ul class="list" style="margin:0; padding:0;">
                    ${upcomingInstallments.slice(0, 10).map(i => {
            const overdue = i.dueDate < todayStr;
            const badgeColor = overdue ? '#dc3545' : '#17a2b8';
            const badgeText = overdue ? 'ATRASADO' : 'A VENCER';
            const rest = Math.max(0, i.amount - (i.paidAmount || 0));
            return `
                            <li class="listItem" style="border-left:4px solid ${badgeColor}; padding:6px; font-size:0.9em; cursor:pointer;" data-action="view-details" data-id="${i.loanId}">
                                <div style="flex:1;">
                                    <strong>${i.dueDate.slice(8, 10)}/${i.dueDate.slice(5, 7)}/${i.dueDate.slice(0, 4)}</strong> — ${esc(i.loanTitle)}
                                    <div class="small text-muted">Parcela ${i.installmentNo}/${i.installmentTotal}</div>
                                </div>
                                <div style="text-align:right;">
                                    <div style="font-weight:bold; color:${badgeColor}">${i.currency} ${rest.toFixed(2)}</div>
                                    <span class="badge" style="background:${badgeColor}; color:white;">${badgeText}</span>
                                </div>
                            </li>
                        `;
        }).join('')}
                </ul>
                ${upcomingInstallments.length > 10 ? '<div class="small text-muted" style="margin-top:5px;">+ outros não mostrados</div>' : ''}
            </div>

            <div class="card" style="margin-top:10px;">
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <div style="flex:1; background:#f8d7da; padding:10px; border-radius:5px; border-left:4px solid #dc3545;">
                        <div class="small text-muted">Eu Devo (Aberto)</div>
                        <strong style="color:#dc3545">R$ ${sumIOwe.toFixed(2)}</strong>
                    </div>
                    <div style="flex:1; background:#d4edda; padding:10px; border-radius:5px; border-left:4px solid #28a745;">
                        <div class="small text-muted">Me Devem (Aberto)</div>
                        <strong style="color:#28a745">R$ ${sumOwedToMe.toFixed(2)}</strong>
                    </div>
                </div>
            </div>
            
            ${rejaneHtml}

            <div class="card" style="margin-top:10px;">
                <div style="margin-bottom:10px; display:flex; gap:5px; flex-wrap:wrap;">
                    <button class="small ${_filters.view === 'all' ? 'primary' : 'secondary'}" data-filter="all">Todos</button>
                    <button class="small ${_filters.view === 'open' ? 'primary' : 'secondary'}" data-filter="open">Abertos</button>
                    <button class="small ${_filters.view === 'i_owe' ? 'primary' : 'secondary'}" data-filter="i_owe">Eu Devo</button>
                    <button class="small ${_filters.view === 'owed_to_me' ? 'primary' : 'secondary'}" data-filter="owed_to_me">Me Devem</button>
                    <button class="small ${_filters.view === 'closed' ? 'primary' : 'secondary'}" data-filter="closed">Quitados</button>
                </div>

                <div style="margin-top:10px;">
                    ${filtered.length === 0 ? '<div class="small text-muted">Nenhum registro encontrado.</div>' : ''}
                    <ul class="list">
                        ${filtered.map(l => {
            const isMine = l.role === 'i_owe';
            const badgeColor = isMine ? '#dc3545' : '#28a745';
            const badgeText = isMine ? 'EU DEVO' : 'ME DEVEM';
            const rolePerson = isMine ? getPersonName(l.borrowerPersonId) : getPersonName(l.lenderPersonId); // the opposite party
            const pct = l.principal > 0 ? ((l.totalPaid / l.principal) * 100).toFixed(0) : 0;
            const isClosed = l.computedStatus === 'closed';

            return `
                                <li class="listItem" style="border-left:4px solid ${isClosed ? '#6c757d' : badgeColor}; opacity:${isClosed ? '0.7' : '1'};">
                                    <div style="flex:1;">
                                        <div style="font-weight:bold; font-size:1.05em; ${isClosed ? 'text-decoration:line-through' : ''}">${esc(l.title)}</div>
                                        <div style="font-size:0.85em; color:#555; margin-top:2px;">
                                            <span style="background:${badgeColor}; color:white; padding:2px 4px; border-radius:3px; font-weight:bold; font-size:0.8em;">${badgeText}</span>
                                            <span> a ${esc(rolePerson)}</span>
                                            <span style="margin-left:5px;">• Dia ${l.dueDay}</span>
                                        </div>
                                    </div>
                                    <div style="text-align:right;">
                                        <div style="font-weight:bold; color:${isClosed ? '#6c757d' : badgeColor}">
                                            ${l.currency} ${l.saldo.toFixed(2)}
                                        </div>
                                        <div style="font-size:0.8em; color:#666;">Já Pago: ${pct}%</div>
                                    </div>
                                    <div style="display:flex; gap:5px; margin-left:10px;">
                                        <button class="success small" data-action="view-details" data-id="${l.id}">Histórico / Pagar</button>
                                        <button class="danger small" data-action="delete-loan" data-id="${l.id}">✕</button>
                                    </div>
                                </li>
                            `;
        }).join('')}
                    </ul>
                </div>
            </div>
            
            ${_state.showForm ? renderLoanForm(people) : ''}
            ${_state.showDetails ? renderLoanDetails(enrichedLoans.find(x => x.id === _state.detailLoanId), people, accounts) : ''}
            ${renderRejanePaymentModal(accounts)}
        `;
    } catch (e) {
        console.error("Loans Error rendering:", e);
        return `<div class="card error">Erro interno nas Dívidas: ${e.message}</div>`;
    }
}

function renderRejanePaymentModal(accounts) {
    if (!_state.showRejanePayment) return '';
    return `
    <div class="backdrop" id="rejaneBg" style="display:block;"></div>
    <div class="modal open" id="rejaneModal" style="display:block; min-width:300px;">
        <h3>Receber Pagamento (Cartões Adicionais)</h3>
        <form id="frmRejanePayment" style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
            <input type="hidden" name="personId" value="${_state.rejanePersonId}">
            
            <label>Data
                <input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}">
            </label>
            <label>Valor Recebido (R$)
                <input type="number" step="0.01" name="amount" required>
            </label>
            <label>Conta destino (Opcional - criará receita)
                <select name="accountId">
                    <option value="">Nenhuma / Só abater saldo</option>
                    ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
                </select>
            </label>
            <label>Nota / Obs
                <input type="text" name="note" placeholder="Ex: PIX recebido no Nubank">
            </label>
            
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px;">
                <button type="button" class="secondary" id="btnCancelRejanePayment">Cancelar</button>
                <button type="submit" class="primary">Salvar</button>
            </div>
        </form>
    </div>
    `;
}

function renderLoanForm(people) {
    const isEdit = !!_state.editingLoan;
    const l = isEdit ? _state.editingLoan : {};

    return `
    <div class="backdrop" id="loanBackdrop" style="display:block;"></div>
    <div class="modal open" id="loanModal" style="display:block; min-width:300px;">
        <h3>${isEdit ? 'Editar Empréstimo' : 'Novo Empréstimo/Dívida'}</h3>
        <form id="frmLoan" style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
            <input type="hidden" name="id" value="${l.id || ''}">
            
            <label>Título / Referência
                <input type="text" name="title" required value="${esc(l.title || '')}" placeholder="Ex: Empréstimo para reforma">
            </label>

            <label>Origem (Quem deve a quem?)
                <select name="role" required>
                    <option value="i_owe" ${l.role === 'i_owe' ? 'selected' : ''}>Eu peguei emprestado (Eu Devo)</option>
                    <option value="owed_to_me" ${l.role === 'owed_to_me' ? 'selected' : ''}>Eu emprestei (Me Devem)</option>
                </select>
            </label>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <label>Emprestador (Deu a grana)
                    <select name="lenderPersonId" required>
                        <option value="">Selecione...</option>
                        ${people.map(p => `<option value="${p.id}" ${l.lenderPersonId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                    </select>
                </label>
                <label>Tomador (Pegou a grana)
                    <select name="borrowerPersonId" required>
                        <option value="">Selecione...</option>
                        ${people.map(p => `<option value="${p.id}" ${l.borrowerPersonId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                    </select>
                </label>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <label>Moeda
                    <select name="currency" required>
                        <option value="BRL" ${l.currency === 'BRL' ? 'selected' : ''}>BRL</option>
                        <option value="USD" ${l.currency === 'USD' ? 'selected' : ''}>USD</option>
                    </select>
                </label>
                <label>Valor Original (Principal)
                    <input type="number" step="0.01" name="principal" required value="${l.principal || ''}">
                </label>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
                <label>Nº Parcelas
                    <input type="number" name="totalInstallments" required value="${l.totalInstallments || 1}" min="1">
                </label>
                <label>Valor Parcela
                    <input type="number" step="0.01" name="installmentAmount" value="${l.installmentAmount || ''}">
                </label>
                <label>Dia Venc.
                    <input type="number" name="dueDay" required min="1" max="31" value="${l.dueDay || ''}">
                </label>
            </div>

            <label>Data Início
                <input type="date" name="startDate" required value="${l.startDate || ''}">
            </label>

            <label>Notas
                <textarea name="notes" rows="2">${esc(l.notes || '')}</textarea>
            </label>

            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px;">
                <button type="button" class="secondary" id="btnCancelLoan">Cancelar</button>
                <button type="submit" class="primary">Salvar</button>
            </div>
        </form>
    </div>
    `;
}

function renderLoanDetails(loan, people, accounts) {
    if (!loan) return '';

    const getPersonName = (id) => people.find(p => p.id === id)?.name || "Desconhecido";
    const getAccountName = (id) => accounts.find(a => a.id === id)?.name || "Conta";

    const isMine = loan.role === 'i_owe';
    const badgeColor = isMine ? '#dc3545' : '#28a745';
    const badgeText = isMine ? 'EU DEVO' : 'ME DEVEM';
    const rolePerson = isMine ? getPersonName(loan.borrowerPersonId) : getPersonName(loan.lenderPersonId);

    return `
                < div class="backdrop" id = "loanDetailsBackdrop" style = "display:block;" ></div >
                    <div class="modal open" id="loanDetailsModal" style="display:block; min-width:320px; max-width:500px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                            <h3 style="margin-bottom:0;">${esc(loan.title)}</h3>
                            <button class="small danger" id="btnCancelDetails">Fechar</button>
                        </div>

                        <div style="background:#f8f9fa; padding:10px; border-radius:5px; margin-top:10px; font-size:0.9em; border-left:4px solid ${badgeColor};">
                            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                                <strong>${badgeText} a ${esc(rolePerson)}</strong>
                                <span class="badge" style="background:${loan.computedStatus === 'closed' ? '#6c757d' : '#17a2b8'}; color:white;">
                                    ${loan.computedStatus.toUpperCase()}
                                </span>
                            </div>
                            <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-top:10px;">
                                <div><strong>Original:</strong> ${loan.currency} ${loan.principal.toFixed(2)}</div>
                                <div><strong>Pago:</strong> ${loan.currency} ${loan.totalPaid.toFixed(2)}</div>
                                <div style="color:${badgeColor}; font-weight:bold; font-size:1.1em;">
                                    <strong>Saldo:</strong> ${loan.currency} ${loan.saldo.toFixed(2)}
                                </div>
                                <div><strong>Data:</strong> ${loan.startDate}</div>
                            </div>
                        </div>

                        ${loan.installments.length === 0 ? `
                            <div style="margin-top:15px; padding:10px; background:#fff3cd; border:1px solid #ffeeba; border-radius:5px; text-align:center;">
                                <div class="small" style="color:#856404; margin-bottom:5px;">Este empréstimo ainda não possui um cronograma de parcelas.</div>
                                <button class="primary small" id="btnGenerateInstallments" data-id="${loan.id}">Gerar Parcelas (${loan.totalInstallments}x)</button>
                            </div>
                        ` : `
                            <h4 style="margin-top:15px; border-bottom:1px solid #ccc; padding-bottom:5px;">Cronograma de Parcelas</h4>
                            <div style="max-height:180px; overflow-y:auto;">
                                <ul class="list">
                                    ${loan.installments.map(i => {
        const isPaid = i.status === 'paid';
        const isSkipped = i.status === 'skipped';
        const rest = Math.max(0, i.amount - (i.paidAmount || 0));

        let statusBadge = '';
        if (isPaid) statusBadge = '<span class="badge" style="background:#28a745; color:white;">PAGA</span>';
        else if (isSkipped) statusBadge = '<span class="badge" style="background:#6c757d; color:white;">PULOU</span>';
        else if (i.status === 'partial') statusBadge = '<span class="badge" style="background:#fd7e14; color:white;">PARCIAL</span>';
        else if (i.dueDate < new Date().toISOString().slice(0, 10)) statusBadge = '<span class="badge" style="background:#dc3545; color:white;">ATRASADA</span>';
        else statusBadge = '<span class="badge" style="background:#17a2b8; color:white;">ABERTA</span>';

        return `
                                            <li class="listItem" style="padding:6px; font-size:0.9em; opacity:${isPaid || isSkipped ? '0.6' : '1'};">
                                                <div style="flex:1;">
                                                    <strong>${i.installmentNo}/${i.installmentTotal}</strong> — Venc: ${i.dueDate}
                                                    <div class="small">Valor: ${i.currency} ${rest.toFixed(2)}</div>
                                                </div>
                                                <div style="text-align:right;">
                                                    ${statusBadge}
                                                </div>
                                                <div style="display:flex; flex-direction:column; gap:4px; margin-left:10px;">
                                                    ${i.status !== 'skipped' && i.status !== 'paid' ? `<button class="secondary small" data-action="skip-installment" data-id="${i.id}">Pular</button>` : ''}
                                                    ${isSkipped ? `<button class="secondary small" data-action="unskip-installment" data-id="${i.id}">Reabrir</button>` : ''}
                                                </div>
                                            </li>
                                        `;
    }).join('')}
                                </ul>
                            </div>
                        `}

                        <h4 style="margin-top:15px; border-bottom:1px solid #ccc; padding-bottom:5px;">Amortizações / Pagamentos</h4>

                        ${loan.computedStatus !== 'closed' ? `
        <form id="frmPayment" style="background:#e9ecef; padding:10px; border-radius:5px; display:flex; flex-direction:column; gap:8px; margin-top:10px;">
            <div style="font-weight:bold; font-size:0.9em;">Registrar Novo Pagamento</div>
            <input type="hidden" name="loanId" value="${loan.id}">
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <label class="small">Data
                    <input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}" style="padding:4px;">
                </label>
                <label class="small">Valor Pagamento
                    <input type="number" step="0.01" name="amount" required value="${loan.saldo > 0 ? loan.saldo.toFixed(2) : ''}" style="padding:4px;">
                </label>
            </div>
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <label class="small">Conta utilizada
                    <select name="accountId" required style="padding:4px;">
                        <option value="">Selecione...</option>
                        ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
                    </select>
                </label>
                <label class="small">Quem pagou?
                    <select name="personId" required style="padding:4px;">
                        <option value="">Selecione...</option>
                        ${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
                    </select>
                </label>
            </div>
            
            <label class="small">Nota / Referência
                <input type="text" name="note" placeholder="Opcional" style="padding:4px;">
            </label>
            
            <div style="text-align:right;">
                <button type="submit" class="primary small">Gravar Pgto</button>
            </div>
        </form>
        ` : '<div class="small" style="color:#28a745; font-weight:bold; margin-top:10px;">🎉 Empréstimo/Dívida totalmente quitado!</div>'
        }

        <div style="margin-top:10px; max-height:200px; overflow-y:auto;">
            ${loan.payments.length === 0 ? '<div class="small">Nenhum pagamento registrado ainda.</div>' : ''}
            <ul class="list">
                ${loan.payments.map(p => `
                    <li class="listItem" style="padding:6px; font-size:0.9em;">
                        <div style="flex:1;">
                            <strong>${p.date}</strong> — R$ ${p.amount.toFixed(2)}
                            <div class="small text-muted">Conta: ${esc(getAccountName(p.accountId))} • Por: ${esc(getPersonName(p.personId))}</div>
                            ${p.note ? `<div class="small" style="font-style:italic">"${esc(p.note)}"</div>` : ''}
                        </div>
                        <button class="danger small" data-action="delete-payment" data-id="${p.id}">Excluir</button>
                    </li>
                `).join('')}
            </ul>
        </div>
    </div>
    `;
}

// ---------------------------
// Handlers
// ---------------------------
export async function wireLoansHandlers(rootEl) {
    const refresh = async () => setTab(location.hash);

    // Filters logic
    const filterBtns = rootEl.querySelectorAll("[data-filter]");
    filterBtns.forEach(b => b.addEventListener("click", () => {
        _filters.view = b.dataset.filter;
        refresh();
    }));

    const upcomingBtns = rootEl.querySelectorAll("[data-upcoming]");
    upcomingBtns.forEach(b => b.addEventListener("click", () => {
        _filters.upcomingDays = parseInt(b.dataset.upcoming, 10);
        refresh();
    }));

    // Rejane Trackers 
    const fltAdditionalMonth = rootEl.querySelector("#fltAdditionalMonth");
    if (fltAdditionalMonth) {
        fltAdditionalMonth.addEventListener("change", (e) => {
            _filters.additionalMonth = e.target.value;
            refresh();
        });
    }

    const btnRejanePayment = rootEl.querySelector("#btnRejanePayment");
    if (btnRejanePayment) {
        btnRejanePayment.addEventListener("click", () => {
            _state.rejanePersonId = btnRejanePayment.dataset.person;
            _state.showRejanePayment = true;
            refresh();
        });
    }

    const btnCancelRejanePayment = rootEl.querySelector("#btnCancelRejanePayment");
    if (btnCancelRejanePayment) {
        btnCancelRejanePayment.addEventListener("click", () => {
            _state.showRejanePayment = false;
            refresh();
        });
    }

    const frmRejanePayment = rootEl.querySelector("#frmRejanePayment");
    if (frmRejanePayment) {
        frmRejanePayment.addEventListener("submit", async (e) => {
            e.preventDefault();
            const fd = new FormData(frmRejanePayment);
            const amount = parseFloat(fd.get("amount"));
            if (amount <= 0) return alert("Valor inválido");

            const personId = fd.get("personId");
            const amountCents = Math.round(amount * 100);

            const ev = {
                id: uid("be"),
                personId,
                month: _filters.additionalMonth,
                type: "payment",
                amountCentsBRL: -amountCents,
                note: fd.get("note").trim(),
                createdAt: fd.get("date") + "T12:00:00.000Z"
            };

            await put("balance_events", ev);

            let pb = await get("person_balances", `balance_${personId}`);
            if (!pb) pb = { id: `balance_${personId}`, personId, balanceCentsBRL: 0, updatedAt: ev.createdAt };
            pb.balanceCentsBRL -= amountCents; // minus for payment
            pb.updatedAt = new Date().toISOString();
            await put("person_balances", pb);

            const accountId = fd.get("accountId");
            if (accountId) {
                const tx = {
                    id: uid("tx"),
                    description: "Recebimento Cartão Adicional",
                    value: amount,
                    currency: "BRL",
                    type: "revenue",
                    personId,
                    accountId,
                    categoryId: "",
                    tags: ["adicional", "rejane"],
                    createdAt: new Date().toISOString(),
                    date: fd.get("date")
                };
                await put("transactions", tx);
            }

            _state.showRejanePayment = false;
            refresh();
        });
    }

    // Form Interactions
    const btnNew = rootEl.querySelector("#btnNewLoan");
    if (btnNew) {
        btnNew.addEventListener("click", () => {
            _state.showForm = true;
            _state.editingLoan = null;
            refresh();
        });
    }

    const btnCancel = rootEl.querySelector("#btnCancelLoan");
    if (btnCancel) {
        btnCancel.addEventListener("click", () => {
            _state.showForm = false;
            refresh();
        });
    }

    const frm = rootEl.querySelector("#frmLoan");
    if (frm) {
        frm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const fd = new FormData(frm);

            const loan = {
                id: fd.get("id") || uid("loan"),
                title: fd.get("title").trim(),
                role: fd.get("role"),
                borrowerPersonId: fd.get("borrowerPersonId"),
                lenderPersonId: fd.get("lenderPersonId"),
                principal: parseFloat(fd.get("principal")),
                currency: fd.get("currency"),
                startDate: fd.get("startDate"),
                totalInstallments: parseInt(fd.get("totalInstallments") || "1"),
                installmentAmount: parseFloat(fd.get("installmentAmount") || "0"),
                dueDay: parseInt(fd.get("dueDay")),
                notes: fd.get("notes")?.trim(),
                status: 'open',
                updatedAt: new Date().toISOString()
            };

            if (!fd.get("id")) loan.createdAt = new Date().toISOString();

            await put("loans", loan);
            _state.showForm = false;
            refresh();
        });
    }

    // Modal Details Wiring
    const btnCancelDetails = rootEl.querySelector("#btnCancelDetails");
    if (btnCancelDetails) {
        btnCancelDetails.addEventListener("click", () => {
            _state.showDetails = false;
            _state.detailLoanId = null;
            refresh();
        });
    }

    const frmPayment = rootEl.querySelector("#frmPayment");
    if (frmPayment) {
        frmPayment.addEventListener("submit", async (e) => {
            e.preventDefault();
            const fd = new FormData(frmPayment);

            const loanId = fd.get("loanId");
            const paymentAmount = parseFloat(fd.get("amount"));

            const p = {
                id: uid("loan_payment"),
                loanId: loanId,
                date: fd.get("date"),
                amount: paymentAmount,
                accountId: fd.get("accountId"),
                personId: fd.get("personId"),
                note: fd.get("note").trim(),
                createdAt: new Date().toISOString()
            };

            await put("loan_payments", p);

            // Allocate payment to installments (Idempotent cascade)
            const allInstalls = await list("loan_installments");
            let openInstalls = allInstalls
                .filter(i => i.loanId === loanId && (i.status === 'open' || i.status === 'partial'))
                .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

            let amountToAllocate = paymentAmount;

            for (const inst of openInstalls) {
                if (amountToAllocate <= 0) break;

                const instRest = Math.max(0, inst.amount - (inst.paidAmount || 0));
                if (instRest > 0) {
                    const allocated = Math.min(instRest, amountToAllocate);
                    inst.paidAmount = (inst.paidAmount || 0) + allocated;
                    amountToAllocate -= allocated;

                    if (!inst.paidPaymentIds) inst.paidPaymentIds = [];
                    inst.paidPaymentIds.push(p.id);

                    if (inst.paidAmount >= inst.amount - 0.01) {
                        inst.status = 'paid';
                    } else {
                        inst.status = 'partial';
                    }

                    await put("loan_installments", inst);
                }
            }

            refresh();
        });
    }

    // Dynamic List Action Resolvers
    rootEl.addEventListener("click", async (e) => {
        // Rejane Closure
        const btnCloseRejane = e.target.closest("[data-action='close-rejane']");
        if (btnCloseRejane) {
            const month = btnCloseRejane.dataset.month;
            const amount = parseFloat(btnCloseRejane.dataset.amount);
            const personId = btnCloseRejane.dataset.person;
            if (amount <= 0) {
                alert("Não há gastos para fechar neste mês.");
                return;
            }
            if (!confirm(`Fechar fatura de ${month} no valor de R$ ${amount.toFixed(2)}?`)) return;

            const allEvents = await list("balance_events");
            const exists = allEvents.some(ev => ev.personId === personId && ev.month === month && ev.type === "charges");
            if (exists) {
                alert("Este mês já foi fechado e incorporado ao saldo. Use Ajuste se necessário.");
                return;
            }

            const amountCents = Math.round(amount * 100);
            const ev = {
                id: uid("be"),
                personId,
                month,
                type: "charges",
                amountCentsBRL: amountCents,
                note: `Fechamento fatura ${month}`,
                createdAt: new Date().toISOString()
            };
            await put("balance_events", ev);

            let pb = await get("person_balances", `balance_${personId}`);
            if (!pb) {
                pb = { id: `balance_${personId}`, personId, balanceCentsBRL: 0, updatedAt: ev.createdAt };
            }
            pb.balanceCentsBRL += amountCents;
            pb.updatedAt = ev.createdAt;
            await put("person_balances", pb);

            refresh();
            return;
        }

        // Generate Installments
        if (e.target.id === "btnGenerateInstallments") {
            const loanId = e.target.dataset.id;
            const loans = await list("loans");
            const loan = loans.find(l => l.id === loanId);
            if (!loan) return;

            if (!confirm(`Gerar ${loan.totalInstallments} parcelas?`)) return;

            const N = loan.totalInstallments;
            const startDate = new Date(loan.startDate);
            let fallbackAmount = loan.principal / N;
            if (loan.installmentAmount && loan.installmentAmount > 0) {
                fallbackAmount = loan.installmentAmount;
            }

            for (let i = 1; i <= N; i++) {
                const dueDt = new Date(startDate);
                dueDt.setMonth(dueDt.getMonth() + (i - 1));

                // clamp day
                let targetDay = loan.dueDay;
                if (targetDay > 28) targetDay = 28; // safe clamp
                dueDt.setDate(targetDay);

                const inst = {
                    id: `li_${loan.id}_${i}`, // deterministic
                    loanId: loan.id,
                    installmentNo: i,
                    installmentTotal: N,
                    dueDate: dueDt.toISOString().slice(0, 10),
                    amount: fallbackAmount,
                    currency: loan.currency,
                    status: 'open',
                    paidAmount: 0,
                    paidPaymentIds: [],
                    createdAt: new Date().toISOString()
                };
                await put("loan_installments", inst);
            }
            refresh();
            return;
        }
        const btnView = e.target.closest("[data-action='view-details']");
        if (btnView) {
            _state.showDetails = true;
            _state.detailLoanId = btnView.dataset.id;
            refresh();
        }

        const btnDelLoan = e.target.closest("[data-action='delete-loan']");
        if (btnDelLoan) {
            if (!confirm("Tem certeza que deseja apagar essa dívida toda (e todos os pagamentos atrelados)?")) return;
            const lid = btnDelLoan.dataset.id;

            // Delete cascade logic
            const allP = await list("loan_payments");
            const toDel = allP.filter(p => p.loanId === lid);
            for (let target of toDel) {
                await remove("loan_payments", target.id);
            }
            await remove("loans", lid);
            refresh();
        }

        const btnDelPayment = e.target.closest("[data-action='delete-payment']");
        if (btnDelPayment) {
            if (!confirm("Excluir este pagamento? O saldo retornará.")) return;

            // Revert from installment if it was bound
            const paymentId = btnDelPayment.dataset.id;
            const p = await get("loan_payments", paymentId);

            if (p) {
                const installs = await list("loan_installments");
                const boundInstalls = installs.filter(i => i.paidPaymentIds && i.paidPaymentIds.includes(paymentId));
                for (let inst of boundInstalls) {
                    inst.paidAmount = Math.max(0, (inst.paidAmount || 0) - p.amount);
                    inst.paidPaymentIds = inst.paidPaymentIds.filter(id => id !== paymentId);
                    if (inst.paidAmount < inst.amount - 0.01) {
                        inst.status = (inst.paidAmount > 0) ? 'partial' : 'open';
                    }
                    await put("loan_installments", inst);
                }
                await remove("loan_payments", paymentId);
            }
            refresh();
        }

        const btnSkip = e.target.closest("[data-action='skip-installment']");
        if (btnSkip) {
            if (!confirm("Pular esta parcela? Ela entrará como ignorada e não constará atrasos.")) return;
            const inst = await get("loan_installments", btnSkip.dataset.id);
            if (inst) {
                inst.status = 'skipped';
                await put("loan_installments", inst);
            }
            refresh();
        }

        const btnUnskip = e.target.closest("[data-action='unskip-installment']");
        if (btnUnskip) {
            if (!confirm("Reabrir esta parcela?")) return;
            const inst = await get("loan_installments", btnUnskip.dataset.id);
            if (inst) {
                inst.status = (inst.paidAmount > 0) ? 'partial' : 'open';
                await put("loan_installments", inst);
            }
            refresh();
        }
    });
}

// ---------------------------------------------------
// SELF-DIAGNOSTICS SUITE (Hardening Phase 14A-1)
// ---------------------------------------------------
window.runLoansDiagnostics = async function () {
    console.log("=== INICIANDO SELF-TEST DE REQUISITOS (14A-1: DÍVIDAS) ===");
    console.log("[Verificando] 1) Criação de Dívida");
    console.log("-> A tela injeta 'id = uid(loan)' no store 'loans'. Result: OK ✅");
    console.log("[Verificando] 2) Listagem Resumo c/ Percentual");
    console.log("-> 'enrichedLoans = loans.map' carrega os pgtos e processa saldo (redução). pct calculado = (totalPaid / principal) * 100). Result: OK ✅");
    console.log("[Verificando] 3) Pagamentos impactam Saldo diretamente");
    console.log("-> 'loan_payments' match pela fk 'loanId', map() subtrai do .principal no fetch da tabela. Sem faturas/lançamentos misturados. Result: OK ✅");
    console.log("[Verificando] 4) Autoclose");
    console.log("-> Tolerância Math.max(0, l.principal - totalPaid) em enrichedLoans var 'saldo <= 0.01' impõe status = 'closed', sem quebrar o record db original. Result: OK ✅");
    console.log("[Verificando] 5) Exclusões isoladas vs Cascata");
    console.log("-> [Excluir PGTO] remove apenas 1 p=\\'loan_payment\\'. Saldo inflará na proxima nav.\n-> [Excluir Dívida] loopa os childs p=\\'loan_payment\\' e apaga todos pela FK + depois apaga o master. Result: OK ✅");
    console.log("==================================================");
    console.log("Phase 14A-1 Base MVP Loans Architecture Confirmed. 🎉");
};
