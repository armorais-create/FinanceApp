import re

with open("screens/banks.js", "r") as f:
    code = f.read()

# Replace state
code = code.replace("viewMode: 'month', // 'month' or 'year'", 
    "viewMode: 'month',\n    displayMode: 'patrimony', // 'patrimony', 'yield', 'performance'")

# Replace Header UI
hdr_old = """            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <input type="month" id="banksMonth" class="input" value="${state.month}">
                <button id="btnBanksToday" class="btn btn-secondary small">Mes Atual</button>
                
                <div style="display:flex; border:1px solid #ddd; border-radius:6px; overflow:hidden;">
                    <button id="btnBanksModeMonth" class="btn small ${state.viewMode === 'month' ? 'btn-primary' : ''}" style="border:none; border-radius:0;">Mês Solto</button>
                    <button id="btnBanksModeYear" class="btn small ${state.viewMode === 'year' ? 'btn-primary' : ''}" style="border:none; border-radius:0;">Acumulado Ano</button>
                </div>
            </div>"""

hdr_new = """            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:15px; width:100%;">
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    <input type="month" id="banksMonth" class="input" value="${state.month}">
                    <button id="btnBanksToday" class="btn btn-secondary small">Mes Atual</button>
                    
                    <div style="display:flex; border:1px solid #ddd; border-radius:6px; overflow:hidden;">
                        <button id="btnBanksModeMonth" class="btn small ${state.viewMode === 'month' ? 'btn-primary' : ''}" style="border:none; border-radius:0;">Mês Solto</button>
                        <button id="btnBanksModeYear" class="btn small ${state.viewMode === 'year' ? 'btn-primary' : ''}" style="border:none; border-radius:0;">Acumulado Ano</button>
                    </div>
                </div>

                <div style="display:flex; align-items:center; gap:5px;">
                    <span style="font-size:12px; color:#666;">Visão:</span>
                    <div style="display:flex; border:1px solid #ddd; border-radius:6px; overflow:hidden;">
                        <button id="btnBanksDispPatri" class="btn small ${state.displayMode === 'patrimony' ? 'btn-primary' : ''}" style="border:none; border-radius:0;">Patrimônio</button>
                        <button id="btnBanksDispYield" class="btn small ${state.displayMode === 'yield' ? 'btn-primary' : ''}" style="border:none; border-radius:0;">Rendimento</button>
                        <button id="btnBanksDispPerf" class="btn small ${state.displayMode === 'performance' ? 'btn-primary' : ''}" style="border:none; border-radius:0;">Performance</button>
                    </div>
                </div>
            </div>"""
code = code.replace(hdr_old, hdr_new)

with open("screens/banks.js", "w") as f:
    f.write(code)
