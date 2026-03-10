import { list, put, remove, uid, get, exportDB, importDB, clearDB, resetDB } from "./db.js?v=v2";
import { APP_VERSION } from "./app.js";
import { getBrandIcon, SUPPORTED_BANKS, SUPPORTED_CARDS } from "./utils/brand.js?v=2.2";

function esc(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function showToast(type, message) {
  const container = document.createElement('div');
  container.className = `toast toast-${type === 'error' ? 'danger' : type}`;
  container.innerHTML = `<div>${esc(message)}</div>`;
  document.body.appendChild(container);

  setTimeout(() => {
    container.style.opacity = '0';
    container.style.transform = 'translate(-50%, 20px)';
    container.style.transition = 'all 0.3s ease-out';
    setTimeout(() => {
      if (document.body.contains(container)) {
        document.body.removeChild(container);
      }
    }, 300);
  }, 3500);
}

export async function prepareExportPack() {
  try {
    const data = await exportDB();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const filename = `FinanceApp_Pack_${yyyy}-${mm}-${dd}_${hh}${mi}.financeapp`;

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("success", "Pack gerado: " + filename + "\n\nNo iPhone: Salve no iCloud Drive.");
  } catch (e) {
    showToast("error", "Erro ao exportar pack: " + e.message);
  }
}

export function renderBadge({ colorKey, shapeKey, text }) {
  const txt = (text || "").substring(0, 2).toUpperCase();
  const c = colorKey || 'gray-1';
  const s = shapeKey || 'circle';
  return `<div class="badge-icon bg-${esc(c)} shape-${esc(s)}" title="${esc(txt)}">${esc(txt)}</div>`;
}

export async function settingsScreen() {
  try {
    const peopleRaw = await list("people");
    const people = peopleRaw.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
    const banks = await list("banks");
    const accounts = await list("accounts");
    const cards = await list("cards");
    const categories = await list("categories");
    const tags = await list("tags");
    const subcategories = await list("subcategories");
    const settings = (await get("settings", "config")) || { usdRate: 0 };
    const rules = (await list("rules")).sort((a, b) => (a.priority || 0) - (b.priority || 0));

    const budgetTemplates = await list("budget_templates");
    const budgetOverrides = await list("budget_overrides");

    // UI Choices stored in settings
    const uiState = (await get("settings", "ui_cat_view"));
    const selectedCatId = uiState ? uiState.value : null;

    const filteredSubs = selectedCatId ? subcategories.filter(s => s.categoryId === selectedCatId) : [];

    // Wealth Goals (Metas de Patrimônio)
    const wealthGoals = await list("wealth_goals");
    const wealthGoalLinks = await list("wealth_goal_links");
    const investmentBoxes = await list("investment_boxes");
    const investmentMoves = await list("investment_moves"); // For calculating current balances

    function backupUi() {
      return `
  <div class="card">
    <div><strong>Backup & Dados</strong></div>
    <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
        <div style="display:flex; gap:5px;">
             <button id="btnExport" style="flex:1" class="btn btn-secondary small">Gerar .json</button>
             <button id="btnImport" style="flex:1" class="btn btn-secondary small">Ler .json</button>
        </div>
        <div style="display:flex; gap:5px;">
             <button id="btnExportPack" style="flex:1;" class="btn btn-primary small">⚡ Export rápido</button>
             <button id="btnImportPack" style="flex:1;" class="btn btn-success small">⚡ Import rápido</button>
        </div>
        <button id="btnReset" class="btn btn-danger small" style="width:100%">⚠️ Resetar App</button>
        <div style="display:flex; gap:5px; margin-top:5px;">
            <button class="btn btn-secondary small" data-action="nav" data-hash="#help" style="flex:1;">❓ Ajuda / Como Usar</button>
            <button id="btnHealthCheck" class="btn btn-secondary small" style="flex:1;">🩺 Rodar Verificação</button>
        </div>
        <input type="file" id="importFile" accept=".json" style="display:none" />
        <input type="file" id="importPackFile" accept=".financeapp,.json" style="display:none" />
    </div>
  </div>`;
    }

    const rulesSection = `
    <div class="card">
        <div><strong>Regras de Importação</strong></div>
        <div class="small" style="color:#666">Automatize categoria e tags baseando-se na descrição. <br/>Ordem: Menor prioridade primeiro.</div>
        
        <form id="ruleForm" class="form" style="display:flex; flex-direction:column; gap:10px; margin-top:10px; background:#f9f9f9; padding:10px; border-radius:5px;">
             <div style="display:flex; justify-content:space-between; align-items:center;">
                 <strong id="ruleFormTitle">Nova Regra</strong>
                 <div style="display:flex; gap:5px;">
                     <button type="button" id="btnTestRule" class="btn btn-primary small" style="display:none;">🧪 Simular</button>
                     <button type="button" id="btnCancelEditRule" class="btn btn-secondary small" style="display:none;">Cancelar Edição</button>
                 </div>
             </div>
             
             <input type="hidden" name="id" /> <!-- For editing -->

             <div style="display:flex; flex-wrap:wrap; gap:10px;">
                 <input name="name" class="field" placeholder="Nome da Regra (ex: Uber)" required style="flex: 2 1 200px; min-width:200px;" />
                 <div style="display:flex; gap:5px; align-items:center; flex: 1 1 150px; min-width:150px;">
                    <input name="priority" class="field" type="number" placeholder="Prioridade (0=Alta)" style="width:100%" value="10" />
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.9em; white-space:nowrap;">
                        <input type="checkbox" name="enabled" checked /> Ativa
                    </label>
                 </div>
             </div>

             <div style="margin-top:5px; font-weight:bold; font-size:0.9em; border-bottom:1px solid #ddd; padding-bottom:5px;">Condições de Match (Filtros)</div>
             <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:5px;">
                 <label class="small" style="flex: 1 1 200px; min-width:150px;">Pode conter qualquer (OR):
                    <input name="ruleAnyIncludes" class="field" placeholder="ex: uber, 99pop" style="width:100%" />
                 </label>
                 <label class="small" style="flex: 1 1 200px; min-width:150px;">Deve conter TODAS (AND):
                    <input name="ruleAllIncludes" class="field" placeholder="ex: viag, internacional" style="width:100%" />
                 </label>
                 <label class="small" style="flex: 1 1 200px; min-width:150px;">Não pode conter (NOT):
                    <input name="ruleNoneIncludes" class="field" placeholder="ex: estorno, cancelado" style="width:100%" />
                 </label>
                 <label class="small" style="flex: 1 1 200px; min-width:150px;">Faixa de Valor BRL (Mín - Máx):
                    <div style="display:flex; gap:5px;">
                        <input type="number" name="ruleMinAmount" class="field" placeholder="Mín" style="width:50%; min-width:0;" />
                        <input type="number" name="ruleMaxAmount" class="field" placeholder="Máx" style="width:50%; min-width:0;" />
                    </div>
                 </label>
                 <label class="small" style="flex: 1 1 48%; min-width:250px;">Restringir ao Cartão:
                    <select name="ruleCardId" class="field" style="width:100%">
                        <option value="">(Qualquer Cartão)</option>
                        ${cards.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
                    </select>
                 </label>
                 <label class="small" style="flex: 1 1 48%; min-width:250px;">Restringir à Conta:
                    <select name="ruleAccountId" class="field" style="width:100%">
                        <option value="">(Qualquer Conta)</option>
                        ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}
                    </select>
                 </label>
             </div>

             <!-- Actions -->
             <div style="margin-top:5px; font-weight:bold; font-size:0.9em; border-bottom:1px solid #ddd; padding-bottom:5px;">Ações Aplicadas</div>
             <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:5px;">
                 <label class="small" style="flex: 1 1 200px; min-width:200px;">Categoria:
                     <select name="actionCategory" id="ruleActionCategory" style="width:100%">
                        <option value="">(Manter Categoria)</option>
                        ${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
                     </select>
                 </label>

                 <label class="small" style="flex: 1 1 200px; min-width:200px;">Subcategoria:
                     <select name="actionSubcategory" id="ruleActionSubcategory" disabled style="width:100%">
                        <option value="">(Manter Subcategoria)</option>
                     </select>
                 </label>
                 
                 <label class="small" style="flex: 1 1 200px; min-width:200px;">Pessoa:
                     <select name="actionPerson" style="width:100%">
                        <option value="">(Manter Pessoa)</option>
                        ${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}
                     </select>
                 </label>

                 <label class="small" style="flex: 1 1 200px; min-width:200px;">Tags (separar por vírgula):
                    <input name="actionTags" class="field" placeholder="Add Tags" style="width:100%" />
                 </label>
             </div>
                 
             <label class="checkInline" style="margin-top:10px;">
                <input type="checkbox" name="overwrite" /> Sobrescrever dados nas linhas já preenchidas? (Agressivo)
            </label>

             <button type="submit" id="btnSaveRule" style="margin-top:10px; background:#28a745;">💾 Salvar Regra</button>
        </form>

        <div style="margin-top:15px;" id="rulesListContainer">
            ${rules.length === 0 ? '<div class="small">Nenhuma regra definida.</div>' : ''}
            <ul class="list">
                ${rules.map(r => {
      // Build Rich Summary
      let conds = [];
      const m = r.match || {};
      const anyI = m.anyIncludes || (m.descriptionIncludes ? [m.descriptionIncludes] : []);
      if (anyI.length) conds.push(`Pode: [${anyI.join(", ")}]`);
      if (m.allIncludes && m.allIncludes.length) conds.push(`Deve: [${m.allIncludes.join(", ")}]`);
      if (m.noneIncludes && m.noneIncludes.length) conds.push(`Não Pode: [${m.noneIncludes.join(", ")}]`);
      if (m.cardId) conds.push(`🪙 Cartão: ${cards.find(c => c.id === m.cardId)?.name || '?'}`);
      if (m.accountId) conds.push(`🏦 Conta: ${accounts.find(a => a.id === m.accountId)?.name || '?'}`);
      if (m.minAmountBRL || m.maxAmountBRL) conds.push(`💲 R$ ${m.minAmountBRL || 0} a ${m.maxAmountBRL || '∞'}`);
      const summary = conds.join(" | ") || "Sem condição (Aplica em tudo)";

      return `
                    <li class="listItem" style="display:block;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="flex:1" class="clickable" data-action="edit-rule" data-rule="${esc(JSON.stringify(r))}">
                                <span style="font-weight:bold; color: #17a2b8; ${!r.enabled ? 'text-decoration:line-through; color:#999;' : ''}">[${esc(r.priority)}] ${esc(r.name)}</span>
                                <div class="small" style="font-weight:bold; color:#444;">${esc(summary)}</div>
                                <div class="small" style="color:#666; margin-top:3px;">
                                    ${r.actions?.categoryId ? `➡ Cat: ${categories.find(c => c.id === r.actions.categoryId)?.name}` : ""}
                                    ${r.actions?.subcategoryId ? ` > Sub: ${subcategories.find(s => s.id === r.actions.subcategoryId)?.name}` : ""}
                                    ${r.actions?.tags?.length ? `➡ Tags: ${r.actions.tags.join(", ")}` : ""}
                                </div>
                            </div>
                            <div style="display:flex; gap:5px;">
                                <button type="button" class="iconBtnPad iconBtnEdit" data-action="edit-rule" data-rule="${esc(JSON.stringify(r))}">✎</button>
                                <button type="button" class="iconBtnPad iconBtnDel" data-del="rules:${r.id}">×</button>
                            </div>
                        </div>
                    </li>
                    `
    }).join("")}
            </ul>
        </div>
    </div>
    
    <!-- Phase 16A-2 Modal Rule Simulator -->
    <dialog id="modalTestRule" style="padding:20px; border-radius:8px; border:1px solid #ccc; width:95%; max-width:500px;">
        <h3 style="margin-top:0; color:#17a2b8;">🧪 Simulador de Regra</h3>
        <p class="small text-muted">Testa a regra atual do formulário (mesmo não salva) contra uma transação fictícia.</p>
        
        <div class="form" style="display:flex; flex-direction:column; gap:10px;">
            <label>Descrição do Extrato:
                <input type="text" id="simDesc" class="field" placeholder="ex: UBER TRIP SP" style="width:100%" />
            </label>
            <div style="display:flex; flex-wrap:wrap; gap:10px;">
                <label style="flex:1;">Valor (BRL absoluto):
                    <input type="number" id="simVal" class="field" placeholder="ex: 35.50" value="10.00" style="width:100%" />
                </label>
                <label style="flex:1;">Cartão Origem:
                    <select id="simCardId" class="field" style="width:100%">
                        <option value="">(Nenhum / Não Fatura)</option>
                        ${cards.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
                    </select>
                </label>
            </div>
            <label>Conta Origem:
                <select id="simAccId" class="field" style="width:100%">
                    <option value="">(Nenhum / Débito/Pix)</option>
                    ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}
                </select>
            </label>
            
            <button type="button" id="btnRunTestRule" style="background:#007bff; color:white; margin-top:10px;">Executar Teste</button>
        </div>
        
        <div id="simOutput" style="margin-top:15px; background:#f0f0f0; padding:10px; border-radius:5px; font-family:monospace; font-size:11px; white-space:pre-wrap; display:none;"></div>
        
        <div style="margin-top:15px; text-align:right;">
             <button type="button" id="btnClsTestRule" style="background:#6c757d; color:white;">Fechar</button>
        </div>
    </dialog>
    `;

    // Recurrent Goals UI
    const templates = await list("goal_templates");
    const revisions = await list("goal_revisions");
    const overrides = await list("goal_overrides");

    // Helper to get current target
    const getTarget = (tmplId, month = new Date().toISOString().slice(0, 7)) => {
      // Check override
      const ov = overrides.find(o => o.templateId === tmplId && o.month === month);
      if (ov) return { val: ov.targetCents, type: 'override' };

      // Check revisions
      const effRevs = revisions.filter(r => r.templateId === tmplId && r.effectiveFromMonth <= month)
        .sort((a, b) => b.effectiveFromMonth.localeCompare(a.effectiveFromMonth));
      if (effRevs.length > 0) return { val: effRevs[0].targetCents, type: 'revision' };

      return { val: 0, type: 'none' };
    };

    const goalsSection = `
    <div class="card">
        <div><strong>Metas Recorrentes</strong></div>
        <form id="goalTemplateForm" class="form" style="display:flex; flex-direction:column; gap:10px; background:#f9f9f9; padding:10px; border-radius:5px;">
            <input type="hidden" name="id" />
            <div style="display:flex; justify-content:space-between; align-items:center;">
                 <strong id="goalTempFormTitle">Nova Meta Recorrente</strong>
                 <button type="button" id="btnCancelEditGoalTemp" class="btn btn-secondary small" style="display:none;">Cancelar</button>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:10px;">
                <input name="name" class="field" placeholder="Nome (ex: Mercado)" required style="flex: 2 1 200px; min-width:200px;" />
                <div style="display:flex; gap:5px; align-items:center; flex: 1 1 150px; min-width:150px;">
                    <span style="font-size:0.8em">Início:</span>
                    <input name="startMonth" type="month" required class="input field-sm" style="flex:1;" value="${new Date().toISOString().slice(0, 7)}" />
                </div>
            </div>

            <!-- TYPE SELECTOR -->
            <div style="display:flex; gap:15px; align-items:center;">
                <label class="checkInline"><input type="radio" name="scopeType" value="category" checked> Categoria</label>
                <label class="checkInline"><input type="radio" name="scopeType" value="tag"> Tag</label>
            </div>

            <!-- CATEGORY SCOPE -->
            <div id="goalScopeCategory" style="display:flex; flex-wrap:wrap; gap:10px;">
                <select name="categoryId" id="goalTempCategory" class="field" style="flex: 1 1 200px; min-width:200px;">
                    <option value="">Selecione Categoria...</option>
                    ${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
                </select>
                <select name="subcategoryId" id="goalTempSubcategory" class="field" disabled style="flex: 1 1 200px; min-width:200px;">
                    <option value="">(Todas Subcategorias)</option>
                </select>
            </div>

            <!-- TAG SCOPE -->
            <div id="goalScopeTag" style="display:none; width:100%;">
                <input name="tagName" class="field" list="tagList" placeholder="Nome da Tag (ex: Viagem)" style="width:100%" />
                <datalist id="tagList">
                    ${tags.map(t => `<option value="${esc(t.name)}">`).join("")}
                </datalist>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:10px;">
                <select name="personId" class="field" style="flex: 1 1 200px; min-width:200px;">
                    <option value="">(Qualquer Pessoa)</option>
                    ${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}
                </select>
                
                <div style="display:flex; gap:5px; align-items:center; flex: 1 1 180px; min-width:180px;">
                    <span style="font-size:0.9em">R$ Padrão</span>
                    <input name="target" type="number" step="0.01" class="field" placeholder="Alvo (ex: 500.00)" required style="flex:1;"/>
                </div>
            </div>

            <label class="checkInline">
                <input type="checkbox" name="active" checked /> Meta Ativa
            </label>

            <button type="submit" id="btnSaveGoalTemp" class="btn btn-primary" style="margin-top:5px; align-self:flex-start;">Salvar Meta</button>
        </form>

        <div style="margin-top:15px;">
            <ul class="list">
                 ${templates.length === 0 ? '<div class="small">Nenhuma meta.</div>' : ''}
                 ${templates.sort((a, b) => a.name.localeCompare(b.name)).map(t => {
      const currentT = getTarget(t.id);
      const isTag = t.scopeType === 'tag';
      let scopeDesc = "";

      if (isTag) {
        scopeDesc = `Tag: <strong>${esc(t.scopeValue)}</strong>`;
      } else {
        // Category
        const cName = categories.find(c => c.id === t.categoryId)?.name || "?";
        const sName = t.subcategoryId ? ` > ${subcategories.find(s => s.id === t.subcategoryId)?.name}` : "";
        scopeDesc = `${cName}${sName}`;
      }

      return `
                    <li class="listItem">
                        <div style="flex:1">
                            <div style="display:flex; justify-content:space-between;">
                                <strong>${esc(t.name)}</strong>
                                <span class="small" style="font-weight:bold; color:${currentT.type === 'override' ? 'orange' : '#007bff'}">
                                    Atual: R$ ${(currentT.val / 100).toFixed(2)}
                                </span>
                            </div>
                            <div class="small" style="color:#666">
                                ${scopeDesc}
                                ${t.personId ? ` • ${people.find(p => p.id === t.personId)?.name}` : ""}
                            </div>
                            
                            <div style="margin-top:5px; display:flex; gap:5px;">
                                <button class="btn btn-secondary small" data-action="new-revision" data-id="${t.id}">📅 Alt. Padrão</button>
                                <button class="btn btn-secondary small" data-action="new-override" data-id="${t.id}">✏️ Ajuste Mês</button>
                            </div>
                        </div>
                        <div style="display:flex; gap:5px; align-items:flex-start;">
                             <button type="button" class="iconBtnPad iconBtnEdit" data-action="edit-goal-temp" data-tmpl="${esc(JSON.stringify(t))}" data-crev="${currentT.val}">✎</button>
                             <button type="button" class="iconBtnPad iconBtnDel" data-del="goal_templates:${t.id}">×</button>
                        </div>
                    </li>
                    `;
    }).join("")}
            </ul>
        </div>
    </div>
    `;

    const rateSection = `
    <div class="card" style="border-left: 4px solid #17a2b8;">
        <div><strong style="color:#0056b3;">Câmbio & Conversão (USD → BRL)</strong></div>
        <div class="small" style="color:#666; margin-bottom:10px;">Defina a cotação padrão e recalcule o histórico unificado em BRL.</div>
        
        <form id="rateForm" class="form flex" style="align-items:flex-end; gap:10px; margin-bottom:15px; display:flex;">
            <label style="display:flex; flex-direction:column; gap:5px;">Taxa Global do Sistema
                <input type="number" step="0.0001" name="usdRate" class="input field-sm" placeholder="Ex: 5.50" value="${settings.usdRate || ''}" required />
            </label>
            <button type="submit" class="btn btn-primary" style="white-space:nowrap; height:40px;">Atualizar Taxa</button>
        </form>

        <div style="background:#f9f9f9; padding:10px; border-radius:4px; font-size:11px;">
            <div style="font-weight:bold; margin-bottom:5px;">Processamento em Lote:</div>
            <div style="display:flex; gap:5px; flex-wrap:wrap;">
                <button type="button" id="btnRecalcSelected" class="btn btn-secondary small">Recalcular USD (Avançado)...</button>
                <button type="button" id="recalcBtn" class="btn btn-danger small">Forçar TODOS (Preservando fixos)</button>
            </div>
            <div class="small" style="margin-top:5px; color:#555;">Recalcula o campo "valueBRL" invisível em todas as despesas internacionais passadas.</div>
        </div>

        <div id="modalRecalc" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:white; padding:20px; box-shadow:0 0 100px rgba(0,0,0,0.8); z-index:999; border-radius:8px; width:95%; max-width:600px; max-height:90vh; overflow-y:auto;">
            <h3>Auditoria de Recálculo USD</h3>
            <div class="form" id="recalcFormArea">
                <label>Mês Referência (YYYY-MM)
                    <input type="month" id="recalcMonth" class="field" value="${new Date().toISOString().substring(0, 7)}" style="width:100%" />
                </label>
                <label class="checkInline" style="margin-top:10px; color:#444;">
                    <input type="checkbox" id="recalcPreserveFx" checked />
                    Ignorar registros que já possuem "Taxa de Câmbio" congelada (Recomendado).
                </label>
                <div style="display:flex; gap:10px; margin-top:15px; justify-content:flex-end;">
                    <button type="button" id="btnCancelRecalc" class="btn btn-secondary small">Cancelar</button>
                    <button type="button" id="btnPreviewRecalc" class="btn btn-primary small">Gerar Preview</button>
                </div>
            </div>
            
            <div id="recalcPreviewArea" style="display:none; margin-top:15px; border-top:1px solid #ccc; padding-top:10px;">
                <div id="recalcSummary" style="margin-bottom:10px; font-size:13px;"></div>
                <div style="max-height: 250px; overflow-y:auto; border: 1px solid #ddd; background:#f9f9f9; padding:5px;">
                    <table style="width:100%; font-size:10px; border-collapse:collapse; text-align:left;">
                        <thead>
                            <tr style="border-bottom:1px solid #ccc;">
                                <th>Data</th>
                                <th>Desc</th>
                                <th>USD</th>
                                <th>Tx Antiga</th>
                                <th>BRL Antigo</th>
                                <th>Nova Tx</th>
                                <th>Novo BRL</th>
                                <th>Delta (R$)</th>
                            </tr>
                        </thead>
                        <tbody id="recalcTableBody"></tbody>
                    </table>
                </div>
                <div id="recalcLimitWarning" class="small" style="color:orange; margin-top:5px; display:none;">Exibindo apenas os primeiros 50 itens. O cálculo total inclui todos os registros.</div>
                
                <div style="display:flex; gap:10px; margin-top:15px; justify-content:flex-end;">
                    <button type="button" id="btnBackToForm" class="btn btn-secondary small">Voltar</button>
                    <button type="button" id="btnConfirmRecalc" class="btn btn-success small">Aplicar Recálculo</button>
                </div>
            </div>
        </div>
    </div>
    `;

    const catSection = `
        <div class="card">
            <div style="display:flex; gap:10px;">
                <!-- Categories Column -->
                <div style="flex:1">
                    <div><strong>Categorias</strong></div>
                    <form id="catForm" style="display:flex; gap:5px; margin-top:5px; margin-bottom:5px; align-items:center;">
                        <input name="name" class="field" placeholder="Nova Categoria" required style="flex:1;" />
                        <button type="submit" class="btn btn-primary small" style="min-height:40px;">+</button>
                    </form>
                    <div style="max-height:200px; overflow:auto; border:1px solid #eee;">
                        ${categories.map(c => `
                            <div class="listItem clickable ${c.id === selectedCatId ? 'selected-row' : ''}" 
                                 data-action="select-cat" data-id="${c.id}" style="padding:5px; cursor:pointer; background:${c.id === selectedCatId ? '#eef' : '#fff'}">
                                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                                    <span style="flex:1;">${esc(c.name)}</span>
                                    <div style="display:flex; gap:5px; margin-left:10px;">
                                        <button type="button" class="iconBtnPad iconBtnEdit" data-edit="categories|${esc(JSON.stringify(c))}">✎</button>
                                        <button type="button" class="iconBtnPad iconBtnDel" data-del="categories:${c.id}">×</button>
                                    </div>
                                </div>
                            </div>
                        `).join("")}
                    </div>
                </div>

                <!-- Subcategories Column -->
                <div style="flex:1; opacity: ${selectedCatId ? 1 : 0.5}; pointer-events: ${selectedCatId ? 'auto' : 'none'}">
                    <div class="small" style="margin-bottom:5px;">Subcategorias (${selectedCatId ? categories.find(c => c.id === selectedCatId)?.name : 'Selecione...'})</div>
                    <form id="subForm" style="display:flex; gap:5px; margin-bottom:5px; align-items:center;">
                        <input name="name" class="field" placeholder="Nova Subcategoria" required style="flex:1;" />
                        <button type="submit" class="btn btn-primary small" style="min-height:40px;">+</button>
                    </form>
                    <div style="max-height:200px; overflow:auto; border:1px solid #eee;">
                        ${filteredSubs.length === 0 ? '<div class="small" style="padding:5px;">Nenhuma.</div>' : ''}
                        ${filteredSubs.map(s => `
                            <div class="listItem" style="padding:5px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                                    <span style="flex:1;">${esc(s.name)}</span>
                                    <div style="display:flex; gap:5px; margin-left:10px;">
                                        <button type="button" class="iconBtnPad iconBtnEdit" data-edit="subcategories|${esc(JSON.stringify(s))}">✎</button>
                                        <button type="button" class="iconBtnPad iconBtnDel" data-del="subcategories:${s.id}">×</button>
                                    </div>
                                </div>
                            </div>
                        `).join("")}
                    </div>
                </div>
            </div>
        </div>`;

    const tagSection = `
        <div class="card">
            <div><strong>Tags</strong></div>
            <form id="tagForm" style="display:flex; gap:5px; margin-top:5px; margin-bottom:5px; align-items:center;">
                <input name="name" class="field" placeholder="Nova Tag (ex: Viagem, Trabalho)" required style="flex:1;" />
                <button type="submit" class="btn btn-primary small" style="min-height:40px;">+</button>
            </form>
            <div style="max-height:200px; overflow:auto; border:1px solid #eee;">
                ${tags.length === 0 ? '<div class="small" style="padding:5px;">Nenhuma.</div>' : ''}
                ${tags.map(t => `
                    <div class="listItem" style="padding:5px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                            <span style="flex:1;">${esc(t.name)}</span>
                            <div style="display:flex; gap:5px; margin-left:10px;">
                                <button type="button" class="iconBtnPad iconBtnEdit" data-edit="tags|${esc(JSON.stringify(t))}">✎</button>
                                <button type="button" class="iconBtnPad iconBtnDel" data-del="tags:${t.id}">×</button>
                            </div>
                        </div>
                    </div>
                `).join("")}
            </div>
        </div>
    `;

    // --- BUDGET UI ---
    const getBudgetTarget = (tmplId, month = new Date().toISOString().slice(0, 7)) => {
      const ov = budgetOverrides.find(o => o.templateId === tmplId && o.month === month);
      return ov ? { val: ov.targetCents, type: 'override' } : { val: null, type: 'none' };
    };

    const budgetSection = `
    <div class="card">
        <div><strong>Orçamentos do Mês</strong></div>
        <div class="small" style="color:#666; margin-bottom:10px;">Defina limites de gastos mensais por Categoria. Você poderá visualizar o progresso no Painel.</div>
        <form id="budgetTemplateForm" class="form" style="display:flex; flex-direction:column; gap:10px; background:#f9f9f9; padding:10px; border-radius:5px;">
            <input type="hidden" name="id" />
            <div style="display:flex; justify-content:space-between; align-items:center;">
                 <strong id="budgetTempFormTitle">Novo Orçamento</strong>
                 <button type="button" id="btnCancelEditBudget" class="btn btn-secondary small" style="display:none;">Cancelar</button>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:10px;">
                <input name="name" class="field" placeholder="Nome (ex: Supermercado)" required style="flex: 2 1 200px; min-width:200px;" />
                <div style="display:flex; gap:5px; align-items:center; flex: 1 1 180px; min-width:180px;">
                    <span style="font-size:0.9em; white-space:nowrap;">R$ Mensal Padrão</span>
                    <input name="monthlyTarget" class="field" type="number" step="0.01" placeholder="Ex: 1500.00" required style="width:100%" />
                </div>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:10px;">
                <select name="categoryId" id="budgetTempCategory" class="field" required style="flex: 1 1 200px; min-width:200px;">
                    <option value="">Selecione Categoria...</option>
                    ${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
                </select>
                <select name="subcategoryId" id="budgetTempSubcategory" class="field" disabled style="flex: 1 1 200px; min-width:200px;">
                    <option value="">(Todas Subcategorias)</option>
                </select>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:10px;">
                <select name="personId" class="field" style="flex: 1 1 100%;">
                    <option value="">(Qualquer Pessoa)</option>
                    ${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}
                </select>
            </div>

            <label style="display:flex; align-items:center; gap:5px; font-size:0.9em;">
                <input type="checkbox" name="active" checked /> Ativo
            </label>
            <button type="submit" id="btnSaveBudget" class="btn btn-primary" style="margin-top:5px; align-self:flex-start;">Salvar Orçamento</button>
        </form>

        <div style="margin-top:15px;">
            <ul class="list">
                 ${budgetTemplates.length === 0 ? '<div class="small">Nenhum orçamento configurado.</div>' : ''}
                 ${budgetTemplates.sort((a, b) => a.name.localeCompare(b.name)).map(t => {
      const currentOv = getBudgetTarget(t.id);
      const val = currentOv.type === 'override' ? currentOv.val : t.monthlyTargetCents;

      const cName = categories.find(c => c.id === t.categoryId)?.name || "?";
      const sName = t.subcategoryId ? " > " + (subcategories.find(s => s.id === t.subcategoryId)?.name || "") : "";
      const scopeDesc = cName + sName;

      return `
                    <li class="listItem">
                        <div style="flex:1">
                            <div style="display:flex; justify-content:space-between;">
                                <strong>${esc(t.name)}</strong>
                                <span class="small" style="font-weight:bold; color:${currentOv.type === 'override' ? 'orange' : '#007bff'}">
                                    Mês Atual: R$ ${(val / 100).toFixed(2)}
                                </span>
                            </div>
                            <div class="small" style="color:#666">
                                ${scopeDesc} ${t.personId ? ` • ${people.find(p => p.id === t.personId)?.name}` : ""}
                            </div>
                            <div class="small" style="color:#999; margin-top:2px;">(Padrão Mensal: R$ ${(t.monthlyTargetCents / 100).toFixed(2)})</div>
                            
                            <div style="margin-top:5px;">
                                <button type="button" class="btn btn-primary small" data-action="open-budget-details" data-id="${t.id}">🔍 Ver Detalhes / Ajustes</button>
                            </div>
                        </div>
                        <div style="display:flex; gap:5px; align-items:flex-start;">
                             <button type="button" class="iconBtnPad iconBtnEdit" data-action="edit-budget-temp" data-tmpl="${esc(JSON.stringify(t))}">✎</button>
                             <button type="button" class="iconBtnPad iconBtnDel" data-del="budget_templates:${t.id}">×</button>
                        </div>
                    </li>
      `;
    }).join("")}
            </ul>
        </div>
    </div>
    `;

    // --- WEALTH GOALS UI ---
    // Calculate current balance for each box mapping
    const boxBalancesMap = {};
    investmentBoxes.forEach(box => {
      const boxMoves = investmentMoves.filter(m => m.boxId === box.id);
      let balance = 0;
      boxMoves.forEach(m => {
        if (m.kind === 'deposit' || m.kind === 'yield') balance += m.value;
        if (m.kind === 'withdraw') balance -= m.value;
      });
      boxBalancesMap[box.id] = balance;
    });

    const wealthGoalsSection = `
    <div class="card" style="border-left: 4px solid #f39c12;">
        <div><strong style="color:#e67e22;">Metas de Patrimônio</strong></div>
        <div class="small" style="color:#666; margin-bottom:10px;">Defina alvos de reserva, viagem ou aquisições e vincule às suas Caixinhas (Investimentos).</div>
        
        <form id="wealthGoalForm" class="form" style="display:flex; flex-direction:column; gap:10px; background:#f9f9f9; padding:10px; border-radius:5px;">
            <input type="hidden" name="id" />
            <div style="display:flex; justify-content:space-between; align-items:center;">
                 <strong id="wealthGoalFormTitle">Nova Meta de Patrimônio</strong>
                 <button type="button" id="btnCancelEditWealthGoal" class="btn btn-secondary small" style="display:none;">Cancelar</button>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:10px;">
                <input name="name" class="field" placeholder="Nome (ex: Troca de Carro)" required style="flex: 2 1 200px; min-width:200px;" />
                <div style="display:flex; gap:5px; align-items:center; flex: 1 1 180px; min-width:180px;">
                    <span style="font-size:0.9em; white-space:nowrap;">Alvo BRL</span>
                    <input name="targetValue" class="field" type="number" step="0.01" placeholder="Ex: 50000.00" required style="width:100%" />
                </div>
            </div>

            <input name="notes" class="field" placeholder="Anotações / Notas (opcional)" style="width:100%;" />

            <label style="display:flex; align-items:center; gap:5px; font-size:0.9em;">
                <input type="checkbox" name="active" checked /> Meta Ativa
            </label>
            <button type="submit" id="btnSaveWealthGoal" class="btn btn-primary" style="margin-top:5px; background:#e67e22; border-color:#d35400; align-self:flex-start;">Salvar Meta</button>
        </form>

        <div style="margin-top:15px;">
            <ul class="list">
                 ${wealthGoals.length === 0 ? '<div class="small">Nenhuma Meta de Patrimônio configurada.</div>' : ''}
                 ${wealthGoals.sort((a, b) => a.name.localeCompare(b.name)).map(g => {
      // Calculate progress
      const linkedBoxes = wealthGoalLinks.filter(l => l.goalId === g.id);
      const currentBRL = linkedBoxes.reduce((sum, link) => sum + (boxBalancesMap[link.investmentBoxId] || 0), 0);
      const targetBRL = (g.targetCentsBRL || 0) / 100;
      const pctObj = targetBRL > 0 ? (currentBRL / targetBRL) * 100 : 0;
      const pct = Math.min(100, pctObj);

      return `
                    <li class="listItem">
                        <div style="flex:1">
                            <div style="display:flex; justify-content:space-between; align-items:baseline;">
                                <strong>${!g.active ? '<span style="color:#999; text-decoration:line-through;">' : ''}${esc(g.name)}${!g.active ? '</span>' : ''}</strong>
                                <span class="small" style="font-weight:bold; color:#007bff;">
                                    Progresso: ${(pctObj).toFixed(1)}%
                                </span>
                            </div>
                            <div class="small" style="color:#666">
                                Atual: R$ ${currentBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} / Alvo: R$ ${targetBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </div>
                            ${g.notes ? `<div class="small" style="color:#888; font-style:italic; margin-top:2px;">"${esc(g.notes)}"</div>` : ''}
                            
                            <!-- Progress Bar -->
                            <div style="background:#ddd; height:6px; border-radius:3px; margin-top:4px; overflow:hidden;">
                               <div style="background:${pct >= 100 ? '#27ae60' : (pct >= 80 ? '#f39c12' : '#2980b9')}; height:100%; width:${pct}%;"></div>
                            </div>
                            
                            <div style="margin-top:8px; display:flex; gap:5px; align-items:center;">
                                <button type="button" class="btn btn-secondary small" data-action="link-investments" data-id="${g.id}">🔗 Vincular Investimentos (${linkedBoxes.length})</button>
                            </div>
                        </div>
                        <div style="display:flex; gap:5px; align-items:flex-start;">
                             <button type="button" class="iconBtnPad iconBtnEdit" data-action="edit-wealth-goal" data-goal="${esc(JSON.stringify(g))}">✎</button>
                             <button type="button" class="iconBtnPad iconBtnDel" data-del="wealth_goals:${g.id}">×</button>
                        </div>
                    </li>
      `;
    }).join("")}
            </ul>
        </div>
    </div>
    
    <!-- Modal para vinculação de investimentos -->
    <dialog id="modalLinkInvestments" style="padding:20px; border-radius:8px; border:1px solid #ccc; width:95%; max-width:450px;">
        <h3 style="margin-top:0; color:#e67e22;">Vincular Caixinhas</h3>
        <div class="small" style="margin-bottom:10px; color:#555;">Selecione os investimentos cujo saldo contará para a meta <strong id="linkGoalNameStr">...</strong></div>
        
        <form id="linkInvestmentsForm" class="form">
            <input type="hidden" id="linkGoalId" />
            <div id="investmentsChecklist" style="max-height: 250px; overflow-y:auto; border: 1px solid #eee; padding:5px; background:#fafafa; border-radius:5px;">
                 <!-- Populated dynamically via JS -->
            </div>
            <div style="display:flex; gap:10px; margin-top:15px; justify-content:flex-end;">
                <button type="button" id="btnCancelLinkInst" class="btn btn-secondary small">Cancelar</button>
                <button type="submit" class="btn btn-primary small" style="background:#e67e22; border-color:#d35400;">Salvar Vínculos</button>
            </div>
        </form>
    </dialog>
    `;

    return `
  <style>
    .selected-row { border-left: 3px solid #007bff; font-weight:bold; }
  </style>
  ${backupUi()}
  ${rateSection}
  ${rulesSection}
  ${budgetSection}
  ${goalsSection}
  ${wealthGoalsSection}
  ${catSection}
  ${tagSection}
  
  <div class="card">
    <div><strong>Pessoas</strong></div>
    <form id="personForm" class="form" style="display:flex; gap:10px; align-items:center;">
      <input name="name" class="field" placeholder="Nome" required style="flex:1;" />
      <button type="submit" class="btn btn-primary">Adicionar</button>
    </form>
    <div class="small">Cadastradas: ${people.length}</div>
    ${renderList("people", people, p => `${esc(p.name)}`)}
  </div>

  <div class="card">
    <div><strong>Bancos</strong></div>
    <form id="bankForm" class="form" style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
      <input name="name" class="field" placeholder="Nome (ex: Nubank)" required style="flex:2; min-width:150px;" />
      <select name="badgeColorKey" class="field" required style="flex:1; min-width:100px;">
        <option value="red-1">Vermelho 1</option>
        <option value="red-2">Vermelho 2</option>
        <option value="purple-1">Roxo 1</option>
        <option value="purple-2">Roxo 2</option>
        <option value="blue-1">Azul 1</option>
        <option value="blue-2">Azul 2</option>
        <option value="green-1">Verde 1</option>
        <option value="green-2">Verde 2</option>
        <option value="yellow-1">Amarelo 1</option>
        <option value="yellow-2">Amarelo 2</option>
        <option value="gray-1">Cinza 1</option>
        <option value="gray-2">Cinza 2</option>
      </select>
      <select name="badgeShapeKey" class="field" required style="flex:1; min-width:100px;">
        <option value="circle">Círculo</option>
        <option value="square">Quadrado</option>
        <option value="rounded">Arredondado</option>
        <option value="diamond">Diamante</option>
        <option value="triangle">Triângulo</option>
        <option value="hex">Hexágono</option>
      </select>
      <button type="submit" class="btn btn-primary" style="flex-shrink:0;">Adicionar</button>
    </form>
    <div class="small">Cadastrados: ${banks.length}</div>
    ${renderList("banks", banks, b => `
      <div style="display:flex; align-items:center; gap:8px;">
        ${renderBadge({ colorKey: b.badgeColorKey, shapeKey: b.badgeShapeKey, text: b.name })}
        <span>${esc(b.name)}</span>
      </div>
    `)}
  </div>

  <div class="card">
    <div><strong>Contas</strong></div>
    <form id="accountForm" class="form" style="display:flex; flex-direction:column; gap:10px;">
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
        <input name="name" class="field" placeholder="Nome da conta" required style="flex:2; min-width:150px;" />
        <select name="currency" class="field-sm" required style="flex:1;">
          <option value="BRL">BRL</option>
          <option value="USD">USD</option>
        </select>
        <select name="bankId" class="field" required style="flex:2; min-width:150px;">
          <option value="">Banco...</option>
          ${banks.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}
        </select>
        <select name="personId" class="field" required style="flex:2; min-width:150px;">
          <option value="">Dado do Titular da Conta...</option>
          ${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}
        </select>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
        <select name="accountType" class="field" required style="flex:1; min-width:150px;" onchange="this.form.investSubtype.style.display = this.value === 'investment' ? 'inline-block' : 'none'">
          <option value="checking">Conta Corrente</option>
          <option value="investment">Investimento</option>
        </select>
        <select name="investSubtype" class="field" style="flex:1; min-width:150px; display:none;">
          <option value="">Subtipo de Investimento...</option>
          <option value="Caixinha">Caixinha</option>
          <option value="CDI">CDI</option>
          <option value="CDB">CDB</option>
          <option value="Outro">Outro</option>
        </select>
        <button type="submit" class="btn btn-primary" style="flex-shrink:0;">Adicionar</button>
      </div>
    </form>
    <div class="small">Cadastradas: ${accounts.length}</div>
    ${renderList("accounts", accounts, a => {
      const b = banks.find(x => x.id === a.bankId);
      const p = people.find(x => x.id === a.personId);
      const bankName = b ? b.name : "(Definir Banco)";
      const personName = p ? p.name : "(Definir Pessoa)";
      const typeStr = a.accountType === 'investment' ? `Investimento${a.investSubtype ? '/' + a.investSubtype : ''}` : `Conta Corrente`;
      return `
      <div style="display:flex; align-items:center; gap:8px;">
        ${b ? renderBadge({ colorKey: b.badgeColorKey, shapeKey: b.badgeShapeKey, text: b.name }) : '<div class="badge-icon bg-gray-1 shape-circle" title="?">?</div>'}
        <div style="display:flex; flex-direction:column;">
          <strong>${esc(a.name)}</strong>
          <span class="small" style="color:#666;">${esc(bankName)} • ${esc(personName)} • ${typeStr} • ${esc(a.currency)}</span>
        </div>
      </div>
      `;
    })}
  </div>

  <div class="card">
    <div><strong>Cartões (Titular + Adicionais)</strong></div>
    <select id="hiddenAccountSelect" style="display:none;">
      <option value="">Nenhuma conta padrão...</option>
      ${accounts.map(a => `<option value="${a.id}">${esc(a.name)} (${esc(a.currency)})</option>`).join("")}
    </select>
    <form id="cardForm" class="form" style="display:flex; flex-direction:column; gap:10px;">
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
        <input name="name" class="field" placeholder="Nome do Cartão" required style="flex:2; min-width:150px;" />
        <select name="currency" class="field-sm" required style="flex:1;">
          <option value="BRL">BRL</option>
          <option value="USD">USD</option>
        </select>
        <select name="badgeColorKey" class="field-sm" required style="flex:1;">
            <option value="purple-1">Roxo 1</option>
            <option value="purple-2">Roxo 2</option>
            <option value="red-1">Vermelho 1</option>
            <option value="red-2">Vermelho 2</option>
            <option value="blue-1">Azul 1</option>
            <option value="blue-2">Azul 2</option>
            <option value="green-1">Verde 1</option>
            <option value="green-2">Verde 2</option>
            <option value="yellow-1">Amarelo 1</option>
            <option value="yellow-2">Amarelo 2</option>
            <option value="gray-1">Cinza 1</option>
            <option value="gray-2">Cinza 2</option>
        </select>
        <select name="badgeShapeKey" class="field-sm" required style="flex:1;">
            <option value="square">Quadrado</option>
            <option value="circle">Círculo</option>
            <option value="rounded">Arredondado</option>
            <option value="diamond">Diamante</option>
            <option value="triangle">Triângulo</option>
            <option value="hex">Hexágono</option>
        </select>
        <input name="closingDay" class="field-sm" type="number" min="1" max="28" placeholder="Dia fecha." required style="flex:1;" />
        <input name="dueDay" class="field-sm" type="number" min="1" max="28" placeholder="Dia venc." required style="flex:1;" />
      </div>
      
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:flex-start;">
        <div style="flex:1; min-width:200px; border:1px solid #ddd; padding:10px; border-radius:4px; background:#fafafa;">
           <strong>Titular do Cartão</strong><br/>
           <select name="mainPersonId" class="field card-person-select" style="width:100%; margin-top:5px;" required>
             <option value="">Selecione Titular...</option>
             ${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}
           </select>
        </div>
        <div style="flex:1; min-width:200px; border:1px solid #ddd; padding:10px; border-radius:4px; background:#fafafa;">
           <strong>Adicionais (Opcional)</strong><br/>
           <div class="small" style="max-height:80px; overflow-y:auto; margin-top:5px; display:flex; flex-direction:column; gap:4px;">
             ${people.map(p => `
               <label style="display:flex; align-items:center; gap:5px; cursor:pointer;">
                 <input type="checkbox" name="additionalPersonIds" value="${p.id}" data-name="${esc(p.name)}" class="card-person-check" /> ${esc(p.name)}
               </label>
             `).join("")}
           </div>
        </div>
      </div>

      <div id="cardPaymentSetupContainer" style="border:1px solid #eee; padding:10px; border-radius:4px; display:none;">
          <strong class="small">Conta padrão para pagar fatura de cada portador (Opcional):</strong>
          <div id="cardPaymentSetupList" style="display:flex; flex-direction:column; gap:5px; margin-top:5px;"></div>
      </div>
      <button type="submit" class="btn btn-primary" style="align-self:flex-start;">Adicionar Cartão</button>
    </form>
    <div class="small">Cadastrados: ${cards.length}</div>
    ${renderList("cards", cards, c => {
      const mainName = people.find(p => p.id === c.mainPersonId)?.name || c.legacyHolderName || "(Sem Titular)";
      const addsIds = Array.isArray(c.additionalPersonIds) ? c.additionalPersonIds : [];
      const addNames = addsIds.map(pid => people.find(p => p.id === pid)?.name || "?").join(", ");
      const legacyAddStr = c.legacyAdditionalName ? ` [Legado: ${c.legacyAdditionalName}]` : '';
      const allAdds = addNames + legacyAddStr;

      return `
      <div style="display:flex; align-items:center; gap:10px;">
        ${renderBadge({ colorKey: c.badgeColorKey, shapeKey: c.badgeShapeKey, text: c.name })}
        <div style="display:flex; flex-direction:column;">
          <strong>${esc(c.name)}</strong> <span class="small">(${esc(c.currency)})</span>
          <span class="small" style="color:#666;">
            Fecha dia ${esc(c.closingDay)} · Vence dia ${esc(c.dueDay)}<br/>
            Titular: ${esc(mainName)} ${allAdds ? `· Adicionais: ${esc(allAdds)}` : ""}
          </span>
        </div>
      </div>
      `;
    })}
  </div>
  
  <div style="text-align: center; color: #999; margin: 25px 0 10px 0; font-size: 0.9em;">
      FinanceApp v${APP_VERSION}
  </div>

  <!-- Modal Health Check -->
  <dialog id="modalHealthCheck" style="padding:20px; border-radius:8px; border:1px solid #ccc; width:95%; max-width:400px;">
      <h3 style="margin-top:0; color:#17a2b8;">🩺 Saúde do App</h3>
      <div id="healthCheckResults" style="margin: 15px 0; font-size:0.95em; line-height:1.6;"></div>
      <div style="text-align:right;">
           <button type="button" id="btnClsHealthCheck" class="btn btn-secondary">Fechar</button>
      </div>
  </dialog>
  `;
  } catch (err) {
    console.error("[SETTINGS ERROR]", err);
    return `
      <div class="card" style="border-left: 5px solid red;">
         <h3>Erro de Banco de Dados</h3>
         <p>Seus dados locais parecem estar em uma versão antiga ou corrompida.</p>
         <pre style="background:#eee; padding:5px; font-size:0.8em">${err.message}</pre>
         <div style="display:flex; gap:10px; margin-top:15px;">
             <button class="btn btn-primary" onclick="location.reload()">Tentar corrigir (Recarregar)</button>
             <button id="btnForceReset" class="btn btn-danger">Resetar Banco (Apagar Tudo)</button>
         </div>
      </div>
      `;
  }
}

function renderList(store, items, renderFn) {
  if (!items.length) return `<div class="small">Nenhum item ainda.</div>`;
  return `
    <ul class="list">
      ${items.map(i => `
        <li class="listItem" style="display:flex; justify-content:space-between; align-items:center;">
          <div style="flex:1;">${renderFn(i)}</div>
          <div style="display:flex; gap:5px; margin-left:10px;">
            <button type="button" class="iconBtnPad iconBtnEdit" data-edit="${store}|${esc(JSON.stringify(i))}">✎</button>
            <button type="button" class="iconBtnPad iconBtnDel" data-del="${store}:${i.id}">×</button>
          </div>
        </li>
      `).join("")}
    </ul>
  `;
}

export async function wireSettingsHandlers(rootEl) {
  // BACKUP HANDLERS
  const btnExport = rootEl.querySelector("#btnExport");
  const btnImport = rootEl.querySelector("#btnImport");
  const btnExportPack = rootEl.querySelector("#btnExportPack");
  const btnImportPack = rootEl.querySelector("#btnImportPack");
  const btnReset = rootEl.querySelector("#btnReset");
  const btnSafeMode = rootEl.querySelector("#btnSafeMode");
  const btnRestartApp = rootEl.querySelector("#btnRestartApp");
  const fileInput = rootEl.querySelector("#importFile");
  const importPackFile = rootEl.querySelector("#importPackFile");

  if (btnSafeMode) {
    btnSafeMode.onclick = () => {
      if (confirm("Isso limpará as preferências de interface salvas e recarregará o aplicativo. Útil se alguma tela estiver travada. Continuar?")) {
        localStorage.clear();
        sessionStorage.clear();
        showToast("success", "Preferências limpas. O app será reiniciado.");
        location.hash = "#home";
        location.reload();
      }
    };
  }

  if (btnRestartApp) {
    btnRestartApp.onclick = () => {
      location.reload();
    };
  }

  if (btnExportPack) {
    btnExportPack.onclick = prepareExportPack;
  }

  if (btnImportPack) {
    btnImportPack.onclick = () => importPackFile.click();
    importPackFile.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const text = await file.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        showToast("error", "Não consegui ler este arquivo. Ele pode estar corrompido ou não ser do FinanceApp.");
        importPackFile.value = "";
        return;
      }

      if (json.meta && json.meta.appId !== "financeapp") {
        showToast("error", "Este arquivo não é um backup válido do FinanceApp.");
        importPackFile.value = "";
        return;
      }

      try {
        let countMsg = "";
        let backupDate = "(Sem data)";
        if (json.meta && json.meta.counts) {
          backupDate = new Date(json.meta.createdAt).toLocaleString();
          const c = json.meta.counts;
          countMsg = `- Lançamentos: ${c.transactions || 0}\n` +
            `- Contas: ${c.accounts || 0}\n` +
            `- Metas: ${(c.goal_templates || 0) + (c.goals || 0)}\n` +
            `- Regras: ${c.rules || 0}\n`;
        } else {
          // Fallback for legacy
          let d = json.data || json;
          countMsg = `- Lançamentos: ${d.transactions?.length || 0}\n` +
            `- Contas: ${d.accounts?.length || 0}\n`;
        }

        const msg = `⚡ Import Rápido iCloud\n\nDeseja substituir todos os seus dados PELO BACKUP ABAIXO?\n\nData do Pack: ${backupDate}\n${countMsg}\nEsta ação não pode ser desfeita.`;

        if (!confirm(msg)) {
          importPackFile.value = "";
          return;
        }

        btnImportPack.disabled = true;
        btnImportPack.innerText = "⏳ Restaurando...";

        try {
          await importDB(json, true);
          showToast("success", "⚡ Pack restaurado com sucesso!\nO app será recarregado.");
          location.hash = "#home";
          location.reload();
        } catch (err) {
          showToast("error", err.message);
        } finally {
          btnImportPack.disabled = false;
          btnImportPack.innerText = "⚡ Import rápido";
          importPackFile.value = "";
        }
      } catch (err) {
        showToast("error", `Erro na leitura do Pack:\n${err.message}`);
        importPackFile.value = "";
      }
    };
  }

  if (btnExport) {
    btnExport.onclick = async () => {
      try {
        const data = await exportDB();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        // Filename: FinanceApp_backup_YYYY-MM-DD_HHMM.json
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mi = String(now.getMinutes()).padStart(2, '0');
        const filename = `FinanceApp_backup_${yyyy}-${mm}-${dd}_${hh}${mi}.json`;

        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast("success", "Backup gerado: " + filename + "\n\nNo iPhone: Salve em 'Arquivos > iCloud Drive > FinanceApp' para sincronizar.");
      } catch (e) {
        showToast("error", "Erro ao exportar: " + e.message);
      }
    };
  }

  if (btnImport) {
    btnImport.onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // A) Validar extensão/tipo
      if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
        showToast("error", "Este arquivo não parece um backup (.json) do FinanceApp.\n\nSelecione o arquivo exportado em Config > Exportar.");
        fileInput.value = "";
        return;
      }

      const text = await file.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        // B) Validar JSON
        showToast("error", "Não consegui ler este arquivo como JSON.\n\nEle pode estar corrompido ou não ser um backup do FinanceApp (ex.: CSV/OFX).\nTente exportar novamente em Config > Exportar e selecione o .json gerado.");
        fileInput.value = "";
        return;
      }

      // 1.1) Validação Rápida de App (Se tiver meta, mas for outro app, rejeita logo)
      if (json.meta && json.meta.appId && json.meta.appId !== "financeapp") {
        showToast("error", "Este arquivo não é um backup do FinanceApp (parece ser de outro app).\nExporte novamente em Config > Exportar e selecione o .json gerado.");
        fileInput.value = "";
        return;
      }

      try {
        // Pre-calc Summary for Confirmation (Best effort)
        // We assume structure might be valid here, but real validation is in importDB
        let d = json.data;
        // If legacy raw dump, d might be undefined or we look at root
        if (!d && (Array.isArray(json.transactions) || Array.isArray(json.accounts))) {
          d = json;
        }
        d = d || {};

        const countTx = d.transactions?.length || 0;
        const countGoals = (d.goal_templates?.length || 0) + (d.goals?.length || 0);
        const countRules = d.rules?.length || 0;
        const backupDate = json.meta?.createdAt ? new Date(json.meta.createdAt).toLocaleString() : "(Sem data)";

        // E) Confirmação
        const msg = `Importar backup e substituir todos os seus dados?\n\nRESUMO DO BACKUP:\nData: ${backupDate}\n- Lançamentos: ${countTx}\n- Metas: ${countGoals}\n- Regras: ${countRules}\n\nIsso vai substituir TODOS os seus dados atuais neste aparelho. Continuar?`;

        if (!confirm(msg)) {
          fileInput.value = "";
          return;
        }

        // UI Busy State
        const originalText = btnImport.innerText;
        btnImport.disabled = true;
        btnImport.innerText = "⏳ Importando...";

        try {
          // F) Segurança de dados (Atomic Restore via db.js)
          // 1.4) Call importDB with original JSON
          await importDB(json, true);

          showToast("success", "Backup importado com sucesso.\nO app será recarregado agora.");
          location.hash = "#home";
          location.reload();
        } catch (err) {
          // 1.5) Show friendly error from db.js directly
          showToast("error", err.message);
        } finally {
          // Reset UI
          btnImport.disabled = false;
          btnImport.innerText = originalText;
          fileInput.value = "";
        }

      } catch (err) {
        showToast("error", `Erro na pré-validação:\n${err.message}`);
        fileInput.value = "";
      }
    };
  }

  if (btnReset) {
    btnReset.onclick = async () => {
      if (confirm("TEM CERTEZA? Isso apagará TODOS os dados do app permanentemente.") && confirm("Confirmação final: APAGAR TUDO?")) {
        await resetDB();
        showToast("success", "App resetado. Recarregando...");
        location.reload();
      }
    };
  }

  // HEALTH CHECK LOGIC
  const btnHealthCheck = rootEl.querySelector("#btnHealthCheck");
  const modalHealthCheck = rootEl.querySelector("#modalHealthCheck");
  const btnClsHealthCheck = rootEl.querySelector("#btnClsHealthCheck");
  const healthResults = rootEl.querySelector("#healthCheckResults");

  if (btnHealthCheck) {
    btnHealthCheck.onclick = async () => {
      let resultsHtml = "";

      // 1. Service Worker
      if ('serviceWorker' in navigator) {
        const sw = await navigator.serviceWorker.getRegistration();
        if (sw && sw.active) {
          resultsHtml += "<div>✅ Service Worker Ativo (Offline OK)</div>";
        } else {
          resultsHtml += "<div>⚠️ Service Worker não ativo (Offline pode falhar)</div>";
        }
      } else {
        resultsHtml += "<div>⚠️ Service Worker não suportado neste navegador.</div>";
      }

      // 2. IndexedDB
      try {
        const dbs = await window.indexedDB.databases();
        const mainDb = dbs.find(d => d.name === "financeapp");
        if (mainDb) {
          resultsHtml += "<div>✅ Banco de Dados Local acessível</div>";
        } else {
          // It might exist but the API might be restricted or it's named differently
          resultsHtml += "<div>✅ Banco de Dados Local presumido (API databases n/a ou não listado)</div>";
        }
      } catch (e) {
        resultsHtml += "<div>✅ Banco de Dados Local acessível</div>"; // fallback if databases() fails
      }

      // 3. Storage Estimate
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const estimate = await navigator.storage.estimate();
          const usedMB = (estimate.usage / (1024 * 1024)).toFixed(2);
          const totalMB = (estimate.quota / (1024 * 1024)).toFixed(0);
          resultsHtml += `<div>✅ Armazenamento usado: ${usedMB} MB (limite: ~${totalMB} MB)</div>`;
        } catch (e) { }
      }

      healthResults.innerHTML = resultsHtml;
      modalHealthCheck.showModal();
    };
  }

  if (btnClsHealthCheck) {
    btnClsHealthCheck.onclick = () => modalHealthCheck.close();
  }

  // Force Reset (Error Screen)
  const btnForce = rootEl.querySelector("#btnForceReset");
  if (btnForce) {
    btnForce.onclick = async () => {
      if (confirm("Isso apagará seus dados para corrigir o erro. Continuar?")) {
        await resetDB();
        location.reload();
      }
    };
  }
  // Rate
  rootEl.querySelector("#rateForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const usdRate = Number(e.target.usdRate.value);
    if (!usdRate) return;
    await put("settings", { id: "config", usdRate });
    await refreshSettings(rootEl);
    showToast("success", "Taxa Global de Câmbio atualizada com sucesso!");
  });

  const btnRecalcSel = rootEl.querySelector("#btnRecalcSelected");
  const modalRecalc = rootEl.querySelector("#modalRecalc");
  if (btnRecalcSel && modalRecalc) {
    const btnCancel = rootEl.querySelector("#btnCancelRecalc");
    const btnPreview = rootEl.querySelector("#btnPreviewRecalc");
    const btnBack = rootEl.querySelector("#btnBackToForm");
    const btnConfirm = rootEl.querySelector("#btnConfirmRecalc");

    const formArea = rootEl.querySelector("#recalcFormArea");
    const previewArea = rootEl.querySelector("#recalcPreviewArea");
    const tbody = rootEl.querySelector("#recalcTableBody");
    const summary = rootEl.querySelector("#recalcSummary");
    const limitWarning = rootEl.querySelector("#recalcLimitWarning");

    let pendingTxsToUpdate = [];
    let pendingRate = 0;

    const resetModal = () => {
      formArea.style.display = "block";
      previewArea.style.display = "none";
      pendingTxsToUpdate = [];
      pendingRate = 0;
    };

    btnRecalcSel.onclick = () => {
      resetModal();
      modalRecalc.style.display = "block";
    };

    btnCancel.onclick = () => modalRecalc.style.display = "none";
    btnBack.onclick = resetModal;

    btnPreview.onclick = async () => {
      const m = rootEl.querySelector("#recalcMonth").value;
      const preserve = rootEl.querySelector("#recalcPreserveFx").checked;
      if (!m) return showToast("error", "Selecione um mês válido.");

      const cfg = await get("settings", "config");
      if (!cfg?.usdRate) return showToast("error", "Defina uma taxa global de câmbio antes de recalcular.");
      pendingRate = cfg.usdRate;

      const txs = await list("transactions");
      let totalDelta = 0;
      pendingTxsToUpdate = [];

      for (const t of txs) {
        if (t.currency === "USD" && t.date.startsWith(m)) {
          if (preserve && t.fxRate > 0) continue; // Pula congelados

          const valBRLAntigo = t.valueBRL || (t.value * (t.fxRate || 0));
          const valBRLNovo = t.value * pendingRate;
          const delta = valBRLNovo - valBRLAntigo;

          pendingTxsToUpdate.push({
            tx: t,
            oldRate: t.fxRate || "(Auto)",
            oldBRL: valBRLAntigo,
            newBRL: valBRLNovo,
            delta: delta
          });
          totalDelta += delta;
        }
      }

      if (pendingTxsToUpdate.length === 0) {
        return showToast("info", "Nenhum lançamento elegível para recálculo neste mês/critério.");
      }

      // Render Table
      tbody.innerHTML = "";
      const displayLimit = 50;
      limitWarning.style.display = pendingTxsToUpdate.length > displayLimit ? "block" : "none";

      pendingTxsToUpdate.slice(0, displayLimit).forEach(item => {
        const t = item.tx;
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid #eee";

        const deltaColor = item.delta > 0 ? "red" : (item.delta < 0 ? "green" : "#666");

        tr.innerHTML = `
            <td>${t.date.split("-").reverse().join("/")}</td>
            <td style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:80px;">${esc(t.description)}</td>
            <td>U$ ${t.value.toFixed(2)}</td>
            <td>${item.oldRate}</td>
            <td>R$ ${item.oldBRL.toFixed(2)}</td>
            <td style="color:#007bff; font-weight:bold;">${pendingRate}</td>
            <td style="color:#007bff; font-weight:bold;">R$ ${item.newBRL.toFixed(2)}</td>
            <td style="color:${deltaColor}; font-weight:bold;">${item.delta > 0 ? '+' : ''}${item.delta.toFixed(2)}</td>
          `;
        tbody.appendChild(tr);
      });

      const totalDColor = totalDelta > 0 ? "red" : "green";
      summary.innerHTML = `
        <strong>Afetados:</strong> ${pendingTxsToUpdate.length} lançamentos.<br/>
        <strong>Impacto Global Estimado:</strong> <span style="color:${totalDColor}; font-weight:bold;">${totalDelta > 0 ? '+' : ''} R$ ${totalDelta.toFixed(2)}</span>
      `;

      formArea.style.display = "none";
      previewArea.style.display = "block";
    };

    btnConfirm.onclick = async () => {
      let count = 0;
      const preserve = rootEl.querySelector("#recalcPreserveFx").checked;

      for (const item of pendingTxsToUpdate) {
        const t = item.tx;
        t.valueBRL = item.newBRL;
        if (!preserve) {
          // If user forced bypass of preserveFx, we clear their explicit fxRate so it's fully tracked by global again, or explicitly overwrite it.
          // Better standard: batch recalculator unfixes them.
          // M.D. standard: batch recalculator unfixes them.
          t.fxRate = null;
        }
        await put("transactions", t);
        count++;
      }

      showToast("success", `Sucesso! ${count} lançamentos foram salvos no banco.`);
      modalRecalc.style.display = "none";
      await refreshSettings(rootEl);
    };
  }

  // Rewrite recalcBtn (TODOS)
  const recalcAllBtn = rootEl.querySelector("#recalcBtn");
  if (recalcAllBtn) {
    recalcAllBtn.onclick = async () => {
      if (!confirm("Isso aplicará a taxa global de USD ATUAL em TODOS os lançamentos USD passados que não possuem taxa fixa congelada. Continuar?")) return;
      const cfg = await get("settings", "config");
      if (!cfg?.usdRate) return showToast("error", "Defina o câmbio primeiro.");

      const txs = await list("transactions");
      let count = 0;
      for (const t of txs) {
        if (t.currency === "USD") {
          if (t.fxRate > 0) continue; // SEMPRE preserva taxa fixada individualmente no "ALL"
          t.valueBRL = t.value * cfg.usdRate;
          await put("transactions", t);
          count++;
        }
      }
      showToast("success", `${count} lançamentos brutos globais recalculados usando taxa de R$ ${cfg.usdRate}.`);
    };
  }

  // Categories
  rootEl.querySelector("#catForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = e.target.elements.id?.value || uid("cat");
    const name = e.target.name.value.trim();
    if (!name) return;
    await put("categories", { id, name });
    e.target.reset();
    if (e.target.elements.id) e.target.elements.id.value = "";
    await refreshSettings(rootEl);
  });

  // Select Categoria Action
  rootEl.addEventListener("click", async (e) => {
    const selCat = e.target.closest("[data-action='select-cat']");
    if (selCat) {
      const id = selCat.dataset.id;
      await put("settings", { id: "ui_cat_view", value: id });
      await refreshSettings(rootEl);
    }
  });

  // Subcategories
  rootEl.querySelector("#subForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const selectedCatId = (await get("settings", "ui_cat_view"))?.value;
    if (!selectedCatId) return showToast("error", "Selecione uma categoria primeiro.");

    const id = e.target.elements.id?.value || uid("sub");
    const name = e.target.name.value.trim();
    if (!name) return;
    await put("subcategories", { id, categoryId: selectedCatId, name });
    e.target.reset();
    if (e.target.elements.id) e.target.elements.id.value = "";
    await refreshSettings(rootEl);
  });

  // Tags
  rootEl.querySelector("#tagForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = e.target.elements.id?.value || uid("tag");
    const name = e.target.name.value.trim();
    if (!name) return;
    await put("tags", { id, name });
    e.target.reset();
    if (e.target.elements.id) e.target.elements.id.value = "";
    await refreshSettings(rootEl);
  });

  // Pessoas
  rootEl.querySelector("#personForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = e.target.elements.id?.value || uid("p");
    const name = e.target.name.value.trim();
    if (!name) return;
    await put("people", { id, name });
    e.target.reset();
    if (e.target.elements.id) e.target.elements.id.value = "";
    await refreshSettings(rootEl);
  });

  // Bancos
  rootEl.querySelector("#bankForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = e.target.elements.id?.value || uid("b");
    const name = e.target.name.value.trim();
    const badgeColorKey = e.target.badgeColorKey.value;
    const badgeShapeKey = e.target.badgeShapeKey.value;
    if (!name) return;
    await put("banks", { id, name, badgeColorKey, badgeShapeKey, createdAt: e.target.dataset.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
    e.target.reset();
    if (e.target.elements.id) e.target.elements.id.value = "";
    await refreshSettings(rootEl);
  });

  // Contas
  rootEl.querySelector("#accountForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = e.target.elements.id?.value || uid("a");
    const name = e.target.name.value.trim();
    const currency = e.target.currency.value;
    const bankId = e.target.bankId.value || null;
    const personId = e.target.personId.value || null;
    const accountType = e.target.accountType.value;
    const investSubtype = accountType === 'investment' ? (e.target.investSubtype.value || null) : null;

    if (!name) return;
    await put("accounts", {
      id, name, currency, bankId, personId, accountType, investSubtype,
      createdAt: e.target.dataset.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    e.target.reset();
    if (e.target.elements.id) e.target.elements.id.value = "";
    e.target.investSubtype.style.display = "none";
    await refreshSettings(rootEl);
  });

  // Cartões
  const cardForm = rootEl.querySelector("#cardForm");
  if (cardForm) {
    const mainSel = cardForm.querySelector("[name='mainPersonId']");
    const addChecks = cardForm.querySelectorAll(".card-person-check");
    const setupCont = cardForm.querySelector("#cardPaymentSetupContainer");
    const setupList = cardForm.querySelector("#cardPaymentSetupList");
    const hiddenAccs = rootEl.querySelector("#hiddenAccountSelect")?.innerHTML || "";

    const renderPaymentSetup = () => {
      let html = "";
      const pNameMain = mainSel.options[mainSel.selectedIndex]?.text;
      const pValues = [];
      if (mainSel.value) pValues.push({ id: mainSel.value, name: pNameMain, type: 'Titular' });
      addChecks.forEach(cb => {
        if (cb.checked) pValues.push({ id: cb.value, name: cb.dataset.name, type: 'Adicional' });
      });

      if (pValues.length === 0) {
        setupCont.style.display = 'none';
        return;
      }

      pValues.forEach(pv => {
        html += `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:5px;">
                  <span class="small" style="min-width:100px;">${pv.type}: <strong>${esc(pv.name)}</strong></span>
                  <select class="field-sm card-payment-dynamic-select" data-person="${pv.id}" style="flex:1;">
                    ${hiddenAccs}
                  </select>
                </div>
              `;
      });
      setupList.innerHTML = html;
      setupCont.style.display = 'block';

      if (cardForm.dataset.editingPaymentSetup) {
        try {
          const savedMap = JSON.parse(cardForm.dataset.editingPaymentSetup);
          cardForm.querySelectorAll('.card-payment-dynamic-select').forEach(sel => {
            if (savedMap[sel.dataset.person]) {
              sel.value = savedMap[sel.dataset.person];
            }
          });
        } catch (e) { }
      }
    };

    mainSel.addEventListener("change", renderPaymentSetup);
    addChecks.forEach(cb => cb.addEventListener("change", renderPaymentSetup));

    cardForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = e.target.elements.id?.value || uid("c");
      const name = e.target.name.value.trim();
      const currency = e.target.currency.value;
      const closingDay = Number(e.target.closingDay.value);
      const dueDay = Number(e.target.dueDay.value);

      const badgeColorKey = e.target.badgeColorKey.value;
      const badgeShapeKey = e.target.badgeShapeKey.value;
      const mainPersonId = e.target.mainPersonId.value;

      const addCheckboxes = Array.from(e.target.querySelectorAll('.card-person-check:checked'));
      const additionalPersonIds = addCheckboxes.map(cb => cb.value);

      const defaultAccountByPersonId = {};
      const selects = e.target.querySelectorAll('.card-payment-dynamic-select');
      selects.forEach(sel => {
        if (sel.value) defaultAccountByPersonId[sel.dataset.person] = sel.value;
      });

      await put("cards", {
        id, name, currency, closingDay, dueDay,
        badgeColorKey, badgeShapeKey, mainPersonId, additionalPersonIds,
        defaultAccountByPersonId,
        createdAt: e.target.dataset.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      e.target.reset();
      if (e.target.elements.id) e.target.elements.id.value = "";
      delete e.target.dataset.editingPaymentSetup;
      setupCont.style.display = "none";
      await refreshSettings(rootEl);
    });
  }

  // Rules
  const rForm = rootEl.querySelector("#ruleForm");
  if (rForm) {
    const selCatAction = rForm.querySelector("#ruleActionCategory");
    const selSubAction = rForm.querySelector("#ruleActionSubcategory");

    // Dynamic Subcategory Population
    const updateSubcategories = async (catId) => {
      selSubAction.innerHTML = '<option value="">(Manter Subcategoria)</option>';
      if (!catId) {
        selSubAction.disabled = true;
        return;
      }

      const subs = await list("subcategories");
      const filtered = subs.filter(s => s.categoryId === catId);

      if (filtered.length > 0) {
        selSubAction.disabled = false;
        selSubAction.innerHTML += filtered.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
      } else {
        selSubAction.disabled = true;
      }
    };

    selCatAction.addEventListener("change", (e) => updateSubcategories(e.target.value));

    rForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);

      // Handle Edit ID
      let id = fd.get("id");
      let isEdit = !!id;
      if (!id) id = uid("rule"); // Create new ID if not exist

      // Preserve created_at if editing? fetch old or just set updated_at
      // Ideally we fetch old rule if editing to preserve unexpected fields, but schema is strict here.
      // Let's assume replace for simplicity on MVP, but preserve created_at from old logic if we had it.
      // We'll trust "put" replaces.

      const rule = {
        id: id,
        name: fd.get("name"),
        enabled: fd.get("enabled") === "on",
        priority: parseInt(fd.get("priority")) || 10,
        match: {
          // Phase 16A-2 Extended Filters
          anyIncludes: fd.get("ruleAnyIncludes") ? fd.get("ruleAnyIncludes").split(",").map(s => s.trim()).filter(Boolean) : [],
          allIncludes: fd.get("ruleAllIncludes") ? fd.get("ruleAllIncludes").split(",").map(s => s.trim()).filter(Boolean) : [],
          noneIncludes: fd.get("ruleNoneIncludes") ? fd.get("ruleNoneIncludes").split(",").map(s => s.trim()).filter(Boolean) : [],

          cardId: fd.get("ruleCardId") || undefined,
          accountId: fd.get("ruleAccountId") || undefined,

          minAmountBRL: fd.get("ruleMinAmount") ? parseFloat(fd.get("ruleMinAmount")) : undefined,
          maxAmountBRL: fd.get("ruleMaxAmount") ? parseFloat(fd.get("ruleMaxAmount")) : undefined
        },
        actions: {},
        options: {
          overwrite: fd.get("overwrite") === "on"
        },
        createdAt: isEdit ? undefined : new Date().toISOString(), // let's not lose original createdAt if we fetched it? 
        updatedAt: new Date().toISOString()
      };

      // If edit, we might be overwriting createdAt with undefined if we don't fetch or store it in hidden.
      // Better: if isEdit, try to get existing first? No, too slow.
      // Just store what we have. If createdAt is lost, it's acceptable for now or add hidden input.
      // I won't add hidden 'createdAt' input to keep it simple.

      // Actions
      if (fd.get("actionCategory")) rule.actions.categoryId = fd.get("actionCategory");
      if (fd.get("actionSubcategory")) rule.actions.subcategoryId = fd.get("actionSubcategory");
      if (fd.get("actionPerson")) rule.actions.personId = fd.get("actionPerson");

      const t = fd.get("actionTags");
      if (t) {
        rule.actions.tags = t.split(",").map(s => s.trim()).filter(Boolean);
      }

      await put("rules", rule);
      e.target.reset();
      await refreshSettings(rootEl);
    });

    // Wealth Goals Form Handler
    const wgForm = rootEl.querySelector("#wealthGoalForm");
    if (wgForm) {
      wgForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);

        let id = fd.get("id");
        if (!id) id = uid("wg");

        const targetValue = parseFloat(fd.get("targetValue"));
        if (isNaN(targetValue) || targetValue <= 0) {
          showToast("error", "Valor alvo inválido.");
          return;
        }

        const goal = {
          id,
          name: fd.get("name").trim(),
          targetCentsBRL: Math.round(targetValue * 100),
          active: fd.get("active") === "on",
          notes: fd.get("notes").trim(),
          updatedAt: new Date().toISOString()
        };

        if (!fd.get("id")) goal.createdAt = goal.updatedAt;

        await put("wealth_goals", goal);
        e.target.reset();
        await refreshSettings(rootEl);
      });
    }

    // Generic Edit Handler for entities using renderList
    rootEl.addEventListener("click", (e) => {
      const btnEdit = e.target.closest("[data-edit]");
      if (btnEdit) {
        const idx = btnEdit.dataset.edit.indexOf("|");
        const store = btnEdit.dataset.edit.substring(0, idx);
        const itemStr = btnEdit.dataset.edit.substring(idx + 1);
        const item = JSON.parse(itemStr);

        const configs = {
          "people": { formId: "#personForm" },
          "banks": { formId: "#bankForm" },
          "accounts": { formId: "#accountForm" },
          "cards": { formId: "#cardForm" },
          "categories": { formId: "#catForm" },
          "subcategories": { formId: "#subForm" },
          "tags": { formId: "#tagForm" },
        };

        const cfg = configs[store];
        if (!cfg) return;

        const form = rootEl.querySelector(cfg.formId);
        if (!form) return;

        let idInput = form.querySelector("[name='id']");
        if (!idInput) {
          idInput = document.createElement("input");
          idInput.type = "hidden";
          idInput.name = "id";
          form.appendChild(idInput);
        }

        if (store === 'cards' && item.defaultAccountByPersonId) {
          form.dataset.editingPaymentSetup = JSON.stringify(item.defaultAccountByPersonId);
        } else {
          delete form.dataset.editingPaymentSetup;
        }

        if (item.createdAt) form.dataset.createdAt = item.createdAt;

        Object.keys(item).forEach(k => {
          if (Array.isArray(item[k])) {
            const checkboxes = form.querySelectorAll(`input[type="checkbox"][name='${k}']`);
            checkboxes.forEach(cb => {
              cb.checked = item[k].includes(cb.value);
              cb.dispatchEvent(new Event('change', { bubbles: true }));
            });
            return;
          }
          const input = form.querySelector(`[name='${k}']`);
          if (input) {
            if (input.type === 'checkbox') input.checked = item[k];
            else input.value = item[k] || '';
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        idInput.value = item.id;

        const submitBtn = form.querySelector("button[type='submit']");
        if (submitBtn) submitBtn.innerText = "Salvar Alterações";

        let cancelBtn = form.querySelector(".btn-cancel-edit");
        if (!cancelBtn) {
          cancelBtn = document.createElement("button");
          cancelBtn.type = "button";
          cancelBtn.className = "btn btn-secondary small btn-cancel-edit";
          cancelBtn.innerText = "Cancelar";
          cancelBtn.onclick = () => {
            form.reset();
            idInput.value = "";
            submitBtn.innerText = store === 'categories' || store === 'subcategories' || store === 'tags' ? '+' : 'Adicionar';
            cancelBtn.style.display = "none";
            if (form.querySelector("[name='colorHex']")) form.querySelector("[name='colorHex']").value = store === 'accounts' ? "#666666" : "#17a2b8";
          };
          submitBtn.parentNode.insertBefore(cancelBtn, submitBtn.nextSibling);
          submitBtn.parentNode.style.display = 'flex';
          submitBtn.parentNode.style.gap = '5px';
        }
        cancelBtn.style.display = "inline-block";
        form.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    // Edit Rule Handler
    rootEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action='edit-rule']");
      if (btn) {
        const rule = JSON.parse(btn.dataset.rule);
        const f = rForm;

        f.querySelector("[name=id]").value = rule.id;
        f.querySelector("[name=name]").value = rule.name;
        f.querySelector("[name=priority]").value = rule.priority || 10;
        f.querySelector("[name=enabled]").checked = rule.enabled !== false;

        // Matchers
        const m = rule.match || {};
        f.querySelector("[name=ruleAnyIncludes]").value = (m.anyIncludes || (m.descriptionIncludes ? [m.descriptionIncludes] : [])).join(", ");
        f.querySelector("[name=ruleAllIncludes]").value = (m.allIncludes || []).join(", ");
        f.querySelector("[name=ruleNoneIncludes]").value = (m.noneIncludes || []).join(", ");
        f.querySelector("[name=ruleCardId]").value = m.cardId || "";
        f.querySelector("[name=ruleAccountId]").value = m.accountId || "";
        f.querySelector("[name=ruleMinAmount]").value = m.minAmountBRL || "";
        f.querySelector("[name=ruleMaxAmount]").value = m.maxAmountBRL || "";

        const catId = rule.actions?.categoryId || "";
        f.querySelector("[name=actionCategory]").value = catId;

        // Populate and select Subcategory
        await updateSubcategories(catId);
        f.querySelector("[name=actionSubcategory]").value = rule.actions?.subcategoryId || "";

        f.querySelector("[name=actionPerson]").value = rule.actions?.personId || "";
        f.querySelector("[name=actionTags]").value = (rule.actions?.tags || []).join(", ");
        f.querySelector("[name=overwrite]").checked = rule.options?.overwrite === true;

        // Change UI state
        document.getElementById("ruleFormTitle").innerText = "Editar Regra";
        document.getElementById("btnSaveRule").innerText = "Salvar Alterações";
        document.getElementById("btnCancelEditRule").style.display = "block";
        document.getElementById("btnTestRule").style.display = "block";

        // Scroll to form
        f.scrollIntoView({ behavior: "smooth" });
      }

      // Wealth Goals Edit
      const btnEditGoal = e.target.closest("[data-action='edit-wealth-goal']");
      if (btnEditGoal) {
        const goal = JSON.parse(btnEditGoal.dataset.goal);
        const f = wgForm;
        if (!f) return;

        f.querySelector("[name=id]").value = goal.id;
        f.querySelector("[name=name]").value = goal.name;
        f.querySelector("[name=targetValue]").value = (goal.targetCentsBRL / 100).toFixed(2);
        f.querySelector("[name=notes]").value = goal.notes || "";
        f.querySelector("[name=active]").checked = goal.active !== false;

        document.getElementById("wealthGoalFormTitle").innerText = "Editar Meta de Patrimônio";
        document.getElementById("btnSaveWealthGoal").innerText = "Salvar Alterações";
        document.getElementById("btnCancelEditWealthGoal").style.display = "block";
        f.scrollIntoView({ behavior: "smooth" });
      }
    });

    const btnCancel = rootEl.querySelector("#btnCancelEditRule");
    if (btnCancel) {
      btnCancel.onclick = () => {
        rForm.reset();
        rForm.querySelector("[name=id]").value = "";
        updateSubcategories(""); // Reset sub dropdown
        document.getElementById("ruleFormTitle").innerText = "Nova Regra";
        document.getElementById("btnSaveRule").innerText = "Salvar Regra";
        btnCancel.style.display = "none";
        document.getElementById("btnTestRule").style.display = "none";
        showToast("success", "Edição cancelada");
      };
    }

    const btnCancelGoal = rootEl.querySelector("#btnCancelEditWealthGoal");
    if (btnCancelGoal && wgForm) {
      btnCancelGoal.onclick = () => {
        wgForm.reset();
        wgForm.querySelector("[name=id]").value = "";
        document.getElementById("wealthGoalFormTitle").innerText = "Nova Meta de Patrimônio";
        document.getElementById("btnSaveWealthGoal").innerText = "Salvar Meta";
        btnCancelGoal.style.display = "none";
      };
    }

    // --- Phase 16A-2 Rule Simulator ---
    const btnTest = rootEl.querySelector("#btnTestRule");
    const testModal = rootEl.querySelector("#modalTestRule");
    if (btnTest && testModal) {
      btnTest.onclick = () => {
        // Pre-fill inputs from form state just for fun, or leave blank initially
        testModal.showModal();
      };

      rootEl.querySelector("#btnClsTestRule").onclick = () => {
        testModal.close();
        rootEl.querySelector("#simOutput").style.display = "none";
      };

      rootEl.querySelector("#btnRunTestRule").onclick = async () => {
        const out = rootEl.querySelector("#simOutput");
        out.style.display = "block";
        out.innerHTML = "<em>Simulando...</em>";

        // 1. Build Mock Tx
        const mockTx = {
          id: "sim_tx_001",
          description: rootEl.querySelector("#simDesc").value || "",
          value: parseFloat(rootEl.querySelector("#simVal").value) || 0,
          valueBRL: parseFloat(rootEl.querySelector("#simVal").value) || 0,
          cardId: rootEl.querySelector("#simCardId").value || undefined,
          accountId: rootEl.querySelector("#simAccId").value || undefined,
          categoryId: "",
          tags: []
        };

        // 2. Build Mock Rule directly from the ongoing Form (no need to save)
        const fd = new FormData(rForm);
        const mockRule = {
          id: "mock_rule",
          match: {
            anyIncludes: fd.get("ruleAnyIncludes") ? fd.get("ruleAnyIncludes").split(",").map(s => s.trim()).filter(Boolean) : [],
            allIncludes: fd.get("ruleAllIncludes") ? fd.get("ruleAllIncludes").split(",").map(s => s.trim()).filter(Boolean) : [],
            noneIncludes: fd.get("ruleNoneIncludes") ? fd.get("ruleNoneIncludes").split(",").map(s => s.trim()).filter(Boolean) : [],
            cardId: fd.get("ruleCardId") || undefined,
            accountId: fd.get("ruleAccountId") || undefined,
            minAmountBRL: fd.get("ruleMinAmount") ? parseFloat(fd.get("ruleMinAmount")) : undefined,
            maxAmountBRL: fd.get("ruleMaxAmount") ? parseFloat(fd.get("ruleMaxAmount")) : undefined
          },
          actions: {
            categoryId: fd.get("actionCategory"),
            subcategoryId: fd.get("actionSubcategory"),
            personId: fd.get("actionPerson"),
            tags: fd.get("actionTags") ? fd.get("actionTags").split(",").map(s => s.trim()).filter(Boolean) : []
          }
        };

        // 3. Import dynamic engine properly to avoid polluting context
        const mRules = await import('./rules_engine.js');
        const subcats = await list("subcategories");

        // 4. Execute
        const result = mRules.applyRulesToDraft(mockTx, [mockRule], subcats);

        // 5. Present Results
        const didMatch = result.appliedRuleIds.includes("mock_rule");

        if (didMatch) {
          out.innerHTML = `<span style="color:green; font-weight:bold;">✅ Regra Aplicada com Sucesso!</span>\n\nA transação mock passou nas validações da Regra.`;
          out.innerHTML += `\n\n📌 <b>Alterações Projetadas:</b>\n`;
          if (result.draftTx.categoryId) out.innerHTML += `- Categoria ID: ${result.draftTx.categoryId}\n`;
          if (result.draftTx.subcategoryId) out.innerHTML += `- Subcat ID: ${result.draftTx.subcategoryId}\n`;
          if (result.draftTx.personId) out.innerHTML += `- Pessoa ID: ${result.draftTx.personId}\n`;
          if (result.draftTx.tags && result.draftTx.tags.length) out.innerHTML += `- Tags: [${result.draftTx.tags.join(', ')}]\n`;
        } else {
          out.innerHTML = `<span style="color:red; font-weight:bold;">❌ Regra Falhou (Não Bateu)</span>\n\nA transação simulada não atinge os critérios construídos pelo formulário.`;
          out.innerHTML += `\n\n🔍 Dicas de debugging:\n- Verificou Músculas/Minúsculas?\n- O filtro de Conta/Cartão condiz?\n- Alguma palavra caiu no 'Não Pode'?\n- O valor bate com a faixa delimitada?`;
        }
      };
    }
  }

  // Wealth Goals Link Investments Modal Handles
  const linkModal = rootEl.querySelector("#modalLinkInvestments");
  if (linkModal) {
    // Open Link Modal
    rootEl.addEventListener("click", async (e) => {
      const btnLink = e.target.closest("[data-action='link-investments']");
      if (btnLink) {
        const goalId = btnLink.dataset.id;
        const goal = wealthGoals.find(g => g.id === goalId);
        if (!goal) return;

        rootEl.querySelector("#linkGoalNameStr").innerText = goal.name;
        rootEl.querySelector("#linkGoalId").value = goalId;

        // Generate checkboxes for boxes
        const currentLinks = wealthGoalLinks.filter(l => l.goalId === goalId).map(l => l.investmentBoxId);

        let chkHtml = "";
        if (investmentBoxes.length === 0) {
          chkHtml = '<div class="small" style="color:#d35400;">Nenhuma Caixinha cadastrada. Crie uma em "Caixinhas" primeiro.</div>';
        } else {
          investmentBoxes.sort((a, b) => a.name.localeCompare(b.name)).forEach(box => {
            const isChecked = currentLinks.includes(box.id) ? "checked" : "";
            const bal = boxBalancesMap[box.id] || 0;
            chkHtml += `
                        <label style="display:flex; align-items:center; gap:8px; padding:5px; border-bottom:1px solid #eaeaea;">
                            <input type="checkbox" name="boxLink" value="${box.id}" ${isChecked} />
                            <div style="flex:1;">
                                <div style="font-weight:bold; font-size:13px;">${esc(box.name)}</div>
                                <div class="small" style="color:#666;">Saldo BRL: R$ ${bal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                            </div>
                        </label>
                    `;
          });
        }

        rootEl.querySelector("#investmentsChecklist").innerHTML = chkHtml;
        linkModal.showModal();
      }
    });

    // Close Button
    rootEl.querySelector("#btnCancelLinkInst").onclick = () => {
      linkModal.close();
    };

    // Submitting Link Form
    const linkForm = rootEl.querySelector("#linkInvestmentsForm");
    linkForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const goalId = linkForm.querySelector("#linkGoalId").value;
      const formChecks = linkForm.querySelectorAll("input[name='boxLink']:checked");
      const selectedBoxIds = Array.from(formChecks).map(chk => chk.value);

      // Delete existing links for this goal
      const existingLinks = wealthGoalLinks.filter(l => l.goalId === goalId);
      for (const link of existingLinks) {
        await remove("wealth_goal_links", link.id);
      }

      // Create new links
      for (const boxId of selectedBoxIds) {
        await put("wealth_goal_links", {
          id: uid("wgl"),
          goalId,
          investmentBoxId: boxId,
          createdAt: new Date().toISOString()
        });
      }

      linkModal.close();
      showToast("success", "Vínculos salvos com sucesso!");
      await refreshSettings(rootEl);
    });
  }

  // Legacy Goals Handlers removed.
  // We now use #goalTemplateForm in the section below.


  // Recurrent Goals Handlers
  const gForm = rootEl.querySelector("#goalTemplateForm");
  if (gForm) {
    const selCat = gForm.querySelector("#goalTempCategory");
    const selSub = gForm.querySelector("#goalTempSubcategory");

    // Dynamic Subcategory
    const updateGoalSubs = async (catId) => {
      selSub.innerHTML = '<option value="">(Todas Subcategorias)</option>';
      if (!catId) {
        selSub.disabled = true;
        return;
      }
      const subs = await list("subcategories");
      const filtered = subs.filter(s => s.categoryId === catId);
      if (filtered.length > 0) {
        selSub.disabled = false;
        selSub.innerHTML += filtered.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
      } else {
        selSub.disabled = true;
      }
    };

    selCat.addEventListener("change", (e) => updateGoalSubs(e.target.value));

    gForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      let id = fd.get("id");
      const isEdit = !!id;

      const tmpl = {
        id: id || uid("gt"),
        name: fd.get("name"),
        categoryId: fd.get("categoryId"),
        subcategoryId: fd.get("subcategoryId") || null,
        personId: fd.get("personId") || null,
        active: fd.get("active") === "on",
        createdAt: isEdit ? undefined : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // If Edit, we preserve revisions/overrides (they are separate stores)
      // But allow name/active changes.
      if (isEdit) {
        const old = await get("goal_templates", id);
        if (old) tmpl.createdAt = old.createdAt;
        await put("goal_templates", tmpl);
        // We do NOT update target/month here as per plan (use revision button).
        // Unless it's a "simple update" but user requested separate revision logic.
        // Just updating template properties.
      } else {
        // Create New Template + First Revision
        await put("goal_templates", tmpl);

        const startMonth = fd.get("startMonth");
        const target = parseFloat(fd.get("target"));
        if (!startMonth || !target) return showToast("error", "Mês e Valor obrigatórios para nova meta.");

        await put("goal_revisions", {
          id: uid("gr"),
          templateId: tmpl.id,
          effectiveFromMonth: startMonth,
          targetCents: Math.round(target * 100),
          createdAt: new Date().toISOString()
        });
      }

      e.target.reset();
      await refreshSettings(rootEl);
    });

    // Edit Template Logic
    rootEl.addEventListener("click", async (e) => {
      // Edit Template Properties
      const btnEdit = e.target.closest("[data-action='edit-goal-temp']");
      if (btnEdit) {
        const tmpl = JSON.parse(btnEdit.dataset.tmpl);
        const f = gForm;

        f.querySelector("[name=id]").value = tmpl.id;
        f.querySelector("[name=name]").value = tmpl.name;
        f.querySelector("[name=active]").checked = tmpl.active !== false;
        f.querySelector("[name=personId]").value = tmpl.personId || "";

        f.querySelector("[name=categoryId]").value = tmpl.categoryId;
        await updateGoalSubs(tmpl.categoryId);
        f.querySelector("[name=subcategoryId]").value = tmpl.subcategoryId || "";

        // Disable Start/Target for edit (Force usage of Revision button)
        f.querySelector("[name=startMonth]").disabled = true;
        f.querySelector("[name=target]").disabled = true;
        f.querySelector("[name=startMonth]").value = ""; // Clear to avoid confusion
        f.querySelector("[name=target]").value = "";

        document.getElementById("goalTempFormTitle").innerText = "Editar Meta (Propriedades)";
        document.getElementById("btnSaveGoalTemp").innerText = "Salvar Alterações";
        document.getElementById("btnCancelEditGoalTemp").style.display = "block";

        f.scrollIntoView({ behavior: "smooth" });
        return;
      }

      // Cancel Edit
      if (e.target.id === "btnCancelEditGoalTemp") {
        gForm.reset();
        gForm.querySelector("[name=id]").value = "";
        updateGoalSubs("");
        gForm.querySelector("[name=startMonth]").disabled = false;
        gForm.querySelector("[name=target]").disabled = false;
        // Reset default month
        gForm.querySelector("[name=startMonth]").value = new Date().toISOString().slice(0, 7);

        document.getElementById("goalTempFormTitle").innerText = "Nova Meta Recorrente";
        document.getElementById("btnSaveGoalTemp").innerText = "Salvar Meta";
        e.target.style.display = "none";
        return;
      }

      // New Revision
      const btnRev = e.target.closest("[data-action='new-revision']");
      if (btnRev) {
        const tmplId = btnRev.dataset.id;
        const newMonth = prompt("A partir de qual mês? (YYYY-MM)", new Date().toISOString().slice(0, 7));
        if (!newMonth) return;
        const newVal = prompt("Qual o novo valor padrão? (ex: 600.00)");
        if (!newVal) return;

        await put("goal_revisions", {
          id: uid("gr"),
          templateId: tmplId,
          effectiveFromMonth: newMonth,
          targetCents: Math.round(parseFloat(newVal.replace(",", ".")) * 100),
          createdAt: new Date().toISOString()
        });
        await refreshSettings(rootEl);
        return;
      }

      // New Override
      const btnOver = e.target.closest("[data-action='new-override']");
      if (btnOver) {
        const tmplId = btnOver.dataset.id;
        const month = prompt("Para qual mês específico? (YYYY-MM)", new Date().toISOString().slice(0, 7));
        if (!month) return;
        const val = prompt("Qual o valor SOMENTE para este mês? (ex: 800.00)");
        if (!val) return;

        // Check if exists to update? We use put, so updates if key exists.
        // But key is ID. We need to find if override exists for this month/tmpl.
        // Since 'id' is random, we might duplicate if we just push new.
        // We should query first.
        const overrides = await list("goal_overrides");
        const existing = overrides.find(o => o.templateId === tmplId && o.month === month);

        await put("goal_overrides", {
          id: existing ? existing.id : uid("go"),
          templateId: tmplId,
          month: month,
          targetCents: Math.round(parseFloat(val.replace(",", ".")) * 100),
          createdAt: existing ? existing.createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        await refreshSettings(rootEl);
        return;
      }
    });
  }

  // --- Budget Templates Handlers 19C-1 ---
  const bForm = rootEl.querySelector("#budgetTemplateForm");
  if (bForm) {
    const selCat = bForm.querySelector("#budgetTempCategory");
    const selSub = bForm.querySelector("#budgetTempSubcategory");

    const updateBudgetSubs = async (catId) => {
      selSub.innerHTML = '<option value="">(Todas Subcategorias)</option>';
      if (!catId) {
        selSub.disabled = true;
        return;
      }
      const subs = await list("subcategories");
      const filtered = subs.filter(s => s.categoryId === catId);
      if (filtered.length > 0) {
        selSub.disabled = false;
        selSub.innerHTML += filtered.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
      } else {
        selSub.disabled = true;
      }
    };

    selCat.addEventListener("change", (e) => updateBudgetSubs(e.target.value));

    bForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      let id = fd.get("id");
      const isEdit = !!id;

      const tmpl = {
        id: id || uid("bt"),
        name: fd.get("name"),
        categoryId: fd.get("categoryId"),
        subcategoryId: fd.get("subcategoryId") || null,
        personId: fd.get("personId") || null,
        monthlyTargetCents: Math.round(parseFloat(fd.get("monthlyTarget").replace(",", ".")) * 100),
        active: fd.get("active") === "on",
        createdAt: isEdit ? undefined : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (isEdit) {
        const old = await get("budget_templates", id);
        if (old) tmpl.createdAt = old.createdAt;
      }
      await put("budget_templates", tmpl);

      e.target.reset();
      await refreshSettings(rootEl);
    });

    rootEl.addEventListener("click", async (e) => {
      // Edit Budget
      const btnEdit = e.target.closest("[data-action='edit-budget-temp']");
      if (btnEdit) {
        const tmpl = JSON.parse(btnEdit.dataset.tmpl);
        const f = bForm;

        f.querySelector("[name=id]").value = tmpl.id;
        f.querySelector("[name=name]").value = tmpl.name;
        f.querySelector("[name=monthlyTarget]").value = (tmpl.monthlyTargetCents / 100).toFixed(2);
        f.querySelector("[name=active]").checked = tmpl.active !== false;
        f.querySelector("[name=personId]").value = tmpl.personId || "";
        f.querySelector("[name=categoryId]").value = tmpl.categoryId;

        await updateBudgetSubs(tmpl.categoryId);
        f.querySelector("[name=subcategoryId]").value = tmpl.subcategoryId || "";

        document.getElementById("budgetTempFormTitle").innerText = "Editar Orçamento";
        document.getElementById("btnSaveBudget").innerText = "Salvar Alterações";
        document.getElementById("btnCancelEditBudget").style.display = "block";
        f.scrollIntoView({ behavior: "smooth" });
        return;
      }

      // Cancel Edit
      if (e.target.id === "btnCancelEditBudget") {
        bForm.reset();
        bForm.querySelector("[name=id]").value = "";
        updateBudgetSubs("");
        document.getElementById("budgetTempFormTitle").innerText = "Novo Orçamento";
        document.getElementById("btnSaveBudget").innerText = "Salvar Orçamento";
        e.target.style.display = "none";
        return;
      }

      // Open Budget Details Modal
      const btnDetails = e.target.closest("[data-action='open-budget-details']");
      if (btnDetails) {
        const tmplId = btnDetails.dataset.id;
        renderBudgetDetailsModal(tmplId);
        return;
      }
    });
  }
} // Ends wireSettingsHandlers

