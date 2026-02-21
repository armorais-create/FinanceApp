// db.js — banco local no navegador (IndexedDB)
const DB_NAME = "financeapp";
const DB_VERSION = 24; // INCREMENTED for Phase 17A-2 (Checklist do Mês)
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
    "loan_payments",
    "loan_installments",
    "person_balances",
    "balance_events",
    "month_checklist"
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
            } else {
                const s = tx.objectStore("bills");
                if (!s.indexNames.contains("by_plan")) {
                    console.log("[DB Upgrade] Creating index: by_plan on bills");
                    s.createIndex("by_plan", "planId", { unique: false });
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
    const db = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const store = tx(db, storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
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
    const db = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const store = tx(db, storeName, "readwrite");
            const req = store.put(obj);
            req.onsuccess = () => resolve(true);
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
            req.onsuccess = () => resolve(true);
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
                const reqPut = store.put(updated);
                reqPut.onsuccess = () => resolve(updated);
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

            t.oncomplete = () => resolve(deletedCount);
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
        t.oncomplete = () => resolve(true);
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
        t.oncomplete = () => resolve(true);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(new Error("Falha ao importar: seus dados atuais não foram alterados. Tente novamente com um backup válido."));

        try {
            existingStores.forEach(name => {
                const store = t.objectStore(name);
                if (replace) store.clear();

                const items = dataMap[name];
                if (Array.isArray(items)) {
                    items.forEach(item => store.put(item));
                }
            });
        } catch (e) {
            t.abort();
            reject(e);
        }
    });
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
