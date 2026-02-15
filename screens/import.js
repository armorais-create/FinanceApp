import { list, put, uid } from "../db.js";
import { setInvoiceState } from "./invoice.js";
import { importer } from "../utils/importer.js";
import { applyRulesToMany } from "../rules_engine.js";

function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* =========================================
   STATE MANAGEMENT
   ========================================= */

const state = {
    step: 1,
    file: null,
    importSessionId: null,

    // Data (Rows)
    // Each row: { id, date, description, value, category, subcategory, cardType, payer, selected, warnings[], ... }
    rows: [],

    // Destination choices
    dest: {
        cardId: "",
        invoiceMonth: new Date().toISOString().slice(0, 7), // YYYY-MM
        cardHolder: "main" // Titular or Additional
    },

    // Cache for dropdowns
    cache: {
        categories: [],
        subcategories: [], // Flattened or map? We'll load all.
        cards: [],
        people: [],
        tags: []
    }
};

/* =========================================
   MAIN EXPORT
   ========================================= */

export async function importScreen() {
    return `
    <div class="card">
        <div><strong>Import Wizard v2</strong></div>
        <div id="importWizard" style="margin-top:15px; min-height:300px;">
            <div class="small">Carregando...</div>
        </div>
    </div>
    `;
}

export async function wireImportHandlers(rootEl) {
    const container = rootEl.querySelector("#importWizard");

    // Load dependencies once
    if (state.cache.categories.length === 0) {
        try {
            const [cats, subs, cards, people, tags] = await Promise.all([
                list("categories"),
                list("subcategories"),
                list("cards"),
                list("people"),
                list("tags")
            ]);
            state.cache.categories = cats;
            state.cache.subcategories = subs;
            state.cache.cards = cards;
            state.cache.people = people;
            state.cache.tags = tags;
        } catch (e) {
            console.error(e);
            container.innerHTML = `<div class="card error">Erro ao carregar dados: ${e.message}</div>`;
            return;
        }
    }

    // Reset state on entry if it's done or empty
    if (!state.file) {
        resetState();
    }

    renderDispatcher(container);
}

function resetState() {
    state.step = 1;
    state.file = null;
    state.rows = [];
    state.importSessionId = uid("imp");
    // Keep dest and cache
}

/* =========================================
   RENDER DISPATCHER
   ========================================= */

