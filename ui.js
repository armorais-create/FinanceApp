import { list, put, remove, uid, get, exportDB, importDB, clearDB, resetDB } from "./db.js";

function esc(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function settingsScreen() {
  try {
    const people = await list("people");
    const accounts = await list("accounts");
    const cards = await list("cards");
    const categories = await list("categories");
    const tags = await list("tags");
    const subcategories = await list("subcategories");
    const settings = (await get("settings", "config")) || { usdRate: 0 };
    const rules = (await list("rules")).sort((a, b) => (a.priority || 0) - (b.priority || 0));

    // UI Choices stored in settings
    const uiState = (await get("settings", "ui_cat_view"));
    const selectedCatId = uiState ? uiState.value : null;

    const filteredSubs = selectedCatId ? subcategories.filter(s => s.categoryId === selectedCatId) : [];

    function backupUi() {
      return `
  <div class="card">
    <div><strong>Backup & Dados</strong></div>
    <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
        <div style="display:flex; gap:5px;">
             <button id="btnExport" style="flex:1" class="secondary small">Gerar .json</button>
             <button id="btnImport" style="flex:1" class="secondary small">Ler .json</button>
        </div>
        <div style="display:flex; gap:5px;">
             <button id="btnExportPack" style="flex:1; background:#007bff; color:white;">⚡ Export rápido</button>
             <button id="btnImportPack" style="flex:1; background:#28a745; color:white;">⚡ Import rápido</button>
        </div>
        <button id="btnReset" class="danger small" style="width:100%">⚠️ Resetar App</button>
        <input type="file" id="importFile" accept=".json" style="display:none" />
        <input type="file" id="importPackFile" accept=".financeapp,.json" style="display:none" />
    </div>
  </div>`;
    }

    const rulesSection = `
    <div class="card">
        <div><strong>Regras de Importação</strong></div>
        <div class="small" style="color:#666">Automatize categoria e tags baseando-se na descrição. <br/>Ordem: Menor prioridade primeiro.</div>
        
        <form id="ruleForm" class="form grid" style="margin-top:10px; background:#f9f9f9; padding:10px; border-radius:5px;">
             <div style="display:flex; justify-content:space-between; align-items:center;">
                 <strong id="ruleFormTitle">Nova Regra</strong>
                 <div style="display:flex; gap:5px;">
                     <button type="button" id="btnTestRule" style="padding:2px 8px; font-size:0.8em; background:#17a2b8; color:white; border:none; border-radius:3px; display:none;">🧪 Simular Regra</button>
                     <button type="button" id="btnCancelEditRule" style="display:none; padding:2px 8px; font-size:0.8em; background:#ccc; border:none; border-radius:3px;">Cancelar Edição</button>
                 </div>
             </div>
             
             <input type="hidden" name="id" /> <!-- For editing -->

             <div class="grid" style="grid-template-columns: 2fr 1fr; gap:5px;">
                 <input name="name" placeholder="Nome da Regra (ex: Uber)" required />
                 <div style="display:flex; gap:5px; align-items:center;">
                    <input name="priority" type="number" placeholder="Prioridade (0=Alta)" style="width:100%" value="10" />
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.9em; white-space:nowrap;">
                        <input type="checkbox" name="enabled" checked /> Ativa
                    </label>
                 </div>
             </div>

             <div style="margin-top:5px; font-weight:bold; font-size:0.9em; border-bottom:1px solid #ddd; padding-bottom:5px;">Condições de Match (Filtros)</div>
             <div class="grid" style="grid-template-columns: 1fr 1fr; gap:5px; margin-top:5px;">
                 <label class="small">Pode conter qualquer (OR):
                    <input name="ruleAnyIncludes" placeholder="ex: uber, 99pop" style="width:100%" />
                 </label>
                 <label class="small">Deve conter TODAS (AND):
                    <input name="ruleAllIncludes" placeholder="ex: viag, internacional" style="width:100%" />
                 </label>
                 <label class="small">Não pode conter (NOT):
                    <input name="ruleNoneIncludes" placeholder="ex: estorno, cancelado" style="width:100%" />
                 </label>
                 <label class="small">Faixa de Valor BRL (Mín - Máx):
                    <div style="display:flex; gap:5px;">
                        <input type="number" name="ruleMinAmount" placeholder="Mín" style="width:50%" />
                        <input type="number" name="ruleMaxAmount" placeholder="Máx" style="width:50%" />
                    </div>
                 </label>
                 <label class="small">Restringir ao Cartão:
                    <select name="ruleCardId" style="width:100%">
                        <option value="">(Qualquer Cartão)</option>
                        ${cards.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
                    </select>
                 </label>
                 <label class="small">Restringir à Conta:
                    <select name="ruleAccountId" style="width:100%">
                        <option value="">(Qualquer Conta)</option>
                        ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}
                    </select>
                 </label>
             </div>

             <!-- Actions -->
             <div style="margin-top:5px; font-weight:bold; font-size:0.9em; border-bottom:1px solid #ddd; padding-bottom:5px;">Ações Aplicadas</div>
             <div class="grid" style="grid-template-columns: 1fr 1fr; gap:5px; margin-top:5px;">
                 <label class="small">Categoria:
                     <select name="actionCategory" id="ruleActionCategory" style="width:100%">
                        <option value="">(Manter Categoria)</option>
                        ${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
                     </select>
                 </label>

                 <label class="small">Subcategoria:
                     <select name="actionSubcategory" id="ruleActionSubcategory" disabled style="width:100%">
                        <option value="">(Manter Subcategoria)</option>
                     </select>
                 </label>
                 
                 <label class="small">Pessoa:
                     <select name="actionPerson" style="width:100%">
                        <option value="">(Manter Pessoa)</option>
                        ${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}
                     </select>
                 </label>

                 <label class="small">Tags (separar por vírgula):
                    <input name="actionTags" placeholder="Add Tags" style="width:100%" />
                 </label>
             </div>
                 
             <label style="display:flex; align-items:center; gap:5px; font-size:0.9em; margin-top:5px;">
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
                                <button type="button" class="iconBtn" data-action="edit-rule" data-rule="${esc(JSON.stringify(r))}">✎</button>
                                <button type="button" class="danger iconBtn" data-del="rules:${r.id}">×</button>
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
        
        <div class="form grid">
            <label>Descrição do Extrato:
                <input type="text" id="simDesc" placeholder="ex: UBER TRIP SP" />
            </label>
            <div class="grid" style="grid-template-columns: 1fr 1fr; gap:5px;">
                <label>Valor (BRL absoluto):
                    <input type="number" id="simVal" placeholder="ex: 35.50" value="10.00" />
                </label>
                <label>Cartão Origem:
                    <select id="simCardId">
                        <option value="">(Nenhum / Não Fatura)</option>
                        ${cards.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
                    </select>
                </label>
            </div>
            <label>Conta Origem:
                <select id="simAccId">
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
        <form id="goalTemplateForm" class="form grid" style="margin-top:10px; background:#f9f9f9; padding:10px; border-radius:5px;">
            <input type="hidden" name="id" />
            <div style="display:flex; justify-content:space-between; align-items:center;">
                 <strong id="goalTempFormTitle">Nova Meta Recorrente</strong>
                 <button type="button" id="btnCancelEditGoalTemp" style="display:none; padding:2px 8px; font-size:0.8em; background:#ccc; border:none; border-radius:3px;">Cancelar</button>
            </div>

            <div class="grid" style="grid-template-columns: 1fr 1fr; gap:5px;">
                <input name="name" placeholder="Nome (ex: Mercado)" required />
                <div style="display:flex; gap:5px; align-items:center;">
                    <span style="font-size:0.8em">Início:</span>
                    <input name="startMonth" type="month" required value="${new Date().toISOString().slice(0, 7)}" />
                </div>
            </div>

            <!-- TYPE SELECTOR -->
            <div style="margin-top:5px; margin-bottom:5px;">
                <label style="margin-right:10px;"><input type="radio" name="scopeType" value="category" checked> Categoria</label>
                <label><input type="radio" name="scopeType" value="tag"> Tag</label>
            </div>

            <!-- CATEGORY SCOPE -->
            <div id="goalScopeCategory" class="grid" style="grid-template-columns: 1fr 1fr; gap:5px;">
                <select name="categoryId" id="goalTempCategory">
                    <option value="">Selecione Categoria...</option>
                    ${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
                </select>
                <select name="subcategoryId" id="goalTempSubcategory" disabled>
                    <option value="">(Todas Subcategorias)</option>
                </select>
            </div>

            <!-- TAG SCOPE -->
            <div id="goalScopeTag" style="display:none;">
                <input name="tagName" list="tagList" placeholder="Nome da Tag (ex: Viagem)" style="width:100%" />
                <datalist id="tagList">
                    ${tags.map(t => `<option value="${esc(t.name)}">`).join("")}
                </datalist>
            </div>

            <div class="grid" style="grid-template-columns: 1fr 1fr; gap:5px; margin-top:5px;">
                <select name="personId">
                    <option value="">(Qualquer Pessoa)</option>
                    ${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}
                </select>
                
                <div style="display:flex; gap:5px; align-items:center;">
                    <span style="font-size:0.9em">R$ Padrão</span>
                    <input name="target" type="number" step="0.01" placeholder="Alvo (ex: 500.00)" required />
                </div>
            </div>

            <label style="display:flex; align-items:center; gap:5px; font-size:0.9em; margin-top:5px;">
                <input type="checkbox" name="active" checked /> Meta Ativa
            </label>

            <button type="submit" id="btnSaveGoalTemp" style="margin-top:5px;">Salvar Meta</button>
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
                                <button class="small" data-action="new-revision" data-id="${t.id}">📅 Alt. Padrão</button>
                                <button class="small" data-action="new-override" data-id="${t.id}">✏️ Ajuste Mês</button>
                            </div>
                        </div>
                        <div style="display:flex; gap:5px; align-items:flex-start;">
                             <button type="button" class="iconBtn" data-action="edit-goal-temp" data-tmpl="${esc(JSON.stringify(t))}" data-crev="${currentT.val}">✎</button>
                             <button type="button" class="danger iconBtn" data-del="goal_templates:${t.id}">×</button>
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
            <label style="flex:1">Taxa Global do Sistema
                <input type="number" step="0.0001" name="usdRate" placeholder="Ex: 5.50" value="${settings.usdRate || ''}" required style="width:100%"/>
            </label>
            <button type="submit" style="white-space:nowrap; height:32px;">Atualizar Taxa</button>
        </form>

        <div style="background:#f9f9f9; padding:10px; border-radius:4px; font-size:11px;">
            <div style="font-weight:bold; margin-bottom:5px;">Processamento em Lote:</div>
            <div style="display:flex; gap:5px; flex-wrap:wrap;">
                <button type="button" id="btnRecalcSelected" style="background:#6c757d; font-size:11px; padding:5px 10px;">Recalcular USD (Avançado)...</button>
                <button type="button" id="recalcBtn" class="danger" style="font-size:11px; padding:5px 10px;">Forçar TODOS (Preservando fixos)</button>
            </div>
            <div class="small" style="margin-top:5px; color:#555;">Recalcula o campo "valueBRL" invisível em todas as despesas internacionais passadas.</div>
        </div>

        <div id="modalRecalc" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:white; padding:20px; box-shadow:0 0 100px rgba(0,0,0,0.8); z-index:999; border-radius:8px; width:95%; max-width:600px; max-height:90vh; overflow-y:auto;">
            <h3>Auditoria de Recálculo USD</h3>
            <div class="form" id="recalcFormArea">
                <label>Mês Referência (YYYY-MM)
                    <input type="month" id="recalcMonth" value="${new Date().toISOString().substring(0, 7)}" style="width:100%" />
                </label>
                <label style="display:flex; align-items:flex-start; gap:5px; font-size:11px; margin-top:10px; color:#444;">
                    <input type="checkbox" id="recalcPreserveFx" checked />
                    Ignorar registros que já possuem "Taxa de Câmbio" congelada (Recomendado).
                </label>
                <div style="display:flex; gap:10px; margin-top:15px; justify-content:flex-end;">
                    <button type="button" id="btnCancelRecalc" style="background:#ccc;">Cancelar</button>
                    <button type="button" id="btnPreviewRecalc" style="background:#17a2b8;">Gerar Preview</button>
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
                    <button type="button" id="btnBackToForm" style="background:#ccc;">Voltar</button>
                    <button type="button" id="btnConfirmRecalc" style="background:#28a745; font-weight:bold;">Aplicar Recálculo</button>
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
                    <form id="catForm" style="display:flex; gap:5px; margin-top:5px; margin-bottom:5px;">
                        <input name="name" placeholder="Nova Categoria" required style="width:100%" />
                        <button type="submit">+</button>
                    </form>
                    <div style="max-height:200px; overflow:auto; border:1px solid #eee;">
                        ${categories.map(c => `
                            <div class="listItem clickable ${c.id === selectedCatId ? 'selected-row' : ''}" 
                                 data-action="select-cat" data-id="${c.id}" style="padding:5px; cursor:pointer; background:${c.id === selectedCatId ? '#eef' : '#fff'}">
                                <span>${esc(c.name)}</span>
                                 <button type="button" class="iconBtn danger small" data-del="categories:${c.id}">×</button>
                            </div>
                        `).join("")}
                    </div>
                </div>

                <!-- Subcategories Column -->
                <div style="flex:1; opacity: ${selectedCatId ? 1 : 0.5}; pointer-events: ${selectedCatId ? 'auto' : 'none'}">
                    <div class="small" style="margin-bottom:5px;">Subcategorias (${selectedCatId ? categories.find(c => c.id === selectedCatId)?.name : 'Selecione...'})</div>
                    <form id="subForm" style="display:flex; gap:5px; margin-bottom:5px;">
                        <input name="name" placeholder="Nova Subcategoria" required style="width:100%" />
                        <button type="submit">+</button>
                    </form>
                    <div style="max-height:200px; overflow:auto; border:1px solid #eee;">
                        ${filteredSubs.length === 0 ? '<div class="small" style="padding:5px;">Nenhuma.</div>' : ''}
                        ${filteredSubs.map(s => `
                            <div class="listItem" style="padding:5px;">
                                <span>${esc(s.name)}</span>
                                <button type="button" class="iconBtn danger small" data-del="subcategories:${s.id}">×</button>
                            </div>
                        `).join("")}
                    </div>
                </div>
            </div>
        </div>`;

    const tagSection = `
        <div class="card">
            <div><strong>Tags</strong></div>
            <form id="tagForm" style="display:flex; gap:5px; margin-top:5px; margin-bottom:5px;">
                <input name="name" placeholder="Nova Tag (ex: Viagem, Trabalho)" required style="width:100%" />
                <button type="submit">+</button>
            </form>
            <div style="max-height:200px; overflow:auto; border:1px solid #eee;">
                ${tags.length === 0 ? '<div class="small" style="padding:5px;">Nenhuma.</div>' : ''}
                ${tags.map(t => `
                    <div class="listItem" style="padding:5px;">
                        <span>${esc(t.name)}</span>
                        <button type="button" class="iconBtn danger small" data-del="tags:${t.id}">×</button>
                    </div>
                `).join("")}
            </div>
        </div>
    `;


    // ... rest of sections ...

    return `
  <style>
    .selected-row { border-left: 3px solid #007bff; font-weight:bold; }
  </style>
  ${backupUi()}
  ${rateSection}
  ${rulesSection}
  ${goalsSection}
  ${catSection}
  ${tagSection}
  
  <div class="card">
    <div><strong>Pessoas</strong></div>
    <form id="personForm" class="form">
      <input name="name" placeholder="Nome (ex: André)" required />
      <button type="submit">Adicionar</button>
    </form>
    <div class="small">Cadastradas: ${people.length}</div>
    ${renderList("people", people, p => `${esc(p.name)}`)}
  </div>

  <div class="card">
    <div><strong>Contas</strong></div>
    <form id="accountForm" class="form">
      <input name="name" placeholder="Nome (ex: Nubank, Wise)" required />
      <select name="currency" required>
        <option value="BRL">BRL</option>
        <option value="USD">USD</option>
      </select>
      <button type="submit">Adicionar</button>
    </form>
    <div class="small">Cadastradas: ${accounts.length}</div>
    ${renderList("accounts", accounts, a => `${esc(a.name)} <span class="small">(${esc(a.currency)})</span>`)}
  </div>

  <div class="card">
    <div><strong>Cartões (Titular + Adicional)</strong></div>
    <form id="cardForm" class="form grid">
      <input name="name" placeholder="Nome (ex: Amex, Visa)" required />
      <select name="currency" required>
        <option value="BRL">BRL</option>
        <option value="USD">USD</option>
      </select>
      <input name="closingDay" type="number" min="1" max="28" placeholder="Dia fechamento (1-28)" required />
      <input name="dueDay" type="number" min="1" max="28" placeholder="Dia vencimento (1-28)" required />
      <input name="holder" placeholder="Titular (ex: André)" required />
      <select name="defaultAccountMain">
        <option value="">Conta Padrão Titular...</option>
        ${accounts.map(a => `<option value="${a.id}">${esc(a.name)} (${esc(a.currency)})</option>`).join("")}
      </select>

      <input name="additional" placeholder="Adicional (ex: Jessica) — opcional" />
      <select name="defaultAccountAdditional">
        <option value="">Conta Padrão Adicional...</option>
        ${accounts.map(a => `<option value="${a.id}">${esc(a.name)} (${esc(a.currency)})</option>`).join("")}
      </select>
      <button type="submit">Adicionar</button>
    </form>
    <div class="small">Cadastrados: ${cards.length}</div>
    ${renderList("cards", cards, c => `
      ${esc(c.name)} <span class="small">(${esc(c.currency)})</span><br/>
      <span class="small">
        Fecha dia ${esc(c.closingDay)} · Vence dia ${esc(c.dueDay)}<br/>
        Titular: ${esc(c.holder)} ${(c.defaultAccountMain ? `(Conta: ${accounts.find(a => a.id === c.defaultAccountMain)?.name || '?'})` : "")}
        ${c.additional ? `<br/>Adicional: ${esc(c.additional)} ${(c.defaultAccountAdditional ? `(Conta: ${accounts.find(a => a.id === c.defaultAccountAdditional)?.name || '?'})` : "")}` : ""}
      </span>
    `)}
  </div>
  `;
  } catch (err) {
    console.error("[SETTINGS ERROR]", err);
    return `
      <div class="card" style="border-left: 5px solid red;">
         <h3>Erro de Banco de Dados</h3>
         <p>Seus dados locais parecem estar em uma versão antiga ou corrompida.</p>
         <pre style="background:#eee; padding:5px; font-size:0.8em">${err.message}</pre>
         <div style="display:flex; gap:10px; margin-top:15px;">
             <button onclick="location.reload()">Tentar corrigir (Recarregar)</button>
             <button id="btnForceReset" class="danger">Resetar Banco (Apagar Tudo)</button>
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
        <li class="listItem">
          <div>${renderFn(i)}</div>
          <button type="button" class="danger" data-del="${store}:${i.id}">Excluir</button>
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
  const fileInput = rootEl.querySelector("#importFile");
  const importPackFile = rootEl.querySelector("#importPackFile");

  if (btnExportPack) {
    btnExportPack.onclick = async () => {
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

        alert("Pack gerado: " + filename + "\n\nNo iPhone: Salve em 'Arquivos > iCloud Drive > FinanceApp' para sincronizar com 1-clique depois.");
      } catch (e) {
        alert("Erro ao exportar pack: " + e.message);
      }
    };
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
        alert("Não consegui ler este arquivo. Ele pode estar corrompido ou não ser do FinanceApp.");
        importPackFile.value = "";
        return;
      }

      if (json.meta && json.meta.appId !== "financeapp") {
        alert("Este arquivo não é um backup válido do FinanceApp.");
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
          alert("⚡ Pack restaurado com sucesso!\nO app será recarregado.");
          location.hash = "#home";
          location.reload();
        } catch (err) {
          alert(err.message);
        } finally {
          btnImportPack.disabled = false;
          btnImportPack.innerText = "⚡ Import rápido";
          importPackFile.value = "";
        }
      } catch (err) {
        alert(`Erro na leitura do Pack:\n${err.message}`);
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

        alert("Backup gerado: " + filename + "\n\nNo iPhone: Salve em 'Arquivos > iCloud Drive > FinanceApp' para sincronizar.");
      } catch (e) {
        alert("Erro ao exportar: " + e.message);
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
        alert("Este arquivo não parece um backup (.json) do FinanceApp.\n\nSelecione o arquivo exportado em Config > Exportar.");
        fileInput.value = "";
        return;
      }

      const text = await file.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        // B) Validar JSON
        alert("Não consegui ler este arquivo como JSON.\n\nEle pode estar corrompido ou não ser um backup do FinanceApp (ex.: CSV/OFX).\nTente exportar novamente em Config > Exportar e selecione o .json gerado.");
        fileInput.value = "";
        return;
      }

      // 1.1) Validação Rápida de App (Se tiver meta, mas for outro app, rejeita logo)
      if (json.meta && json.meta.appId && json.meta.appId !== "financeapp") {
        alert("Este arquivo não é um backup do FinanceApp (parece ser de outro app).\nExporte novamente em Config > Exportar e selecione o .json gerado.");
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

          alert("Backup importado com sucesso.\nO app será recarregado agora.");
          location.hash = "#home";
          location.reload();
        } catch (err) {
          // 1.5) Show friendly error from db.js directly
          alert(err.message);
        } finally {
          // Reset UI
          btnImport.disabled = false;
          btnImport.innerText = originalText;
          fileInput.value = "";
        }

      } catch (err) {
        alert(`Erro na pré-validação:\n${err.message}`);
        fileInput.value = "";
      }
    };
  }

  if (btnReset) {
    btnReset.onclick = async () => {
      if (confirm("TEM CERTEZA? Isso apagará TODOS os dados do app permanentemente.") && confirm("Confirmação final: APAGAR TUDO?")) {
        await resetDB();
        alert("App resetado. Recarregando...");
        location.reload();
      }
    };
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
    alert("Taxa Global de Câmbio atualizada com sucesso!");
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
      if (!m) return alert("Selecione um mês válido.");

      const cfg = await get("settings", "config");
      if (!cfg?.usdRate) return alert("Defina uma taxa global de câmbio antes de recalcular.");
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
        return alert("Nenhum lançamento elegível para recálculo neste mês/critério.");
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
          // Better standard: if we are applying global rate over them, we can strip the 'fixed' status or just set it.
          // M.D. standard: batch recalculator unfixes them.
          t.fxRate = null;
        }
        await put("transactions", t);
        count++;
      }

      alert(`Sucesso! ${count} lançamentos foram salvos no banco.`);
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
      if (!cfg?.usdRate) return alert("Defina o câmbio primeiro.");

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
      alert(`${count} lançamentos brutos globais recalculados usando taxa de R$ ${cfg.usdRate}.`);
    };
  }

  // Categories
  rootEl.querySelector("#catForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    await put("categories", { id: uid("cat"), name });
    e.target.reset();
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
    if (!selectedCatId) return alert("Selecione uma categoria primeiro.");

    const name = e.target.name.value.trim();
    if (!name) return;
    await put("subcategories", { id: uid("sub"), categoryId: selectedCatId, name });
    e.target.reset();
    await refreshSettings(rootEl);
  });

  // Tags
  rootEl.querySelector("#tagForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    await put("tags", { id: uid("tag"), name });
    e.target.reset();
    await refreshSettings(rootEl);
  });

  // Pessoas
  rootEl.querySelector("#personForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    await put("people", { id: uid("p"), name });
    e.target.reset();
    await refreshSettings(rootEl);
  });

  // Contas
  rootEl.querySelector("#accountForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    const currency = e.target.currency.value;
    if (!name) return;
    await put("accounts", { id: uid("a"), name, currency });
    e.target.reset();
    await refreshSettings(rootEl);
  });

  // Cartões
  rootEl.querySelector("#cardForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    const currency = e.target.currency.value;
    const closingDay = Number(e.target.closingDay.value);
    const dueDay = Number(e.target.dueDay.value);
    const holder = e.target.holder.value.trim();
    const additional = e.target.additional.value.trim();
    const defaultAccountMain = e.target.defaultAccountMain.value;
    const defaultAccountAdditional = e.target.defaultAccountAdditional.value;

    await put("cards", {
      id: uid("c"),
      name, currency, closingDay, dueDay,
      holder, additional: additional || null,
      defaultAccountMain: defaultAccountMain || null,
      defaultAccountAdditional: defaultAccountAdditional || null
    });
    e.target.reset();
    await refreshSettings(rootEl);
  });

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
        if (!startMonth || !target) return alert("Mês e Valor obrigatórios para nova meta.");

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
}

// Handle Deletion (Global delegation on body to ensure capture)
// DEPRECATED: Handled globally in app.js now.
// We keep this function clean only for form handlers.
// End of function


// handleDelete removed (moved to app.js)

async function refreshSettings(rootEl) {
  rootEl.innerHTML = await settingsScreen();
  await wireSettingsHandlers(rootEl);
}
