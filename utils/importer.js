import { list, get } from "../db.js?v=v2";

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

    // Remove any trailing times first
    if (d.includes(" ")) d = d.split(" ")[0];

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

    // Attempt M/D formats or generic
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

function normalizeHeader(str) {
    if (!str) return "";
    let s = String(str).trim().toLowerCase();
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Remove accents
    s = s.replace(/[^\w\s]/gi, ''); // Remove punctuation
    return s.trim();
}

const DICT = {
    date: ['data', 'date', 'dt', 'data compra', 'transaction date', 'posted date', 'lancamento em', 'emissao'],
    desc: ['descricao', 'historico', 'lancamento', 'lancamentos', 'transacao', 'transacoes', 'memo', 'payee', 'estabelecimento', 'detalhe', 'detalhes', 'documento', 'narrative', 'desc'],
    val: ['valor', 'amount', 'total', 'vl', 'valor r', 'valor usd', 'quantia'],
    debit: ['debito', 'saida', 'debit'],
    credit: ['credito', 'entrada', 'credit'],
    last4: ['cartao', 'final', 'card'],
    name: ['nome', 'portador', 'name', "titular"]
};

// =========================================
// HEURISTICS & CONFIDENCE SCORING
// =========================================

/**
 * Validates a normalized transaction object and returns a confidence score (0-100).
 * Highly penalizes missing dates or amounts, and penalizes descriptions that are just times.
 */
function calculateConfidence(tx) {
    if (!tx) return 0;
    let score = 0;

    // Date validity (+40)
    if (tx.dateISO) score += 40;

    // Amount validity (+40)
    if (tx.amount !== null && !isNaN(tx.amount)) {
        score += 40;
    }

    // Description validity (+20 or penalty)
    const desc = (tx.description || "").trim();
    const isTimeRegex = /^(\d{1,2}:\d{2}(:\d{2})?(\s?[APM]{2})?)$/i;
    const isNumberOrValueRegex = /^-?(?:R\$|\$)?\s?[\d.,]+$/i;

    if (desc && desc !== "Sem descrição") {
        if (isTimeRegex.test(desc)) {
            // penalty enforced via cap
        } else if (isNumberOrValueRegex.test(desc)) {
            // penalty enforced via cap
        } else if (/[a-zA-Z]{3,}/.test(desc)) {
            score += 20;
        } else if (/[a-zA-Z]/.test(desc)) {
            score += 10;
        } else {
            score += 5;
        }
    }

    if (!desc || desc === "Sem descrição") {
        score = Math.min(40, score);
    } else if (isTimeRegex.test(desc) || isNumberOrValueRegex.test(desc)) {
        score = Math.min(30, score);
    }

    // Clamp score 0-100
    return Math.max(0, Math.min(100, score));
}

/**
 * Attempts to extract Date, Amount, and Description from a raw string line using pure heuristics.
 * Returns { dateISO, amount, description }
 */
