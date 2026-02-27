import { getCache, setCache, clearCache } from "./utils/cache.js";

const DB_NAME = "financeapp";
const DB_VERSION = 29; // INCREMENTED for Metas de Patrimônio (Wealth Goals)
const SUPPORTED_BACKUP_VERSION = 1;

// Helper to validate legacy dumps
function looksLikeFinanceAppDump(obj) {
    if (!obj || typeof obj !== 'object') return false;
    // Check for at least 2 known arrays
    const keys = ["transactions", "accounts", "cards", "categories", "people", "settings", "tags", "subcategories", "rules"];
    let matchCount = 0;
    for (const k of keys) {
        if (Array.isArray(obj[k])) matchCount++;
    }
    return matchCount >= 2;
}

// Stores definitions
const STORES = [
    "settings",
    "people",
    "accounts",
    "cards",
    "categories",
    "subcategories",
    "tags",
    "invoices",
    "transactions",
    "invoice_payments",
    "installment_plans",
    "rules",
    "goals", // Legacy, kept for migration or safe fallback
    "goal_templates",
    "goal_revisions",
    "goal_overrides",
    "bill_templates",
    "bill_plans",
    "bills",
    "loans",
    "loan_installments",
    "person_balances",
    "balance_events",
    "month_checklist",
    "budget_templates",
    "budget_overrides",
    "investment_boxes",
    "investment_moves",
    "wealth_goals",
    "wealth_goal_links"
];

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = req.result;
            const tx = req.transaction;

            STORES.forEach(storeName => {
                if (!db.objectStoreNames.contains(storeName)) {
                    console.log(`[DB Upgrade] Creating store: ${storeName}`);
                    const s = db.createObjectStore(storeName, { keyPath: "id" });

                    // Specific Indexes
                    if (storeName === "transactions") {
                        s.createIndex("invoice_idx", ["cardId", "invoiceMonth"], { unique: false });
                        s.createIndex("import_session_idx", "import_session_id", { unique: false });
                        s.createIndex("by_planId", "installmentPlanId", { unique: false });
                        s.createIndex("by_dateMonth", "dateMonth", { unique: false });
                        s.createIndex("by_account_month", ["accountId", "dateMonth"], { unique: false });
                        s.createIndex("by_person_month", ["personId", "dateMonth"], { unique: false });
                        s.createIndex("by_category_month", ["categoryId", "dateMonth"], { unique: false });
                        s.createIndex("by_invoiceMonth", "invoiceMonth", { unique: false });
                    }
                } else if (storeName === "transactions") {
                    const s = tx.objectStore("transactions");
                    if (!s.indexNames.contains("invoice_idx")) {
                        s.createIndex("invoice_idx", ["cardId", "invoiceMonth"], { unique: false });
                    }
                    if (!s.indexNames.contains("import_session_idx")) {
                        s.createIndex("import_session_idx", "import_session_id", { unique: false });
                    }
                    if (!s.indexNames.contains("by_planId")) {
                        console.log("[DB Upgrade] Creating index: by_planId");
                        s.createIndex("by_planId", "installmentPlanId", { unique: false });
                    }
                    if (!s.indexNames.contains("by_dateMonth")) {
                        console.log("[DB Upgrade] Creating index: by_dateMonth");
                        s.createIndex("by_dateMonth", "dateMonth", { unique: false });
                    }
                    if (!s.indexNames.contains("by_account_month")) {
                        console.log("[DB Upgrade] Creating index: by_account_month");
                        s.createIndex("by_account_month", ["accountId", "dateMonth"], { unique: false });
                    }
                    if (!s.indexNames.contains("by_person_month")) {
                        console.log("[DB Upgrade] Creating index: by_person_month");
                        s.createIndex("by_person_month", ["personId", "dateMonth"], { unique: false });
                    }
                    if (!s.indexNames.contains("by_category_month")) {
                        console.log("[DB Upgrade] Creating index: by_category_month");
                        s.createIndex("by_category_month", ["categoryId", "dateMonth"], { unique: false });
                    }
                    if (!s.indexNames.contains("by_invoiceMonth")) {
                        console.log("[DB Upgrade] Creating index: by_invoiceMonth");
                        s.createIndex("by_invoiceMonth", "invoiceMonth", { unique: false });
                    }
                }
            });

            // Create invoice_payments store if not exists, or add index if missing
            if (!db.objectStoreNames.contains("invoice_payments")) {
                console.log("[DB Upgrade] Creating store: invoice_payments");
                const s = db.createObjectStore("invoice_payments", { keyPath: "id" });
                s.createIndex("by_invoiceKey", "invoiceKey", { unique: false });
                s.createIndex("by_invoiceMonth", "invoiceMonth", { unique: false });
            } else {
                const s = tx.objectStore("invoice_payments");
                if (!s.indexNames.contains("by_invoiceKey")) {
                    console.log("[DB Upgrade] Creating index: by_invoiceKey");
                    s.createIndex("by_invoiceKey", "invoiceKey", { unique: false });
                }
                if (!s.indexNames.contains("by_invoiceMonth")) {
                    console.log("[DB Upgrade] Creating index: by_invoiceMonth");
                    s.createIndex("by_invoiceMonth", "invoiceMonth", { unique: false });
                }
            }

            // Create installment_plans store if not exists
            if (!db.objectStoreNames.contains("installment_plans")) {
                console.log("[DB Upgrade] Creating store: installment_plans");
                const s = db.createObjectStore("installment_plans", { keyPath: "id" });
                s.createIndex("by_account", "accountId", { unique: false });
                s.createIndex("by_status", "status", { unique: false });
            }

            // Create rules store if not exists
            if (!db.objectStoreNames.contains("rules")) {
                console.log("[DB Upgrade] Creating store: rules");
                const s = db.createObjectStore("rules", { keyPath: "id" });
                s.createIndex("by_priority", "priority", { unique: false });
            }

            // Create goals store if not exists
            if (!db.objectStoreNames.contains("goals")) {
                console.log("[DB Upgrade] Creating store: goals");
                const s = db.createObjectStore("goals", { keyPath: "id" });
                s.createIndex("by_month", "month", { unique: false });
            }

            // Recurrent Goals Stores
            if (!db.objectStoreNames.contains("goal_templates")) {
                console.log("[DB Upgrade] Creating store: goal_templates");
                db.createObjectStore("goal_templates", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("goal_revisions")) {
                console.log("[DB Upgrade] Creating store: goal_revisions");
                const s = db.createObjectStore("goal_revisions", { keyPath: "id" });
                s.createIndex("by_template", "templateId", { unique: false });
                s.createIndex("by_effective", "effectiveFromMonth", { unique: false });
            }

            if (!db.objectStoreNames.contains("goal_overrides")) {
                console.log("[DB Upgrade] Creating store: goal_overrides");
                const s = db.createObjectStore("goal_overrides", { keyPath: "id" });
                s.createIndex("by_template", "templateId", { unique: false });
                s.createIndex("by_month", "month", { unique: false });
            }

            if (!db.objectStoreNames.contains("month_checklist")) {
                console.log("[DB Upgrade] Creating store: month_checklist");
                db.createObjectStore("month_checklist", { keyPath: "id" });
            }

            // Bills Feature
            if (!db.objectStoreNames.contains("bill_templates")) {
                console.log("[DB Upgrade] Creating store: bill_templates");
                db.createObjectStore("bill_templates", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("bill_plans")) {
                console.log("[DB Upgrade] Creating store: bill_plans");
                db.createObjectStore("bill_plans", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("bills")) {
                console.log("[DB Upgrade] Creating store: bills");
                const s = db.createObjectStore("bills", { keyPath: "id" });
                s.createIndex("by_month", "month", { unique: false });
                s.createIndex("by_template", "templateId", { unique: false });
                s.createIndex("by_plan", "planId", { unique: false });
                s.createIndex("by_template_month", ["templateId", "month"], { unique: false });
                s.createIndex("by_status_month", ["status", "month"], { unique: false });
            } else {
                const s = tx.objectStore("bills");
                if (!s.indexNames.contains("by_plan")) {
                    console.log("[DB Upgrade] Creating index: by_plan on bills");
                    s.createIndex("by_plan", "planId", { unique: false });
                }
                if (!s.indexNames.contains("by_template_month")) {
                    console.log("[DB Upgrade] Creating index: by_template_month on bills");
                    s.createIndex("by_template_month", ["templateId", "month"], { unique: false });
                }
                if (!s.indexNames.contains("by_status_month")) {
                    console.log("[DB Upgrade] Creating index: by_status_month on bills");
                    s.createIndex("by_status_month", ["status", "month"], { unique: false });
                }
            }

            // Loans Feature (14A)
            if (!db.objectStoreNames.contains("loans")) {
                console.log("[DB Upgrade] Creating store: loans");
                const s = db.createObjectStore("loans", { keyPath: "id" });
                s.createIndex("by_status", "status", { unique: false });
                s.createIndex("by_borrower", "borrowerPersonId", { unique: false });
                s.createIndex("by_lender", "lenderPersonId", { unique: false });
            }

            if (!db.objectStoreNames.contains("loan_payments")) {
                console.log("[DB Upgrade] Creating store: loan_payments");
                const s = db.createObjectStore("loan_payments", { keyPath: "id" });
                s.createIndex("by_loanId", "loanId", { unique: false });
            }

            if (!db.objectStoreNames.contains("loan_installments")) {
                console.log("[DB Upgrade] Creating store: loan_installments");
                const s = db.createObjectStore("loan_installments", { keyPath: "id" });
                s.createIndex("by_loanId", "loanId", { unique: false });
                s.createIndex("by_status", "status", { unique: false });
                s.createIndex("by_dueMonth", "dueMonth", { unique: false });
                s.createIndex("by_status_dueMonth", ["status", "dueMonth"], { unique: false });
            } else {
                const s = tx.objectStore("loan_installments");
                if (!s.indexNames.contains("by_dueMonth")) {
                    console.log("[DB Upgrade] Creating index: by_dueMonth on loan_installments");
                    s.createIndex("by_dueMonth", "dueMonth", { unique: false });
                }
                if (!s.indexNames.contains("by_status_dueMonth")) {
                    console.log("[DB Upgrade] Creating index: by_status_dueMonth on loan_installments");
                    s.createIndex("by_status_dueMonth", ["status", "dueMonth"], { unique: false });
                }
            }

            if (!db.objectStoreNames.contains("person_balances")) {
                console.log("[DB Upgrade] Creating store: person_balances");
                db.createObjectStore("person_balances", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("balance_events")) {
                console.log("[DB Upgrade] Creating store: balance_events");
                const s = db.createObjectStore("balance_events", { keyPath: "id" });
                s.createIndex("by_person", "personId", { unique: false });
                s.createIndex("by_month", "month", { unique: false });
            }

            // Monthly Budgets
            if (!db.objectStoreNames.contains("budget_templates")) {
                console.log("[DB Upgrade] Creating store: budget_templates");
                db.createObjectStore("budget_templates", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("budget_overrides")) {
                console.log("[DB Upgrade] Creating store: budget_overrides");
                const s = db.createObjectStore("budget_overrides", { keyPath: "id" });
                s.createIndex("by_template", "templateId", { unique: false });
                s.createIndex("by_month", "month", { unique: false });
            }

            // Investments (Caixinhas)
            if (!db.objectStoreNames.contains("investment_boxes")) {
                console.log("[DB Upgrade] Creating store: investment_boxes");
                db.createObjectStore("investment_boxes", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("investment_moves")) {
                console.log("[DB Upgrade] Creating store: investment_moves");
                const s = db.createObjectStore("investment_moves", { keyPath: "id" });
                s.createIndex("by_boxId", "boxId", { unique: false });
                s.createIndex("by_date", "date", { unique: false });
            } else {
                const s = tx.objectStore("investment_moves");
                if (!s.indexNames.contains("by_boxId")) {
                    console.log("[DB Upgrade] Creating index: by_boxId on investment_moves");
                    s.createIndex("by_boxId", "boxId", { unique: false });
                }
                if (!s.indexNames.contains("by_date")) {
                    console.log("[DB Upgrade] Creating index: by_date on investment_moves");
                    s.createIndex("by_date", "date", { unique: false });
                }
            }

            // Wealth Goals (Metas de Patrimônio)
            if (!db.objectStoreNames.contains("wealth_goals")) {
                console.log("[DB Upgrade] Creating store: wealth_goals");
                db.createObjectStore("wealth_goals", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("wealth_goal_links")) {
                console.log("[DB Upgrade] Creating store: wealth_goal_links");
                const s = db.createObjectStore("wealth_goal_links", { keyPath: "id" });
                s.createIndex("by_goalId", "goalId", { unique: false });
            } else {
                const s = tx.objectStore("wealth_goal_links");
                if (!s.indexNames.contains("by_goalId")) {
                    console.log("[DB Upgrade] Creating index: by_goalId on wealth_goal_links");
                    s.createIndex("by_goalId", "goalId", { unique: false });
                }
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function tx(db, storeName, mode = "readonly") {
    if (!db.objectStoreNames.contains(storeName)) {
        throw new Error(`ObjectStore '${storeName}' not found. Database might be outdated.`);
    }
    return db.transaction(storeName, mode).objectStore(storeName);
}

export function uid(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

export async function list(storeName) {
    // 20B-1: Memcache for fast reads
    const cacheKey = `list_${storeName}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const db = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const store = tx(db, storeName);
            const req = store.getAll();
            req.onsuccess = () => {
                const res = req.result || [];
                setCache(cacheKey, res); // Cache the result
                resolve(res);
            };
            req.onerror = () => reject(req.error);
        } catch (e) { reject(e); }
    });
}

export async function get(storeName, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const store = tx(db, storeName);
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        } catch (e) { reject(e); }
    });
}

export async function put(storeName, obj) {
    if (storeName === "transactions") {
        const d = obj.date || new Date().toISOString().slice(0, 10);
        obj.dateMonth = d.slice(0, 7);
    } else if (storeName === "loan_installments") {
        const d = obj.dueDate || new Date().toISOString().slice(0, 10);
        obj.dueMonth = d.slice(0, 7);
    }

    const db = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const store = tx(db, storeName, "readwrite");
            const req = store.put(obj);
            req.onsuccess = () => {
                clearCache();
                resolve(true);
            };
            req.onerror = () => reject(req.error);
        } catch (e) { reject(e); }
    });
}


export async function remove(storeName, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const store = tx(db, storeName, "readwrite");
            const req = store.delete(id);
            req.onsuccess = () => {
                clearCache();
                resolve(true);
            };
            req.onerror = () => reject(req.error);
        } catch (e) { reject(e); }
    });
}

export async function updateTransaction(id, patch) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const store = tx(db, "transactions", "readwrite");
            const req = store.get(id);
            req.onsuccess = () => {
                const data = req.result;
                if (!data) return resolve(false); // Not found

                const updated = { ...data, ...patch };
                const d = updated.date || new Date().toISOString().slice(0, 10);
                updated.dateMonth = d.slice(0, 7);

                const reqPut = store.put(updated);
                reqPut.onsuccess = () => {
                    clearCache();
                    resolve(updated);
                };
                reqPut.onerror = () => reject(reqPut.error);
            };
            req.onerror = () => reject(req.error);
        } catch (e) { reject(e); }
    });
}

export async function deleteTransaction(id) {
    return remove("transactions", id);
}

export async function deleteInvoice(cardId, invoiceMonth) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        try {
            // Use the index to find all transactions first, then delete them
            const t = db.transaction("transactions", "readwrite");
            const store = t.objectStore("transactions");
            if (!store.indexNames.contains("invoice_idx")) {
                return reject(new Error("Index invoice_idx missing"));
            }
            const index = store.index("invoice_idx");
            const range = IDBKeyRange.only([cardId, invoiceMonth]);

            let deletedCount = 0;
            const req = index.openCursor(range);

            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                }
            };

            t.oncomplete = () => {
                clearCache();
                resolve(deletedCount);
            };
            t.onerror = () => reject(t.error);
        } catch (e) { reject(e); }
    });
}

// BACKUP FUNCTIONS
export async function exportDB() {
    const db = await openDB();
    // HARDENING: Wrap with metadata for validation
    const backup = {
        meta: {
            appId: "financeapp",
            backupVersion: 1, // Current supported backup version
            createdAt: new Date().toISOString(),
            dbVersion: DB_VERSION
        },
        data: {}
    };

    const t = db.transaction(STORES, "readonly");

    // Parallel reads
    const promises = STORES.map(name => {
        return new Promise((resolve, reject) => {
            if (db.objectStoreNames.contains(name)) {
                const req = t.objectStore(name).getAll();
                req.onsuccess = () => resolve({ name, items: req.result });
                req.onerror = () => reject(req.error);
            } else {
                resolve({ name, items: [] });
            }
        });
    });

    const results = await Promise.all(promises);
    backup.meta.counts = {};
    results.forEach(r => {
        backup.data[r.name] = r.items;
        backup.meta.counts[r.name] = r.items.length;
    });

    return backup;
}

export async function clearDB() {
    // We try to clear stores appropriately, but if schema is broken, might need full delete
    const db = await openDB();
    const existingStores = STORES.filter(s => db.objectStoreNames.contains(s));

    if (existingStores.length === 0) return true;

    const t = db.transaction(existingStores, "readwrite");
    existingStores.forEach(name => t.objectStore(name).clear());
    return new Promise((resolve, reject) => {
        t.oncomplete = () => {
            clearCache();
            resolve(true);
        };
        t.onerror = () => reject(t.error);
    });
}

export async function resetDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve(true); // Proceed anyway
    });
}

export async function importDB(backupData, replace = true) {
    const db = await openDB();
    const existingStores = STORES.filter(s => db.objectStoreNames.contains(s));

    // HARDENING: Normalize Data Source
    let dataMap = null;

    // 1. New Format (Meta + Data)
    if (backupData.meta) {
        if (backupData.meta.appId !== "financeapp") {
            throw new Error("Este arquivo não é um backup do FinanceApp (parece ser de outro app). Exporte novamente em Config > Exportar.");
        }
        if ((backupData.meta.backupVersion || 0) > SUPPORTED_BACKUP_VERSION) {
            throw new Error("Este backup foi gerado por uma versão mais nova do FinanceApp e não é compatível com a versão atual. Atualize o app e tente importar novamente.");
        }
        // If valid meta, data must exist
        if (!backupData.data) throw new Error("Arquivo de backup corrompido (sem dados).");
        dataMap = backupData.data;
    }
    // 2. Legacy Format or Raw Dump
    else {
        // Validation for legacy
        const isLegacyWrapper = backupData.data && typeof backupData.data === 'object';
        const candidate = isLegacyWrapper ? backupData.data : backupData;

        if (!looksLikeFinanceAppDump(candidate)) {
            throw new Error("Este JSON não parece ser um backup do FinanceApp. Exporte em Config > Exportar e selecione o .json gerado.");
        }
        dataMap = candidate;
    }

    // Double check we have something
    if (!dataMap) {
        throw new Error("Falha ao ler dados do backup.");
    }

    const t = db.transaction(existingStores, "readwrite");

    return new Promise((resolve, reject) => {
        t.oncomplete = () => {
            clearCache();
            resolve(true);
        };
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(new Error("Falha ao importar: seus dados atuais não foram alterados. Tente novamente com um backup válido."));

        try {
            existingStores.forEach(name => {
                const store = t.objectStore(name);
                if (replace) store.clear();

                const items = dataMap[name];
                if (Array.isArray(items)) {
                    items.forEach(item => {
                        // Import Hooks for derived indices
                        if (name === "transactions") {
                            const d = item.date || new Date().toISOString().slice(0, 10);
                            item.dateMonth = d.slice(0, 7);
                        } else if (name === "loan_installments") {
                            const d = item.dueDate || new Date().toISOString().slice(0, 10);
                            item.dueMonth = d.slice(0, 7);
                        }
                        store.put(item);
                    });
                }
            });
        } catch (e) {
            t.abort();
            reject(e);
        }
    });
}

// ----------------------------------------------------
// PHASE 20B-2 DB OPTIMIZATIONS
// ----------------------------------------------------

export async function listByIndex(storeName, indexName, key) {
    // Memcache for indexes
    const cacheKey = `listIdx_${storeName}_${indexName}_${key}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const db = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const store = tx(db, storeName);
            if (!store.indexNames.contains(indexName)) {
                console.warn(`[DB] Index ${indexName} not found on ${storeName}. Fallback triggered.`);
                return resolve(null); // Signal fallback to array filter
            }

            const index = store.index(indexName);
            const req = index.getAll(IDBKeyRange.only(key));

            req.onsuccess = () => {
                const res = req.result || [];
                setCache(cacheKey, res);
                resolve(res);
            };
            req.onerror = () => {
                console.error(`[DB] Error resolving index ${indexName}:`, req.error);
                resolve(null); // Fallback
            };
        } catch (e) {
            console.error(`[DB] Exception reading index ${indexName} on ${storeName}:`, e);
            resolve(null); // Fallback
        }
    });
}

export async function runBackgroundMigrations() {
    try {
        const db = await openDB();
        const storesToMigrate = [];
        if (db.objectStoreNames.contains("transactions")) storesToMigrate.push("transactions");
        if (db.objectStoreNames.contains("loan_installments")) storesToMigrate.push("loan_installments");

        if (storesToMigrate.length === 0) return;

        let mutated = false;
        const t = db.transaction(storesToMigrate, "readwrite");

        if (storesToMigrate.includes("transactions")) {
            const reqTx = t.objectStore("transactions").openCursor();
            reqTx.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const txRec = cursor.value;
                    if (!txRec.dateMonth && txRec.date) {
                        txRec.dateMonth = txRec.date.slice(0, 7);
                        cursor.update(txRec);
                        mutated = true;
                    }
                    cursor.continue();
                }
            };
        }

        if (storesToMigrate.includes("loan_installments")) {
            const reqLoan = t.objectStore("loan_installments").openCursor();
            reqLoan.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const lRec = cursor.value;
                    if (!lRec.dueMonth && lRec.dueDate) {
                        lRec.dueMonth = lRec.dueDate.slice(0, 7);
                        cursor.update(lRec);
                        mutated = true;
                    }
                    cursor.continue();
                }
            };
        }

        t.oncomplete = () => {
            if (mutated) {
                console.log("[DB] Background schema patch applied successfully (dateMonth / dueMonth).");
                clearCache();
            }
        };
        t.onerror = (e) => {
            console.warn("[DB] Background migration failed or aborted", e);
        };

    } catch (err) {
        console.error("[DB] Background Migration Caught Exception", err);
    }
}


// INVOICE PAYMENT HELPERS
export function makeInvoiceKey(cardId, invoiceMonth) {
    return `${cardId}__${invoiceMonth}`;
}

export async function addInvoicePayment(payment) {
    if (!payment.id) payment.id = uid("inv_pay");
    return put("invoice_payments", payment);
}

export async function listInvoicePaymentsByInvoiceKey(invoiceKey) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const t = db.transaction("invoice_payments", "readonly");
            const s = t.objectStore("invoice_payments");
            const idx = s.index("by_invoiceKey");
            const req = idx.getAll(invoiceKey);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        } catch (e) { console.error(e); resolve([]); }
    });
}

