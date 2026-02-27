import re

with open("screens/banks.js", "r") as f:
    code = f.read()

# Add wiring for new buttons
disp_wiring_old = """    const domBtnYear = container.querySelector("#btnBanksModeYear");
    const domChart = container.querySelector("#banksYieldChart");"""

disp_wiring_new = """    const domBtnYear = container.querySelector("#btnBanksModeYear");
    
    const domBtnDispPatri = container.querySelector("#btnBanksDispPatri");
    const domBtnDispYield = container.querySelector("#btnBanksDispYield");
    const domBtnDispPerf = container.querySelector("#btnBanksDispPerf");

    const updateDispButtons = () => {
        if(domBtnDispPatri) domBtnDispPatri.className = `btn small ${state.displayMode === 'patrimony' ? 'btn-primary' : ''}`;
        if(domBtnDispYield) domBtnDispYield.className = `btn small ${state.displayMode === 'yield' ? 'btn-primary' : ''}`;
        if(domBtnDispPerf) domBtnDispPerf.className = `btn small ${state.displayMode === 'performance' ? 'btn-primary' : ''}`;
    };

    if(domBtnDispPatri) domBtnDispPatri.onclick = () => { state.displayMode = 'patrimony'; updateDispButtons(); refresh(); };
    if(domBtnDispYield) domBtnDispYield.onclick = () => { state.displayMode = 'yield'; updateDispButtons(); refresh(); };
    if(domBtnDispPerf) domBtnDispPerf.onclick = () => { state.displayMode = 'performance'; updateDispButtons(); refresh(); };

    const domChart = container.querySelector("#banksYieldChart");"""
code = code.replace(disp_wiring_old, disp_wiring_new)

# Refresh Logic Update
refresh_old = """        // Compute Box current total (Up to End of month)
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
                yield: 0,
                deposit: 0,
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
                        yield: 0,
                        deposit: 0,
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

            moves.filter(m => m.boxId === bx.id && inScope(m.date)).forEach(m => {
                const v = m.amountBRL ?? m.amount ?? 0;
                if (m.kind === 'yield') { bYield += v; bankData[aid].yield += v; }
                if (m.kind === 'deposit') { bDep += v; bankData[aid].deposit += v; }
            });

            bankData[aid].boxes.push({
                box: bx,
                balance: bbal,
                yield: bYield,
                deposit: bDep
            });
        });

        const activeBanks = Object.values(bankData).filter(b => b.cashBalance !== 0 || b.invBalance !== 0 || b.yield !== 0 || b.deposit !== 0);

        // Sort by Yield DESC
        activeBanks.sort((a, b) => b.yield - a.yield);

        // Update Title
        domLabelTitle.innerText = state.viewMode === 'month' ? "Rendimento por Banco (Mês)" : "Rendimento por Banco (Acumulado Ano)";

        // Draw Chart
        const chartData = activeBanks.filter(b => b.yield > 0).slice(0, 5).map(b => ({
            label: b.name,
            value: b.yield,
            id: b.id
        }));

        if (domChart.getContext) {
            domChart.height = Math.max(150, chartData.length * 35 + 40); // Dynamic height
            const ctx = domChart.getContext('2d');
            chartHitboxes = drawBarChart(domChart, chartData, { colorBar: "#17a2b8" }) || [];
        }

        // Top 3 Ranking text
        if (chartData.length > 0) {
            let rankHtml = '<strong>🏆 Top 3 Rendimentos:</strong> ';
            const top3 = chartData.slice(0, 3);
            rankHtml += top3.map((d, i) => `${i + 1}º ${esc(d.label)} (${fmtBRL(d.value)})`).join(" | ");
            domRankingText.innerHTML = rankHtml;
        } else {
            domRankingText.innerHTML = `<span style="color:#999;">Sem rendimentos no período.</span>`;
        }"""