function extractLineHeuristics(lineStr) {
    if (!lineStr) return { dateISO: null, amount: null, description: "Linha vazia" };

    let rawStr = lineStr.trim();
    let dateISO = null;
    let amount = null;
    let description = "";

    // 1. Extract Date: Look for dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, or dd/mm
    const dateRegexes = [
        /\b(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})\b/, // DD/MM/YYYY
        /\b(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})\b/, // YYYY-MM-DD
        /^\b(\d{1,2})[\/\-\.](\d{1,2})\b/            // DD/MM (start of line)
    ];

    let dateMatchRaw = null;
    // We try normalizeDate on tokens as a fallback if regex is weak
    const tokens = rawStr.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
        const potentialDate = normalizeDate(tokens[i]);
        if (potentialDate) {
            dateISO = potentialDate;
            dateMatchRaw = tokens[i];
            break;
        }
    }

    // Remove the extracted date from the string to ease further parsing
    if (dateMatchRaw) {
        rawStr = rawStr.replace(dateMatchRaw, "").trim();
    }

    // 2. Extract Amount: Look for numbers with currency/signal indicators or just the last/first valid number
    // To be safe, look for R$, $, -, +, or the last numeric token
    const remainingTokens = rawStr.split(/\s+/).filter(Boolean);
    let amountMatchRaw = null;

    // Reverse scan is often best for amounts at the end of lines
    for (let i = remainingTokens.length - 1; i >= 0; i--) {
        const t = remainingTokens[i];
        // Must contain digits. Might contain , or .
        if (/[\d]+[.,]?[\d]*/.test(t)) {
            const parsed = parseMoneyBR(t);
            // Ignore things that parse as money but are clearly times or dates that slipped through (e.g. 18:46 shouldn't be parsed normally by parseMoneyBR but just in case)
            if (parsed !== null && !/^(\d{1,2}:\d{2}(:\d{2})?)$/.test(t)) {

                // If the immediate previous token is a sign, incorporate it
                if (i > 0 && (remainingTokens[i - 1] === '-' || remainingTokens[i - 1] === 'R$' || remainingTokens[i - 1] === '$')) {
                    if (remainingTokens[i - 1] === '-') {
                        amountMatchRaw = "-" + t;
                        amount = -Math.abs(parsed);
                    } else {
                        // R$ 10,00 -> we found 10,00.
                        amountMatchRaw = remainingTokens[i - 1] + " " + t;
                        amount = parsed;
                        // check if sign is further back e.g. - R$ 10,00
                        if (i > 1 && remainingTokens[i - 2] === '-') {
                            amountMatchRaw = "-" + amountMatchRaw;
                            amount = -Math.abs(amount);
                        }
                    }
                } else if (t.startsWith('-')) {
                    amountMatchRaw = t;
                    amount = parsed; // parseMoneyBR handles the negative
                } else {
                    amountMatchRaw = t;
                    amount = parsed;
                }
                break;
            }
        }
    }

    if (amountMatchRaw) {
        rawStr = rawStr.replace(amountMatchRaw, "").trim();
    }

    // 3. Extract Description: The rest of the string, stripped of times and noise
    // Remove standalone time formats (HH:MM or HH:MM:SS) if they exist
    rawStr = rawStr.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "").trim();

    // Clean up multiple spaces and lingering isolated negative signs or currency signs
    rawStr = rawStr.replace(/^(?:R\$|\$|-|\+)/, "").trim();
    rawStr = rawStr.replace(/\s+/g, " ");

    if (/^-?(?:R\$|\$)?\s?[\d.,]+$/i.test(rawStr)) {
        rawStr = "";
    }

    description = rawStr || "Sem descrição";

    return { dateISO, amount, description };
}

// =========================================
// TRANSACTION SCORER (PDF / RAW LINES)
// =========================================

/**
 * Scores a line based on how likely it is to be a transaction.
 * Useful for sampling manual lines out of PDFs.
 */
function txnScore(lineStr) {
    if (!lineStr || typeof lineStr !== 'string') return -10;

    let str = lineStr.trim();
    if (str.length < 8) return -5;

    let score = 0;

    const hasDate = /\b(\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d{4}-\d{2}-\d{2})\b/.test(str);
    const hasTime = /\b(\d{1,2}:\d{2}(:\d{2})?)\b/.test(str);
    const hasMoney = /([R$U$€£]?\s*[-–]?\s*\d{1,3}([.,]\d{3})*([.,]\d{2})|\b[-–]?\d+([.,]\d{2})\b)/.test(str);
    const hasLetters = /[A-Za-zÀ-ÿ]/.test(str);

    if (hasDate) score += 3;
    if (hasMoney) score += 2;
    if (hasLetters) score += 1;

    // Penalties for obvious headers
    const headerWords = /\b(cliente|cpf|endereço|saldo|período|banco|cartão final|extrato|agência|conta)\b/i;
    if (headerWords.test(str)) {
        score -= 3;
    }

    // Only Date/Time/Money but NO letters? Usually means it matched some column alignment garbage but is technically parseable
    if ((hasDate || hasTime) && hasMoney && !hasLetters) {
        score -= 2;
    }

    // If it lacks both money and dates entirely, it's definitely just description/header text
    if (!hasDate && !hasMoney) {
        score -= 4;
    }

    return score;
}

