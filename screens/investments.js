import { get, list } from "../db.js?v=v2";
import {
    listInvestmentBoxes,
    putInvestmentBox,
    deleteInvestmentBox,
    addInvestmentMove,
    deleteInvestmentMove,
    listMovesByBoxId,
    computeBoxBalance,
    computeInvestmentMonthlyReturn
} from "../db.js?v=v2";
import { getBrandIcon } from "../utils/brand.js?v=2.1";

export function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function fmtCurrency(val, currency = "BRL") {
    return val.toLocaleString("pt-BR", { style: "currency", currency: currency });
}

export async function investmentsScreen() {
    return `
    <div id="investmentsContainer" style="padding-bottom:100px;">
        <div class="card" style="margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0;"><span style="font-size:1.2em; vertical-align:middle;">📈</span> Investimentos</h3>
                <button class="btn btn-outline small" onclick="location.hash='#home'">← Voltar</button>
            </div>
            <p style="color:#666; font-size:12px; margin-top:5px;">Acompanhe seus investimentos por conta, registre aportes, retiradas e rendimentos.</p>
        </div>

        <div class="card" style="margin-bottom:15px; border-left:4px solid #007bff;">
            <h4 style="margin-top:0; font-size:14px;">Novo Investimento</h4>
            <form id="frmNewBox" style="display:flex; flex-direction:column; gap:10px;">
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <div style="flex:1; min-width:150px;">
                        <label class="small" style="display:block; margin-bottom:2px;">Conta / Banco</label>
                        <select id="boxAccountId" class="select">
                            <option value="">Carregando...</option>
                        </select>
                    </div>
                    <div style="flex:1; min-width:120px;">
                        <label class="small" style="display:block; margin-bottom:2px;">Tipo</label>
                        <select id="boxType" class="select" required>
                            <option value="box">Caixinha / Reserva</option>
                            <option value="cdb">CDB</option>
                            <option value="cdi">CDI</option>
                            <option value="poupanca">Poupança</option>
                            <option value="crypto">Criptomoedas</option>
                            <option value="other">Outros</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label class="small" style="display:block; margin-bottom:2px;">Nome</label>
                    <input type="text" id="boxName" class="input" placeholder="Ex: Reserva de Emergência, CDB 110%" required>
                </div>
                <div style="display:flex; gap:10px;">
                    <div style="flex:1;">
                        <label class="small" style="display:block; margin-bottom:2px;">Moeda</label>
                        <select id="boxCurrency" class="select" required>
                            <option value="BRL">BRL (R$)</option>
                            <option value="USD">USD ($)</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label class="small" style="display:block; margin-bottom:2px;">Observação (opcional)</label>
                    <input type="text" id="boxNote" class="input" placeholder="Planejamento, meta, etc">
                </div>
                <button type="submit" class="btn btn-primary" style="align-self:flex-start;">Criar Investimento</button>
            </form>
        </div>

        <div id="investmentsList">
            <div class="card" style="text-align:center; padding: 20px;">Carregando...</div>
        </div>
    </div>
    `;
}