refresh_new = """        const periodStartMonth = state.viewMode === 'year' ? `${currentYear}-01` : state.month;

        // Compute Box Balances Start & End
        const boxBalancesStart = {};
        const boxBalancesEnd = {};
        boxes.forEach(b => { boxBalancesStart[b.id] = 0; boxBalancesEnd[b.id] = 0; });
        moves.forEach(m => {
            if (m.date) {
                const mstr = m.date.substring(0, 7);
                const v = m.amountBRL ?? m.amount ?? 0;
                const isAdd = (m.kind === 'deposit' || m.kind === 'yield');
                const isSub = (m.kind === 'withdraw' || m.kind === 'taxes' || m.kind === 'fees');
                const val = isAdd ? v : (isSub ? -v : 0);

                if (mstr < periodStartMonth) boxBalancesStart[m.boxId] += val;
                if (mstr <= state.month) boxBalancesEnd[m.boxId] += val;
            }
        });

        // Group yields, deposits, and boxes by Account
        const bankData = {};
        accounts.forEach(a => {
            bankData[a.id] = {
                id: a.id, name: a.name, brandKey: a.brandKey || 'default',
                yield: 0, deposit: 0,
                invBalanceStart: 0, invBalanceEnd: 0,
                cashBalance: accountCash[a.id] || 0, boxes: []
            };
        });

        const semBancoId = "sem_banco";

        boxes.forEach(bx => {
            let aid = bx.accountId;
            if (!aid || !bankData[aid]) {
                aid = semBancoId;
                if (!bankData[aid]) bankData[aid] = { id: aid, name: "Sem Banco", brandKey: "default", yield: 0, deposit: 0, invBalanceStart: 0, invBalanceEnd: 0, cashBalance: 0, boxes: [] };
            }

            const bbalStart = boxBalancesStart[bx.id] || 0;
            const bbalEnd = boxBalancesEnd[bx.id] || 0;
            const avgBal = (bbalStart + bbalEnd) / 2;

            bankData[aid].invBalanceStart += bbalStart;
            bankData[aid].invBalanceEnd += bbalEnd;

            let bYield = 0;
            let bDep = 0;

            moves.filter(m => m.boxId === bx.id && inScope(m.date)).forEach(m => {
                const v = m.amountBRL ?? m.amount ?? 0;
                if (m.kind === 'yield') { bYield += v; bankData[aid].yield += v; }
                if (m.kind === 'deposit') { bDep += v; bankData[aid].deposit += v; }
                if (m.kind === 'withdraw') { bDep -= v; bankData[aid].deposit -= v; }
            });

            let boxRoi = null;
            if (avgBal > 0) boxRoi = (bYield / avgBal) * 100;

            bankData[aid].boxes.push({ box: bx, balanceStart: bbalStart, balance: bbalEnd, avgBal, yield: bYield, deposit: bDep, roi: boxRoi });
        });

        const activeBanks = Object.values(bankData).filter(b => b.cashBalance !== 0 || b.invBalanceEnd !== 0 || b.yield !== 0 || b.deposit !== 0);

        // Bank ROI
        activeBanks.forEach(b => {
             b.avgBal = (b.invBalanceStart + b.invBalanceEnd) / 2;
             b.patrimony = b.cashBalance + b.invBalanceEnd;
             b.roi = b.avgBal > 0 ? (b.yield / b.avgBal) * 100 : null;
        });

        // Set up Chart & List based on Display Mode
        let chartData = [];
        if (state.displayMode === 'patrimony') {
            activeBanks.sort((a, b) => b.patrimony - a.patrimony);
            domLabelTitle.innerText = "Patrimônio por Banco";
            chartData = activeBanks.filter(b => b.patrimony > 0).slice(0, 5).map(b => ({ label: b.name, value: b.patrimony, id: b.id }));
            
            let rankHtml = '<strong>🏆 Top 3 Patrimônios:</strong> ';
            const top3 = chartData.slice(0, 3);
            rankHtml += top3.length > 0 ? top3.map((d, i) => `${i + 1}º ${esc(d.label)} (${fmtBRL(d.value)})`).join(" | ") : '<span style="color:#999;">Sem dados.</span>';
            domRankingText.innerHTML = rankHtml;
        } 
        else if (state.displayMode === 'performance') {
            activeBanks.sort((a, b) => (b.roi || 0) - (a.roi || 0));
            domLabelTitle.innerText = "Ranking de Performance por Banco (ROI%)";
            chartData = activeBanks.filter(b => b.roi !== null && b.roi > 0).slice(0, 5).map(b => ({ label: b.name, value: b.roi, id: b.id }));
            
            // Collect all investments for Top 10 ROI
            const allInvestments = [];
            activeBanks.forEach(b => {
                b.boxes.forEach(bx => {
                    if (bx.roi !== null && bx.roi > 0) {
                        allInvestments.push({
                            bankName: b.name,
                            invName: bx.box.name,
                            roi: bx.roi,
                            yield: bx.yield
                        });
                    }
                });
            });
            allInvestments.sort((a, b) => b.roi - a.roi);
            
            let rankHtml = '<strong>🚀 Top 10 Investimentos (ROI%):</strong><br>';
            const top10 = allInvestments.slice(0, 10);
            if (top10.length > 0) {
                rankHtml += `<div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:5px;">`;
                rankHtml += top10.map((inv, i) => `<span style="background:#f1f1f1; padding:2px 6px; border-radius:4px;">${i + 1}º ${esc(inv.invName)} (${inv.roi.toFixed(2)}%)</span>`).join("");
                rankHtml += `</div>`;
            } else {
                rankHtml += '<span style="color:#999;">Sem dados de performance.</span>';
            }
            domRankingText.innerHTML = rankHtml;
        }
        else {
            // yield
            activeBanks.sort((a, b) => b.yield - a.yield);
            domLabelTitle.innerText = state.viewMode === 'month' ? "Rendimento por Banco (Mês)" : "Rendimento por Banco (Acumulado Ano)";
            chartData = activeBanks.filter(b => b.yield > 0).slice(0, 5).map(b => ({ label: b.name, value: b.yield, id: b.id }));
            
            let rankHtml = '<strong>🏆 Top 3 Rendimentos:</strong> ';
            const top3 = chartData.slice(0, 3);
            rankHtml += top3.length > 0 ? top3.map((d, i) => `${i + 1}º ${esc(d.label)} (${fmtBRL(d.value)})`).join(" | ") : '<span style="color:#999;">Sem rendimentos.</span>';
            domRankingText.innerHTML = rankHtml;
        }

        if (domChart.getContext) {
            domChart.height = Math.max(150, chartData.length * 35 + 40);
            const ctx = domChart.getContext('2d');
            const colorOption = state.displayMode === 'performance' ? "#6f42c1" : (state.displayMode === 'patrimony' ? "#007bff" : "#17a2b8");
            const formatVal = state.displayMode === 'performance' ? (v) => v.toFixed(2) + "%" : fmtBRL;
            chartHitboxes = drawBarChart(domChart, chartData, { colorBar: colorOption, formatValue: formatVal }) || [];
        }"""
