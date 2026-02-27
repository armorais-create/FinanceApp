// =========================================
// CUSTOM CANVAS CHARTS (Phase 20A-1)
// =========================================

// Helper to format currency
const formatBRL = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

export function exportChartToPNG(canvas, filename) {
    if (!canvas) return;
    try {
        const dataUrl = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = filename || `chart_${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (e) {
        console.error("Export Chart Error:", e);
        alert("Erro ao exportar o gráfico.");
    }
}

// Draw "Sem dados" fallback
function drawEmptyState(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f9f9f9";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#666";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Sem dados para exibir", width / 2, height / 2);
}

// 1) LINE CHART (e.g. 6 Months Evolution)
// data: [{ label: "2026-01", value: 1500 }, ...]
export function drawLineChart(canvas, data, options = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    if (!data || data.length === 0) {
        return drawEmptyState(ctx, width, height);
    }

    ctx.clearRect(0, 0, width, height);

    // Configs
    const padding = 40;
    const colorLine = options.colorLine || "#007bff";
    const colorPoint = options.colorPoint || "#0056b3";
    const fillArea = options.fillArea !== false;

    // Find min and max for scaling
    const values = data.map(d => d.value);
    const maxVal = Math.max(...values, 1); // Avoid div by 0
    let minVal = Math.min(...values, 0);
    // Add 10% headroom
    const scaleMax = maxVal * 1.1;

    // Draw Area/Line
    const drawX = (index) => padding + (index * ((width - 2 * padding) / Math.max(1, data.length - 1)));
    const drawY = (val) => height - padding - ((val - Math.min(0, minVal)) / (scaleMax - Math.min(0, minVal)) * (height - 2 * padding));

    const hitboxes = [];

    // Fill Area under line
    if (fillArea) {
        ctx.beginPath();
        ctx.moveTo(drawX(0), height - padding);
        for (let i = 0; i < data.length; i++) {
            ctx.lineTo(drawX(i), drawY(data[i].value));
        }
        ctx.lineTo(drawX(data.length - 1), height - padding);
        ctx.closePath();
        ctx.fillStyle = colorLine + "33"; // 20% opacity alpha hex (approx)
        ctx.fill();
    }

    // Draw Line
    ctx.beginPath();
    ctx.moveTo(drawX(0), drawY(data[0].value));
    for (let i = 1; i < data.length; i++) {
        ctx.lineTo(drawX(i), drawY(data[i].value));
    }
    ctx.strokeStyle = colorLine;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw Points and X-Axis Labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "11px sans-serif";

    for (let i = 0; i < data.length; i++) {
        const x = drawX(i);
        const y = drawY(data[i].value);

        // Point
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = colorPoint;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Save hitbox
        hitboxes.push({ x, y, radius: 15, data: data[i] });

        // X Label (Month)
        ctx.fillStyle = "#555";
        let label = data[i].label; // e.g. "2026-02"
        if (label.length === 7) label = label.substring(5, 7) + "/" + label.substring(2, 4); // "02/26"
        ctx.fillText(label, x, height - padding + 8);

        // Value Text above point
        ctx.fillStyle = "#333";
        ctx.textBaseline = "bottom";
        const valText = (data[i].value / 1000).toFixed(1) + "k"; // abbreviate
        ctx.fillText(valText, x, y - 8);
        ctx.textBaseline = "top";
    }

    // Draw Y-Axis Guideline (Zero line if minVal < 0)
    if (minVal < 0) {
        const zeroY = drawY(0);
        ctx.beginPath();
        ctx.moveTo(padding, zeroY);
        ctx.lineTo(width - padding, zeroY);
        ctx.strokeStyle = "#ccc";
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    return hitboxes;
}

// 2) HORIZONTAL BAR CHART (e.g. Top 10 Categories)
// data: [{ label: "Moradia", value: 5000 }, ...]
export function drawBarChart(canvas, data, options = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    if (!data || data.length === 0) {
        return drawEmptyState(ctx, width, height);
    }

    ctx.clearRect(0, 0, width, height);

    const paddingX = 10;
    const paddingY = 10;
    const labelWidth = 100; // Left space for category text
    const valueWidth = 70;  // Right space for R$ text

    const barAreaWidth = width - labelWidth - valueWidth - (paddingX * 2);
    const maxVal = Math.max(...data.map(d => d.value), 1);

    const barHeight = Math.min(24, (height - paddingY * 2) / data.length - 4);
    const rowHeight = barHeight + 8;

    ctx.textBaseline = "middle";
    ctx.font = "12px sans-serif";

    const colorBar = options.colorBar || "#17a2b8";
    const hitboxes = [];

    for (let i = 0; i < data.length; i++) {
        const item = data[i];
        const y = paddingY + i * rowHeight;

        // Save hitbox (entire row)
        hitboxes.push({ x: 0, y, w: width, h: barHeight + 4, data: item });

        // Label
        ctx.fillStyle = "#333";
        ctx.textAlign = "right";
        let label = item.label;
        if (label.length > 13) label = label.substring(0, 11) + "..."; // truncate
        ctx.fillText(label, labelWidth - 5, y + barHeight / 2);

        // Background Bar Track (optional)
        ctx.fillStyle = "#f1f1f1";
        ctx.fillRect(labelWidth, y, barAreaWidth, barHeight);

        // Bar
        const barW = (item.value / maxVal) * barAreaWidth;
        ctx.fillStyle = colorBar;
        ctx.fillRect(labelWidth, y, barW, barHeight);

        // Value Text
        ctx.fillStyle = "#666";
        ctx.textAlign = "left";
        const valText = options.formatValue ? options.formatValue(item.value) : formatBRL(item.value);
        ctx.fillText(valText, labelWidth + barAreaWidth + 5, y + barHeight / 2);
    }

    return hitboxes;
}

// 3) GROUPED BAR CHART (e.g. Income vs Expense)
// data: { income: 5000, expense: 3000 }
export function drawGroupedBarChart(canvas, data, options = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    if (!data || (data.income === 0 && data.expense === 0)) {
        return drawEmptyState(ctx, width, height);
    }

    ctx.clearRect(0, 0, width, height);

    const maxVal = Math.max(data.income, data.expense, 1);
    const padding = 40;
    const barMaxHeight = height - padding * 2;
    const barWidth = 60;

    // Draw X Axis line
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.strokeStyle = "#ccc";
    ctx.stroke();

    const drawBar = (val, color, title, xOffset) => {
        const h = (val / maxVal) * barMaxHeight;
        const x = width / 2 + xOffset;
        const y = height - padding - h;

        // Bar
        ctx.fillStyle = color;
        ctx.fillRect(x, y, barWidth, h);

        // Value Label
        ctx.fillStyle = "#333";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.font = "12px sans-serif";
        const valText = val > 1000 ? (val / 1000).toFixed(1) + "k" : val.toFixed(0);
        ctx.fillText("R$ " + valText, x + barWidth / 2, y - 5);

        // X Label
        ctx.fillStyle = color; // match label to bar color for contrast
        ctx.textBaseline = "top";
        ctx.fillText(title, x + barWidth / 2, height - padding + 8);
    };

    drawBar(data.income, "#28a745", "Receitas", -barWidth - 10);
    drawBar(data.expense, "#dc3545", "Despesas", 10);
}

// 4) HELPER EXTRAS
export function getCanvasClickPosition(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY
    };
}
window.getCanvasClickPosition = getCanvasClickPosition;