function renderDispatcher(container) {
    container.innerHTML = "";

    try {
        switch (state.step) {
            case 1: renderStep1(container); break;
            case 2: renderStep2(container); break;
            case 3: renderStepBatchReview(container); break; // NEW
            case 4: renderStepDestination(container); break; // Was Step 3
            case 5: renderStepProcessing(container); break;  // Was Step 4
            default: container.innerHTML = "Passo desconhecido.";
        }
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="card error">Erro de renderização: ${e.message}</div>`;
    }
}

/* =========================================
   STEP 1: UPLOAD
   ========================================= */

function renderStep1(cnt) {
    cnt.innerHTML = `
        <h3>1. Selecionar Arquivo</h3>
        <p class="small">Suporta CSV, Excel (XLSX) e PDF (Extratos bancários).</p>
        
        <div class="form" style="margin-top:20px; border: 2px dashed #ccc; padding:20px; text-align:center;">
            <input type="file" id="fiUpload" accept=".csv,.xlsx,.xls,.pdf" style="display:none" />
            <button id="btnChoose" style="font-size:1.2em; padding:10px 20px;">📂 Escolher Arquivo</button>
            <div id="fileName" style="margin-top:10px; color:#666;"></div>
        </div>
        
        <div style="margin-top:20px; text-align:right">
             <button id="btnNext1" disabled>Carregar e Visualizar »</button>
        </div>
    `;

    const fi = cnt.querySelector("#fiUpload");
    const btnChoose = cnt.querySelector("#btnChoose");
    const lbl = cnt.querySelector("#fileName");
    const btnNext = cnt.querySelector("#btnNext1");

    btnChoose.onclick = () => fi.click();

    fi.onchange = (e) => {
        const f = e.target.files[0];
        if (f) {
            state.file = f;
            lbl.textContent = `Arquivo: ${f.name} (${(f.size / 1024).toFixed(1)} KB)`;
            btnNext.disabled = false;
        }
    };

    btnNext.onclick = async () => {
        btnNext.textContent = "Processando...";
        btnNext.disabled = true;

        console.log(`[IMPORT][CSV] File selected: ${state.file.name}, size: ${state.file.size}`);

        try {
            // Processing in next tick to allow UI to update
            setTimeout(async () => {
                try {
                    const result = await importer.parseFile(state.file);

                    console.log(`[IMPORT][CSV] Parsed rows length: ${result.rows.length}`);
                    if (result.rows.length === 0) {
                        throw new Error("Nenhum item encontrado. Verifique se o arquivo é válido.");
                    }

                    // Map to internal state rows
                    state.rows = result.rows.map(r => ({
                        id: r.id,
                        date: r.dateISO, // Map dateISO -> date
                        description: r.description,
                        value: r.amount, // Map amount -> value

                        categoryId: r.categoryId || "",
                        subcategoryId: r.subcategoryId || "",

                        cardType: r.cardUsageType || "fisico", // 'fisico' | 'virtual'
                        payerRole: r.payerRole || "main",      // 'main' | 'additional'

                        selected: r.selected !== false,
                        warnings: r.warnings || [],
                        raw: r.raw
                    }));

                    // --- APPLY RULES (Block 9B) ---
                    console.log(`[IMPORT] Applying rules...`);
                    const rules = await list("rules");

                    // We only apply rules to rows. applyRulesToMany returns { draftTx, appliedRuleIds }
                    // We need to map back to state.rows structure
                    const subcategories = await list("subcategories");

                    const ruleResults = applyRulesToMany(state.rows, rules, subcategories);

                    state.rows = ruleResults.map(res => {
                        const r = res.draftTx; // Modified draft
                        // Preserve original props not in draftTx if any? 
                        // applyRulesToDraft returns a copy of input. 
                        // But input was state.rows elem. So it should be fine.

                        // Add metadata for UI
                        r.appliedRules = res.appliedRuleIds;
                        return r;
                    });

                    console.log(`[IMPORT] Rules applied. Rows with rules: ${state.rows.filter(r => r.appliedRules?.length).length}`);
                    // ------------------------------

                    state.step = 2;
                    renderDispatcher(cnt);
                } catch (err) {
                    console.error("[IMPORT][CSV] Error:", err);
                    alert("Erro ao ler arquivo: " + err.message);
                    btnNext.textContent = "Carregar e Visualizar »";
                    btnNext.disabled = false;
                }
            }, 50);
        } catch (e) {
            alert("Erro inesperado: " + e.message);
            btnNext.textContent = "Carregar e Visualizar »";
            btnNext.disabled = false;
        }
    };
}

/* =========================================
   STEP 2: PREVIEW & EDIT (The Optimized Table)
   ========================================= */

function renderStep2(cnt) {
    // Helper to generate options
    const genOpts = (list, selectedId) => {
        return `<option value="">--</option>` +
            list.map(i => `<option value="${i.id}" ${i.id === selectedId ? "selected" : ""}>${esc(i.name)}</option>`).join("");
    };

    // Subcategories map for quick access (grouped by categoryId)
    const subsByCat = {};
    state.cache.categories.forEach(c => {
        subsByCat[c.id] = state.cache.subcategories.filter(s => s.categoryId === c.id);
    });

    const getSubOpts = (catId, selSubId) => {
        const subs = subsByCat[catId] || [];
        return `<option value="">--</option>` +
            subs.map(s => `<option value="${s.id}" ${s.id === selSubId ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    };

    cnt.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
             <h3>2. Pré-visualização (${state.rows.length} itens)</h3>
             <div class="small">
                <label><input type="checkbox" id="chkAll" checked> Selecionar Todos</label>
             </div>
        </div>

        <div id="tableContainer" style="max-height:500px; overflow:auto; border:1px solid #ddd; margin-top:10px; position:relative;">
             <table style="width:100%; border-collapse:collapse; font-size:12px; min-width:900px;">
                <thead style="position:sticky; top:0; background:#f5f5f5; z-index:10; box-shadow:0 1px 2px rgba(0,0,0,0.1);">
                    <tr>
                        <th width="30">#</th>
                        <th width="90">Data</th>
                        <th>Descrição</th>
                        <th width="80">Valor</th>
                        <th width="110">Categoria</th>
                        <th width="110">Subcat</th>
                        <th width="70">Parc.</th>
                        <th width="60">Atual</th>
                        <th width="80">Tipo</th>
                        <th width="90">Pagador</th>
                    </tr>
                </thead>
                <tbody id="tblBody">
                    <!-- Rows injected via Chunk Rendering -->
                </tbody>
             </table>
             <div id="loadingIndicator" style="text-align:center; padding:10px; display:none;">Carregando mais...</div>
        </div>

        <div style="margin-top:10px; display:flex; gap:10px; justify-content:flex-end;">
            <button class="backBtn" style="background:#888;">« Voltar</button>
            <button class="nextBtn">Próximo: Revisar em Lote »</button>
        </div>
    `;

    // --- HANDLERS ---

    cnt.querySelector(".backBtn").onclick = () => {
        if (confirm("Voltar descartará esta importação. Confirmar?")) {
            state.step = 1;
            renderDispatcher(cnt);
        }
    };

    cnt.querySelector(".nextBtn").onclick = () => {
        const hasSelected = state.rows.some(r => r.selected);
        if (!hasSelected) return alert("Selecione pelo menos um item para importar.");
        state.step = 3;
        renderDispatcher(cnt);
    };

    cnt.querySelector("#chkAll").onchange = (e) => {
        const checked = e.target.checked;
        state.rows.forEach(r => r.selected = checked);
        cnt.querySelectorAll(".rowCheckbox").forEach(cb => cb.checked = checked);
    };

    // --- CHUNK RENDER LOGIC ---
    const tbody = cnt.querySelector("#tblBody");
    const CHUNK_SIZE = 50;
    let renderedCount = 0;
    let isRendering = false;

    function renderChunk() {
        if (isRendering) return;
        isRendering = true;

        const fragment = document.createDocumentFragment();
        const limit = Math.min(renderedCount + CHUNK_SIZE, state.rows.length);

        for (let i = renderedCount; i < limit; i++) {
            const r = state.rows[i];
            const tr = document.createElement("tr");
            tr.className = r.warnings.length ? "warning-row" : "";
            if (r.warnings.length) tr.title = r.warnings.join("\n");

            // Auto-classification indicator
            const isAuto = r.appliedRules && r.appliedRules.length > 0;
            const autoBadge = isAuto ? `<span title="Classificado automaticamente por regra" style="color:blue; font-weight:bold; font-size:10px;">★ Auto</span>` : "";

            const catOptions = genOpts(state.cache.categories, r.categoryId);
            const subOptions = getSubOpts(r.categoryId, r.subcategoryId);

            tr.innerHTML = `
                <td style="text-align:center;">
                    <input type="checkbox" class="rowCheckbox" data-idx="${i}" ${r.selected ? "checked" : ""}>
                </td>
                <td><input type="date" class="rowDate smallInput" data-idx="${i}" value="${r.date || ''}" style="width:100%"></td>
                <td>
                    <input type="text" class="rowDesc smallInput" data-idx="${i}" value="${esc(r.description)}" style="width:100%">
                    ${autoBadge}
                </td>
                <td><input type="number" step="0.01" class="rowVal smallInput" data-idx="${i}" value="${r.value}" style="width:100%"></td>
                
                <td>
                    <select class="rowCat smallInput" data-idx="${i}" style="width:100%">
                        ${catOptions}
                    </select>
                </td>
                <td>
                    <select class="rowSub smallInput" data-idx="${i}" style="width:100%">
                        ${subOptions}
                    </select>
                </td>
                
                <td>
                    <input type="number" class="rowTotalInst smallInput" data-idx="${i}" value="${r.totalInstallments || 1}" min="1" max="99" style="width:100%">
                </td>
                <td>
                    <input type="number" class="rowCurrInst smallInput" data-idx="${i}" value="${r.currentInstallment || 1}" min="1" max="99" style="width:100%">
                </td>

                <td>
                    <select class="rowType smallInput" data-idx="${i}" style="width:100%">
                        <option value="fisico" ${r.cardType === 'fisico' ? 'selected' : ''}>Físico</option>
                        <option value="virtual" ${r.cardType === 'virtual' ? 'selected' : ''}>Virtual</option>
                    </select>
                </td>
                <td>
                    <select class="rowPay smallInput" data-idx="${i}" style="width:100%">
                        <option value="main" ${r.payerRole === 'main' ? 'selected' : ''}>Titular</option>
                        <option value="additional" ${r.payerRole === 'additional' ? 'selected' : ''}>Adicional</option>
                    </select>
                </td>
            `;
            fragment.appendChild(tr);
        }

        tbody.appendChild(fragment);
        renderedCount = limit;
        isRendering = false;

        if (renderedCount < state.rows.length) {
            if (renderedCount < 200) {
                setTimeout(renderChunk, 0);
            } else {
                cnt.querySelector("#loadingIndicator").style.display = "block";
            }
        } else {
            cnt.querySelector("#loadingIndicator").style.display = "none";
        }
    }

    const scroller = cnt.querySelector("#tableContainer");
    scroller.onscroll = () => {
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 200) {
            if (renderedCount < state.rows.length) renderChunk();
        }
    };

    // Event Delegation
    tbody.addEventListener("input", (e) => {
        const el = e.target;
        const idx = el.dataset.idx;
        if (!idx) return;
        const row = state.rows[idx];

        if (el.classList.contains("rowDesc")) row.description = el.value;
        if (el.classList.contains("rowVal")) row.value = parseFloat(el.value) || 0;
        if (el.classList.contains("rowDate")) row.date = el.value;
    });

    tbody.addEventListener("change", (e) => {
        const el = e.target;
        const idx = el.dataset.idx;
        if (!idx) return;
        const row = state.rows[idx];

        if (el.classList.contains("rowCheckbox")) row.selected = el.checked;

        if (el.classList.contains("rowCat")) {
            row.categoryId = el.value;
            row.subcategoryId = ""; // Reset sub
            // Dynamic Update of Subcategory Dropdown
            const subSel = el.closest("tr").querySelector(".rowSub");
            if (subSel) {
                subSel.innerHTML = getSubOpts(row.categoryId, "");
            }
        }

        if (el.classList.contains("rowSub")) row.subcategoryId = el.value;
        if (el.classList.contains("rowTotalInst")) row.totalInstallments = parseInt(el.value) || 1;
        if (el.classList.contains("rowCurrInst")) row.currentInstallment = parseInt(el.value) || 1;
        if (el.classList.contains("rowType")) row.cardType = el.value;
        if (el.classList.contains("rowPay")) row.payerRole = el.value;
    });

    // Styles
    const style = document.createElement("style");
    style.innerHTML = `
        .smallInput { border:1px solid #ccc; border-radius:3px; padding:2px; font-size:11px; }
        .warning-row { background-color: #fff8e1; }
        tbody tr:hover { background-color: #f0f8ff; }
    `;
    cnt.appendChild(style);

    setTimeout(renderChunk, 0);
}

/* =========================================
   STEP 3: BATCH REVIEW (NEW)
   ========================================= */

function renderStepBatchReview(cnt) {
    const selectedCount = state.rows.filter(r => r.selected).length;
    const totalCount = state.rows.length;

    // Helper options
    const catOpts = `<option value="">(Não Alterar)</option>` +
        state.cache.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");

    // Subcategories dependent on logic, will load dynamically or show all if cat not selected? 
    // Usually batch edit for subcat requires cat. We'll disable subcat until cat selected OR show all?
    // Let's show (Não Alterar) and if they pick a subcat, we imply the cat?
    // Simpler: Just allow selecting category first.

    const personOpts = `<option value="">(Não Alterar)</option>` +
        state.cache.people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");

    cnt.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3>3. Revisar / Edição em Lote</h3>
            <div class="small">
                Selecionados: <strong>${selectedCount}</strong> / ${totalCount}
            </div>
        </div>

        <div class="card" style="background:#f0fafe; border:1px solid #bee5eb; padding:15px; margin-top:10px;">
            <div style="font-weight:bold; margin-bottom:10px; color:#0c5460;">Aplicar alterações nos itens selecionados:</div>
            
            <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; gap:10px;">
                <label>Categoria
                    <select id="batchCat">${catOpts}</select>
                </label>
                <label>Subcategoria
                    <select id="batchSub" disabled><option value="">(Selecione Categoria)</option></select>
                </label>
                <label>Tags (Adicionar/Substituir)
                    <input id="batchTags" placeholder="Ex: Viagem, Trabalho" />
                </label>
            </div>
            
            <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; gap:10px; margin-top:10px;">
                <label>Pessoa
                    <select id="batchPerson">${personOpts}</select>
                </label>
                <label>Portador (Role)
                    <select id="batchRole">
                        <option value="">(Não Alterar)</option>
                        <option value="main">Titular</option>
                        <option value="additional">Adicional</option>
                    </select>
                </label>
                <label>Tipo Cartão
                    <select id="batchType">
                        <option value="">(Não Alterar)</option>
                        <option value="fisico">Físico</option>
                        <option value="virtual">Virtual</option>
                    </select>
                </label>
            </div>

            <div style="margin-top:10px; text-align:right;">
                <button id="btnBatchApply" style="background:#17a2b8; color:white;">Aplicar Alterações</button>
            </div>
        </div>

        <p class="small" style="margin-top:10px; color:#666;">
            Abaixo estão os itens que serão importados. Você pode voltar ao passo anterior para refinar a seleção individual.
        </p>

        <!-- Read-only List Preview (scrollable) -->
        <div style="max-height:300px; overflow:auto; border:1px solid #ddd; background:white;">
            <table style="width:100%; font-size:11px; border-collapse:collapse;">
                <thead style="position:sticky; top:0; background:#eee;">
                    <tr>
                        <th width="30"></th>
                        <th>Data</th>
                        <th>Descrição</th>
                        <th>Valor</th>
                        <th>Cat > Sub</th>
                        <th>Tags</th>
                    </tr>
                </thead>
                <tbody id="previewBody">
                    ${renderBatchPreviewRows()}
                </tbody>
            </table>
        </div>

        <div style="margin-top:20px; text-align:right; display:flex; gap:10px; justify-content:flex-end;">
            <button class="backBtn" style="background:#888;">« Voltar (Seleção)</button>
            <button class="nextBtn">Próximo: Destino »</button>
        </div>
    `;

    // --- HANDLERS ---

    // 1. Navigation
    cnt.querySelector(".backBtn").onclick = () => {
        state.step = 2;
        renderDispatcher(cnt);
    };

    cnt.querySelector(".nextBtn").onclick = () => {
        if (state.rows.filter(r => r.selected).length === 0) {
            return alert("Nenhum item selecionado para importação.");
        }
        state.step = 4;
        renderDispatcher(cnt);
    };

    // 2. Dynamic Subcategory
    const batchCat = cnt.querySelector("#batchCat");
    const batchSub = cnt.querySelector("#batchSub");

    batchCat.onchange = () => {
        const catId = batchCat.value;
        if (!catId) {
            batchSub.innerHTML = '<option value="">(Selecione Categoria)</option>';
            batchSub.disabled = true;
            return;
        }
        const subs = state.cache.subcategories.filter(s => s.categoryId === catId);
        batchSub.innerHTML = `<option value="">(Não Alterar)</option>` +
            subs.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
        batchSub.disabled = false;
    };

    // 3. Apply Batch
    cnt.querySelector("#btnBatchApply").onclick = () => {
        const catId = batchCat.value;
        const subId = batchSub.value;
        const tagsVal = cnt.querySelector("#batchTags").value.trim();
        const personId = cnt.querySelector("#batchPerson").value;
        const role = cnt.querySelector("#batchRole").value;
        const type = cnt.querySelector("#batchType").value;

        // Validation: if user selected sub but no cat, usually UI prevents, but logic check:
        // If cat is (Não Alterar) but sub is (Invalid).. sub is disabled so OK.

        let count = 0;
        state.rows.forEach(r => {
            if (!r.selected) return;

            if (catId) {
                r.categoryId = catId;
                // Only reset sub if logic dictates, but here we only apply sub if subId is set. 
                // BUT if I change category, I SHOULD reset subcategory if it doesn't match?
                // Yes, if I set category, old sub is invalid. 
                // So if catId is set, we overwrite cat. 
                // If subId is NOT set, we should probably clear sub IF it doesn't belong to new cat.
                // For simplicity: If catId changed, clear sub unless subId is also provided.
                if (!subId) r.subcategoryId = "";
            }
            if (subId) r.subcategoryId = subId; // If provided, set it.

            if (tagsVal) {
                // Feature: Replace or Append? User prompt implies "Add/Replace".
                // Let's strictly RESET tags to strings provided for batch consistency.
                // Or maybe append? "Adicionar/Substituir" is ambiguous.
                // Let's assume SET.
                r.tags = tagsVal;
            }

            if (personId) r.personId = personId; // We map this to...? Wait, step 4 uses Payer Holder.
            // Actually Step 4 doesn't show "Person" column logic, it shows "Holder".
            // But we have "payerRole" in Rows.
            // And we have "personId" in Transaction Schema.
            // Import Step 1 maps `payerRole`. 
            // `personId` is usually for the "Responsible" field in legacy/other views.
            // Let's support it if the rule engine or batch wants it.

            if (role) r.payerRole = role;
            if (type) r.cardType = type;

            count++;
        });

        alert(`Alterações aplicadas em ${count} itens.`);
        // Re-render list
        cnt.querySelector("#previewBody").innerHTML = renderBatchPreviewRows();
    };
}

function renderBatchPreviewRows() {
    // Show only selected? Or all? 
    // "Revisar Importação" usually implies checking what will be imported.
    // So filter by selected.
    return state.rows.filter(r => r.selected).slice(0, 100).map(r => {
        const catName = state.cache.categories.find(c => c.id === r.categoryId)?.name || "-";
        const subName = state.cache.subcategories.find(s => s.id === r.subcategoryId)?.name || "-";

        return `
            <tr style="border-bottom:1px solid #eee;">
                <td style="text-align:center; color:green;">✔</td>
                <td>${r.date}</td>
                <td>${esc(r.description)}</td>
                <td>${r.value.toFixed(2)}</td>
                <td>${esc(catName)} > ${esc(subName)}</td>
                <td>${esc(r.tags || "")}</td>
            </tr>
         `;
    }).join("") + (state.rows.filter(r => r.selected).length > 100 ? '<tr><td colspan="6" style="text-align:center; color:#999;">...e mais itens...</td></tr>' : '');
}

/* =========================================
   STEP 4: DESTINATION (Renamed from Step 3)
   ========================================= */

function renderStepDestination(cnt) {
    // Totals
    const selected = state.rows.filter(r => r.selected);
    const totalVal = selected.reduce((sum, r) => sum + r.value, 0);

    cnt.innerHTML = `
        <h3>4. Destino da Importação</h3>
        <p>Você selecionou <strong>${selected.length}</strong> transações.</p>
        <p>Valor Total: <strong style="${totalVal < 0 ? 'color:red' : 'color:green'}">R$ ${totalVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></p>

        <div class="card" style="background:#f9f9f9; padding:15px; border:1px solid #ddd;">
            <div class="form grid">
                <label>Cartão de Crédito (Obrigatório)
                    <select id="dstCard" required>
                        <option value="">-- Selecione --</option>
                        ${state.cache.cards.map(c => `<option value="${c.id}" ${state.dest.cardId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join("")}
                    </select>
                </label>
                
                <label>Mês da Fatura (Obrigatório)
                    <input type="month" id="dstMonth" value="${state.dest.invoiceMonth}" required>
                </label>

                <label>Portador Padrão (Se não definido na linha)
                     <select id="dstHolder">
                        <option value="main" ${state.dest.cardHolder === 'main' ? 'selected' : ''}>Titular</option>
                        <option value="additional" ${state.dest.cardHolder === 'additional' ? 'selected' : ''}>Adicional</option>
                     </select>
                </label>
            </div>
        </div>

        <div style="margin-top:20px; text-align:right; display:flex; gap:10px; justify-content:flex-end;">
            <button class="backBtn" style="background:#888;">« Voltar</button>
            <button class="nextBtn" style="background:#28a745; color:white; font-weight:bold;">CONFIRMAR E PROCESSAR »</button>
        </div>
    `;

    cnt.querySelector(".backBtn").onclick = () => {
        // Save state values before going back?
        state.dest.cardId = cnt.querySelector("#dstCard").value;
        state.dest.invoiceMonth = cnt.querySelector("#dstMonth").value;
        state.dest.cardHolder = cnt.querySelector("#dstHolder").value;
        state.step = 3; // Go back to Batch Review
        renderDispatcher(cnt);
    };

    cnt.querySelector(".nextBtn").onclick = () => {
        const cardId = cnt.querySelector("#dstCard").value;
        const mon = cnt.querySelector("#dstMonth").value;

        if (!cardId || !mon) return alert("Por favor, preencha Cartão e Mês da Fatura.");

        state.dest.cardId = cardId;
        state.dest.invoiceMonth = mon;
        state.dest.cardHolder = cnt.querySelector("#dstHolder").value;

        state.step = 5; // Go to Processing
        renderDispatcher(cnt);
    };
}

/* =========================================
   STEP 5: PROCESSING (Renamed from Step 4)
   ========================================= */

function renderStepProcessing(cnt) {
    cnt.innerHTML = `
        <h3>5. Processando...</h3>
        <p>Salvando transações no banco de dados.</p>
        <div style="width:100%; background:#eee; height:20px; border-radius:10px; overflow:hidden;">
            <div id="progBar" style="width:0%; background:#007bff; height:100%; transition:width 0.2s;"></div>
        </div>
        <div id="progText" style="text-align:center; margin-top:5px; font-size:0.8em;">0%</div>
        <div id="finalMsg" style="margin-top:20px; text-align:center; display:none;">
            <div style="font-size:1.2em; color:green; margin-bottom:10px;">✅ Sucesso!</div>
            <button id="btnFinish">Ver Faturas</button>
        </div>
    `;

    startImportProcess(cnt);
}

async function startImportProcess(cnt) {
    const progBar = cnt.querySelector("#progBar");
    const progText = cnt.querySelector("#progText");
    const finalMsg = cnt.querySelector("#finalMsg");
    const btnFinish = cnt.querySelector("#btnFinish");

    const selected = state.rows.filter(r => r.selected);
    const total = selected.length;
    let processed = 0;

    // Chunk processing
    const BATCH_SIZE = 50;

    // Save loop
    for (let i = 0; i < total; i += BATCH_SIZE) {
        const chunk = selected.slice(i, i + BATCH_SIZE);

        await Promise.all(chunk.map(async (row) => {
            const tx = {
                id: uid("tx"),
                created_at: new Date().toISOString(),
                date: row.date || new Date().toISOString().split("T")[0],
                purchaseDate: row.date,
                invoiceMonth: state.dest.invoiceMonth,
                billMonth: state.dest.invoiceMonth,

                description: row.description,
                value: Math.abs(row.value), // Store absolute
                type: row.value > 0 ? "card_payment" : "expense", // Postivie = Payment/Refund, Negative = Expense (standard statement)

                cardId: state.dest.cardId,
                personId: "", // Not using Person ID in this flow anymore, using Holder/Role

                categoryId: row.categoryId || "",
                subcategory: row.subcategoryId || "",
                tags: row.tags ? row.tags.split(",").map(t => t.trim()) : [],

                cardType: row.cardType || "fisico",
                // Valid cardHolder values: 'main' | 'additional'
                cardHolder: (row.payerRole === "main" || row.payerRole === "additional")
                    ? row.payerRole
                    : state.dest.cardHolder,

                import_session_id: state.importSessionId
            };

            // Correction: If user selected "virtual", usage is virtual. 
            // If they selected "additional", usage is physical usually, but role is additional.
            // The UI logic is split: Type (Physical/Virtual) vs Payer (Main/Additional).
            // Schema likely expects cardHolder to be 'main' or 'additional'.

            await put("transactions", tx);
        }));

        processed += chunk.length;
        const pct = Math.round((processed / total) * 100);
        progBar.style.width = pct + "%";
        progText.textContent = `${processed}/${total}`;

        // Yield to UI
        await new Promise(r => setTimeout(r, 10));
    }

    // Finish
    progBar.style.width = "100%";
    progText.textContent = "Concluído!";
    finalMsg.style.display = "block";

    // Update Invoice State (Circuit Breaker pattern - safe update)
    try {
        setInvoiceState(state.dest.cardId, state.dest.invoiceMonth);
    } catch (e) { console.warn("Invoice update warning", e); }

    btnFinish.onclick = () => {
        location.hash = "#invoices";
    };
}