// =========================================
// SHARED TABLE PROCESSING (CSV, XLSX)
// =========================================
async function processTableData(data, options, fileType) {
    if (!data || data.length === 0) return [];

    // Assume first row is header
    const rawHeaders = data[0];
    const normHeaders = rawHeaders.map(h => normalizeHeader(h));
    const headerHash = normHeaders.join("|");

    // 1. Check Saved Mapping
    let mapConf = null; // { idxDate, idxDesc, idxVal, idxDebit, idxCredit }

    // Explicit UI Override
    if (options.forceMapping) {
        return { mappingRequired: true, headers: rawHeaders, samples: data.slice(1, 4), hash: headerHash, fileType };
    }

    if (options.importType) {
        try {
            const saved = await get("settings", `import_mapping_${options.importType}_${headerHash}`);
            if (saved && saved.value) mapConf = saved.value;
        } catch (e) { }
    }

    // 2. Try Dictionary Mapping
    if (!mapConf) {
        mapConf = { idxDate: -1, idxDesc: -1, idxVal: -1, idxDebit: -1, idxCredit: -1, idxLast4: -1, idxName: -1 };
        normHeaders.forEach((h, i) => {
            if (DICT.date.includes(h)) mapConf.idxDate = i;
            else if (DICT.desc.includes(h)) mapConf.idxDesc = i;
            else if (DICT.val.includes(h)) mapConf.idxVal = i;
            else if (DICT.debit.includes(h)) mapConf.idxDebit = i;
            else if (DICT.credit.includes(h)) mapConf.idxCredit = i;
            else if (DICT.last4.includes(h)) mapConf.idxLast4 = i;
            else if (DICT.name.includes(h)) mapConf.idxName = i;
        });

        if (mapConf.idxDate > -1 && mapConf.idxDesc > -1 && (mapConf.idxVal > -1 || (mapConf.idxDebit > -1 || mapConf.idxCredit > -1))) {
            // Good enough!
        } else {
            // 3. Fallback Heuristics
            const sampleRow = data.length > 1 ? data[1] : data[0];
            let foundMoneyCol = -1;
            let foundDateCol = mapConf.idxDate;
            let foundDescCol = mapConf.idxDesc;

            if (foundDateCol === -1) {
                foundDateCol = sampleRow.findIndex(cell => normalizeDate(String(cell)) !== null);
            }

            if (mapConf.idxVal === -1 && mapConf.idxDebit === -1 && mapConf.idxCredit === -1) {
                for (let c = 0; c < sampleRow.length; c++) {
                    if (c === foundDateCol) continue;
                    const cellStr = String(sampleRow[c]);
                    if (parseMoneyBR(cellStr) !== null && /[\d]+[.,]?[\d]*/.test(cellStr)) {
                        foundMoneyCol = c; break;
                    }
                }
            }

            if (foundDescCol === -1) {
                // Find longest string that is not money and not date
                let bestC = -1, maxL = 0;
                for (let c = 0; c < sampleRow.length; c++) {
                    if (c === foundDateCol || c === foundMoneyCol) continue;
                    const l = String(sampleRow[c]).length;
                    if (l > maxL) { maxL = l; bestC = c; }
                }
                foundDescCol = bestC;
            }

            if (foundDateCol > -1 && foundDescCol > -1 && (foundMoneyCol > -1 || mapConf.idxVal > -1)) {
                mapConf.idxDate = foundDateCol;
                mapConf.idxDesc = foundDescCol;
                if (foundMoneyCol > -1) mapConf.idxVal = foundMoneyCol;
            } else {
                mapConf = null;
            }
        }
    }

    // Apply mapping or heuristics per row
    const rows = data.map((r, i) => {
        if (i === 0) return null; // Skip header

        const rawLine = r.join(" ");
        if (!rawLine.trim()) return null;

        let bestTx = null;
        let bestScore = -1;

        // 1. Try Heuristics
        const heurRaw = extractLineHeuristics(rawLine);
        const heurTx = {
            id: `${fileType}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            dateISO: heurRaw.dateISO,
            description: heurRaw.description,
            amount: heurRaw.amount,
            currency: "BRL",
            categoryId: "", subcategoryId: "", cardUsageType: "fisico",
            payerRole: "main", selected: true, warnings: [], raw: r,
            last4: null, cardName: null, sourceType: fileType
        };
        const heurScore = calculateConfidence(heurTx);
        bestTx = heurTx;
        bestScore = heurScore;

        // 2. Try Positional Map if available
        if (mapConf) {
            const d = mapConf.idxDate > -1 ? r[mapConf.idxDate] : null;
            const desc = mapConf.idxDesc > -1 ? r[mapConf.idxDesc] : "Sem descrição";
            let v;
            if (mapConf.idxVal > -1) v = r[mapConf.idxVal];
            else {
                let valD = mapConf.idxDebit > -1 ? r[mapConf.idxDebit] : undefined;
                let valC = mapConf.idxCredit > -1 ? r[mapConf.idxCredit] : undefined;
                if (valD && parseMoneyBR(valD) !== null) v = `-${Math.abs(parseMoneyBR(valD))}`;
                else if (valC && parseMoneyBR(valC) !== null) v = `${Math.abs(parseMoneyBR(valC))}`;
            }

            const dateISO = normalizeDate(d);
            let parsedAmount = parseMoneyBR(v);

            let last4 = mapConf.idxLast4 > -1 ? r[mapConf.idxLast4] : null;
            let cardName = mapConf.idxName > -1 ? r[mapConf.idxName] : null;

            const mapTx = {
                id: heurTx.id,
                dateISO, description: desc || "Sem descrição", amount: parsedAmount,
                currency: "BRL",
                categoryId: "", subcategoryId: "", cardUsageType: "fisico",
                payerRole: "main", selected: true, warnings: [], raw: r,
                last4, cardName, sourceType: fileType
            };

            const mapScore = calculateConfidence(mapTx);
            if (mapScore > bestScore || (mapScore === bestScore && mapScore > 0)) {
                bestTx = mapTx;
                bestScore = mapScore;
            }
        }

        bestTx.confidence = bestScore;

        // Only return if it extracted something remotely useful
        if (bestTx.dateISO || bestTx.amount !== null) {
            return bestTx;
        }
        return null;
    }).filter(Boolean);

    if (rows.length > 0) {
        // If more than 50% of the rows have poor confidence (<40) or amount=0, it's a bad parse
        const badCount = rows.filter(r => r.confidence < 40 || r.amount === 0 || r.amount === null).length;
        if (badCount / rows.length >= 0.5) {
            return { mappingRequired: true, headers: rawHeaders, samples: data.slice(1, 4), hash: headerHash, fileType };
        }
    } else {
        return { mappingRequired: true, headers: rawHeaders, samples: data.slice(1, 4), hash: headerHash, fileType };
    }

    return rows;
}

// =========================================
// ADAPTERS
// =========================================

const Adapters = {
    csv: async (file, options = {}) => {
        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header: false, skipEmptyLines: true,
                complete: async (results) => {
                    try {
                        const result = await processTableData(results.data, options, 'csv');
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                },
                error: (err) => reject(new Error("Erro CSV: " + err.message))
            });
        });
    },
    xlsx: async (file, options = {}) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const wb = XLSX.read(data, { type: 'array' });
                    let bestSheetRows = [];
                    let mappingRequiredInfo = null;

                    for (const sheetName of wb.SheetNames) {
                        const ws = wb.Sheets[sheetName];
                        // Convert sheet to array of arrays (like CSV)
                        const rowsArray = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
                        if (rowsArray.length < 2) continue; // Skip empty sheets

                        const result = await processTableData(rowsArray, options, 'xlsx');

                        // Error fallback / Map request
                        if (result && result.mappingRequired) {
                            if (!mappingRequiredInfo) mappingRequiredInfo = result;
                            continue;
                        }

                        if (result && Array.isArray(result) && result.length > bestSheetRows.length) {
                            bestSheetRows = result;
                        }
                    }

                    if (bestSheetRows.length > 0) {
                        resolve(bestSheetRows);
                    } else if (mappingRequiredInfo) {
                        resolve(mappingRequiredInfo);
                    } else {
                        throw new Error(`Nenhuma aba contém colunas reconhecíveis (Data/Valor). Abas encontradas: [${wb.SheetNames.map(s => `"${s}"`).join(", ")}].`);
                    }
                } catch (err) { reject(new Error("Erro Excel: " + err.message)); }
            };
            reader.readAsArrayBuffer(file);
        });
    },
    pdf: async (file, options = {}) => {
        const password = options.password;
        try {
            const buf = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: buf, password });
            let pdf;
            try { pdf = await loadingTask.promise; } catch (err) { if (err.name === 'PasswordException') throw new Error("PASSWORD_REQUIRED"); throw err; }

            let fullText = "";
            const pagesLines = [];

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();

                const linesByY = {};
                content.items.forEach(item => {
                    const y = Math.round(item.transform[5]);
                    if (!linesByY[y]) linesByY[y] = [];
                    linesByY[y].push(item);
                });

                const sortedY = Object.keys(linesByY).sort((a, b) => b - a);
                const reconstructedLines = sortedY.map(y => {
                    const lineItems = linesByY[y].sort((a, b) => a.transform[4] - b.transform[4]);
                    return lineItems.map(item => item.str).join(" ");
                });

                pagesLines.push(...reconstructedLines);
                fullText += reconstructedLines.join("\n") + "\n";
            }

            const lines = pagesLines.length > 5 ? pagesLines : fullText.split("\n");
            const rows = [];
            const rxGeneric = /(\d{2}\/\d{2}\/\d{4})\s+(.*?)\s+(-?[\d.,]+)$/;
            const rxNubank = /(\d{2})\s+([A-Z]{3})\s+(.*?)\s+(-?[\d.,]+)$/;
            const rxCommon = /^(\d{2}\/\d{2})\s+(.*?)\s+(-?[\d.,]+)$/;
            const rxBankStmt = /^(\d{2}\/\d{2})\s+(.*?)\s+([\d.,]+)\s+(D|C|-|\+)(?:\s+[\d.,]+)?$/i; // Data, Desc, Valor, D/C
            const monthMap = { JAN: "01", FEV: "02", MAR: "03", ABR: "04", MAI: "05", JUN: "06", JUL: "07", AGO: "08", SET: "09", OUT: "10", NOV: "11", DEZ: "12" };

            // Check if there is an explicit strategy from a manual mapping step for PDF
            const mapStrategy = options.pdfStrategy || null;
            if (options.forceMapping) {
                const candidates = lines.map(line => ({ line, score: txnScore(line) })).filter(x => x.score >= 0);
                candidates.sort((a, b) => b.score - a.score);

                const topTxLines = candidates.slice(0, 15).map(c => c.line);
                const headerLines = lines.filter(l => l.trim() !== '' && !topTxLines.includes(l)).slice(0, 5);

                return {
                    mappingRequired: true,
                    fileType: 'pdf',
                    samples: topTxLines.length > 0 ? topTxLines : lines.slice(0, 10),
                    headerSamples: headerLines,
                    isImageOrEmpty: topTxLines.length === 0,
                    headers: [],
                    hash: 'pdf',
                    rawLines: lines
                };
            }

            lines.forEach((lineStr, i) => {
                const rawLine = lineStr.trim();
                if (!rawLine) return;

                let bestScore = -1;
                let bestObj = { dateISO: null, description: "", amount: null };

                if (mapStrategy) {
                    // Manual strategy
                    let heurTx = extractLineHeuristics(rawLine); // gets date/amount
                    let desc = heurTx.description;
                    if (mapStrategy === "after_compra") {
                        const match = rawLine.match(/(?:compra|pagamento|recebimento)\s+(.*)/i);
                        if (match) desc = match[1].trim();
                    } else if (mapStrategy === "left_of_value") {
                        desc = heurTx.description; // heuristic fallback usually gets this right
                    } else if (mapStrategy === "largest_letters") {
                        const parts = rawLine.split(/\s+/).filter(p => /[A-Za-z]/.test(p));
                        desc = parts.join(" ");
                    }
                    bestObj = { ...heurTx, description: desc };
                    bestScore = calculateConfidence(bestObj);
                } else {
                    // 1. Try heuristic extraction
                    let heurTx = extractLineHeuristics(rawLine);
                    bestScore = calculateConfidence(heurTx);
                    bestObj = { ...heurTx };

                    // 2. Positional Fallback if heuristics aren't confident enough
                    if (bestScore < 40) {
                        let dateISO = null; let desc = ""; let amount = null;
                        let m = rawLine.match(rxBankStmt);
                        if (m) {
                            const pts = m[1].split("/");
                            dateISO = `${new Date().getFullYear()}-${pts[1]}-${pts[0]}`;
                            desc = m[2].trim();
                            amount = parseMoneyBR(m[3]);
                            const signStr = m[4].toUpperCase();
                            if (signStr === 'D' || signStr === '-') {
                                amount = -Math.abs(amount);
                            } else if (signStr === 'C' || signStr === '+') {
                                amount = Math.abs(amount);
                            }
                        } else {
                            m = rawLine.match(rxGeneric);
                            if (m) { dateISO = normalizeDate(m[1]); desc = m[2].trim(); amount = parseMoneyBR(m[3]); }
                            else {
                                m = rawLine.match(rxNubank);
                                if (m) {
                                    const d = m[1]; const mon = monthMap[m[2].toUpperCase()];
                                    if (mon) { dateISO = `${new Date().getFullYear()}-${mon}-${d}`; desc = m[3].trim(); amount = parseMoneyBR(m[4]); }
                                } else {
                                    const m2 = rawLine.match(rxCommon);
                                    if (m2) {
                                        const pts = m2[1].split("/");
                                        dateISO = `${new Date().getFullYear()}-${pts[1]}-${pts[0]}`; desc = m2[2].trim(); amount = parseMoneyBR(m2[3]);
                                    }
                                }
                            }
                        }

                        const posTx = { dateISO, description: desc, amount };
                        const posScore = calculateConfidence(posTx);

                        if (posScore > bestScore) {
                            bestScore = posScore;
                            bestObj = posTx;
                        }
                    }
                } // This closes the if (mapStrategy) {} else {} block

                if (bestObj.dateISO && bestObj.amount !== null && bestObj.amount !== 0) {
                    rows.push({
                        id: `pdf-${i}-${Date.now()}`,
                        dateISO: bestObj.dateISO,
                        description: bestObj.description,
                        amount: bestObj.amount,
                        currency: 'BRL',
                        categoryId: "", subcategoryId: "", cardUsageType: "fisico", payerRole: "main",
                        selected: true, warnings: [], raw: rawLine, cardName: null, last4: null,
                        confidence: bestScore, sourceType: 'pdf'
                    });
                }
            });

            const uniqueRows = [];
            const seen = new Set();
            rows.forEach(r => {
                const dupKey = `${r.dateISO}|${r.description}|${r.amount}`;
                if (!seen.has(dupKey)) { seen.add(dupKey); uniqueRows.push(r); }
            });

            if (uniqueRows.length < 5) {
                console.warn("[Importer] Aviso: PDF extraiu menos de 5 itens.");
                uniqueRows.extractionWarning = "⚠️ A extração de PDF pode ser imprecisa para este banco. Por favor, revise os valores com atenção ou prefira o formato OFX/CSV.";
            } else {
                uniqueRows.extractionWarning = "Extração de PDF realizada. Revise os sinais (positivo/negativo) com atenção, pois variam entre bancos.";
            }

            // Auto-trigger manual mode for PDF
            if (!mapStrategy) {
                const total = uniqueRows.length;
                if (total > 0) {
                    const badDescCount = uniqueRows.filter(r => !r.description || r.description === "Sem descrição" || /^-?(?:R\$|\$)?\s?[\d.,]+$/i.test(r.description)).length;
                    // Strict confidence threshold trigger: Any description that doesn't have letters drops to confidence <=40. So we check <40.
                    const lowConfCount = uniqueRows.filter(r => r.confidence < 40).length;

                    if ((badDescCount / total) >= 0.2 || (lowConfCount / total) >= 0.2) {
                        const candidates = lines.map(line => ({ line, score: txnScore(line) })).filter(x => x.score >= 0);
                        candidates.sort((a, b) => b.score - a.score);

                        const topTxLines = candidates.slice(0, 15).map(c => c.line);
                        const headerLines = lines.filter(l => l.trim() !== '' && !topTxLines.includes(l)).slice(0, 5);

                        return {
                            mappingRequired: true,
                            fileType: 'pdf',
                            samples: topTxLines.length > 0 ? topTxLines : lines.slice(0, 10),
                            headerSamples: headerLines,
                            isImageOrEmpty: topTxLines.length === 0,
                            headers: [],
                            hash: 'pdf',
                            rawLines: lines
                        };
                    }
                }
            }

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
                    const buf = e.target.result;
                    let text = new TextDecoder("utf-8").decode(buf); // Try UTF-8 first

                    // Check encoding hint
                    const encMatch = text.match(/ENCODING:([^\s]+)/i) || text.match(/<CHARSET>([^<]+)/i);
                    if (encMatch && encMatch[1].toUpperCase().includes("1252")) {
                        // Re-decode as Windows-1252
                        text = new TextDecoder("windows-1252").decode(buf);
                    } else if (text.includes("ISO-8859-1") || text.includes("iso-8859-1")) {
                        text = new TextDecoder("iso-8859-1").decode(buf);
                    }

                    const rows = [];
                    let defaultCurrency = "BRL";

                    // Extract default currency if present
                    const curMatch = text.match(/<CURDEF>([A-Z]{3})/i);
                    if (curMatch) defaultCurrency = curMatch[1].toUpperCase();

                    // Detect bank vs card. If card, sign logic in app uses positive for expenses.
                    // But importer.js norm is: negative=expense. 
                    const isCreditCard = /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(text);

                    // Split into transactions
                    const stmts = text.split(/<STMTTRN>/i);

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

                            let rawAmount = parseFloat(trnMatch[1].trim());

                            // CREDITCARDMSGSRSV1 sometimes sends positive for expenses and negative for payments (or vice versa).
                            // But usually TRNAMT < 0 means money out (expense) in OFX.
                            // We will keep standard TRNAMT.

                            // Extract Memo and Name and correct encoding
                            const rawMemo = memoMatch ? normalizeEncoding(memoMatch[1].trim()) : "";
                            const rawName = nameMatch ? normalizeEncoding(nameMatch[1].trim()) : "";

                            // Let the default description be MEMO fallback to NAME (or NAME fallback to MEMO as per OFX norm)
                            // Usually NAME is better than MEMO in OFX. Let's prefer NAME.
                            const desc = rawName || rawMemo || "Extrato OFX";

                            // Deterministic hash if no FITID, including accountId if passed
                            const accountIdChunk = options.accountId ? `-acct-${options.accountId}` : "";
                            const fitid = fitMatch ? fitMatch[1].trim() : `ofx-hash-${dateISO}-${rawAmount}-${desc}${accountIdChunk}`.replace(/\s+/g, '-').substring(0, 100);

                            if (dateISO && !isNaN(rawAmount)) {
                                const tx = {
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
                                    cardUsageType: "fisico",
                                    payerRole: "main",
                                    selected: true,
                                    warnings: [],
                                    raw: txnData,
                                    sourceType: 'ofx',
                                    cardName: null,
                                    last4: null
                                };
                                tx.confidence = calculateConfidence(tx);
                                rows.push(tx);
                            }
                        }
                    }

                    resolve(rows);
                } catch (err) {
                    reject(new Error("Erro OFX: " + err.message));
                }
            };
            reader.readAsArrayBuffer(file);
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

                                const tx = {
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
                                    cardUsageType: "fisico",
                                    payerRole: "main",
                                    selected: true,
                                    warnings: [],
                                    raw: str,
                                    sourceType: 'qif',
                                    cardName: null,
                                    last4: null
                                };
                                tx.confidence = calculateConfidence(tx);
                                rows.push(tx);
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
        else if (ext === "pdf") rows = await Adapters.pdf(file, options);
        else if (ext === "ofx") rows = await Adapters.ofx(file, options);
        else if (ext === "qif") rows = await Adapters.qif(file, options);
        else throw new Error("Formato não suportado: " + ext);

        if (rows && rows.mappingRequired) {
            return rows;
        }

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