code = code.replace(refresh_old, refresh_new)

# Sub for list rendering
list_old = """            activeBanks.forEach(b => {
                const isSemBanco = b.id === semBancoId;
                const icon = getBrandIcon(b.brandKey);
                const color = getBrandColor(b.brandKey, "#fefefe");
                const patrimony = b.cashBalance + b.invBalance;

                listHtml += `
                <div class="card" id="bank_card_${b.id}" style="margin-bottom:10px; padding:0; overflow:hidden; border:1px solid #eee;">
                    <!-- HEADER -->
                    <div class="bank-header" style="background:${color}; padding:15px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;" onclick="document.getElementById('bank_details_${b.id}').style.display = document.getElementById('bank_details_${b.id}').style.display === 'none' ? 'block' : 'none';">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div style="font-size:24px; background:#fff; width:40px; height:40px; display:flex; justify-content:center; align-items:center; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">${icon}</div>
                            <div>
                                <div style="font-weight:bold; font-size:16px; color:#333;">${esc(b.name)}</div>
                                <div style="font-size:12px; color:#555;">Patrimônio: <strong>${fmtBRL(patrimony)}</strong></div>
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:14px; color:#17a2b8;">Rend: <strong>+${fmtBRL(b.yield)}</strong></div>
                            <div style="font-size:12px; color:#28a745;">Aportes: +${fmtBRL(b.deposit)}</div>
                        </div>
                    </div>
                    
                    <!-- ACCORDION CONTENT -->
                    <div id="bank_details_${b.id}" style="display:none; padding:15px; background:#fff;">
                        
                        <!-- Mini-tabela de Conta + Investimentos -->
                        <div style="overflow-x:auto;">
                            <table style="width:100%; font-size:12px; border-collapse:collapse; min-width:400px; margin-bottom:15px;">
                                <thead>
                                    <tr style="border-bottom:1px solid #ddd; text-align:left; color:#666;">
                                        <th style="padding:5px;">Ativo</th>
                                        <th style="padding:5px; text-align:right;">Rendimentos</th>
                                        <th style="padding:5px; text-align:right;">Aportes</th>
                                        <th style="padding:5px; text-align:right;">Saldo Atual</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${isSemBanco ? '' : `
                                    <tr style="border-bottom:1px solid #eee;">
                                        <td style="padding:5px;"><strong>🏦 Conta Corrente</strong></td>
                                        <td style="padding:5px; text-align:right; color:#ccc;">-</td>
                                        <td style="padding:5px; text-align:right; color:#ccc;">-</td>
                                        <td style="padding:5px; text-align:right; font-weight:bold;">${fmtBRL(b.cashBalance)}</td>
                                    </tr>
                                    `}
                                    ${b.boxes.sort((x, y) => y.balance - x.balance).map(bx => `
                                    <tr style="border-bottom:1px solid #f9f9f9;">
                                        <td style="padding:5px;">📈 ${esc(bx.box.name)} <small style="color:#999;">(${bx.box.type || 'box'})</small></td>
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
            });"""

