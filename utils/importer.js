import { list } from "../db.js?v=v2";

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
 * @property {string} rawName
 * @property {string} rawMemo
 */

function normalizeEncoding(str) {
    if (!str) return "";
    try {
        // Tenta corrigir strings que vieram como ISO-8859-1 mas foram lidas como UTF-8 (ex: SÃ£o Paulo)
        return decodeURIComponent(escape(str));
    } catch (e) {
        return str; // Fallback se já for UTF-8 válido que quebra no escape
    }
}

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

function parseMoneyBR(valStr) {
    if (typeof valStr === "number") return valStr;
    if (!valStr || valStr.toString().trim() === "") return null;

    let v = String(valStr).trim();
    v = v.replace(/[^\d.,()-]/gi, "");
    if (!v) return null;

    const isNegative = v.includes("(") || v.includes("-");
    v = v.replace(/[()-]/g, "");

    const dots = (v.match(/\./g) || []).length;
    const commas = (v.match(/,/g) || []).length;

    if (dots > 0 && commas > 0) {
        const lastComma = v.lastIndexOf(",");
        const lastDot = v.lastIndexOf(".");
        if (lastComma > lastDot) v = v.replace(/\./g, "").replace(",", ".");
        else v = v.replace(/,/g, "");
    } else if (commas === 1 && dots === 0) {
        v = v.replace(",", ".");
    } else if (commas > 1 && dots === 0) {
        v = v.replace(/,/g, "");
    } else if (dots > 1 && commas === 0) {
        v = v.replace(/\./g, "");
    } else if (dots === 0 && commas === 0) {
        if (v.length >= 3) {
            const num = parseFloat(v);
            if (num > 500) v = (num / 100).toString();
        }
    }

    const f = parseFloat(v);
    if (isNaN(f)) return null;
    return isNegative ? -f : f;
}

// =========================================
// ADAPTERS
// =========================================

