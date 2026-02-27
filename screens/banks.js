import { list, get } from "../db.js?v=v2";
import { getBrandIcon, getBrandColor } from "../utils/brand.js";
import { drawBarChart } from "../utils/charts.js";

// Basic state
const state = {
    month: new Date().toISOString().slice(0, 7),
    viewMode: 'month',
    displayMode: 'patrimony', // 'patrimony', 'yield', 'performance'
    metric: 'yield', // 'yield' or 'performance'
    data: {
        accounts: [],
        boxes: [],
        moves: [],
        txs: []
    }
};

function esc(str) {
    if (!str) return "";
    return str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const fmtBRL = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

export function banksScreen() {
    return `
    <div id="banksContainer" style="padding-bottom: 80px; width:100%;">
        <!-- HEADER -->
        <div class="card" style="margin-bottom:15px; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:10px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <button class="btn btn-outline small" onclick="location.hash='#home'">← Voltar</button>
                    <h3 style="margin:0; font-size:16px;">Contas e Rendimentos</h3>
                </div>
            </div>
            
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <input type="month" id="banksMonth" class="input" value="${state.month}">
                <button id="btnBanksToday" class="btn btn-secondary small">Mês Atual</button>
                
                <div style="display:flex; border:1px solid #ddd; border-radius:6px; overflow:hidden;">
                    <button id="btnBanksModeMonth" class="btn small ${state.viewMode === 'month' ? 'btn-primary' : ''}" style="border:none; border-radius:0;">Mês Solto</button>
                    <button id="btnBanksModeYear" class="btn small ${state.viewMode === 'year' ? 'btn-primary' : ''}" style="border:none; border-radius:0;">Acumulado Ano</button>
                </div>

                <div style="display:flex; border:1px solid #ddd; border-radius:6px; overflow:hidden;">
                    <button id="btnBanksMetricYield" class="btn small ${state.metric === 'yield' ? 'btn-primary' : ''}" style="border:none; border-radius:0;">Rendimento Nominal</button>
                    <button id="btnBanksMetricPerf" class="btn small ${state.metric === 'performance' ? 'btn-primary' : ''}" style="border:none; border-radius:0;">Performance (ROI)</button>
                </div>
            </div>
        </div>

        <!-- YIELD RANKING WIDGET -->
        <div class="card" style="margin-bottom:15px; padding-bottom:10px;">
            <h3 style="margin-top:0; font-size:14px; border-bottom:1px solid #eee; padding-bottom:5px;" id="lblRankingTitle">Rendimento por Banco</h3>
            <canvas id="banksYieldChart" width="600" height="250" style="width:100%; max-width:600px; display:block; margin:0 auto;"></canvas>
            <div id="banksRankingText" style="margin-top:10px; font-size:12px; border-top:1px solid #eee; padding-top:10px;"></div>
        </div>

        <!-- BANKS LIST -->
        <div id="banksList">
            <div style="text-align:center; padding:20px; color:#999;">Carregando...</div>
        </div>
    </div>
    `;
}

export async function wireBanksHandlers(rootEl) {
    const container = rootEl.querySelector("#banksContainer");
    if (!container) return;

    const domMonth = container.querySelector("#banksMonth");
    const domBtnToday = container.querySelector("#btnBanksToday");
    const domBtnMonth = container.querySelector("#btnBanksModeMonth");
    const domBtnYear = container.querySelector("#btnBanksModeYear");
    const domBtnMetricYield = container.querySelector("#btnBanksMetricYield");
    const domBtnMetricPerf = container.querySelector("#btnBanksMetricPerf");
    const domChart = container.querySelector("#banksYieldChart");
    const domList = container.querySelector("#banksList");
    const domRankingText = container.querySelector("#banksRankingText");
    const domLabelTitle = container.querySelector("#lblRankingTitle");

    // Fetch all data once to avoid repeated calls
    try {
        state.data.accounts = await list("accounts");
        state.data.boxes = await list("investment_boxes");
        state.data.moves = await list("investment_moves");
        state.data.txs = await list("transactions");
    } catch (e) {
        console.error("Error loading banks data", e);
    }

    // Handlers
    domMonth.onchange = (e) => {
        state.month = e.target.value;
        refresh();
    };

    domBtnToday.onclick = () => {
        state.month = new Date().toISOString().slice(0, 7);
        domMonth.value = state.month;
        refresh();
    };

    domBtnMonth.onclick = () => {
        state.viewMode = 'month';
        domBtnMonth.className = "btn small btn-primary";
        domBtnYear.className = "btn small";
        refresh();
    };

    domBtnYear.onclick = () => {
        state.viewMode = 'year';
        domBtnMonth.className = "btn small";
        domBtnYear.className = "btn small btn-primary";
        refresh();
    };

    domBtnMetricYield.onclick = () => {
        state.metric = 'yield';
        domBtnMetricYield.className = "btn small btn-primary";
        domBtnMetricPerf.className = "btn small";
        refresh();
    };

    domBtnMetricPerf.onclick = () => {
        state.metric = 'performance';
        domBtnMetricYield.className = "btn small";
        domBtnMetricPerf.className = "btn small btn-primary";
        refresh();
    };

    let chartHitboxes = [];
    domChart.onclick = (e) => {
        if (!window.getCanvasClickPosition) return;
        const pos = window.getCanvasClickPosition(domChart, e);
        for (const h of chartHitboxes) {
            if (pos.y >= h.y && pos.y <= h.y + h.h) {
                // Find account and expand
                const accId = h.data.id;
                const bankEl = container.querySelector(`#bank_card_${accId}`);
                if (bankEl) {
                    // Scroll to it and click if not already expanded
                    bankEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    const details = container.querySelector(`#bank_details_${accId}`);
                    if (details && details.style.display === "none") {
                        bankEl.querySelector(".bank-header").click();
                    }
                }
                break;
            }
        }
    };

    function refresh() {
        const { accounts, boxes, moves, txs } = state.data;
        const currentYear = state.month.substring(0, 4);

        const inScope = (dateStr) => {
            if (!dateStr) return false;
            if (state.viewMode === 'month') return dateStr.startsWith(state.month);
            // Year: from Jan up to the selected month inclusive
            if (dateStr.substring(0, 4) !== currentYear) return false;
            return dateStr.substring(0, 7) <= state.month;
        };

        const beforeScope = (dateStr) => {
            if (!dateStr) return false;
            if (state.viewMode === 'month') return dateStr.substring(0, 7) < state.month;
            // Year: before Jan of currentYear
            return dateStr.substring(0, 4) < currentYear;
        };

        // Precompute Account Cash Balance (Total up to End of Selected Month)
        // Ignoring year/month toggle for Cash Balance, as balance is always "Current" (up to month end)
        const accountCash = {};
        accounts.forEach(a => accountCash[a.id] = 0);

        txs.forEach(t => {
            if (t.date && t.date.substring(0, 7) <= state.month) {
                const val = t.valueBRL ?? t.value;
                if (t.type === 'revenue' && accountCash[t.accountId] !== undefined) {
                    accountCash[t.accountId] += val;
                } else if (t.type === 'expense' && accountCash[t.accountId] !== undefined) {
                    accountCash[t.accountId] -= val;
                } else if (t.type === 'transfer') {
                    if (accountCash[t.sourceAccountId] !== undefined) accountCash[t.sourceAccountId] -= val;
                    if (accountCash[t.accountId] !== undefined) accountCash[t.accountId] += val;
                }
            }
        });

        // Compute Box current total (Up to End of month)
        const boxBalances = {};
        boxes.forEach(b => boxBalances[b.id] = 0);
        moves.forEach(m => {
            if (m.date && m.date.substring(0, 7) <= state.month) {
                const v = m.amountBRL ?? m.amount ?? 0;
                if (m.kind === 'deposit' || m.kind === 'yield') boxBalances[m.boxId] += v;
                if (m.kind === 'withdraw' || m.kind === 'taxes' || m.kind === 'fees') boxBalances[m.boxId] -= v;
            }
        });

        // Group yields, deposits, and boxes by Account
        const bankData = {};
        // Add all accounts first
        accounts.forEach(a => {
            bankData[a.id] = {
                id: a.id,
                name: a.name,
                brandKey: a.brandKey || 'default',
                colorHex: a.colorHex || null,
                yield: 0,
                deposit: 0,
                startBalance: 0,
                endBalance: 0,
                invBalance: 0,
                cashBalance: accountCash[a.id] || 0,
                boxes: []
            };
        });

        // Add "Sem Banco" virtual account if any box has no account or unknown
        const semBancoId = "sem_banco";

        boxes.forEach(bx => {
            let aid = bx.accountId;
            if (!aid || !bankData[aid]) {
                aid = semBancoId;
                if (!bankData[aid]) {
                    bankData[aid] = {
                        id: aid,
                        name: "Sem Banco",
                        brandKey: "default",
                        colorHex: null,
                        yield: 0,
                        deposit: 0,
                        startBalance: 0,
                        endBalance: 0,
                        invBalance: 0,
                        cashBalance: 0,
                        boxes: []
                    };
                }
            }

            const bbal = boxBalances[bx.id] || 0;
            bankData[aid].invBalance += bbal;

            // Scope stats
            let bYield = 0;
            let bDep = 0;
            let bxStartBalance = 0;

            moves.filter(m => m.boxId === bx.id).forEach(m => {
                const v = m.amountBRL ?? m.amount ?? 0;
                let isAdd = (m.kind === 'deposit' || m.kind === 'yield');
                let isSub = (m.kind === 'withdraw' || m.kind === 'taxes' || m.kind === 'fees');

                if (beforeScope(m.date)) {
                    if (isAdd) bxStartBalance += v;
                    if (isSub) bxStartBalance -= v;
                }

                if (inScope(m.date)) {
                    if (m.kind === 'yield') { bYield += v; bankData[aid].yield += v; }
                    if (m.kind === 'deposit') { bDep += v; bankData[aid].deposit += v; }
                    if (m.kind === 'withdraw') { bDep -= v; bankData[aid].deposit -= v; }
                }
            });

            bankData[aid].startBalance += bxStartBalance;
            bankData[aid].endBalance += bbal;

            const boxAvgBalance = (bxStartBalance + bbal) / 2;
            let roi = null;
            if (boxAvgBalance > 0 && bYield !== 0) {
                roi = (bYield / boxAvgBalance) * 100;
            }

            bankData[aid].boxes.push({
                box: bx,
                balance: bbal,
                yield: bYield,
                deposit: bDep,
                roi: roi
            });
        });

        const activeBanks = Object.values(bankData).filter(b => b.cashBalance !== 0 || b.invBalance !== 0 || b.yield !== 0 || b.deposit !== 0);

        // Calculate Bank ROI
        activeBanks.forEach(b => {
            const bankAvgBalance = (b.startBalance + b.endBalance) / 2;
            if (bankAvgBalance > 0 && b.yield !== 0) {
                b.roi = (b.yield / bankAvgBalance) * 100;
            } else {
                b.roi = null;
            }
        });

        // Sort Data
        const isPerf = state.metric === 'performance';
        if (isPerf) {
            activeBanks.sort((a, b) => (b.roi || 0) - (a.roi || 0));
        } else {
            activeBanks.sort((a, b) => b.yield - a.yield);
        }

        // Update Title
        const titleSuffix = state.viewMode === 'month' ? "(Mês)" : "(Acumulado Ano)";
        domLabelTitle.innerText = isPerf ? `Performance ROI ${titleSuffix}` : `Rendimento Nominal ${titleSuffix}`;

        // Draw Chart
        const chartData = activeBanks.filter(b => isPerf ? b.roi !== null && b.roi > 0 : b.yield > 0).slice(0, 5).map(b => ({
            label: b.name,
            value: isPerf ? parseFloat(b.roi.toFixed(2)) : b.yield,
            id: b.id,
            suffix: isPerf ? '%' : undefined
        }));

        if (domChart.getContext) {
            domChart.height = Math.max(150, chartData.length * 35 + 40); // Dynamic height
            const ctx = domChart.getContext('2d');
            chartHitboxes = drawBarChart(domChart, chartData, { colorBar: isPerf ? "#6f42c1" : "#17a2b8" }) || [];
        }

        // Top Ranking text
        if (chartData.length > 0) {
            let rankHtml = `<strong>🏆 Top 3 ${isPerf ? 'Performance (Bancos)' : 'Rendimentos'}:</strong> `;
            const top3 = chartData.slice(0, 3);
            rankHtml += top3.map((d, i) => `${i + 1}º ${esc(d.label)} (${isPerf ? d.value + '%' : fmtBRL(d.value)})`).join(" | ");

            if (isPerf) {
                // Top 10 boxes overall
                let allBoxes = [];
                activeBanks.forEach(b => {
                    b.boxes.forEach(bx => {
                        if (bx.roi !== null && bx.roi > 0) {
                            allBoxes.push({ name: bx.box.name, roi: bx.roi });
                        }
                    });
                });

                allBoxes.sort((a, b) => b.roi - a.roi);
                const top10Boxes = allBoxes.slice(0, 10);

                if (top10Boxes.length > 0) {
                    rankHtml += '<br><strong style="margin-top:5px; display:inline-block;">🌟 Top 10 Investimentos:</strong> ';
                    rankHtml += top10Boxes.map((d, i) => `${i + 1}º ${esc(d.name)} (${d.roi.toFixed(2)}%)`).join(" | ");
                }
            }

            domRankingText.innerHTML = rankHtml;
        } else {
            domRankingText.innerHTML = `<span style="color:#999;">Sem ${isPerf ? 'performance' : 'rendimentos'} no período.</span>`;
        }

        // Render List
        let listHtml = "";
        if (activeBanks.length === 0) {
            listHtml = `<div style="text-align:center; padding:20px; color:#999;">Nenhuma conta ou investimento encontrado.</div>`;
        } else {
            activeBanks.forEach(b => {
                const isSemBanco = b.id === semBancoId;
                const icon = getBrandIcon(b.brandKey);
                // Define indicator color: custom user color, brand color, or default
                const indicatorColor = b.colorHex || getBrandColor(b.brandKey, "#fefefe");
                const patrimony = b.cashBalance + b.invBalance;

                listHtml += `
                <div class="card" id="bank_card_${b.id}" style="margin-bottom:10px; padding:0; overflow:hidden; border:1px solid #eee; border-left: 5px solid ${indicatorColor};">
                    <div class="bank-header" style="background:#fafafa; padding:15px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;" onclick="document.getElementById('bank_details_${b.id}').style.display = document.getElementById('bank_details_${b.id}').style.display === 'none' ? 'block' : 'none';">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div style="font-size:24px; background:#fff; width:40px; height:40px; display:flex; justify-content:center; align-items:center; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">${icon}</div>
                            <div>
                                <div style="font-weight:bold; font-size:16px; color:#333;">${esc(b.name)}</div>
                                <div style="font-size:12px; color:#555;">Patrimônio: <strong>${fmtBRL(patrimony)}</strong></div>
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:14px; color:${isPerf ? '#6f42c1' : '#17a2b8'};">${isPerf ? 'ROI:' : 'Rend:'} <strong>${isPerf ? (b.roi !== null ? '+' + b.roi.toFixed(2) + '%' : '—') : '+' + fmtBRL(b.yield)}</strong></div>
                            <div style="font-size:12px; color:#28a745;">Aportes: +${fmtBRL(b.deposit)}</div>
                        </div>
                    </div>
                    
                    <div id="bank_details_${b.id}" style="display:none; padding:15px; background:#fff;">
                        <!-- Mini-tabela de Conta + Investimentos -->
                <div style="overflow-x:auto;">
                    <table style="width:100%; font-size:12px; border-collapse:collapse; min-width:400px; margin-bottom:15px;">
                        <thead>
                            <tr style="border-bottom:1px solid #ddd; text-align:left; color:#666;">
                                <th style="padding:5px;">Ativo</th>
                                ${isPerf ? '<th style="padding:5px; text-align:right;">ROI%</th>' : ''}
                                <th style="padding:5px; text-align:right;">Rendimentos</th>
                                <th style="padding:5px; text-align:right;">Aportes</th>
                                <th style="padding:5px; text-align:right;">Saldo Atual</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${isSemBanco ? '' : `
                            <tr style="border-bottom:1px solid #eee;">
                                <td style="padding:5px;"><strong>🏦 Conta Corrente</strong></td>
                                ${isPerf ? '<td style="padding:5px; text-align:right; color:#ccc;">-</td>' : ''}
                                <td style="padding:5px; text-align:right; color:#ccc;">-</td>
                                <td style="padding:5px; text-align:right; color:#ccc;">-</td>
                                <td style="padding:5px; text-align:right; font-weight:bold;">${fmtBRL(b.cashBalance)}</td>
                            </tr>
                                    `}
                            ${b.boxes.sort((x, y) => isPerf ? (y.roi || 0) - (x.roi || 0) : y.balance - x.balance).map(bx => `
                            <tr style="border-bottom:1px solid #f9f9f9;">
                                <td style="padding:5px;">📈 ${esc(bx.box.name)} <small style="color:#999;">(${bx.box.type || 'box'})</small></td>
                                ${isPerf ? `<td style="padding:5px; text-align:right; color:#6f42c1; font-weight:bold;">${bx.roi !== null ? '+' + bx.roi.toFixed(2) + '%' : '—'}</td>` : ''}
                                <td style="padding:5px; text-align:right; color:#17a2b8;">${bx.yield > 0 ? '+' + fmtBRL(bx.yield) : '-'}</td>
                                <td style="padding:5px; text-align:right; color:#28a745;">${bx.deposit > 0 ? '+' + fmtBRL(bx.deposit) : '-'}</td>
                                <td style="padding:5px; text-align:right; font-weight:bold;">${fmtBRL(bx.balance)}</td>
                            </tr>
                                    `).join('')}
                            ${b.boxes.length === 0 ? `<tr><td colspan="4" style="text-align:center; padding:10px; color:#999;">Sem investimentos.</td></tr>` : ''}
                        </tbody>
                    </table>
                </div>
                <div style="text-align:center;">
                    <button class="btn btn-outline small" onclick="location.hash='#investments'">Gerenciar Investimentos →</button>
                </div>
            </div>
                </div>
        `;
            });
        }

        domList.innerHTML = listHtml;
    }

    refresh();
}