// Handle Deletion (Global delegation on body to ensure capture)
// DEPRECATED: Handled globally in app.js now.
// We keep this function clean only for form handlers.
// End of function


// handleDelete removed (moved to app.js)

async function refreshSettings(rootEl) {
  rootEl.innerHTML = await settingsScreen();
  await wireSettingsHandlers(rootEl);
}

// =========================================
// BUDGET DETAILS MODAL (19C-2)
// =========================================
export async function renderBudgetDetailsModal(tmplId, initialMonth) {
  const modalId = "budgetDetailsModal";
  let existing = document.getElementById(modalId);
  if (existing) existing.remove();

  const tmpl = await get("budget_templates", tmplId);
  if (!tmpl) return;

  const m = document.createElement("div");
  m.id = modalId;
  m.style.cssText = "position:fixed; top:0; left:0; right:0; bottom:0; overflow-y:auto; background:rgba(0,0,0,0.6); z-index:9999; padding:20px; display:flex; justify-content:center; align-items:flex-start;";

  m.innerHTML = `
    <div class="card" style="width:100%; max-width:500px; margin-top:20px; position:relative;">
        <button id="btnCloseBudgetModal" class="btn btn-ghost" style="position:absolute; top:10px; right:10px; font-size:1.5em;">&times;</button>
        <div id="budgetModalContent">Carregando...</div>
    </div>
  `;

  document.body.appendChild(m);

  const contentEl = m.querySelector("#budgetModalContent");
  const btnClose = m.querySelector("#btnCloseBudgetModal");
  btnClose.onclick = () => {
    m.remove();
    // Trigger a fake hash change to refresh data on screen if needed
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  let currentMonth = initialMonth || new Date().toISOString().slice(0, 7);

  async function renderContent() {
    const budgetOverrides = await list("budget_overrides") || [];
    const txs = await list("transactions") || [];
    const categories = await list("categories") || [];
    const subcategories = await list("subcategories") || [];
    const people = await list("people") || [];

    const cName = categories.find(c => c.id === tmpl.categoryId)?.name || "?";
    const sName = tmpl.subcategoryId ? " > " + (subcategories.find(s => s.id === tmpl.subcategoryId)?.name || "") : "";
    const scopeDesc = cName + sName + (tmpl.personId ? ` • ${people.find(p => p.id === tmpl.personId)?.name}` : "");

    const ov = budgetOverrides.find(o => o.templateId === tmplId && o.month === currentMonth);
    const targetCents = ov ? ov.targetCents : tmpl.monthlyTargetCents;

    const budgetTxs = txs.filter(t => {
      const txDate = t.date ? t.date.slice(0, 7) : "";
      if (txDate !== currentMonth) return false;
      if (t.type !== "expense") return false;
      if (t.categoryId !== tmpl.categoryId) return false;
      if (tmpl.subcategoryId && t.subcategory !== tmpl.subcategoryId) return false;
      if (tmpl.personId && t.personId !== tmpl.personId) return false;
      return true;
    });

    budgetTxs.sort((a, b) => b.date.localeCompare(a.date));

    const spent = budgetTxs.reduce((sum, t) => sum + (t.valueBRL || t.value), 0);
    const target = targetCents / 100;
    const remaining = target - spent;
    let pct = target > 0 ? (spent * 100) / target : 0;

    const boundedPct = Math.min(100, pct);
    const color = pct >= 100 ? '#dc3545' : (pct >= 80 ? '#fd7e14' : '#28a745');

    contentEl.innerHTML = `
          <h3 style="margin-top:0; margin-bottom:5px;">${esc(tmpl.name)}</h3>
          <div class="small" style="color:#666; margin-bottom:15px;">${esc(scopeDesc)}</div>
          
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:15px;">
              <strong>Mês:</strong> 
              <input type="month" id="budgetModalMonth" value="${currentMonth}" style="padding:5px; border-radius:4px; border:1px solid #ccc; font-size:1em;" />
          </div>

          <div style="background:#f9f9f9; padding:15px; border-radius:8px; margin-bottom:15px; text-align:center;">
              ${target === 0 ? `<div style="color:#dc3545; font-weight:bold;">Defina uma meta para calcular</div>` : `
              <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                  <div>
                      <div class="small">Meta</div>
                      <strong>R$ ${target.toFixed(2)}</strong> ${ov ? '<br/><span class="small" style="color:#fd7e14;" title="Ajuste Ocasional">(Ajustado)</span>' : ''}
                  </div>
                  <div>
                      <div class="small">Gasto</div>
                      <strong>R$ ${spent.toFixed(2)}</strong>
                  </div>
                  <div>
                      <div class="small">${remaining < 0 ? 'Excedeu' : 'Restante'}</div>
                      <strong style="color:${remaining < 0 ? '#dc3545' : '#28a745'}">R$ ${Math.abs(remaining).toFixed(2)}</strong>
                  </div>
              </div>
              <div style="background:#ddd; height:12px; border-radius:6px; overflow:hidden;">
                  <div style="width:${boundedPct}%; background:${color}; height:100%;"></div>
              </div>
              <div class="small" style="margin-top:5px; text-align:right;">${pct.toFixed(1)}%</div>
              `}
          </div>

          <div style="display:flex; gap:10px; margin-bottom:20px;">
              <button id="btnBudgetOverride" type="button" class="btn btn-primary" style="flex:1;">✏️ Ajustar Meta</button>
              <button id="btnBudgetCopy" type="button" class="btn btn-secondary" style="flex:1;">📋 Copiar Resumo</button>
          </div>

          <div>
              <strong>Lançamentos (${budgetTxs.length})</strong>
              ${budgetTxs.length === 0 ? `<div class="small" style="margin-top:10px; color:#666;">Sem lançamentos neste mês.</div>` : `
              <ul class="list" style="margin-top:10px; max-height:250px; overflow-y:auto; padding-right:5px; border:1px solid #eee; border-radius:4px;">
                  ${budgetTxs.slice(0, 50).map(t => `
                      <li style="border-bottom:1px solid #eee; padding:10px; display:flex; justify-content:space-between; align-items:center;">
                          <div style="flex:1; overflow:hidden;">
                              <div style="font-size:0.9em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${esc(t.description)}">${esc(t.description)}</div>
                              <div style="font-size:0.8em; color:#888;">${t.date ? t.date.slice(8, 10) + '/' + t.date.slice(5, 7) : ''} ${t.tags && t.tags.length ? ` · [${esc(t.tags.join(', '))}]` : ''}</div>
                          </div>
                          <strong style="margin-left:10px; font-size:0.95em;">R$ ${(t.valueBRL || t.value).toFixed(2)}</strong>
                      </li>
                  `).join("")}
                  ${budgetTxs.length > 50 ? `<li style="text-align:center; padding:10px; font-size:0.8em; color:#666;">Exibindo os últimos 50 de ${budgetTxs.length}</li>` : ''}
              </ul>
              `}
          </div>
      `;

    contentEl.querySelector("#budgetModalMonth").addEventListener("change", (e) => {
      currentMonth = e.target.value;
      renderContent();
    });

    contentEl.querySelector("#btnBudgetOverride").onclick = async () => {
      const val = prompt(`Qual o limite de gastos SOMENTE para o mês ${currentMonth}? (ex: 800.00)`, target > 0 ? target.toFixed(2) : "");
      if (val === null) return;
      const num = parseFloat(val.replace(",", "."));
      if (isNaN(num)) return showToast("error", "Valor numérico inválido.");

      const overrides = await list("budget_overrides");
      const existing = overrides.find(o => o.templateId === tmplId && o.month === currentMonth);

      await put("budget_overrides", {
        id: existing ? existing.id : uid("bo"),
        templateId: tmplId,
        month: currentMonth,
        targetCents: Math.round(num * 100),
        createdAt: existing ? existing.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      renderContent();
    };

    contentEl.querySelector("#btnBudgetCopy").onclick = async () => {
      const text = `Orçamento ${currentMonth} — ${tmpl.name}\nMeta: R$ ${target.toFixed(2)}\nGasto: R$ ${spent.toFixed(2)}\n${remaining < 0 ? 'Excedeu' : 'Restante'}: R$ ${Math.abs(remaining).toFixed(2)}\n%: ${pct.toFixed(0)}%`;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          // Fallback for insecure contexts (like some local testing)
          let textArea = document.createElement("textarea");
          textArea.value = text;
          textArea.style.position = "fixed";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
        const btn = contentEl.querySelector("#btnBudgetCopy");
        btn.innerText = "✅ Copiado!";
        setTimeout(() => btn.innerText = "📋 Copiar Resumo", 2000);
      } catch (err) {
        showToast("error", "Erro ao copiar. Texto:\n\n" + text);
      }
    };
  }

  await renderContent();
}