export async function deleteInvoicePaymentsByInvoiceKey(invoiceKey) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const t = db.transaction("invoice_payments", "readwrite");
            const s = t.objectStore("invoice_payments");
            const idx = s.index("by_invoiceKey");
            const req = idx.openCursor(IDBKeyRange.only(invoiceKey));

            let count = 0;
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    count++;
                    cursor.continue();
                }
            };
            t.oncomplete = () => resolve(count);
            t.onerror = () => reject(t.error);
        } catch (e) { reject(e); }
    });
}

export async function deleteInvoicePayment(id) {
    return remove("invoice_payments", id);
}

// =========================================
// INVESTMENTS (Caixinhas) HELPERS
// =========================================

export async function listInvestmentBoxes() {
    return list("investment_boxes");
}

export async function putInvestmentBox(box) {
    if (!box.id) box.id = uid("invbox");
    box.updatedAt = new Date().toISOString();
    if (!box.createdAt) box.createdAt = box.updatedAt;
    return put("investment_boxes", box);
}

export async function deleteInvestmentBox(boxId) {
    // Cascade delete moves
    const db = await openDB();
    const t = db.transaction(["investment_boxes", "investment_moves"], "readwrite");
    const movesStore = t.objectStore("investment_moves");
    const boxStore = t.objectStore("investment_boxes");

    return new Promise((resolve, reject) => {
        if (!movesStore.indexNames.contains("by_boxId")) {
            return reject(new Error("Index by_boxId missing on investment_moves"));
        }
        const index = movesStore.index("by_boxId");
        const req = index.openCursor(IDBKeyRange.only(boxId));

        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            } else {
                // Done deleting moves, now delete the box
                boxStore.delete(boxId);
            }
        };

        t.oncomplete = () => {
            clearCache();
            resolve(true);
        };
        t.onerror = () => reject(t.error);
    });
}

