/**
 * Escapes a cell value for CSV following RFC 4180
 */
function escapeCSV(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);

    // Se o texto contém o separador (;), aspas (") ou quebras de linha (\n, \r), 
    // precisamos colocar entre aspas duplas adicionais.
    if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        // Aspas internas devem ser dobradas (" -> "")
        return '"' + str.replace(/"/g, '""') + '"';
    }

    return str;
}

/**
 * Downloads a CSV file containing the specified rows.
 * @param {Array<Array<any>>} rows Array of rows, where each row is an array of cell values.
 * @param {string} filename Name of the file, must include .csv extension (e.g. "report.csv").
 */
export function exportCSV(rows, filename) {
    if (!rows || rows.length === 0) return;

    // Constrói o conteúdo do CSV com o separador Ponto-e-Vírgula para compatibilidade BR.
    const csvContent = rows.map(row => row.map(escapeCSV).join(';')).join('\n');

    // Adiciona o BOM para o Excel forçar a leitura do UTF-8
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();

    // Limpeza
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Helper to export standard transactions format
 */
export function exportTransactionsCSV(items, caches, filename) {
    if (!items || items.length === 0) return;

    // Header
    const rows = [
        [
            "date", "kind/source", "accountName", "cardName", "invoiceMonth",
            "description", "type", "currency", "value", "fxRate", "valueBRL",
            "category", "subcategory", "tags", "person", "payer/holder",
            "importSource", "importId"
        ]
    ];

    items.forEach(t => {
        const sourceName = t.accountId ? (caches.accounts?.find(a => a.id === t.accountId)?.name || "Dinheiro") : "";
        const cName = t.cardId ? (caches.cards?.find(c => c.id === t.cardId)?.name || "Cartão?") : "";
        const catName = caches.categories?.find(c => c.id === t.categoryId)?.name || "";
        const pName = caches.people?.find(p => p.id === t.personId)?.name || "";
        const subCatName = String(t.subcategory || "");

        let kind = "account";
        if (t.cardId) kind = "card";
        if (t.kind === "planned_installment") kind = "bill";
        if (t.kind === "INVOICE_PAYMENT") kind = "card_payment";
        else if (t.rawType === 'bill') kind = 'bill'; // search adapter
        else if (t.rawType === 'loan') kind = 'loan'; // search adapter

        const typeStr = (t.type === "revenue" || t.type === "income" || (t.isExpense === false)) ? "revenue" : "expense";

        const tagsStr = Array.isArray(t.tags) ? t.tags.join(",") : "";

        const valStr = t.value !== undefined ? Number(Math.abs(t.value)).toFixed(2) : "";
        const fxStr = t.fxRate ? Number(t.fxRate).toFixed(4) : "";
        const valBRLStr = t.valueBRL !== undefined ? Number(Math.abs(t.valueBRL)).toFixed(2) : valStr;

        rows.push([
            t.date || "",
            kind,
            sourceName,
            cName,
            t.invoiceMonth || "",
            t.description || t.title || t.name || "",
            typeStr,
            t.currency || "BRL",
            valStr,
            fxStr,
            valBRLStr,
            catName,
            subCatName,
            tagsStr,
            pName,
            t.cardHolder || "",
            t.importSource || "",
            t.importId || ""
        ]);
    });

    exportCSV(rows, filename);
}
