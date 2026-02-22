// screens/search.js
// Global Search and Filters Utilities

import { list, put, get } from "../db.js";

export function normalize(str) {
    if (!str) return "";
    return str.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function debounce(func, delay = 250) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

// Default state object structure
export const defaultSearchState = {
    text: '',
    categoryId: '',
    tag: '',
    personId: '',
    limit: 50
};

export function renderGlobalSearch(state, categories, tags, people) {
    const esc = (s) => (s ?? "").toString().replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

    return `
    <div class="card search-container" style="margin-bottom: 10px; padding: 10px; background: #eef2f5; border: 1px solid #ced4da; border-radius: 6px;">
        <div style="font-weight: bold; margin-bottom: 8px; font-size: 0.9em; color: #495057;">🔍 Busca e Filtros Rápidos</div>
        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
            <input type="text" id="gsText" placeholder="Buscar termo..." value="${esc(state.text)}" style="flex:1; min-width:180px; padding:6px; border-radius:4px; border:1px solid #ccc;">
            
            <select id="gsCategory" style="padding:6px; border-radius:4px; border:1px solid #ccc; max-width: 150px; flex: 1; min-width: 120px;">
                <option value="">(Categorias)</option>
                ${categories.map(c => `<option value="${c.id}" ${state.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
            
            <select id="gsTag" style="padding:6px; border-radius:4px; border:1px solid #ccc; max-width: 150px; flex: 1; min-width: 120px;">
                <option value="">(Tags)</option>
                ${tags.map(t => `<option value="${t.name}" ${state.tag === t.name ? 'selected' : ''}>#${esc(t.name)}</option>`).join('')}
            </select>
            
            <select id="gsPerson" style="padding:6px; border-radius:4px; border:1px solid #ccc; max-width: 150px; flex: 1; min-width: 120px;">
                <option value="">(Pessoas)</option>
                ${people.map(p => `<option value="${p.id}" ${state.personId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
            
            <button id="btnGsClear" class="secondary small" style="padding:6px 12px; background: #fff; border: 1px solid #ccc; color: #333; cursor: pointer;">Limpar</button>
        </div>
    </div>
    `;
}

export function wireGlobalSearch(rootEl, state, onChangeCallback) {
    const txtInput = rootEl.querySelector("#gsText");
    const catSelect = rootEl.querySelector("#gsCategory");
    const tagSelect = rootEl.querySelector("#gsTag");
    const personSelect = rootEl.querySelector("#gsPerson");
    const btnClear = rootEl.querySelector("#btnGsClear");

    if (!txtInput) return; // Search not in DOM

    const notify = () => {
        state.limit = 50; // Reset limit on any filter change
        onChangeCallback();
    };

    const debouncedNotify = debounce(notify, 250);

    txtInput.addEventListener("input", (e) => {
        state.text = e.target.value;
        debouncedNotify();
    });

    catSelect.addEventListener("change", (e) => {
        state.categoryId = e.target.value;
        notify();
    });

    tagSelect.addEventListener("change", (e) => {
        state.tag = e.target.value;
        notify();
    });

    personSelect.addEventListener("change", (e) => {
        state.personId = e.target.value;
        notify();
    });

    btnClear.addEventListener("click", () => {
        state.text = '';
        state.categoryId = '';
        state.tag = '';
        state.personId = '';
        state.limit = 50;

        txtInput.value = '';
        catSelect.value = '';
        tagSelect.value = '';
        personSelect.value = '';

        notify();
    });
}

// Function to attach standard filtering
export function applyGlobalSearch(items, state, categories, people) {
    if (!state.text && !state.categoryId && !state.tag && !state.personId) {
        return items; // No filters active
    }

    const term = normalize(state.text);

    return items.filter(item => {
        // 1. Tag
        if (state.tag) {
            if (!item.tags || !item.tags.includes(state.tag)) return false;
        }

        // 2. Category
        if (state.categoryId) {
            if (item.categoryId !== state.categoryId) return false;
        }

        // 3. Person
        if (state.personId) {
            if (item.personId !== state.personId) return false;
        }

        // 4. Text Search
        if (term) {
            const getCatName = (id) => categories.find(c => c.id === id)?.name || "";
            const getPersonName = (id) => people.find(p => p.id === id)?.name || "";

            // Collect indexable strings for this item
            const indexStr = [
                normalize(item.description || item.name || item.title), // tx, bill, invoice, or loan name property
                normalize(getCatName(item.categoryId)),
                normalize(getPersonName(item.personId)),
                item.tags ? normalize(item.tags.join(" ")) : ""
            ].join(" ");

            if (!indexStr.includes(term)) return false;
        }

        return true;
    });
}

// -------------------------------------------------------------
// Dedicated Full Screen Search Logic (19B-2)
// -------------------------------------------------------------

let _screenState = {
    // Escopos
    scopeTx: true,
    scopeCards: true,
    scopeBills: true,
    scopeLoans: true,

    // Filtros avançados
    query: '',
    periodMode: 'month', // 'month' ou 'range'
    filterMonth: new Date().toISOString().slice(0, 7),
    filterDateStart: '',
    filterDateEnd: '',

    personId: '',
    accountId: '',
    cardId: '',
    categoryId: '',
    subcategoryId: '',
    tag: '',
    valMin: '',
    valMax: '',
    onlyType: '', // 'expense' or 'income'
    status: '', // 'open', 'paid', etc.

    limit: 50
};

export async function searchScreen() {
    // Carregar options
    const [categories, subcategories, people, accounts, cards, settings] = await Promise.all([
        list("categories").catch(() => []),
        list("subcategories").catch(() => []),
        list("people").catch(() => []),
        list("accounts").catch(() => []),
        list("cards").catch(() => []),
        list("settings").catch(() => [])
    ]);

    // Restaurar estado salvo (se houver)
    const savedState = settings.find(s => s.id === "ui_search_state");
    if (savedState && savedState.value) {
        _screenState = { ..._screenState, ...savedState.value };
    }

    // Normalization Cache
    const normCache = new Map();
    const n = (str) => {
        if (!str) return "";
        const s = String(str);
        if (normCache.has(s)) return normCache.get(s);
        const res = normalize(s);
        normCache.set(s, res);
        return res;
    };

    // Coletar dados baseados nos escopos selecionados
    let unified = [];

    if (_screenState.scopeTx || _screenState.scopeCards) {
        const txs = await list("transactions").catch(() => []);
        for (const t of txs) {
            // Se for fatura (tem cardId e invoiceMonth)
            const isCard = !!t.cardId && !!t.invoiceMonth;

            if (isCard && !_screenState.scopeCards) continue;
            if (!isCard && !_screenState.scopeTx) continue;

            unified.push({
                type: isCard ? 'FATURA' : 'TX',
                rawType: isCard ? 'invoice' : 'tx',
                id: t.id,
                date: isCard ? (t.invoiceMonth + "-01") : t.date, // base date for sorting/filtering
                realDate: t.date,
                description: t.description,
                value: t.value || 0,
                isExpense: t.type !== 'income', // assuming type 'income' or 'expense'
                personId: t.personId,
                accountId: t.accountId,
                cardId: t.cardId,
                categoryId: t.categoryId,
                subcategoryId: t.subcategoryId,
                tags: t.tags || [],
                status: isCard ? (t.paid ? 'paid' : 'open') : '', // Approximation for cards
                original: t
            });
        }
    }

    if (_screenState.scopeBills) {
        const bills = await list("bills").catch(() => []);
        for (const b of bills) {
            unified.push({
                type: 'CONTA A PAGAR',
                rawType: 'bill',
                id: b.id,
                date: b.dueDate || (b.month + "-01"),
                description: b.title || b.description,
                value: b.amount || 0,
                isExpense: true, // Assuming bills are expenses
                personId: '', // Usually bills don't have personId like Tx
                accountId: '',
                cardId: '',
                categoryId: b.categoryId,
                subcategoryId: '',
                tags: b.tags || [],
                status: b.paid ? 'paid' : (b.status || 'open'),
                original: b,
                month: b.month
            });
        }
    }

    if (_screenState.scopeLoans) {
        const loans = await list("loans").catch(() => []);
        for (const l of loans) {
            // For loans we need to guess the date or use the creation date. Loans typically have a day like l.dueDay
            // we mock a date using the current _filters.additionalMonth of loans.js or just today if no proper date is found.
            let loanDate = new Date().toISOString().slice(0, 10);

            unified.push({
                type: 'DÍVIDA',
                rawType: 'loan',
                id: l.id,
                date: loanDate,
                description: l.title,
                value: l.amount || l.saldo || 0,
                isExpense: l.role === 'i_owe', // Depends on the perspective
                personId: l.personId,
                accountId: '',
                cardId: '',
                categoryId: '',
                subcategoryId: '',
                tags: [], // Assuming loans don't have tags directly
                status: (l.status === 'closed') ? 'closed' : 'open',
                original: l
            });
        }
    }

    // Aplicar Filtros Avançados
    let filtered = unified.filter(u => {
        // Período
        if (_screenState.periodMode === 'month' && _screenState.filterMonth) {
            if (!u.date.startsWith(_screenState.filterMonth)) return false;
        } else if (_screenState.periodMode === 'range') {
            if (_screenState.filterDateStart && u.date < _screenState.filterDateStart) return false;
            // append "T23:59:59" logically if needed, but string compare works fine
            if (_screenState.filterDateEnd && u.date > _screenState.filterDateEnd) return false;
        }

        // Filtros exatos
        if (_screenState.personId && u.personId !== _screenState.personId) return false;
        if (_screenState.accountId && u.accountId !== _screenState.accountId) return false;
        if (_screenState.cardId && u.cardId !== _screenState.cardId) return false;
        if (_screenState.categoryId && u.categoryId !== _screenState.categoryId) return false;
        if (_screenState.subcategoryId && u.subcategoryId !== _screenState.subcategoryId) return false;
        if (_screenState.tag && !u.tags.includes(_screenState.tag)) return false;

        // Tipo Receita/Despesa
        if (_screenState.onlyType === 'expense' && !u.isExpense) return false;
        if (_screenState.onlyType === 'income' && u.isExpense) return false;

        // Status
        if (_screenState.status) {
            // simplified status check
            if (_screenState.status === 'open' && u.status !== 'open') return false;
            if (_screenState.status === 'paid' && u.status !== 'paid' && u.status !== 'closed') return false;
        }

        // Valor Min / Max
        const val = Math.abs(u.value);
        if (_screenState.valMin !== '' && val < parseFloat(_screenState.valMin)) return false;
        if (_screenState.valMax !== '' && val > parseFloat(_screenState.valMax)) return false;

        return true;
    });

    // Filtro de Texto (usando o normCache)
    const term = n(_screenState.query);
    if (term) {
        filtered = filtered.filter(u => {
            const getCatName = (id) => categories.find(c => c.id === id)?.name || "";
            const getSubName = (id) => subcategories.find(c => c.id === id)?.name || "";
            const getPersonName = (id) => people.find(p => p.id === id)?.name || "";

            const indexStr = [
                n(u.description),
                n(getCatName(u.categoryId)),
                n(getSubName(u.subcategoryId)),
                n(getPersonName(u.personId)),
                n(u.tags?.join(" ") || '')
            ].join(" ");

            return indexStr.includes(term);
        });
    }

    // Ordenação (Mais recente primeiro)
    filtered.sort((a, b) => b.date.localeCompare(a.date));

    // Paginação
    const totalResults = filtered.length;
    const paginated = filtered.slice(0, _screenState.limit);

    // Helpers UI
    const esc = (s) => (s ?? "").toString().replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    const getBadgeColor = (type) => {
        if (type === 'TX') return '#007bff';
        if (type === 'FATURA') return '#6f42c1';
        if (type === 'CONTA A PAGAR') return '#dc3545';
        if (type === 'DÍVIDA') return '#fd7e14';
        return '#6c757d';
    };

    return `
        <div class="card" style="margin-bottom: 10px; padding: 15px; background: #fff; border: 1px solid #ced4da; border-radius: 6px;">
            <div style="font-weight: bold; font-size: 1.2em; margin-bottom: 15px; display:flex; align-items:center; justify-content:space-between;">
                <span>Busca Avançada</span>
                <button class="secondary small btnClearSearch" style="font-size:0.8em;">Limpar Tudo</button>
            </div>
            
            <input type="text" id="mainSearchInput" placeholder="Buscar qualquer termo..." value="${esc(_screenState.query)}" style="width:100%; padding:10px; font-size:1.1em; border-radius:6px; border:1px solid #ccc; margin-bottom: 15px;">

            <div style="margin-bottom:15px; display:flex; gap:15px; flex-wrap:wrap; font-size:0.9em; background:#f8f9fa; padding:10px; border-radius:4px;">
                <label style="cursor:pointer;"><input type="checkbox" class="scopeCheckbox" value="scopeTx" ${_screenState.scopeTx ? 'checked' : ''}> Lançamentos</label>
                <label style="cursor:pointer;"><input type="checkbox" class="scopeCheckbox" value="scopeCards" ${_screenState.scopeCards ? 'checked' : ''}> Cartões/Faturas</label>
                <label style="cursor:pointer;"><input type="checkbox" class="scopeCheckbox" value="scopeBills" ${_screenState.scopeBills ? 'checked' : ''}> Contas a Pagar</label>
                <label style="cursor:pointer;"><input type="checkbox" class="scopeCheckbox" value="scopeLoans" ${_screenState.scopeLoans ? 'checked' : ''}> Dívidas</label>
            </div>

            <details style="margin-bottom:15px; border:1px solid #dee2e6; border-radius:4px; padding:10px;">
                <summary style="font-weight:bold; cursor:pointer; color:#0056b3; outline:none;">Filtros Avançados</summary>
                
                <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:10px; margin-top:15px;">
                    <div>
                        <label>Modo de Período</label>
                        <select id="advPeriodMode" style="width:100%;">
                            <option value="month" ${_screenState.periodMode === 'month' ? 'selected' : ''}>Mês Único</option>
                            <option value="range" ${_screenState.periodMode === 'range' ? 'selected' : ''}>Intervalo Livre</option>
                        </select>
                    </div>

                    ${_screenState.periodMode === 'month' ? `
                        <div>
                            <label>Mês</label>
                            <input type="month" id="advMonth" value="${_screenState.filterMonth}" style="width:100%;">
                        </div>
                    ` : `
                        <div>
                            <label>De (Data inicial)</label>
                            <input type="date" id="advDateStart" value="${_screenState.filterDateStart}" style="width:100%;">
                        </div>
                        <div>
                            <label>Ate (Data final)</label>
                            <input type="date" id="advDateEnd" value="${_screenState.filterDateEnd}" style="width:100%;">
                        </div>
                    `}

                    <div>
                        <label>Categoria</label>
                        <select id="advCategory" style="width:100%;">
                            <option value="">(Todas)</option>
                            ${categories.map(c => `<option value="${c.id}" ${_screenState.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label>Tag</label>
                        <input type="text" id="advTag" placeholder="Ex: viagem" value="${esc(_screenState.tag)}" style="width:100%;">
                    </div>

                    <div>
                        <label>Pessoa</label>
                        <select id="advPerson" style="width:100%;">
                            <option value="">(Todas)</option>
                            ${people.map(p => `<option value="${p.id}" ${_screenState.personId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label>Conta</label>
                        <select id="advAccount" style="width:100%;">
                            <option value="">(Todas)</option>
                            ${accounts.map(a => `<option value="${a.id}" ${_screenState.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label>Cartão</label>
                        <select id="advCard" style="width:100%;">
                            <option value="">(Todos)</option>
                            ${cards.map(a => `<option value="${a.id}" ${_screenState.cardId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
                        </select>
                    </div>
                    
                    <div>
                        <label>Valor Mínimo (R$)</label>
                        <input type="number" step="0.01" id="advValMin" value="${_screenState.valMin}" style="width:100%;">
                    </div>
                    <div>
                        <label>Valor Máximo (R$)</label>
                        <input type="number" step="0.01" id="advValMax" value="${_screenState.valMax}" style="width:100%;">
                    </div>

                    <div>
                        <label>Tipo</label>
                        <select id="advOnlyType" style="width:100%;">
                            <option value="">Todas</option>
                            <option value="expense" ${_screenState.onlyType === 'expense' ? 'selected' : ''}>Apenas Despesas (Saídas)</option>
                            <option value="income" ${_screenState.onlyType === 'income' ? 'selected' : ''}>Apenas Receitas (Entradas)</option>
                        </select>
                    </div>
                </div>

                <div style="margin-top:15px; display:flex; justify-content:flex-end;">
                    <button class="primary" id="btnApplyAdvancedFilters">Aplicar Filtros</button>
                </div>
            </details>
        </div>

        <div class="card">
            <div style="font-weight:bold; margin-bottom:15px; color:#495057;">
                Resultados Encontrados: ${totalResults}
            </div>

            ${paginated.length === 0 ? '<div class="text-muted text-center" style="padding: 20px;">Nenhum registro encontrado.</div>' : ''}

            <ul class="list">
                ${paginated.map(p => {
        const badgeColor = getBadgeColor(p.type);
        const isNeg = p.isExpense;
        const valColor = isNeg ? 'red' : 'green';
        const sign = isNeg ? '-' : '+';

        const catName = categories.find(c => c.id === p.categoryId)?.name || '';
        const personName = people.find(c => c.id === p.personId)?.name || '';

        const subtags = [catName, personName, ...(p.tags || [])].filter(x => x).join(' • ');

        let link = '';
        // Generate proper parameter strings ensuring highlights trigger scrolling later
        if (p.rawType === 'tx') link = `#tx?highlight=${p.id}&month=${p.realDate?.slice(0, 7)}`;
        if (p.rawType === 'invoice') link = `#invoices?card=${p.cardId}&month=${p.original.invoiceMonth}&highlight=${p.id}`;
        if (p.rawType === 'bill') link = `#bills?month=${p.month}&highlight=${p.id}`;
        if (p.rawType === 'loan') link = `#loans?detail=${p.id}`;

        // Add USD if it exists
        const isUSD = p.original.amountUSD ? `<br>(USD ${p.original.amountUSD.toFixed(2)})` : '';

        return `
        <li class="listItem" style="display:flex; justify-content:space-between; align-items:center; border-left:4px solid ${badgeColor}; cursor:pointer;" onclick="location.hash='${link}'">
            <div style="flex:1;">
                <div style="font-weight:bold;">${esc(p.description)}</div>
                <div style="font-size:0.8em; color:#666; display:flex; gap:8px; align-items:center;">
                    <span style="background:${badgeColor}; color:white; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:0.75em;">${p.type}</span>
                    <span>🗓 ${p.date}</span>
                </div>
                ${subtags ? `<div style="font-size:0.75em; color:#888; margin-top:3px;">${esc(subtags)}</div>` : ''}
            </div>
            <div style="text-align:right;">
                <div style="font-weight:bold; color:${valColor};">${sign} R$ ${Math.abs(p.value).toFixed(2)}</div>
                <div style="font-size:0.7em; color:#555;">${isUSD}</div>
                ${p.status ? `<div style="font-size:0.7em; color:#555; text-transform:uppercase;">${p.status}</div>` : ''}
            </div>
        </li>
        `
    }).join('')}
</ul>

${totalResults > _screenState.limit ? `
    <div style="text-align:center; padding: 15px;">
        <button id="btnLoadMoreSearch" class="secondary">Carregar mais (${Math.min(totalResults - _screenState.limit, 50)})</button>
        <div class="small" style="color:#666; margin-top:5px;">Exibindo ${_screenState.limit} de ${totalResults}</div>
     </div>
` : ''}
</div>
`;
}

export async function wireSearchHandlers(rootEl) {
    const refresh = async () => {
        // Save filters automatically before re-rendering
        await put("settings", { id: "ui_search_state", value: _screenState });
        const ev = new Event("hashchange");
        window.dispatchEvent(ev);
    };

    // Text Input (Debounced)
    const txtInput = rootEl.querySelector("#mainSearchInput");
    if (txtInput) {
        const debouncedRefresh = debounce(() => {
            _screenState.limit = 50; // reset pagination
            refresh();
        }, 250);

        txtInput.addEventListener("input", (e) => {
            const val = e.target.value;
            // Only refresh if typing actually happened
            if (_screenState.query !== val) {
                _screenState.query = val;
                debouncedRefresh();
            }
        });
    }

    // Scopes (Checkboxes)
    rootEl.querySelectorAll(".scopeCheckbox").forEach(cb => {
        cb.addEventListener("change", (e) => {
            _screenState[e.target.value] = e.target.checked;
            _screenState.limit = 50;
            refresh();
        });
    });

    // Apply Filters button
    const btnApply = rootEl.querySelector("#btnApplyAdvancedFilters");
    if (btnApply) {
        btnApply.addEventListener("click", () => {
            _screenState.periodMode = rootEl.querySelector("#advPeriodMode").value;
            _screenState.filterMonth = rootEl.querySelector("#advMonth")?.value || '';
            _screenState.filterDateStart = rootEl.querySelector("#advDateStart")?.value || '';
            _screenState.filterDateEnd = rootEl.querySelector("#advDateEnd")?.value || '';

            _screenState.categoryId = rootEl.querySelector("#advCategory").value;
            _screenState.tag = rootEl.querySelector("#advTag").value.trim();
            _screenState.personId = rootEl.querySelector("#advPerson").value;
            _screenState.accountId = rootEl.querySelector("#advAccount").value;
            _screenState.cardId = rootEl.querySelector("#advCard").value;
            _screenState.valMin = rootEl.querySelector("#advValMin").value;
            _screenState.valMax = rootEl.querySelector("#advValMax").value;
            _screenState.onlyType = rootEl.querySelector("#advOnlyType").value;

            _screenState.limit = 50;
            refresh();
        });
    }

    // Changing Period Mode toggles inputs without full refresh immediately
    const modeSelect = rootEl.querySelector("#advPeriodMode");
    if (modeSelect) {
        modeSelect.addEventListener("change", (e) => {
            _screenState.periodMode = e.target.value;
            refresh(); // Quick refresh to show different date inputs
        });
    }

    // Clear All Filters
    const btnClearAllArr = rootEl.querySelectorAll(".btnClearSearch");
    btnClearAllArr.forEach(btnClearAll => {
        btnClearAll.addEventListener("click", () => {
            _screenState.query = '';
            _screenState.periodMode = 'month';
            _screenState.filterMonth = new Date().toISOString().slice(0, 7);
            _screenState.filterDateStart = '';
            _screenState.filterDateEnd = '';
            _screenState.categoryId = '';
            _screenState.tag = '';
            _screenState.personId = '';
            _screenState.accountId = '';
            _screenState.cardId = '';
            _screenState.valMin = '';
            _screenState.valMax = '';
            _screenState.onlyType = '';
            _screenState.status = '';
            _screenState.limit = 50;

            // Re-check scopes
            _screenState.scopeTx = true;
            _screenState.scopeCards = true;
            _screenState.scopeBills = true;
            _screenState.scopeLoans = true;

            refresh();
        });
    });

    // Load More button
    const btnLoadMore = rootEl.querySelector("#btnLoadMoreSearch");
    if (btnLoadMore) {
        btnLoadMore.addEventListener("click", () => {
            _screenState.limit += 50;
            refresh();
        });
    }
}