export async function wireInvestmentsHandlers(rootEl) {
    const listEl = rootEl.querySelector("#investmentsList");
    const frmNewBox = rootEl.querySelector("#frmNewBox");
    const accSelect = rootEl.querySelector("#boxAccountId");

    let boxes = [];
    let accounts = [];
    let sysUsdRate = 5.0; // fallback

    const loadData = async () => {
        try {
            boxes = await listInvestmentBoxes();
            accounts = await list("accounts");
            const set = await get("settings", "usd_rate");
            if (set && set.value) sysUsdRate = parseFloat(set.value);

            // Populate account select
            accSelect.innerHTML = `<option value="">(Sem Banco)</option>` +
                accounts.map(a => `<option value="${a.id}">${esc(a.name)} (${esc(a.currency)})</option>`).join("");

            await renderBoxes();
        } catch (e) {
            console.error(e);
            listEl.innerHTML = `<div class="card error">Erro ao carregar investimentos.</div>`;
        }
    };

    const renderBoxes = async () => {
        if (boxes.length === 0) {
            listEl.innerHTML = `<div class="card" style="text-align:center; color:#666; padding:30px;">
                Nenhum investimento criado ainda. <br/>Use o formulário acima para começar a investir!
            </div>`;
            return;
        }

        const groups = {};
        for (const box of boxes) {
            const actId = box.accountId || "none";
            if (!groups[actId]) groups[actId] = [];
            groups[actId].push(box);
        }

        const currentMonth = new Date().toISOString().slice(0, 7);
        let html = '';

        for (const actId of Object.keys(groups)) {
            const acc = accounts.find(a => a.id === actId);
            const title = acc ? esc(acc.name) : "Sem Banco";
            const colorHex = acc && acc.colorHex && acc.colorHex !== "#666666" ? acc.colorHex : "#007bff";
            const brandText = acc && acc.brandKey ? `[${getBrandIcon(acc.brandKey)}]` : `[🏦]`;

            let groupBalBRL = 0;
            const bxs = groups[actId];
            let listHtml = '';

            let monthYieldsBRL = 0;
            let monthDepositsBRL = 0;

            for (const box of bxs) {
                const { balance, balanceBRL, moveCount } = await computeBoxBalance(box.id);
                groupBalBRL += balanceBRL;

                const moves = await listMovesByBoxId(box.id);
                moves.forEach(m => {
                    if (m.date && m.date.startsWith(currentMonth)) {
                        if (m.kind === "yield") monthYieldsBRL += (m.amountBRL || 0);
                        if (m.kind === "deposit") monthDepositsBRL += (m.amountBRL || 0);
                    }
                });

                let balanceExtraHtml = '';
                if (box.currency === 'USD' && balance > 0) {
                    balanceExtraHtml = `<div style="font-size:11px; color:#666; margin-top:2px;">≈ ${fmtCurrency(balanceBRL, "BRL")} (Convertido)</div>`;
                }

                const typeBadge = box.type ? `<span style="background:#eee; font-size:10px; padding:2px 6px; border-radius:10px; color:#555; text-transform:uppercase;">${esc(box.type)}</span>` : "";

                listHtml += `
                <div class="card" style="margin-bottom:10px; border:1px solid #ddd; position:relative; box-shadow:none;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                        <div>
                            <div style="font-weight:bold; font-size:16px; color:#333; margin-bottom:4px;">${esc(box.name)} ${typeBadge}</div>
                            <div style="font-size:12px; color:#666;">Moeda: ${box.currency}</div>
                            ${box.note ? `<div style="font-size:11px; color:#888; font-style:italic; margin-top:2px;">${esc(box.note)}</div>` : ''}
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:11px; color:#666; text-transform:uppercase;">Saldo Atual</div>
                            <div style="font-size:18px; font-weight:bold; color:${balance >= 0 ? '#28a745' : '#dc3545'};">${fmtCurrency(balance, box.currency)}</div>
                            ${balanceExtraHtml}
                        </div>
                    </div>

                    <!-- Action Buttons -->
                    <div style="display:flex; gap:5px; flex-wrap:wrap; margin-bottom:10px;">
                        <button class="btn btn-outline small" style="color:#28a745; border-color:#28a745;" data-action="toggle-form" data-target="form-dep-${box.id}">➕ Aporte</button>
                        <button class="btn btn-outline small" style="color:#dc3545; border-color:#dc3545;" data-action="toggle-form" data-target="form-with-${box.id}">➖ Retirada</button>
                        <button class="btn btn-outline small" style="color:#17a2b8; border-color:#17a2b8;" data-action="toggle-form" data-target="form-yld-${box.id}">📈 Rendimento</button>
                        <button class="btn btn-secondary small" data-action="toggle-history" data-id="${box.id}">📜 Histórico (${moveCount})</button>
                        <div style="flex:1"></div>
                        <button class="btn btn-outline small" style="color:#666;" data-action="delete-box" data-id="${box.id}" title="Excluir Investimento">🗑️</button>
                    </div>

                    <!-- Forms (Hidden by default) -->
                    <div id="form-dep-${box.id}" style="display:none; background:#f9f9f9; padding:10px; border-radius:4px; margin-bottom:10px; border-left:3px solid #28a745;">
                        <div style="font-weight:bold; font-size:12px; margin-bottom:5px; color:#28a745;">Registrar Aporte (+)</div>
                        <div style="display:flex; gap:5px; flex-wrap:wrap;">
                            <input type="date" id="dep-date-${box.id}" class="input small" value="${new Date().toISOString().slice(0, 10)}" style="flex:1; min-width:110px;">
                            <input type="number" step="0.01" id="dep-val-${box.id}" class="input small" placeholder="Valor" style="flex:1; min-width:80px;">
                            <input type="text" id="dep-note-${box.id}" class="input small" placeholder="Obs..." style="flex:2; min-width:120px;">
                            <button class="btn btn-success small" data-action="save-move" data-id="${box.id}" data-type="deposit">Salvar</button>
                        </div>
                    </div>

                    <div id="form-with-${box.id}" style="display:none; background:#f9f9f9; padding:10px; border-radius:4px; margin-bottom:10px; border-left:3px solid #dc3545;">
                        <div style="font-weight:bold; font-size:12px; margin-bottom:5px; color:#dc3545;">Registrar Retirada (-)</div>
                        <div style="display:flex; gap:5px; flex-wrap:wrap;">
                            <input type="date" id="with-date-${box.id}" class="input small" value="${new Date().toISOString().slice(0, 10)}" style="flex:1; min-width:110px;">
                            <input type="number" step="0.01" id="with-val-${box.id}" class="input small" placeholder="Valor" style="flex:1; min-width:80px;">
                            <input type="text" id="with-note-${box.id}" class="input small" placeholder="Obs..." style="flex:2; min-width:120px;">
                            <button class="btn btn-danger small" data-action="save-move" data-id="${box.id}" data-type="withdraw">Salvar</button>
                        </div>
                    </div>

                    <div id="form-yld-${box.id}" style="display:none; background:#f9f9f9; padding:10px; border-radius:4px; margin-bottom:10px; border-left:3px solid #17a2b8;">
                        <div style="font-weight:bold; font-size:12px; margin-bottom:5px; color:#17a2b8;">Registrar Rendimento (+)</div>
                        <div style="display:flex; gap:5px; flex-wrap:wrap;">
                            <input type="date" id="yld-date-${box.id}" class="input small" value="${new Date().toISOString().slice(0, 10)}" style="flex:1; min-width:110px;">
                            <input type="number" step="0.01" id="yld-val-${box.id}" class="input small" placeholder="Valor" style="flex:1; min-width:80px;">
                            <input type="text" id="yld-note-${box.id}" class="input small" placeholder="Obs (ex: CDI Diário)..." style="flex:2; min-width:120px;">
                            <button class="btn btn-primary small" style="background-color:#17a2b8; border-color:#17a2b8;" data-action="save-move" data-id="${box.id}" data-type="yield">Salvar</button>
                        </div>
                    </div>

                    <!-- History Container -->
                    <div id="history-${box.id}" style="display:none; margin-top:10px; border-top:1px dashed #ccc; padding-top:10px;">
                        <div style="text-align:center; font-size:12px; color:#999;">Carregando histórico...</div>
                    </div>
                </div>
                `;
            }

            html += `
            <div style="margin-bottom:20px;">
                <h3 style="margin: 0 0 10px 0; color:${colorHex}; border-bottom:2px solid ${colorHex}; padding-bottom:5px; display:flex; justify-content:space-between; align-items:flex-end;">
                    <span><span style="display:inline-block; width:12px; height:12px; background:${colorHex}; border-radius:50%; margin-right:5px;"></span> ${title} <span style="font-size:12px; color:#666; font-weight:normal;">${brandText}</span></span>
                    <span style="font-size:14px; color:#333;">Patrimônio: ${fmtCurrency(groupBalBRL, "BRL")}</span>
                </h3>
                <div style="display:flex; gap:15px; margin-bottom:10px; font-size:12px;">
                    <div><span style="color:#666;">Aportes do Mês (${currentMonth.split('-')[1]}):</span> <strong style="color:#28a745;">${fmtCurrency(monthDepositsBRL, "BRL")}</strong></div>
                    <div><span style="color:#666;">Rendimentos do Mês:</span> <strong style="color:#17a2b8;">${fmtCurrency(monthYieldsBRL, "BRL")}</strong></div>
                </div>
                ${listHtml}
            </div>`;
        }

        listEl.innerHTML = html;
        bindListEvents();
    };

    const bindListEvents = () => {
        // Toggle inline forms
        listEl.querySelectorAll('[data-action="toggle-form"]').forEach(btn => {
            btn.onclick = (e) => {
                const targetId = e.target.dataset.target;
                const el = listEl.querySelector("#" + targetId);
                if (el) el.style.display = el.style.display === "none" ? "block" : "none";
            };
        });

        // Save move
        listEl.querySelectorAll('[data-action="save-move"]').forEach(btn => {
            btn.onclick = async (e) => {
                const boxId = e.target.dataset.id;
                const type = e.target.dataset.type; // 'deposit' | 'withdraw' | 'yield'
                const prefix = type === 'deposit' ? 'dep' : (type === 'withdraw' ? 'with' : 'yld');

                const dateEl = listEl.querySelector("#" + prefix + "-date-" + boxId);
                const valEl = listEl.querySelector("#" + prefix + "-val-" + boxId);
                const noteEl = listEl.querySelector("#" + prefix + "-note-" + boxId);

                const val = parseFloat(valEl.value);
                if (isNaN(val) || val <= 0) {
                    alert("Por favor, insira um valor válido maior que zero.");
                    return;
                }
                if (!dateEl.value) {
                    alert("A data é obrigatória.");
                    return;
                }

                // Get box info
                const box = boxes.find(b => b.id === boxId);
                const isUSD = box.currency === 'USD';

                const move = {
                    boxId,
                    date: dateEl.value,
                    kind: type,
                    amount: val,
                    currency: box.currency,
                    note: noteEl.value || null,
                };

                if (isUSD) {
                    move.amountBRL = val * sysUsdRate; // basic conversion based on settings snapshot
                } else {
                    move.amountBRL = val;
                }

                try {
                    await addInvestmentMove(move);

                    // Clear inputs
                    valEl.value = "";
                    noteEl.value = "";

                    // Reload
                    await loadData();
                } catch (err) {
                    console.error("Erro ao salvar movimento:", err);
                    alert("Erro ao salvar o movimento: " + err.message);
                }
            };
        });

        // Toggle History
        listEl.querySelectorAll('[data-action="toggle-history"]').forEach(btn => {
            btn.onclick = async (e) => {
                const boxId = e.target.dataset.id;
                const histEl = listEl.querySelector("#history-" + boxId);

                if (histEl.style.display === "block") {
                    histEl.style.display = "none";
                    return;
                }

                histEl.style.display = "block";

                try {
                    const moves = await listMovesByBoxId(boxId);
                    moves.sort((a, b) => b.date.localeCompare(a.date));

                    if (moves.length === 0) {
                        histEl.innerHTML = '<div style="font-size:12px; color:#666; text-align:center;">Nenhum movimento registrado.</div>';
                        return;
                    }

                    const box = boxes.find(b => b.id === boxId);

                    let mHtml = '<table style="width:100%; font-size:12px; border-collapse:collapse;">';
                    moves.forEach((m, idx) => {
                        if (idx >= 30) return; // Load up to 30

                        let color = '#333';
                        let sign = '';
                        let kindText = '';
                        if (m.kind === 'deposit') { color = '#28a745'; sign = '+'; kindText = 'Aporte'; }
                        else if (m.kind === 'withdraw') { color = '#dc3545'; sign = '-'; kindText = 'Retirada'; }
                        else if (m.kind === 'yield') { color = '#17a2b8'; sign = '+'; kindText = 'Rendimento'; }

                        mHtml += `
                        <tr style="border-bottom:1px solid #f0f0f0;">
                            <td style="padding:4px 0;">${m.date.split("-").reverse().join("/")}</td>
                            <td style="padding:4px 0;"><span style="background:#eee; padding:2px 4px; border-radius:4px; font-size:10px;">${kindText}</span></td>
                            <td style="padding:4px 0; color:${color}; font-weight:bold;">${sign} ${fmtCurrency(m.amount, m.currency)}</td>
                            <td style="padding:4px 0; color:#666;">${esc(m.note) || '-'}</td>
                            <td style="padding:4px 0; text-align:right;">
                                <button class="btn btn-outline small" style="padding:1px 4px; font-size:10px; color:#dc3545;" data-action="del-move" data-id="${m.id}" title="Excluir Movimento">✕</button>
                            </td>
                        </tr>
                        `;
                    });

                    if (moves.length > 30) {
                        mHtml += `<tr><td colspan="5" style="text-align:center; padding:5px; color:#999;">Exibindo últimos 30 movimentos de ${moves.length}</td></tr>`;
                    }

                    mHtml += '</table>';
                    histEl.innerHTML = mHtml;

                    histEl.querySelectorAll('[data-action="del-move"]').forEach(delBtn => {
                        delBtn.onclick = async (ev) => {
                            if (!confirm("Tem certeza que deseja excluir este movimento? O saldo do investimento será recalculado.")) return;
                            try {
                                await deleteInvestmentMove(ev.target.dataset.id);
                                await loadData();
                            } catch (err) {
                                alert("Erro ao excluir: " + err.message);
                            }
                        };
                    });

                } catch (err) {
                    histEl.innerHTML = `<div style="color:red; font-size:12px;">Erro ao carregar histórico: ${err.message}</div>`;
                }
            };
        });

        // Delete Box
        listEl.querySelectorAll('[data-action="delete-box"]').forEach(btn => {
            btn.onclick = async (e) => {
                const boxId = e.target.dataset.id;
                if (!confirm("Tem certeza que deseja excluir este Investimento? TODOS OS MOVIMENTOS DELE SERÃO APAGADOS EM CASCATA e isso exclui o histórico de investimento.")) return;

                try {
                    await deleteInvestmentBox(boxId);
                    await loadData();
                } catch (err) {
                    alert("Erro ao excluir investimento: " + err.message);
                }
            };
        });
    };

    // Create Box Form
    frmNewBox.onsubmit = async (e) => {
        e.preventDefault();
        const btn = frmNewBox.querySelector('button[type="submit"]');
        const originalText = btn.textContent;
        btn.textContent = "Salvando...";
        btn.disabled = true;

        const box = {
            name: rootEl.querySelector("#boxName").value.trim(),
            currency: rootEl.querySelector("#boxCurrency").value,
            type: rootEl.querySelector("#boxType").value,
            accountId: rootEl.querySelector("#boxAccountId").value || null,
            note: rootEl.querySelector("#boxNote").value.trim()
        };

        try {
            await putInvestmentBox(box);
            frmNewBox.reset();
            await loadData();
        } catch (err) {
            console.error(err);
            alert("Erro ao criar investimento: " + err.message);
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    };

    // Initial load
    loadData();
}