const Adapters = {
    csv: async (file) => {
        return new Promise((resolve, reject) => {
            const mapRow = (r, idxMap = null) => {
                let d, desc, v;
                if (idxMap) {
                    d = Object.values(r)[idxMap.date];
                    desc = Object.values(r)[idxMap.desc];
                    v = Object.values(r)[idxMap.val];
                } else {
                    d = r.data || r.date || r.dt || r["data movimento"] || r["data da compra"] || r["date (iso)"];
                    desc = r.descricao || r.description || r.memo || r.historico || r["estabelecimento"] || r["descrição"] || "Sem descrição";
                    const amountHeaders = ["valor", "value", "amount", "price", "vl", "r$", "brl", "vlr", "total", "montante", "valorbrl", "valor_final_brl", "quantia"];
                    let last4 = null, cardName = null;
                    const l4Headers = ["cartão", "cartao", "final", "card"];
                    const nameHeaders = ["nome", "portador", "name", "titular"];
                    for (const h of l4Headers) if (r[h] !== undefined) { last4 = String(r[h]).trim(); break; }
                    for (const h of nameHeaders) if (r[h] !== undefined) { cardName = String(r[h]).trim(); break; }
                    for (const header of amountHeaders) {
                        if (r[header] !== undefined) { v = r[header]; break; }
                    }
                }
                const dateISO = normalizeDate(d);
                let parsedAmount = parseMoneyBR(v);
                if (!dateISO && parsedAmount === null) return null;

                return {
                    id: `csv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    dateISO, description: desc || "Sem descrição", amount: parsedAmount,
                    categoryId: "", subcategoryId: "", cardUsageType: "fisico",
                    payerRole: "main", selected: true, warnings: [], raw: r,
                    last4: null, cardName: null
                };
            };

            const checkZeros = (parsedRows, colsStr) => {
                if (parsedRows.length === 0) return parsedRows;
                const zeroCount = parsedRows.filter(r => r.amount === 0 || r.amount === null).length;
                if (zeroCount / parsedRows.length >= 0.8) {
                    throw new Error(`Não consegui identificar a coluna de valores com confiança. Detectei as colunas: [${colsStr}]. 80% dos valores estão zerados ou vazios. Abra o arquivo e confirme se existe coluna Valor/Amount.`);
                }
                return parsedRows;
            };

            Papa.parse(file, {
                header: true, skipEmptyLines: true, transformHeader: h => h.trim().toLowerCase(),
                complete: (results) => {
                    const rowsWithHeaders = results.data.map(r => mapRow(r)).filter(Boolean);
                    const colsStr = results.meta && results.meta.fields ? results.meta.fields.join(", ") : "N/A";
                    if (rowsWithHeaders.length > 0) {
                        try { return resolve(checkZeros(rowsWithHeaders, colsStr)); } catch (e) { console.warn(e.message); }
                    }
                    console.warn("[Importer] CSV com headers falhou. Tentando sem header.");

                    Papa.parse(file, {
                        header: false, skipEmptyLines: true,
                        complete: (res2) => {
                            if (!res2.data || res2.data.length === 0) return resolve([]);
                            const data = res2.data;
                            let bestMap = { date: 0, desc: 1, val: 2 };
                            const headerRow = data[0].map(c => String(c).toLowerCase());
                            const idxDate = headerRow.findIndex(x => x.includes("data") || x.includes("date") || x.includes("dt"));
                            const idxDesc = headerRow.findIndex(x => x.includes("desc") || x.includes("hist") || x.includes("estab"));
                            const amountKeywords = ["valor", "value", "amount", "price", "vl", "r$", "vlr", "total", "montante", "brl"];
                            let idxVal = headerRow.findIndex(x => amountKeywords.some(kw => x.includes(kw)));
                            if (idxDate > -1 && idxDesc > -1 && idxVal > -1) {
                                bestMap = { date: idxDate, desc: idxDesc, val: idxVal };
                            } else {
                                const sampleRow = data.length > 1 ? data[1] : data[0];
                                let foundMoneyCol = -1;
                                for (let c = 0; c < sampleRow.length; c++) {
                                    if (c === idxDate) continue;
                                    const cellStr = String(sampleRow[c]);
                                    if (!normalizeDate(cellStr) && /[\d]+[.,][\d]/.test(cellStr) && parseMoneyBR(cellStr) !== null) {
                                        foundMoneyCol = c; break;
                                    }
                                }
                                if (foundMoneyCol > -1) {
                                    idxVal = foundMoneyCol;
                                    const dateFallback = idxDate > -1 ? idxDate : 0;
                                    const descFallback = idxDesc > -1 ? idxDesc : (foundMoneyCol > 1 ? 1 : 0);
                                    bestMap = { date: dateFallback, desc: descFallback, val: foundMoneyCol };
                                }
                            }
                            const rowsNoHeaders = data.map((r, i) => {
                                if (i === 0 && idxDate > -1) return null;
                                return mapRow(r, bestMap);
                            }).filter(Boolean);
                            try { resolve(checkZeros(rowsNoHeaders, headerRow.join(", "))); } catch (e) { reject(e); }
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
                    let bestSheetRows = [];
                    let bestSheetName = "";

                    for (const sheetName of wb.SheetNames) {
                        const ws = wb.Sheets[sheetName];
                        const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
                        const rows = json.map(r => {
                            const keys = Object.keys(r).reduce((acc, k) => { acc[k.trim().toLowerCase()] = r[k]; return acc; }, {});
                            const dateISO = normalizeDate(keys.data || keys.date || keys.dt || keys["data da compra"]);
                            let amtRaw = keys.valor || keys.value || keys.amount || keys.price || keys.vl || keys["r$"] || keys.vlr || keys.total || keys.montante || keys["valor (brl)"];
                            let amount = parseMoneyBR(amtRaw);
                            const desc = keys.descricao || keys.description || keys.historico || keys.estabelecimento || "Sem descrição";
                            const last4 = keys.cartão || keys.cartao || keys.final || keys.card || null;
                            const cardName = keys.nome || keys.portador || keys.name || keys.titular || null;

                            if (!dateISO && amount === null) return null;
                            return {
                                id: `xlsx-${Date.now()}-${Math.random()}`, dateISO, description: desc, amount,
                                categoryId: "", subcategoryId: "", cardUsageType: "fisico", payerRole: "main",
                                selected: true, warnings: [], raw: r, cardName, last4
                            };
                        }).filter(Boolean);

                        if (rows.length > bestSheetRows.length) {
                            bestSheetRows = rows;
                            bestSheetName = sheetName;
                        }
                    }

                    if (bestSheetRows.length === 0) throw new Error(`Nenhuma aba contém colunas reconhecíveis (Data/Valor). Abas encontradas: [${wb.SheetNames.map(s => `"${s}"`).join(", ")}].`);
                    const zeroCount = bestSheetRows.filter(r => r.amount === 0 || r.amount === null).length;
                    if (bestSheetRows.length > 0 && zeroCount / bestSheetRows.length >= 0.8) throw new Error(`Na aba "${bestSheetName}", não consegui identificar a coluna de valores com confiança. (80% dos valores zerados). Abra o arquivo e confirme se existe coluna "Valor" ou "Amount".`);
                    resolve(bestSheetRows);
                } catch (err) { reject(new Error("Erro Excel: " + err.message)); }
            };
            reader.readAsArrayBuffer(file);
        });
    },
    pdf: async (file, password) => {
        try {
            const buf = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: buf, password });
            let pdf;
            try { pdf = await loadingTask.promise; } catch (err) { if (err.name === 'PasswordException') throw new Error("PASSWORD_REQUIRED"); throw err; }

            let fullText = "";
            let textItems = [];
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                content.items.forEach(item => textItems.push(item));
                fullText += content.items.map(item => item.str).join(" ") + "\n";
            }

            const linesByY = {};
            textItems.forEach(item => {
                const y = Math.round(item.transform[5]);
                if (!linesByY[y]) linesByY[y] = [];
                linesByY[y].push(item);
            });
            const sortedY = Object.keys(linesByY).sort((a, b) => b - a);
            const reconstructedLines = sortedY.map(y => {
                const lineItems = linesByY[y].sort((a, b) => a.transform[4] - b.transform[4]);
                return lineItems.map(i => i.str).join(" ");
            });

            const lines = reconstructedLines.length > 5 ? reconstructedLines : fullText.split("\n");
            const rows = [];
            const rxGeneric = /(\d{2}\/\d{2}\/\d{4})\s+(.*?)\s+(-?[\d\.,]+)$/;
            const rxNubank = /(\d{2})\s+([A-Z]{3})\s+(.*?)\s+(-?[\d\.,]+)$/;
            const rxCommon = /^(\d{2}\/\d{2})\s+(.*?)\s+(-?[\d\.,]+)$/;
            const monthMap = { JAN: "01", FEV: "02", MAR: "03", ABR: "04", MAI: "05", JUN: "06", JUL: "07", AGO: "08", SET: "09", OUT: "10", NOV: "11", DEZ: "12" };

            lines.forEach((line, i) => {
                let dateISO = null; let desc = ""; let amount = null;
                let m = line.match(rxGeneric);
                if (m) { dateISO = normalizeDate(m[1]); desc = m[2].trim(); amount = parseMoneyBR(m[3]); }
                else {
                    m = line.match(rxNubank);
                    if (m) {
                        const d = m[1]; const mon = monthMap[m[2].toUpperCase()];
                        if (mon) { dateISO = `${new Date().getFullYear()}-${mon}-${d}`; desc = m[3].trim(); amount = parseMoneyBR(m[4]); }
                    } else {
                        const m2 = line.trim().match(rxCommon);
                        if (m2) {
                            const pts = m2[1].split("/");
                            dateISO = `${new Date().getFullYear()}-${pts[1]}-${pts[0]}`; desc = m2[2].trim(); amount = parseMoneyBR(m2[3]);
                        }
                    }
                }
                if (dateISO && amount !== null && amount !== 0) {
                    rows.push({
                        id: `pdf-${i}-${Date.now()}`, dateISO, description: desc, amount,
                        categoryId: "", subcategoryId: "", cardUsageType: "fisico", payerRole: "main",
                        selected: true, warnings: [], raw: line, cardName: null, last4: null
                    });
                }
            });

            const uniqueRows = [];
            const seen = new Set();
            rows.forEach(r => {
                const dupKey = `${r.dateISO}|${r.description}|${r.amount}`;
                if (!seen.has(dupKey)) { seen.add(dupKey); uniqueRows.push(r); }
            });

            if (uniqueRows.length < 5) console.warn("[Importer] Aviso: PDF extraiu menos de 5 itens.");
            return uniqueRows;
        } catch (err) {
            if (err.name === 'PasswordException') throw new Error("PASSWORD_REQUIRED");
            throw err;
        }
    },

    ofx: async (file, options = {}) => {
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
                            // Extract Memo and Name and correct encoding
                            const rawMemo = memoMatch ? normalizeEncoding(memoMatch[1].trim()) : "";
                            const rawName = nameMatch ? normalizeEncoding(nameMatch[1].trim()) : "";

                            // Let the default description be MEMO fallback to NAME
                            const desc = rawMemo || rawName || "Extrato OFX";

                            // Deterministic hash if no FITID, including accountId if passed
                            const accountIdChunk = options.accountId ? `-acct-${options.accountId}` : "";
                            const fitid = fitMatch ? fitMatch[1].trim() : `ofx-hash-${dateISO}-${rawAmount}-${desc}${accountIdChunk}`.replace(/\s+/g, '-').substring(0, 100);

                            if (dateISO && !isNaN(rawAmount)) {
                                rows.push({
                                    id: `ofx-${i}-${Date.now()}`,
                                    dateISO,
                                    description: desc,
                                    rawName, // Keep original available
                                    rawMemo, // Keep original available
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

    qif: async (file, options = {}) => {
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
                                const accountIdChunk = options.accountId ? `-acct-${options.accountId}` : "";
                                const pseudoHash = `qif-hash-${currentDate}-${currentAmount}-${desc}${accountIdChunk}`.replace(/\s+/g, '-').substring(0, 100);

                                rows.push({
                                    id: `qif-${index}-${Date.now()}`,
                                    dateISO: currentDate,
                                    description: desc,
                                    rawName: currentPayee,
                                    rawMemo: currentMemo,
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
                                currentPayee = normalizeEncoding(val);
                                isParsingTx = true;
                            } else if (type === 'M') {
                                currentMemo = normalizeEncoding(val);
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
    async parseFile(file, options = {}) {
        const ext = file.name.split(".").pop().toLowerCase();
        let rows = [];

        if (ext === "csv") rows = await Adapters.csv(file, options);
        else if (ext === "xlsx" || ext === "xls") rows = await Adapters.xlsx(file, options);
        else if (ext === "pdf") rows = await Adapters.pdf(file, options.password);
        else if (ext === "ofx") rows = await Adapters.ofx(file, options);
        else if (ext === "qif") rows = await Adapters.qif(file, options);
        else throw new Error("Formato não suportado: " + ext);

        // Deduplication Check
        const existingTxs = await list("transactions");
        // Create lookup Map for performance: "date|amount" -> [descriptions...] and "fitid" -> true
        const lookup = new Map();
        const fitidLookup = new Set();

        existingTxs.forEach(tx => {
            if (!tx) return;
            const key = `${tx.date}|${tx.value}`;
            if (!lookup.has(key)) lookup.set(key, []);
            lookup.get(key).push((tx.description || "").toLowerCase());

            if (tx.importId) {
                fitidLookup.add(tx.importId);
            }
        });

        rows.forEach(row => {
            // Check deterministic FITID (OFX/QIF)
            if (row.fitid && fitidLookup.has(row.fitid)) {
                row.warnings.push("Duplicada exata: (ID do Extrato já importado)");
                row.selected = false; // By default, deselect duplicates!
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
