with open("utils/importer.js", "r") as f:
    lines = f.readlines()

new_parse = """function parseMoneyBR(valStr) {
    if (typeof valStr === "number") return valStr;
    if (!valStr || valStr.toString().trim() === "") return null;

    let v = String(valStr).trim();
    v = v.replace(/[^\\d.,()-]/gi, "");
    if (!v) return null;

    const isNegative = v.includes("(") || v.includes("-");
    v = v.replace(/[()-]/g, "");

    const dots = (v.match(/\\./g) || []).length;
    const commas = (v.match(/,/g) || []).length;

    if (dots > 0 && commas > 0) {
        const lastComma = v.lastIndexOf(",");
        const lastDot = v.lastIndexOf(".");
        if (lastComma > lastDot) v = v.replace(/\\./g, "").replace(",", ".");
        else v = v.replace(/,/g, "");
    } else if (commas === 1 && dots === 0) {
        v = v.replace(",", ".");
    } else if (commas > 1 && dots === 0) {
        v = v.replace(/,/g, "");
    } else if (dots > 1 && commas === 0) {
        v = v.replace(/\\./g, "");
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
"""

new_csv = """    csv: async (file) => {
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
                        try { return resolve(checkZeros(rowsWithHeaders, colsStr)); } catch(e) { console.warn(e.message); }
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
                                    if (!normalizeDate(cellStr) && /[\\d]+[.,][\\d]/.test(cellStr) && parseMoneyBR(cellStr) !== null) {
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
                            try { resolve(checkZeros(rowsNoHeaders, headerRow.join(", "))); } catch(e) { reject(e); }
                        },
                        error: (err) => reject(new Error("Erro CSV fallback: " + err.message))
                    });
                },
                error: (err) => reject(new Error("Erro CSV: " + err.message))
            });
        });
    },
"""

new_xlsx = """    xlsx: async (file) => {
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

                            if (!dateISO && amount === null) return null;
                            return {
                                id: `xlsx-${Date.now()}-${Math.random()}`, dateISO, description: desc, amount,
                                categoryId: "", subcategoryId: "", cardUsageType: "fisico", payerRole: "main",
                                selected: true, warnings: [], raw: r, cardName: null, last4: null
                            };
                        }).filter(Boolean);

                        if (rows.length > bestSheetRows.length) {
                            bestSheetRows = rows;
                            bestSheetName = sheetName;
                        }
                    }

                    if (bestSheetRows.length === 0) throw new Error(`Nenhuma aba contém colunas reconhecíveis (Data/Valor). Abas encontradas: [${wb.SheetNames.map(s=>`"${s}"`).join(", ")}].`);
                    const zeroCount = bestSheetRows.filter(r => r.amount === 0 || r.amount === null).length;
                    if (bestSheetRows.length > 0 && zeroCount / bestSheetRows.length >= 0.8) throw new Error(`Na aba "${bestSheetName}", não consegui identificar a coluna de valores com confiança. (80% dos valores zerados). Abra o arquivo e confirme se existe coluna "Valor" ou "Amount".`);
                    resolve(bestSheetRows);
                } catch (err) { reject(new Error("Erro Excel: " + err.message)); }
            };
            reader.readAsArrayBuffer(file);
        });
    },
"""

new_pdf = """    pdf: async (file, password) => {
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
                fullText += content.items.map(item => item.str).join(" ") + "\\n";
            }

            const linesByY = {};
            textItems.forEach(item => {
                const y = Math.round(item.transform[5]);
                if (!linesByY[y]) linesByY[y] = [];
                linesByY[y].push(item);
            });
            const sortedY = Object.keys(linesByY).sort((a,b) => b - a);
            const reconstructedLines = sortedY.map(y => {
                const lineItems = linesByY[y].sort((a,b) => a.transform[4] - b.transform[4]);
                return lineItems.map(i => i.str).join(" ");
            });

            const lines = reconstructedLines.length > 5 ? reconstructedLines : fullText.split("\\n");
            const rows = [];
            const rxGeneric = /(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(.*?)\\s+(-?[\\d\\.,]+)$/;
            const rxNubank = /(\\d{2})\\s+([A-Z]{3})\\s+(.*?)\\s+(-?[\\d\\.,]+)$/;
            const rxCommon = /^(\\d{2}\\/\\d{2})\\s+(.*?)\\s+(-?[\\d\\.,]+)$/;
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
"""

lines = lines[:57] + [new_parse] + lines[105:111] + [new_csv, new_xlsx, new_pdf] + lines[359:]

with open("utils/importer.js", "w") as f:
    f.writelines(lines)