export async function addInvestmentMove(move) {
    if (!move.id) move.id = uid("invmov");
    if (!move.createdAt) move.createdAt = new Date().toISOString();
    return put("investment_moves", move);
}

export async function deleteInvestmentMove(id) {
    return remove("investment_moves", id);
}

export async function listMovesByBoxId(boxId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const t = db.transaction("investment_moves", "readonly");
            const s = t.objectStore("investment_moves");
            if (!s.indexNames.contains("by_boxId")) {
                // Fallback to full iteration if index missing (shouldn't happen with our upgrade)
                const req = s.getAll();
                req.onsuccess = () => {
                    const all = req.result || [];
                    resolve(all.filter(m => m.boxId === boxId));
                };
                req.onerror = () => reject(req.error);
                return;
            }
            const idx = s.index("by_boxId");
            const req = idx.getAll(boxId);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        } catch (e) {
            console.error(e);
            resolve([]);
        }
    });
}

export async function computeBoxBalance(boxId) {
    const moves = await listMovesByBoxId(boxId);
    let balance = 0;
    let balanceBRL = 0; // Se houver taxas convertidas no momento do aporte/retirada

    moves.forEach(m => {
        const sign = (m.kind === "deposit" || m.kind === "yield") ? 1 : -1;
        balance += (m.amount || 0) * sign;
        balanceBRL += (m.amountBRL || 0) * sign;
    });

    return { balance, balanceBRL, moveCount: moves.length };
}

export async function computeInvestmentMonthlyReturn(accountId, month) {
    const allBoxes = await listInvestmentBoxes();
    const boxes = allBoxes.filter(b => b.accountId === accountId);

    let totalYieldBRL = 0;
    for (const box of boxes) {
        const moves = await listMovesByBoxId(box.id);
        moves.forEach(m => {
            if (m.kind === "yield" && m.date && m.date.startsWith(month)) {
                totalYieldBRL += (m.amountBRL || 0);
            }
        });
    }
    return { yieldBRL: totalYieldBRL };
}
