import { list } from "../db.js";

// =========================================
// TYPES & UTILS
// =========================================

/**
 * @typedef {Object} ParsedTx
 * @property {string} id - Unique ID for UI key
 * @property {string} dateISO - YYYY-MM-DD
 * @property {string} description
 * @property {number} amount - Absolute value usually, or signed? Let's keep signed for import (negative=expense).
 * @property {string} categoryId
 * @property {string} subcategoryId
 * @property {string} cardUsageType - 'fisico' | 'virtual'
 * @property {string} payerRole - 'main' | 'additional'
 * @property {boolean} selected
 * @property {string[]} warnings
 * @property {Object} raw
 */

function normalizeDate(dateStr) {
    if (!dateStr) return null;
    let d = String(dateStr).trim();

    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;

    // DD/MM/YYYY or DD-MM-YYYY
    const pt = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (pt) {
        const day = pt[1].padStart(2, '0');
        const mon = pt[2].padStart(2, '0');
        let yr = pt[3];
        if (yr.length === 2) yr = `20${yr}`;
        return `${yr}-${mon}-${day}`;
    }

    // Try native
    const ts = Date.parse(d);
    if (!isNaN(ts)) return new Date(ts).toISOString().split("T")[0];

    return null;
}

function normalizeValue(valStr) {
    if (typeof valStr === "number") return valStr;
    if (!valStr) return 0;

    let v = String(valStr).trim();

    // Brazilian Format Check: "1.234,56" or "1234,56" -> comma is decimal
    // US Format: "1,234.56" -> dot is decimal

    // Heuristic: Last separator wins as decimal, unless only one type exists
    const lastComma = v.lastIndexOf(",");
    const lastDot = v.lastIndexOf(".");

    // Remove symbols
    v = v.replace(/[R$\s]/g, "");

    if (lastComma > lastDot) {
        // Assume comma as decimal (BRL/EU)
        // Remove dots (thousands)
        v = v.replace(/\./g, "");
        // Replace comma with dot
        v = v.replace(",", ".");
    } else if (lastDot > -1) {
        // Assume dot as decimal (US)
        // Remove commas
        v = v.replace(/,/g, "");
    }

    // Cleanup non-numeric (except dot and minus)
    v = v.replace(/[^\d.-]/g, "");

    const f = parseFloat(v);
    return isNaN(f) ? 0 : f;
}

// =========================================
// ADAPTERS
// =========================================