list_new = """            activeBanks.forEach(b => {
                const isSemBanco = b.id === semBancoId;
                const icon = getBrandIcon(b.brandKey);
                const color = getBrandColor(b.brandKey, "#fefefe");
                
                let headerStatsHTML = '';
                if (state.displayMode === 'performance') {
                    headerStatsHTML = `
                        <div style="font-size:14px; color:#6f42c1;">ROI: <strong>${b.roi !== null ? b.roi.toFixed(2) + '%' : '—'}</strong></div>
                        <div style="font-size:12px; color:#17a2b8;">Rend: +${fmtBRL(b.yield)}</div>
                    `;
                } else {
                    headerStatsHTML = `
                        <div style="font-size:14px; color:#17a2b8;">Rend: <strong>+${fmtBRL(b.yield)}</strong></div>
                        <div style="font-size:12px; color:#28a745;">AportLiq: ${b.deposit >= 0 ? '+' : ''}${fmtBRL(b.deposit)}</div>
                    `;
                }

                let subTableHeaders = '';
                if (state.displayMode === 'performance') {
                    subTableHeaders = `
                        <th style="padding:5px;">Ativo</th>
                        <th style="padding:5px; text-align:right;">Rendimentos</th>
                        <th style="padding:5px; text-align:right;">ROI%</th>
                        <th style="padding:5px; text-align:right;">Saldo Final</th>
                    `;
                } else {
                    subTableHeaders = `
                        <th style="padding:5px;">Ativo</th>
                        <th style="padding:5px; text-align:right;">Rendimentos</th>
                        <th style="padding:5px; text-align:right;">Aportes</th>
                        <th style="padding:5px; text-align:right;">Saldo Atual</th>
                    `;
                }

                listHtml += `
                <div class="card" id="bank_card_${b.id}" style="margin-bottom:10px; padding:0; overflow:hidden; border:1px solid #eee;">
                    <!-- HEADER -->
                    <div class="bank-header" style="background:${color}; padding:15px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;" onclick="document.getElementById('bank_details_${b.id}').style.display = document.getElementById('bank_details_${b.id}').style.display === 'none' ? 'block' : 'none';">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div style="font-size:24px; background:#fff; width:40px; height:40px; display:flex; justify-content:center; align-items:center; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">${icon}</div>
                            <div>
                                <div style="font-weight:bold; font-size:16px; color:#333;">${esc(b.name)}</div>
                                <div style="font-size:12px; color:#555;">Patrimônio: <strong>${fmtBRL(b.patrimony)}</strong></div>
                            </div>
                        </div>
                        <div style="text-align:right;">
                            ${headerStatsHTML}
                        </div>
                    </div>
                    
                    <!-- ACCORDION CONTENT -->
                    <div id="bank_details_${b.id}" style="display:none; padding:15px; background:#fff;">
                        
                        <!-- Mini-tabela de Conta + Investimentos -->
                        <div style="overflow-x:auto;">
                            <table style="width:100%; font-size:12px; border-collapse:collapse; min-width:400px; margin-bottom:15px;">
                                <thead>
                                    <tr style="border-bottom:1px solid #ddd; text-align:left; color:#666;">
                                        ${subTableHeaders}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${isSemBanco ? '' : `
                                    <tr style="border-bottom:1px solid #eee;">
                                        <td style="padding:5px;"><strong>🏦 Conta Corrente</strong></td>
                                        <td style="padding:5px; text-align:right; color:#ccc;">-</td>
                                        <td style="padding:5px; text-align:right; color:#ccc;">-</td>
                                        <td style="padding:5px; text-align:right; font-weight:bold;">${fmtBRL(b.cashBalance)}</td>
                                    </tr>
                                    `}
                                    ${b.boxes.sort((x, y) => {
                                        if(state.displayMode === 'performance') return (y.roi || 0) - (x.roi || 0);
                                        return y.balance - x.balance;
                                    }).map(bx => {
                                        if (state.displayMode === 'performance') {
                                            return `
                                            <tr style="border-bottom:1px solid #f9f9f9;">
                                                <td style="padding:5px;">📈 ${esc(bx.box.name)} <small style="color:#999;">(${bx.box.type || 'box'})</small></td>
                                                <td style="padding:5px; text-align:right; color:#17a2b8;">${bx.yield > 0 ? '+' + fmtBRL(bx.yield) : '-'}</td>
                                                <td style="padding:5px; text-align:right; color:#6f42c1;"><strong>${bx.roi !== null ? bx.roi.toFixed(2) + '%' : '—'}</strong></td>
                                                <td style="padding:5px; text-align:right; font-weight:bold;">${fmtBRL(bx.balance)}</td>
                                            </tr>
                                            `;
                                        } else {
                                            return `
                                            <tr style="border-bottom:1px solid #f9f9f9;">
                                                <td style="padding:5px;">📈 ${esc(bx.box.name)} <small style="color:#999;">(${bx.box.type || 'box'})</small></td>
                                                <td style="padding:5px; text-align:right; color:#17a2b8;">${bx.yield > 0 ? '+' + fmtBRL(bx.yield) : '-'}</td>
                                                <td style="padding:5px; text-align:right; color:#28a745;">${bx.deposit >= 0 ? '+' : ''}${fmtBRL(bx.deposit)}</td>
                                                <td style="padding:5px; text-align:right; font-weight:bold;">${fmtBRL(bx.balance)}</td>
                                            </tr>
                                            `;
                                        }
                                    }).join('')}
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
            });"""
code = code.replace(list_old, list_new)

with open("screens/banks.js", "w") as f:
    f.write(code)
