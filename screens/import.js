import { list, put, uid, get } from "../db.js?v=v2";
import { setInvoiceState } from "./invoice.js";
import { importer } from "../utils/importer.js?v=2.2";
import { applyRulesToMany } from "../rules_engine.js";
import { getBrandIcon } from "../utils/brand.js?v=2.1";

function esc(s) {
    return (s ?? "").toString()
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function normalizeStr(s) {
    return (s || "").toString()
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
        .replace(/\s+/g, " ") // collapse spaces
        .trim();
}

async function applyRulesToStateRows() {
    console.log(`[IMPORT] Applying rules...`);
    const rules = await list("rules");
    const subcategories = await list("subcategories");

    const ruleResults = applyRulesToMany(state.rows, rules, subcategories);

    state.rows = ruleResults.map(res => {
        const r = res.draftTx; // Modified draft
        r.appliedRules = res.appliedRuleIds;

        if (r.appliedRules && r.appliedRules.length > 0) {
            r.confidence = 'alta';
        } else {
            const norm = normalizeStr(r.description);
            const histMatch = state.cache.historyMap[norm];
            if (histMatch && histMatch.categoryId) {
                r.confidence = 'media';
                r.categoryId = histMatch.categoryId || r.categoryId;
                r.subcategoryId = histMatch.subcategoryId || r.subcategoryId;
                r.cardType = histMatch.cardType || r.cardType;
                r.payerRole = histMatch.payerRole || r.payerRole;
                r.personId = histMatch.personId || r.personId;
                r.tags = histMatch.tags || r.tags;
            } else {
                r.confidence = 'baixa';
            }
        }
        return r;
    });
    console.log(`[IMPORT] Rules applied. Rows with rules: ${state.rows.filter(r => r.appliedRules?.length).length}`);
}

/* =========================================
   STATE MANAGEMENT
   ========================================= */

const state = {
    step: 1,
    file: null,
    importSessionId: null,

    // Destination choices
    dest: {
        importType: "card", // "card" | "account"
        cardId: "",
        accountId: "",
        invoiceMonth: new Date().toISOString().slice(0, 7), // YYYY-MM
        cardHolderRole: "main",
        cardHolderPersonId: null,
        cardHolderName: null,
        descFallback: "memo", // "memo" | "name" | "both"
        relaxedDedup: false,
        fxRate: null,
        isUSD: false
    },

    // Cache for dropdowns
    cache: {
        accounts: [],
        categories: [],
        subcategories: [], // Flattened or map? We'll load all.
        cards: [],
        people: [],
        tags: [],
        transactions: [],
        historyMap: {}
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
            const [cats, subs, cards, people, tags, txs, accounts] = await Promise.all([
                list("categories"),
                list("subcategories"),
                list("cards"),
                list("people"),
                list("tags"),
                list("transactions"),
                list("accounts")
            ]);
            state.cache.categories = cats;
            state.cache.subcategories = subs;
            state.cache.cards = cards;
            state.cache.people = people;
            state.cache.tags = tags;
            state.cache.accounts = accounts;

            // Phase 16A-1: Generate ML Cache over recent 500 items
            const recentTxs = txs.sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 500);
            state.cache.transactions = recentTxs;

            const hMap = {};
            for (const t of recentTxs) {
                const norm = normalizeStr(t.description);
                if (norm && !hMap[norm]) { // first seen is newest
                    hMap[norm] = {
                        categoryId: t.categoryId,
                        subcategoryId: t.subcategoryId,
                        tags: t.tags || [],
                        cardType: t.cardType || "fisico",
                        payerRole: t.payerRole || "main",
                        personId: t.personId
                    };
                }
            }
            state.cache.historyMap = hMap;

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
    state.mappingInfo = null;
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
            case 1.5: renderStepMapping(container); break; // NEW: Column Mapping UI
            case 2: renderStep2(container); break;
            case 3: renderStepBatchReview(container); break; // NEW
            case 4: renderStepProcessing(container); break;  // Was Step 5
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
        <h3>1. Selecionar Arquivo e Destino</h3>
        
        <div class="form grid" style="margin-bottom: 20px;">
            <label>O que você vai importar?
                <select id="selImportType">
                    <option value="card" ${state.dest.importType === 'card' ? 'selected' : ''}>Cartão de Crédito (Fatura): CSV/XLSX/PDF/OFX</option>
                    <option value="account" ${state.dest.importType === 'account' ? 'selected' : ''}>Conta Bancária (Extrato): OFX/CSV/XLSX/PDF</option>
                </select>
            </label>
        </div>

        <div id="accountConfigArea" class="form grid" style="margin-bottom: 20px; display: none;">
             <label>Conta de Destino (Obrigatório)
                <select id="selDestAccount">
                    <option value="">-- Selecione uma conta --</option>
                    ${state.cache.accounts.map(a => `<option value="${a.id}" ${state.dest.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join("")}
                </select>
             </label>
        </div>

        <div id="cardConfigArea" class="form grid" style="margin-bottom: 20px; display: none;">
            <label>Cartão de Crédito (Obrigatório)
                <select id="selDestCard">
                    <option value="">-- Selecione um cartão --</option>
                    ${state.cache.cards.map(c => `<option value="${c.id}" ${state.dest.cardId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join("")}
                </select>
            </label>
            <label id="lblCardHolder" style="display:none;">Portador (no cartão)
                <select id="selDestHolder">
                </select>
            </label>
            <label>Mês da Fatura (Obrigatório)
                <input type="month" id="selDestMonth" value="${state.dest.invoiceMonth}" required>
            </label>
        </div>

        <p class="small" id="uploadTip">Selecione o destino acima para saber quais formatos são suportados.</p>
        
        <div class="form" style="border: 2px dashed #ccc; padding:20px; text-align:center;">
            <input type="file" id="fiUpload" accept=".csv,.xlsx,.xls,.pdf,.ofx,.qif" style="display:none" />
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
    const selImportType = cnt.querySelector("#selImportType");
    const selDestAccount = cnt.querySelector("#selDestAccount");
    const selDestCard = cnt.querySelector("#selDestCard");
    const selDestMonth = cnt.querySelector("#selDestMonth");
    const accountConfigArea = cnt.querySelector("#accountConfigArea");
    const cardConfigArea = cnt.querySelector("#cardConfigArea");
    const uploadTip = cnt.querySelector("#uploadTip");

    function updateUploadUI() {
        if (selImportType.value === "account") {
            accountConfigArea.style.display = "block";
            cardConfigArea.style.display = "none";
            uploadTip.textContent = "Extrato da Conta. Suporta: OFX, CSV, Excel (XLSX), PDF.";
            fi.accept = ".ofx,.qif,.csv,.xlsx,.xls,.pdf";
        } else {
            accountConfigArea.style.display = "none";
            cardConfigArea.style.display = "block";
            uploadTip.textContent = "Fatura do Cartão. Suporta: CSV, Excel (XLSX), PDF, OFX.";
            fi.accept = ".csv,.xlsx,.xls,.pdf,.ofx";
        }
    }

    selImportType.onchange = (e) => {
        state.dest.importType = e.target.value;
        updateUploadUI();
        // Clear file when type changes
        state.file = null;
        lbl.textContent = "";
        fi.value = "";
        btnNext.disabled = true;
    };

    const selDestHolder = cnt.querySelector("#selDestHolder");
    const lblCardHolder = cnt.querySelector("#lblCardHolder");

    function updateCardHolders() {
        if (!state.dest.cardId) {
            lblCardHolder.style.display = "none";
            return;
        }
        const card = state.cache.cards.find(c => c.id === state.dest.cardId);
        if (!card) return;

        let opts = `<option value="">(Não definido/Geral)</option>`;

        // Titular
        const main = state.cache.people.find(p => p.id === card.mainPersonId);
        if (main) {
            opts += `<option value="main|${main.id}|${esc(main.name)}">Titular: ${esc(main.name)}</option>`;
            if (!state.dest.cardHolderRole) {
                state.dest.cardHolderRole = "main";
                state.dest.cardHolderPersonId = main.id;
                state.dest.cardHolderName = main.name;
            }
        } else if (card.legacyHolderName) {
            opts += `<option value="main||${esc(card.legacyHolderName)}">Titular: ${esc(card.legacyHolderName)}</option>`;
        }

        // Adicionais
        const addIds = card.additionalPersonIds || [];
        addIds.forEach(id => {
            const p = state.cache.people.find(x => x.id === id);
            if (p) opts += `<option value="additional|${p.id}|${esc(p.name)}">Adic.: ${esc(p.name)}</option>`;
        });

        if (card.legacyAdditionalName) {
            opts += `<option value="additional||${esc(card.legacyAdditionalName)}">Adic.: ${esc(card.legacyAdditionalName)}</option>`;
        }

        selDestHolder.innerHTML = opts;

        if (state.dest.cardHolderRole) {
            const val = `${state.dest.cardHolderRole}|${state.dest.cardHolderPersonId || ''}|${state.dest.cardHolderName || ''}`;
            const searchOpt = Array.from(selDestHolder.options).find(o => o.value === val);
            if (searchOpt) {
                searchOpt.selected = true;
            } else if (selDestHolder.options.length > 0) {
                selDestHolder.selectedIndex = 0;
            }
        }

        lblCardHolder.style.display = "block";
        applyHolderSelection();
    }

    function applyHolderSelection() {
        const parts = selDestHolder.value.split('|');
        if (parts.length === 3) {
            state.dest.cardHolderRole = parts[0] || "main";
            state.dest.cardHolderPersonId = parts[1] || null;
            state.dest.cardHolderName = parts[2] || null;
        } else {
            state.dest.cardHolderRole = null;
            state.dest.cardHolderPersonId = null;
            state.dest.cardHolderName = null;
        }
    }

    if (selDestHolder) selDestHolder.onchange = applyHolderSelection;

    selDestAccount.onchange = (e) => state.dest.accountId = e.target.value;
    selDestCard.onchange = (e) => {
        state.dest.cardId = e.target.value;
        updateCardHolders();
    };
    selDestMonth.onchange = (e) => state.dest.invoiceMonth = e.target.value;

    updateUploadUI();
    if (state.dest.importType === "card") updateCardHolders();

    btnChoose.onclick = () => {
        if (state.dest.importType === "account" && !state.dest.accountId) {
            return alert("Por favor, selecione a Conta de Destino antes de anexar o arquivo.");
        }
        if (state.dest.importType === "card" && (!state.dest.cardId || !state.dest.invoiceMonth)) {
            return alert("Por favor, preencha o Cartão e Mês da Fatura antes de anexar o arquivo.");
        }
        fi.click();
    };

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
                let pwd = undefined;
                let retry = true;
                while (retry) {
                    try {
                        const result = await importer.parseFile(state.file, {
                            accountId: state.dest.importType === "account" ? state.dest.accountId : null,
                            password: pwd,
                            forceMapping: state._forceMapping,
                            pdfStrategy: state._pdfStrategy
                        });
                        state._forceMapping = false; // Reset it immediately
                        state._pdfStrategy = null; // Reset it immediately
                        retry = false;

                        console.log(`[IMPORT][CSV] Parsed rows length: ${result.length === undefined ? 'Obj' : result.rows.length}`);

                        // Handle Mapping Required
                        if (result.mappingRequired) {
                            state.mappingInfo = result;
                            state.step = 1.5;
                            renderDispatcher(cnt);
                            return;
                        }

                        if (result.rows.length === 0) {
                            throw new Error("Nenhum item encontrado. Verifique se o arquivo é válido.");
                        }

                        state.rows = result.rows.map(r => {
                            let desc = r.description;
                            if (state.dest.importType === "account" && r.rawMemo !== undefined) {
                                if (state.dest.descFallback === "name") desc = r.rawName || r.rawMemo || "Extrato OFX";
                                else if (state.dest.descFallback === "both") desc = [r.rawName, r.rawMemo].filter(Boolean).join(" - ") || "Extrato OFX";
                                else desc = r.rawMemo || r.rawName || "Extrato OFX";
                            }

                            let matchedPersonId = "";
                            if (state.dest.importType === "card" && r.cardName) {
                                const first = r.cardName.trim().split(" ")[0].toLowerCase();
                                const pm = state.cache.people.find(p => p.name.toLowerCase().startsWith(first));
                                if (pm) matchedPersonId = pm.id;
                            }

                            let forcedPersonId = "";
                            let forcedRole = "main";
                            if (state.dest.importType === "card") {
                                forcedPersonId = state.dest.cardHolderPersonId || "";
                                forcedRole = state.dest.cardHolderRole || "main";
                            }

                            return {
                                id: r.id,
                                date: r.dateISO,
                                description: desc,
                                rawName: r.rawName,
                                rawMemo: r.rawMemo,
                                value: r.amount,
                                currency: r.currency || "BRL",
                                fitid: r.fitid || "",
                                categoryId: r.categoryId || "",
                                subcategoryId: r.subcategoryId || "",
                                cardType: r.cardUsageType || "fisico",
                                payerRole: forcedRole,
                                personId: forcedPersonId || matchedPersonId || r.personId,
                                accountId: state.dest.importType === "account" ? state.dest.accountId : "",
                                last4: r.last4,
                                cardName: r.cardName,
                                selected: r.selected !== false,
                                warnings: r.warnings || [],
                                raw: r.raw
                            };
                        });

                        await applyRulesToStateRows();

                        state.step = 2;
                        renderDispatcher(cnt);
                    } catch (err) {
                        if (err.message === "PASSWORD_REQUIRED") {
                            const p = prompt("Este PDF é protegido por senha. Por favor, digite a senha (ela não será salva):");
                            if (p) {
                                pwd = p;
                                continue;
                            } else {
                                alert("A importação foi cancelada pois a senha não foi fornecida.");
                                retry = false;
                            }
                        } else {
                            console.error("[IMPORT][CSV] Error:", err);
                            alert("Erro ao ler arquivo: " + err.message);
                            retry = false;
                        }
                        btnNext.textContent = "Carregar e Visualizar »";
                        btnNext.disabled = false;
                    }
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
   STEP 1.5: MAPEAR COLUNAS (Manual)
   ========================================= */

function renderStepMapping(cnt) {
    const mi = state.mappingInfo;

    cnt.innerHTML = `
        <h3>⚠️ Identificação de Colunas Requerida</h3>
        <p>A extração automática identificou baixa confiança neste arquivo. Por favor, ajuste as regras abaixo para continuar.</p>
        <div id="mappingUiArea"></div>
    `;

    const area = cnt.querySelector("#mappingUiArea");

    if (mi.fileType === 'pdf') {
        if (mi.isImageOrEmpty) {
            area.innerHTML = `
                <div style="background:#f8d7da; color:#721c24; padding:15px; border-radius:4px; margin-bottom:15px; border:1px solid #f5c6cb;">
                    <h4 style="margin-top:0;">⚠️ PDF sem texto detectável</h4>
                    <p>Não consegui encontrar nenhuma transação neste arquivo. É provável que este PDF seja uma <b>imagem digitalizada</b> ou tenha um formato ilegível de texto.</p>
                    <p>Por favor, tente exportar o extrato bancário em formato <b>CSV</b> ou <b>OFX</b> e importe novamente.</p>
                </div>
                <div style="margin-top:20px; text-align:right">
                     <button class="secondary" id="btnCancelMap">Voltar / Cancelar</button>
                </div>
            `;
            cnt.querySelector("#btnCancelMap").onclick = () => {
                resetState();
                renderDispatcher(cnt);
            };
            return;
        }

        const validSamples = (mi.samples || []).filter(line => (line || "").trim() !== "");
        const headerSamples = (mi.headerSamples || []).filter(line => (line || "").trim() !== "");

        area.innerHTML = `
            <div style="background:#d4edda; padding:10px; border-radius:4px; margin-bottom:15px; font-size:12px; border:1px solid #c3e6cb;">
                <strong style="color:#155724;">✅ Exemplos de TRANSAÇÕES detectadas (para mapear):</strong><br/>
                <ul style="margin:5px 0 0 20px; color:#155724;">
                    ${validSamples.map(line => `<li><pre style="margin:0; font-family:monospace;">${esc(line)}</pre></li>`).join("")}
                </ul>
            </div>

            ${headerSamples.length > 0 ? `
            <details style="background:#e2e3e5; padding:10px; border-radius:4px; margin-bottom:15px; font-size:12px; border:1px solid #d6d8db; cursor:pointer;">
                <summary><strong>Ver linhas de Cabeçalho ignoradas (Debug)</strong></summary>
                <ul style="margin:10px 0 0 20px; color:#383d41;">
                    ${headerSamples.map(line => `<li><pre style="margin:0; font-family:monospace;">${esc(line)}</pre></li>`).join("")}
                </ul>
            </details>` : ''}
            
            <div class="form grid">
                <label>Estratégia para extrair DESCRIÇÃO
                    <select id="selPdfStrategy">
                        <option value="largest_letters">Maior bloco de texto e letras (Padrão/Heurística)</option>
                        <option value="after_compra">Texto após palavras como "Compra", "Pagamento"</option>
                        <option value="left_of_value">Texto associado antes do valor (Heurística Fallback)</option>
                    </select>
                </label>
            </div>
            
            <div style="margin-top:20px; text-align:right">
                 <button class="secondary" id="btnCancelMap">Cancelar Importação</button>
                 <button id="btnSaveMap" class="primary">Aplicar Estratégia »</button>
            </div>
        `;

        cnt.querySelector("#btnCancelMap").onclick = () => {
            resetState();
            renderDispatcher(cnt);
        };

        cnt.querySelector("#btnSaveMap").onclick = async () => {
            state._pdfStrategy = cnt.querySelector("#selPdfStrategy").value;
            state.step = 1;
            state.mappingInfo = null;
            renderDispatcher(cnt);
            setTimeout(() => {
                const btn = document.getElementById("btnNext1");
                if (btn) btn.click();
            }, 100);
        };

    } else {
        // TABULAR FORMAT (CSV / XLSX)
        const headers = mi.headers.map(h => String(h).trim());

        // Help generate selects
        const mkSelect = (id, label) => `
            <label>${label}
                <select id="${id}" style="width:100%">
                    <option value="-1">-- Selecione --</option>
                    ${headers.map((h, i) => `<option value="${i}">${esc(h) || `[Coluna ${i + 1}]`}</option>`).join("")}
                </select>
            </label>
        `;

        area.innerHTML = `
            <div style="background:#fff3cd; padding:10px; border-radius:4px; margin-bottom:15px; font-size:12px; border:1px solid #ffeeba;">
                <strong>Amostra dos Dados (Primeiras 3 linhas):</strong><br/>
                <table style="width:100%; border-collapse: collapse; margin-top:5px;">
                    <thead>
                        <tr style="background:#e9ecef;">
                            ${headers.map((h, i) => `<th style="border:1px solid #ccc; padding:4px;">${esc(h) || `Col ${i}`}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${mi.samples.map(row => `
                            <tr>
                                ${row.map(cell => `<td style="border:1px solid #ccc; padding:4px;">${esc(String(cell))}</td>`).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>

            <div class="form grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 15px;">
                ${mkSelect('mapDate', 'Coluna de Data <span style="color:red">*</span>')}
                ${mkSelect('mapDesc', 'Coluna de Descrição <span style="color:red">*</span>')}
                ${mkSelect('mapVal', 'Coluna de Valor (Geral)')}
            </div>
            
            <p style="margin-top:10px; font-size:12px; color:#666;">Se o extrato não possui coluna "Valor" e separa em "Débito" e "Crédito", não preencha a coluna Valor e use os campos abaixo:</p>
            
            <div class="form grid" style="grid-template-columns: 1fr 1fr; gap: 15px; background:#f9f9f9; padding:10px; border-radius:4px;">
                ${mkSelect('mapDebit', 'Coluna Débito/Saída (-) (Opcional)')}
                ${mkSelect('mapCredit', 'Coluna Crédito/Entrada (+) (Opcional)')}
            </div>

            <div class="form grid" style="grid-template-columns: 1fr 1fr; gap: 15px; margin-top:15px; background:#f9f9f9; padding:10px; border-radius:4px;">
                ${mkSelect('mapName', 'Coluna Nome/Titular (Opcional)')}
                ${mkSelect('mapLast4', 'Coluna Final do Cartão (Opcional)')}
            </div>

            <div style="margin-top:20px; text-align:right">
                 <button class="secondary" id="btnCancelMap\">Cancelar Importação</button>
                 <button id="btnSaveMap" class="primary">Aplicar e Continuar »</button>
            </div>
        `;

        cnt.querySelector("#btnCancelMap").onclick = () => {
            resetState();
            renderDispatcher(cnt);
        };

        cnt.querySelector("#btnSaveMap").onclick = async () => {
            const idxDate = parseInt(cnt.querySelector("#mapDate").value);
            const idxDesc = parseInt(cnt.querySelector("#mapDesc").value);
            const idxVal = parseInt(cnt.querySelector("#mapVal").value);
            const idxDebit = parseInt(cnt.querySelector("#mapDebit").value);
            const idxCredit = parseInt(cnt.querySelector("#mapCredit").value);
            const idxName = parseInt(cnt.querySelector("#mapName").value);
            const idxLast4 = parseInt(cnt.querySelector("#mapLast4").value);

            if (idxDate === -1 || idxDesc === -1) {
                return alert("Data e Descrição são obrigatórios.");
            }
            if (idxVal === -1 && idxDebit === -1 && idxCredit === -1) {
                return alert("Você precisa mapear a coluna Valor, OU pelo menos uma das colunas (Débito/Crédito).");
            }

            const mapConf = { idxDate, idxDesc, idxVal, idxDebit, idxCredit, idxName, idxLast4 };

            try {
                // Save mapping for next time
                const key = `import_mapping_${state.dest.importType}_${mi.hash}`;
                await put("settings", { id: key, value: mapConf });
                console.log("Saved mapping to settings:", key);
            } catch (e) { console.warn("Could not save mapping", e); }

            // Resume Import Flow
            state.step = 1;
            state.mappingInfo = null;
            renderDispatcher(cnt);

            // Wait for DOM
            setTimeout(() => {
                cnt.querySelector("#btnNext1").click(); // Auto proceed
            }, 100);
        };
    }
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
                <button id="btnForceMapping" style="margin-right: 15px; font-size: 11px; padding: 2px 6px; background: #fff3cd; color: #856404; border: 1px solid #ffeeba; border-radius: 3px; cursor: pointer;">✏️ Corrigir Colunas / Mapear Manualmente</button>
                <span id="invalidValuesCount" style="color:red; font-weight:bold; margin-right:15px; display:none;"></span>
                <label><input type="checkbox" id="chkAll" checked> Selecionar Todos</label>
             </div>
        </div>
        
        ${state.dest.importType === 'account' ? `
        <div class="form grid" style="background:#f9f9f9; border:1px solid #ddd; padding:10px; margin-top:10px; border-radius:4px;">
            <label style="font-weight:bold; font-size: 13px;">Descrição Padrão:
                <select id="selDescFallback" style="padding: 4px; border: 1px solid #ccc; width: auto;">
                    <option value="memo" ${state.dest.descFallback === 'memo' ? 'selected' : ''}>MEMO (Padrão)</option>
                    <option value="name" ${state.dest.descFallback === 'name' ? 'selected' : ''}>NAME</option>
                    <option value="both" ${state.dest.descFallback === 'both' ? 'selected' : ''}>Combinar (NAME - MEMO)</option>
                </select>
            </label>
            <label style="font-weight:normal; font-size: 13px; color:#555; display:flex; align-items:center; gap:5px;">
                <input type="checkbox" id="chkRelaxedDedup" ${state.dest.relaxedDedup ? 'checked' : ''}>
                <span>Considerar deduplicação relaxada (Avisar/Ignorar duplicatas por <b>Data+Valor</b> ignorando diferenças na descrição)</span>
            </label>
        </div>` : ''}

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
                        ${state.dest.importType === 'card' ? `
                            <th width="80">Tipo</th>
                            <th width="110">Pagador</th>
                        ` : ''}
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

    // --- HELPER FUNCTION FOR MISSING VALUES COUNT ---
    function updateInvalidCount() {
        const cntMissing = state.rows.filter(r => r.value === null).length;
        const badge = cnt.querySelector("#invalidValuesCount");
        if (badge) {
            if (cntMissing > 0) {
                badge.innerText = `⚠️ ${cntMissing} linha(s) sem valor detectado!`;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    // --- HANDLERS ---

    const btnForce = cnt.querySelector("#btnForceMapping");
    if (btnForce) {
        if (!state.file.name.match(/\.(csv|xlsx|xls|pdf)$/i)) {
            btnForce.style.display = "none";
        } else {
            btnForce.onclick = () => {
                state._forceMapping = true;
                // Go back to step 1 and trigger load
                state.step = 1;
                renderDispatcher(cnt);
                setTimeout(() => {
                    const bNext = document.getElementById("btnNext1");
                    if (bNext) bNext.click();
                }, 100);
            };
        }
    }

    cnt.querySelector(".backBtn").onclick = () => {
        if (confirm("Voltar descartará esta importação. Confirmar?")) {
            state.step = 1;
            renderDispatcher(cnt);
        }
    };

    cnt.querySelector(".nextBtn").onclick = () => {
        const hasSelected = state.rows.some(r => r.selected);
        if (!hasSelected) return alert("Selecione pelo menos um item para importar.");

        const hasNulls = state.rows.some(r => r.selected && r.value === null);
        if (hasNulls && !confirm("Atenção: Existem itens selecionados SEM VALOR. Deseja ignorá-los e continuar (eles serão salvos com valor 0.00)?")) {
            return;
        }
        // Force nulls to 0 before saving if they decided to continue
        state.rows.forEach(r => { if (r.selected && r.value === null) r.value = 0; });

        // Check if there are USD transactions that require an FX rate
        let needsFx = false;
        if (state.dest.importType === "card") {
            const c = state.cache.cards.find(x => x.id === state.dest.cardId);
            if (c && c.currency === "USD") needsFx = true;
        } else {
            if (state.rows.some(r => r.selected && r.currency === "USD")) needsFx = true;
        }

        if (needsFx) {
            const fxStr = prompt("As transações envolvem Dólar (USD). Por favor, informe a cotação do dólar para conversão (ex: 5.50):", state.dest.fxRate || "");
            if (fxStr === null) return; // Cancelled
            const fx = parseFloat(fxStr);
            if (!isNaN(fx) && fx > 0) {
                state.dest.fxRate = fx;
                state.dest.isUSD = true;
            } else {
                alert("Taxa inválida. As transações podem não ser convertidas corretamente.");
            }
        }

        // Jump straight to Process (Step 4) since we removed Destination step
        state.step = 4;
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

            // Auto-classification indicator (Phase 16A-1 ML Trust / Heuristics)
            let autoBadge = "";
            let confidence = typeof r.confidence === 'number' ? r.confidence : 100; // default 100 for legacy plugins

            if (confidence >= 75) {
                autoBadge = `<span title="Confiança Alta (Heurística)" style="color:white; background:green; padding:1px 4px; border-radius:3px; font-weight:bold; font-size:9px; vertical-align:middle;">★ ALTA</span>`;
            } else if (confidence >= 40) {
                autoBadge = `<span title="Confiança Média (Sugerimos Revisar)" style="color:white; background:#ff9800; padding:1px 4px; border-radius:3px; font-weight:bold; font-size:9px; vertical-align:middle;">💡 MÉDIA</span>`;
                tr.style.backgroundColor = "#fffde7"; // light yellow
            } else {
                autoBadge = `<span title="Confiança Baixa (Detecção Heurística Falhou)" style="color:white; background:#f44336; padding:1px 4px; border-radius:3px; font-weight:bold; font-size:9px; vertical-align:middle;">⚠️ BAIXA</span>`;
                tr.style.backgroundColor = "#ffebee"; // highlight red
            }

            const catOptions = genOpts(state.cache.categories, r.categoryId);
            const subOptions = getSubOpts(r.categoryId, r.subcategoryId);

            tr.innerHTML = `
                <td style="text-align:center;">
                    <input type="checkbox" class="rowCheckbox" data-idx="${i}" ${r.selected ? "checked" : ""}>
                </td>
                <td><input type="date" class="rowDate smallInput" data-idx="${i}" value="${r.date || ''}" style="width:100%"></td>
                <td>
                    <input type="text" class="rowDesc smallInput" data-idx="${i}" value="${esc(r.description)}" style="width:100%">
                    <div style="margin-top:2px;">
                        ${autoBadge} 
                        ${r.appliedRules && r.appliedRules.length ? `<span style="font-size:10px; color:#555;">(Regra aplicada)</span>` : ''}
                        ${state.dest.importType === 'card' && (r.cardName || r.last4) ? `<div style="font-size:10px; color:#666; margin-top:2px;">Cartão: ${r.last4 ? '****' + r.last4 : 'N/A'} • Nome: ${esc(r.cardName || 'N/D')}</div>` : ''}
                    </div>
                </td>
                <td><input type="number" step="0.01" class="rowVal smallInput ${r.value === null ? 'error-input' : ''}" data-idx="${i}" value="${r.value === null ? '' : r.value}" placeholder="0.00" style="width:100%; box-sizing:border-box;"></td>
                
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
                
                ${state.dest.importType === 'card' ? `
                    <td>
                        <select class="rowType smallInput" data-idx="${i}" style="width:100%">
                            <option value="fisico" ${r.cardType === 'fisico' ? 'selected' : ''}>Físico</option>
                            <option value="virtual" ${r.cardType === 'virtual' ? 'selected' : ''}>Virtual</option>
                        </select>
                    </td>
                    <td>
                        <select class="rowReqPerson smallInput" data-idx="${i}" style="width:100%">
                            <option value="">(Titular)</option>
                            ${state.cache.people.map(p => `<option value="${p.id}" ${r.personId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                        </select>
                    </td>
                ` : ''}
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
        if (el.classList.contains("rowVal")) {
            row.value = el.value === "" ? null : parseFloat(el.value);
            if (row.value === null || isNaN(row.value)) {
                row.value = null;
                el.classList.add("error-input");
            } else {
                el.classList.remove("error-input");
            }
            updateInvalidCount();
        }
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
        // Removed Parc
        // Removed Atual
        if (el.classList.contains("rowType")) row.cardType = el.value;
        if (el.classList.contains("rowReqPerson")) row.personId = el.value;
    });

    // Custom controls
    const selDescFallback = cnt.querySelector("#selDescFallback");
    if (selDescFallback) {
        selDescFallback.onchange = (e) => {
            state.dest.descFallback = e.target.value;
            cnt.querySelector("#loadingIndicator").style.display = "block";
            setTimeout(async () => {
                state.rows.forEach(r => {
                    if (r.rawMemo !== undefined) {
                        if (state.dest.descFallback === "name") r.description = r.rawName || r.rawMemo || "Extrato OFX";
                        else if (state.dest.descFallback === "both") r.description = [r.rawName, r.rawMemo].filter(Boolean).join(" - ") || "Extrato OFX";
                        else r.description = r.rawMemo || r.rawName || "Extrato OFX";
                    }
                });
                await applyRulesToStateRows();
                renderDispatcher(cnt);
            }, 50);
        };
    }

    const chkRelaxedDedup = cnt.querySelector("#chkRelaxedDedup");
    if (chkRelaxedDedup) {
        chkRelaxedDedup.onchange = (e) => {
            state.dest.relaxedDedup = e.target.checked;
        };
    }

    // Styles
    const style = document.createElement("style");
    style.innerHTML = `
        .smallInput { border:1px solid #ccc; border-radius:3px; padding:2px; font-size:11px; }
        .warning-row { background-color: #fff8e1; }
        .error-input { border: 2px solid red !important; outline: none; background: #ffe6e6; }
        tbody tr:hover { background-color: #f0f8ff; }
    `;
    cnt.appendChild(style);

    updateInvalidCount();
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
                ${state.dest.importType === 'card' ? `
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
                ` : '<div></div><div></div>'}
            </div>

            <div style="margin-top:10px; display:flex; gap:10px; justify-content:space-between;">
                <!-- Advanced Smart Actions -->
                 <div style="display:flex; gap:5px;">
                    <button id="btnConfirmSuggested" style="background:#28a745; color:white; font-size:11px; border:none; border-radius:3px; cursor:pointer;" title="Confirmar Sugestões de Alta Confiança">✓ Confirmar Alta Confiança</button>
                    <button id="btnSimilar" style="background:#6c757d; color:white; font-size:11px; border:none; border-radius:3px; cursor:pointer;" title="Selecione 1 item para usar como modelo">🔁 Aplicar a Semelhantes</button>
                    <button id="btnSaveRule" style="background:#ffc107; color:black; font-size:11px; border:none; border-radius:3px; cursor:pointer;" title="Selecione 1 item para criar regra">⭐ Salvar como Regra</button>
                </div>
                
                <button id="btnBatchApply" style="background:#17a2b8; color:white; border:none; padding:5px 10px; border-radius:3px;">Aplicar Alterações (Seleção)</button>
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
            <button class="nextBtn" style="background:#28a745; color:white; font-weight:bold;">CONFIRMAR E PROCESSAR »</button>
        </div>

        <!-- NEW RULE MODAL (Phase 16A-1) -->
        <dialog id="dlgRule" style="padding:20px; border-radius:8px; border:1px solid #ccc; width:90%; max-width:400px;">
            <h3 style="margin-top:0;">🌟 Salvar como Regra Inteligente</h3>
            <div class="form grid">
                <label>Termo Principal (A descrição precisa conter):
                    <input type="text" id="dlgRuleMatch" required />
                </label>
                <label>Nome da Regra:
                    <input type="text" id="dlgRuleName" required />
                </label>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <label>Prioridade (0 é mais alta)
                        <input type="number" id="dlgRulePriority" value="10" />
                    </label>
                    <label>Sobrescrever dados?
                        <select id="dlgRuleOverwrite">
                            <option value="false">Não</option>
                            <option value="true">Sim</option>
                        </select>
                    </label>
                </div>
                <div style="margin-top:15px; display:flex; gap:10px; justify-content:flex-end;">
                    <button type="button" id="dlgRuleCancel" style="background:#dc3545; color:white;">Cancelar</button>
                    <button type="button" id="dlgRuleSave" style="background:#28a745; color:white;">💾 Salvar Regra</button>
                </div>
            </div>
        </dialog>
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

        let needsFx = false;
        if (state.dest.importType === "card") {
            const c = state.cache.cards.find(x => x.id === state.dest.cardId);
            if (c && c.currency === "USD") needsFx = true;
        } else {
            if (state.rows.some(r => r.selected && r.currency === "USD")) needsFx = true;
        }

        if (needsFx) {
            const fxStr = prompt("As transações envolvem Dólar (USD). Por favor, informe a cotação do dólar para conversão (ex: 5.50):", state.dest.fxRate || "");
            if (fxStr === null) return; // Cancelled
            const fx = parseFloat(fxStr);
            if (!isNaN(fx) && fx > 0) {
                state.dest.fxRate = fx;
                state.dest.isUSD = true;
            } else {
                alert("Taxa inválida. As transações não serão convertidas.");
                return;
            }
        }

        state.step = 4; // Step 4 is Processing
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

    // 3. Apply Batch (Selected)
    cnt.querySelector("#btnBatchApply").onclick = () => {
        const catId = batchCat.value;
        const subId = batchSub.value;
        const tagsVal = cnt.querySelector("#batchTags").value.trim();
        const personId = cnt.querySelector("#batchPerson").value;

        let role = null;
        let type = null;
        if (state.dest.importType === 'card') {
            role = cnt.querySelector("#batchRole").value;
            type = cnt.querySelector("#batchType").value;
        }

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

    // 4. Smart Actions
    const getSingleSelected = () => {
        const sel = state.rows.filter(r => r.selected);
        if (sel.length !== 1) {
            alert("Por favor, selecione EXATAMENTE 1 item para usar esta função.");
            return null;
        }
        return sel[0];
    };

    cnt.querySelector("#btnSimilar").onclick = () => {
        const ref = getSingleSelected();
        if (!ref) return;

        const refNorm = normalizeStr(ref.description);
        // Find matches (same desc, same sign/type usually?)
        // Let's match by normalized description only for simplicity, as requested.
        const matches = state.rows.filter(r => normalizeStr(r.description) === refNorm && r.id !== ref.id);

        if (matches.length === 0) {
            return alert("Nenhum outro item com descrição semelhante encontrado.");
        }

        if (!confirm(`Encontrados ${matches.length} itens com descrição similar a "${ref.description}".\n\nAplicar a classificação deste item (Categoria, Tags, Pessoa, etc) a todos eles?`)) {
            return;
        }

        // Apply
        let count = 0;
        matches.forEach(r => {
            r.categoryId = ref.categoryId;
            r.subcategoryId = ref.subcategoryId;
            r.tags = ref.tags;
            r.personId = ref.personId;
            r.payerRole = ref.payerRole;
            r.cardType = ref.cardType;
            // Also select them so user can see? Or just update?
            // Let's update data.
            count++;
        });

        alert(`Aplicado a ${count} itens.`);
        cnt.querySelector("#previewBody").innerHTML = renderBatchPreviewRows();
    };

    cnt.querySelector("#btnConfirmSuggested").onclick = () => {
        let count = 0;
        state.rows.forEach(r => {
            if (r.confidence === 'alta') {
                r.confidence = 'confirmed_alta'; // Mark as manually reviewed
                count++;
            }
        });
        alert(`Sugestões de Alta Confiança confirmadas e aplicadas ativamente em ${count} linhas.`);
        cnt.querySelector("#previewBody").innerHTML = renderBatchPreviewRows();
    };

    cnt.querySelector("#btnSaveRule").onclick = async () => {
        const ref = getSingleSelected();
        if (!ref) return;

        const dlg = cnt.querySelector("#dlgRule");
        const iMatch = cnt.querySelector("#dlgRuleMatch");
        const iName = cnt.querySelector("#dlgRuleName");

        iMatch.value = normalizeStr(ref.description);
        iName.value = ref.description.trim() + " (Auto)";

        dlg.showModal();

        cnt.querySelector("#dlgRuleCancel").onclick = () => dlg.close();
        cnt.querySelector("#dlgRuleSave").onclick = async () => {
            const ruleName = iName.value.trim();
            const matchTerm = iMatch.value.trim();
            if (!ruleName || !matchTerm) return alert("Preencha o Termo e o Nome.");

            const newRule = {
                id: uid("rule"),
                name: ruleName,
                priority: parseInt(cnt.querySelector("#dlgRulePriority").value) || 10,
                active: true,
                match: {
                    descriptionIncludes: matchTerm
                },
                actions: {
                    categoryId: ref.categoryId || "",
                    subcategoryId: ref.subcategoryId || "",
                    tags: ref.tags ? (Array.isArray(ref.tags) ? ref.tags : ref.tags.split(",").map(t => t.trim())) : [],
                    personId: ref.personId || ""
                },
                options: {
                    overwrite: cnt.querySelector("#dlgRuleOverwrite").value === "true"
                }
            };

            try {
                await put("rules", newRule);
                alert("Regra salva com sucesso! Os próximos imports já a utilizarão.");
                dlg.close();

                // Optional: Recalculate visually on the current preview?
                // Too complex for right now, the user usually just wants it saved for next time.
            } catch (e) {
                alert("Erro ao salvar regra: " + e.message);
            }
        };
    };
}

function renderBatchPreviewRows() {
    return state.rows.filter(r => r.selected).slice(0, 100).map(r => {
        const catName = state.cache.categories.find(c => c.id === r.categoryId)?.name || "-";
        const subName = state.cache.subcategories.find(s => s.id === r.subcategoryId)?.name || "-";

        let badgeTitle = "Revisão Padrão";
        let badgeIcon = '<span style="color:#ccc">○</span>';

        if (r.confidence === 'alta') {
            const ruleId = r.appliedRuleIds && r.appliedRuleIds.length > 0 ? r.appliedRuleIds[0] : null;
            const rName = ruleId ? state.cache.rules.find(rx => rx.id === ruleId)?.name : "(Regra Padrão)";
            badgeTitle = `Alta Confiança — Aplicou: ${rName}`;
            badgeIcon = `<span style="color:green; font-weight:bold" title="${esc(badgeTitle)}">★</span>`;
        } else if (r.confidence === 'media') {
            badgeTitle = "Sugestão baseada no Histórico Recente";
            badgeIcon = `<span style="color:#ff9800; font-weight:bold" title="${esc(badgeTitle)}">💡</span>`;
        } else if (r.confidence === 'confirmed_alta') {
            badgeTitle = "Confirmado Manualmente";
            badgeIcon = `<span style="color:blue; font-weight:bold" title="${esc(badgeTitle)}">✔</span>`;
        }

        return `
            <tr style="border-bottom:1px solid #eee;">
                <td style="text-align:center;">${badgeIcon}</td>
                <td>${r.date}</td>
                <td>${esc(r.description)}</td>
                <td>${r.value.toFixed(2)}</td>
                <td>${esc(catName)} > ${esc(subName)}</td>
                <td>${esc(Array.isArray(r.tags) ? r.tags.join(",") : (r.tags || ""))}</td>
            </tr>
         `;
    }).join("") + (state.rows.filter(r => r.selected).length > 100 ? '<tr><td colspan="6" style="text-align:center; color:#999;">...e mais itens...</td></tr>' : '');
}

/* =========================================
   STEP 4: PROCESSING (Renamed from Step 5)
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
    let ignoredCount = 0;

    // Deduplication Set for Accounts
    const importIdSet = new Set();
    const relaxedDedupSet = new Set();
    if (state.dest.importType === "account") {
        const existingTx = await list("transactions");
        existingTx.forEach(tx => {
            if (tx.accountId === state.dest.accountId) {
                if (tx.importId) {
                    importIdSet.add(tx.importId);
                }
                if (state.dest.relaxedDedup && tx.date && tx.value !== undefined) {
                    relaxedDedupSet.add(`${tx.date}|${tx.value}`);
                }
            }
        });
    }

    // Config needed for fallback fx rates
    let usdRateGlob = 5.0;
    if (state.dest.isUSD) {
        const cfg = await get("settings", "config");
        if (cfg && cfg.usdRate) usdRateGlob = parseFloat(cfg.usdRate);
    }

    // Chunk processing
    const BATCH_SIZE = 50;

    // Save loop
    for (let i = 0; i < total; i += BATCH_SIZE) {
        const chunk = selected.slice(i, i + BATCH_SIZE);

        await Promise.all(chunk.map(async (row) => {
            const isExpense = row.value < 0;
            const absoluteValue = Math.abs(row.value);

            const commonProps = {
                id: uid("tx"),
                created_at: new Date().toISOString(),
                date: row.date || new Date().toISOString().split("T")[0],
                description: row.description,
                value: absoluteValue,

                categoryId: row.categoryId || "",
                subcategory: row.subcategoryId || "",
                tags: row.tags ? (Array.isArray(row.tags) ? row.tags : row.tags.split(",").map(t => t.trim())) : [],

                personId: row.personId || "",

                import_session_id: state.importSessionId
            };

            // Handle USD logic
            if (row.currency === "USD") {
                const finalRate = state.dest.fxRate || usdRateGlob;
                commonProps.currency = "USD";
                commonProps.fxRate = finalRate;
                commonProps.valueBRL = absoluteValue * finalRate;
            } else {
                commonProps.currency = "BRL";
            }

            let finalTx;

            if (state.dest.importType === "card") {
                // Card Export Structure
                finalTx = {
                    ...commonProps,
                    type: isExpense ? "expense" : "card_payment",

                    purchaseDate: row.date,
                    invoiceMonth: state.dest.invoiceMonth,
                    billMonth: state.dest.invoiceMonth,
                    cardId: state.dest.cardId,
                    cardType: row.cardType || "fisico",
                    cardHolder: state.dest.cardHolderRole || "main",
                    holderPersonId: state.dest.cardHolderPersonId || null,
                    holderName: state.dest.cardHolderName || null
                };

                // Dívida a Receber Auto-Creation
                if (row.personId && row.personId !== "" && isExpense && absoluteValue > 0) {
                    const existingDebtId = uid("loan_impt");
                    const loan = {
                        id: existingDebtId,
                        title: `Ref: ${finalTx.description}`,
                        role: 'owed_to_me',
                        borrowerPersonId: row.personId,
                        lenderPersonId: "",
                        principal: absoluteValue,
                        currency: finalTx.currency,
                        startDate: finalTx.date,
                        totalInstallments: 1,
                        installmentAmount: absoluteValue,
                        dueDay: parseInt(finalTx.date.split("-")[2], 10) || 10,
                        notes: `Gerado automaticamente da importação de cartão.\nData: ${finalTx.date}\nFatura: ${state.dest.invoiceMonth}`,
                        status: 'open',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        import_session_id: state.importSessionId
                    };
                    try {
                        await put("loans", loan);
                        const inst = {
                            id: uid("loan_inst"),
                            loanId: loan.id,
                            installmentNo: 1,
                            installmentTotal: 1,
                            dueDate: loan.startDate,
                            amount: absoluteValue,
                            status: 'open',
                            createdAt: loan.createdAt
                        };
                        await put("loan_installments", inst);
                    } catch (er) {
                        console.warn("Could not auto-create debt receivable", er);
                    }
                }
            } else {
                // Account Export Structure (OFX/QIF)
                const importIdBase = row.fitid || undefined;
                const finalImportId = importIdBase ? `${importIdBase}-acct-${state.dest.accountId}` : undefined;

                let isDuplicate = false;
                if (finalImportId && importIdSet.has(finalImportId)) {
                    isDuplicate = true;
                } else if (state.dest.relaxedDedup) {
                    const rowDateKey = row.dateISO || row.date;
                    const rowValKey = row.amount !== undefined ? row.amount : row.value;
                    const relaxedKey = `${rowDateKey}|${rowValKey}`;
                    if (relaxedDedupSet.has(relaxedKey)) {
                        isDuplicate = true;
                    }
                }

                if (isDuplicate) {
                    ignoredCount++;
                    return; // Skip duplicate mapping
                }

                if (finalImportId) importIdSet.add(finalImportId); // Add locally too
                if (state.dest.relaxedDedup) {
                    const rowDateKey = row.dateISO || row.date;
                    const rowValKey = row.amount !== undefined ? row.amount : row.value;
                    relaxedDedupSet.add(`${rowDateKey}|${rowValKey}`);
                }

                finalTx = {
                    ...commonProps,
                    type: isExpense ? "expense" : "revenue", // OFX/QIF positive equals revenue (or transfer, but revenue is safe default)
                    accountId: state.dest.accountId,
                    importId: finalImportId, // For OFX fits or QIF pseudo-hashes
                    importSource: row.fitid ? (row.fitid.startsWith('qif-') ? "qif" : "ofx") : undefined
                };
            }

            if (finalTx) {
                await put("transactions", finalTx);
            }
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

    let successHtml = `<div style="font-size:1.2em; color:green; margin-bottom:10px;">✅ Sucesso!</div>`;
    if (ignoredCount > 0) {
        successHtml += `<div style="font-size:0.9em; margin-bottom:10px; color:#555;">Importadas ${total - ignoredCount}; Duplicadas ${ignoredCount} (ignoradas)</div>`;
    } else {
        successHtml += `<div style="font-size:0.9em; margin-bottom:10px; color:#555;">Importadas ${total}</div>`;
    }
    successHtml += `<button id="btnFinish">Ver Faturas</button>`;
    finalMsg.innerHTML = successHtml;

    const newBtnFinish = cnt.querySelector("#btnFinish");

    if (state.dest.importType === "card") {
        // Update Invoice State (Circuit Breaker pattern - safe update)
        try {
            setInvoiceState(state.dest.cardId, state.dest.invoiceMonth);
        } catch (e) { console.warn("Invoice update warning", e); }

        newBtnFinish.textContent = "Ver Faturas";
        newBtnFinish.onclick = () => {
            location.hash = "#invoices";
        };
    } else {
        newBtnFinish.textContent = "Ver Lançamentos";
        newBtnFinish.onclick = () => {
            location.hash = "#tx";
        };
    }
}