const Adapters = {
    csv: async (file) => {
        return new Promise((resolve, reject) => {
            // Helper to map raw row to ParsedTx
            const mapRow = (r, idxMap = null) => {
                let d, desc, v;

                if (idxMap) {
                    // Positional mapping
                    d = r[idxMap.date];
                    desc = r[idxMap.desc];
                    v = r[idxMap.val];
                } else {
                    // Key-based mapping (header: true)
                    // Keys are already lowercased by transformHeader
                    d = r.data || r.date || r.dt || r["data movimento"] || r["data da compra"] || r["date (iso)"];
                    desc = r.descricao || r.description || r.memo || r.historico || r["estabelecimento"] || r["descrição"] || "Sem descrição";
                    v = r.valor || r.value || r.amount || r.quantia || r["valor (brl)"];
                }

                const dateISO = normalizeDate(d);
                const amount = normalizeValue(v);

                if (!dateISO && amount === 0) return null;

                return {
                    id: `csv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    dateISO,
                    description: desc || "Sem descrição",
                    amount,
                    categoryId: "",
                    subcategoryId: "",
                    cardUsageType: "fisico",
                    payerRole: "main",
                    selected: true,
                    warnings: [],
                    raw: r
                };
            };

            // 1. Try with Headers
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                transformHeader: h => h.trim().toLowerCase(),
                complete: (results) => {
                    const rowsWithHeaders = results.data.map(r => mapRow(r)).filter(Boolean);

                    if (rowsWithHeaders.length > 0) {
                        return resolve(rowsWithHeaders);
                    }

                    console.warn("[Importer] CSV with headers yielded 0 rows. Retrying without headers.");

                    // 2. Fallback: No Headers
                    Papa.parse(file, {
                        header: false,
                        skipEmptyLines: true,
                        complete: (res2) => {
                            if (!res2.data || res2.data.length === 0) {
                                return resolve([]);
                            }

                            const data = res2.data; // Array of arrays
                            // Heuristic to find columns in first 5 rows
                            let bestMap = { date: 0, desc: 1, val: 2 }; // Default defaults

                            // Scan first row for keywords
                            const headerRow = data[0].map(c => String(c).toLowerCase());
                            const idxDate = headerRow.findIndex(x => x.includes("data") || x.includes("date") || x.includes("dt"));
                            const idxDesc = headerRow.findIndex(x => x.includes("desc") || x.includes("hist") || x.includes("estab"));
                            const idxVal = headerRow.findIndex(x => x.includes("valor") || x.includes("value") || x.includes("amount") || x.includes("brl"));

                            if (idxDate > -1 && idxDesc > -1 && idxVal > -1) {
                                bestMap = { date: idxDate, desc: idxDesc, val: idxVal };
                            }

                            const rowsNoHeaders = data.map((r, i) => {
                                // Skip "header" row if we found keywords in it
                                if (i === 0 && idxDate > -1) return null;
                                return mapRow(r, bestMap);
                            }).filter(Boolean);

                            resolve(rowsNoHeaders);
                        },
                        error: (err) => reject(new Error("Erro CSV fallback: " + err.message))
                    });
                },
                error: (err) => reject(new Error("Erro CSV: " + err.message))
            });
        });
    },

    xlsx: async (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const wb = XLSX.read(data, { type: 'array' });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const json = XLSX.utils.sheet_to_json(ws, { defval: "" }); // defval ensures empty cells exist

                    const rows = json.map(r => {
                        // Normalize keys
                        const keys = Object.keys(r).reduce((acc, k) => {
                            acc[k.trim().toLowerCase()] = r[k];
                            return acc;
                        }, {});

                        const dateISO = normalizeDate(keys.data || keys.date || keys.dt);
                        const amount = normalizeValue(keys.valor || keys.value || keys.amount);
                        const desc = keys.descricao || keys.description || keys.historico || "Sem descrição";

                        if (!dateISO && amount === 0) return null;

                        return {
                            id: `xlsx-${Date.now()}-${Math.random()}`,
                            dateISO,
                            description: desc,
                            amount,
                            categoryId: "",
                            subcategoryId: "",
                            cardUsageType: "fisico",
                            payerRole: "main",
                            selected: true,
                            warnings: [],
                            raw: r
                        };
                    }).filter(Boolean);

                    resolve(rows);
                } catch (err) {
                    reject(new Error("Erro Excel: " + err.message));
                }
            };
            reader.readAsArrayBuffer(file);
        });
    },

    pdf: async (file, password) => {
        // PDF Implementation is complex and depends on format.
        // We will do a generic text extraction and regex search as established previously.
        // Re-using the logic from before but standardizing output.
        try {
            const buf = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: buf, password });
            const pdf = await loadingTask.promise;

            let fullText = "";
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                fullText += content.items.map(item => item.str).join(" ") + "\n";
            }

            const lines = fullText.split("\n");
            const rows = [];

            // Regexes
            const rxGeneric = /(\d{2}\/\d{2}\/\d{4})\s+(.*?)\s+(-?[\d\.,]+)$/; // DD/MM/YYYY
            const rxNubank = /(\d{2})\s+([A-Z]{3})\s+(.*?)\s+(-?[\d\.,]+)$/; // DD MMM
            const monthMap = { JAN: "01", FEV: "02", MAR: "03", ABR: "04", MAI: "05", JUN: "06", JUL: "07", AGO: "08", SET: "09", OUT: "10", NOV: "11", DEZ: "12" };

            lines.forEach((line, i) => {
                let dateISO = null;
                let desc = "";
                let amount = 0;

                let m = line.match(rxGeneric);
                if (m) {
                    dateISO = normalizeDate(m[1]);
                    desc = m[2].trim();
                    amount = normalizeValue(m[3]);
                } else {
                    m = line.match(rxNubank);
                    if (m) {
                        const d = m[1];
                        const mon = monthMap[m[2].toUpperCase()];
                        if (mon) {
                            const year = new Date().getFullYear(); // infer?
                            dateISO = `${year}-${mon}-${d}`;
                            desc = m[3].trim();
                            amount = normalizeValue(m[4]);
                        }
                    }
                }

                if (dateISO) {
                    rows.push({
                        id: `pdf-${i}-${Date.now()}`,
                        dateISO,
                        description: desc,
                        amount,
                        categoryId: "",
                        subcategoryId: "",
                        cardUsageType: "fisico",
                        payerRole: "main",
                        selected: true,
                        warnings: [],
                        raw: line
                    });
                }
            });

            return rows;
        } catch (err) {
            if (err.name === 'PasswordException') throw new Error("PASSWORD_REQUIRED");
            throw err;
        }
    },

    ofx: async (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const content = e.target.result;
                    const rows = [];
                    let defaultCurrency = "BRL";

                    // Extract default currency if present
                    const curMatch = content.match(/<CURDEF>([A-Z]{3})/i);
                    if (curMatch) defaultCurrency = curMatch[1].toUpperCase();

                    // Split into transactions
                    const stmts = content.split(/<STMTTRN>/i);

                    // The first split chunk is header info before the first <STMTTRN>
                    for (let i = 1; i < stmts.length; i++) {
                        const block = stmts[i];

                        // Stop reading this block at </STMTTRN> if it's there
                        const txnData = block.split(/<\/STMTTRN>/i)[0];

                        // Extract fields
                        const dtMatch = txnData.match(/<DTPOSTED>([^<]+)/i);
                        const trnMatch = txnData.match(/<TRNAMT>([^<]+)/i);
                        const fitMatch = txnData.match(/<FITID>([^<]+)/i);
                        const nameMatch = txnData.match(/<NAME>([^<]+)/i);
                        const memoMatch = txnData.match(/<MEMO>([^<]+)/i);

                        if (dtMatch && trnMatch) {
                            let rawDate = dtMatch[1].trim();
                            // OFX date is usually YYYYMMDD or YYYYMMDDHHMMSS
                            let dateISO = null;
                            if (rawDate.length >= 8) {
                                dateISO = `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)}`;
                            }

                            const rawAmount = parseFloat(trnMatch[1].trim());
                            const fitid = fitMatch ? fitMatch[1].trim() : `ofx-${Date.now()}-${Math.random()}`;

                            // Prefer MEMO if available, then NAME
                            const memo = memoMatch ? memoMatch[1].trim() : "";
                            const name = nameMatch ? nameMatch[1].trim() : "";
                            const desc = memo || name || "Extrato OFX";

                            if (dateISO && !isNaN(rawAmount)) {
                                rows.push({
                                    id: `ofx-${i}-${Date.now()}`,
                                    dateISO,
                                    description: desc,
                                    amount: rawAmount, // Keep sign!
                                    currency: defaultCurrency,
                                    fitid: fitid,
                                    categoryId: "",
                                    subcategoryId: "",
                                    selected: true,
                                    warnings: [],
                                    raw: txnData
                                });
                            }
                        }
                    }

                    resolve(rows);
                } catch (err) {
                    reject(new Error("Erro OFX: " + err.message));
                }
            };
            reader.readAsText(file); // Assume standard or ISO-8859 parsing works, wait usually ISO-8859-1 for OFX but let's see. You can try Windows-1252 or utf-8.
        });
    },

    qif: async (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const content = e.target.result;
                    const lines = content.split('\n');
                    const rows = [];

                    let currentDate = null;
                    let currentAmount = 0;
                    let currentPayee = "";
                    let currentMemo = "";
                    let isParsingTx = false;

                    lines.forEach((line, index) => {
                        const str = line.trim();
                        if (!str) return;

                        if (str.startsWith('^')) {
                            // End of transaction block
                            if (isParsingTx && currentDate) {
                                const desc = currentMemo || currentPayee || "Extrato QIF";
                                // Hash if no FITID
                                const pseudoHash = `qif-${currentDate}-${currentAmount}-${desc}`.replace(/\s+/g, '-');

                                rows.push({
                                    id: `qif-${index}-${Date.now()}`,
                                    dateISO: currentDate,
                                    description: desc,
                                    amount: currentAmount,
                                    currency: "BRL", // QIF rarely has currency inline reliably
                                    fitid: pseudoHash,
                                    categoryId: "",
                                    subcategoryId: "",
                                    selected: true,
                                    warnings: [],
                                    raw: str
                                });
                            }
                            // reset
                            currentDate = null;
                            currentAmount = 0;
                            currentPayee = "";
                            currentMemo = "";
                            isParsingTx = false;
                        } else {
                            // First character is the type
                            const type = str[0];
                            const val = str.substring(1).trim();

                            if (type === 'D') {
                                // Date can be MM/DD/YYYY or DD/MM/YYYY or MM/DD'YY
                                // QIF dates are notorious. Let's try normalizeDate.
                                currentDate = normalizeDate(val);
                                isParsingTx = true;
                            } else if (type === 'T' || type === 'U') {
                                currentAmount = parseFloat(val.replace(',', '')); // Assume dot decimal in QIF
                                if (isNaN(currentAmount)) currentAmount = 0;
                                isParsingTx = true;
                            } else if (type === 'P') {
                                currentPayee = val;
                                isParsingTx = true;
                            } else if (type === 'M') {
                                currentMemo = val;
                                isParsingTx = true;
                            }
                        }
                    });

                    resolve(rows);
                } catch (err) {
                    reject(new Error("Erro QIF: " + err.message));
                }
            };
            reader.readAsText(file); // Or ISO-8859-1 depending on charset
        });
    }
};

// =========================================
// MAIN EXPORT
// =========================================

export const importer = {
    async parseFile(file, password = "") {
        const ext = file.name.split(".").pop().toLowerCase();
        let rows = [];

        if (ext === "csv") rows = await Adapters.csv(file);
        else if (ext === "xlsx" || ext === "xls") rows = await Adapters.xlsx(file);
        else if (ext === "pdf") rows = await Adapters.pdf(file, password);
        else if (ext === "ofx") rows = await Adapters.ofx(file);
        else if (ext === "qif") rows = await Adapters.qif(file);
        else throw new Error("Formato não suportado: " + ext);

        // Deduplication Check
        const existingTxs = await list("transactions");
        // Create lookup Map for performance: "date|amount" -> [descriptions...] and "fitid" -> true
        const lookup = new Map();
        const fitidLookup = new Set();

        existingTxs.forEach(tx => {
            const key = `${tx.date}|${tx.value}`;
            if (!lookup.has(key)) lookup.set(key, []);
            lookup.get(key).push(tx.description.toLowerCase());

            if (tx.importId) {
                fitidLookup.add(tx.importId);
            }
        });

        rows.forEach(row => {
            // Check deterministic FITID (OFX/QIF)
            if (row.fitid && fitidLookup.has(row.fitid)) {
                row.warnings.push("Duplicada exata: (ID do Extrato já importado)");
                // We don't automatically deselect here so the user can see it, but we could!
            } else {
                // Fallback heuristic deduplication for CSV/PDF
                const key = `${row.dateISO}|${row.amount}`;
                if (lookup.has(key)) {
                    row.warnings.push("Possível duplicata (valor e data coincidem)");
                }
            }
        });

        return { rows };
    }
};
