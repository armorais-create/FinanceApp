// utils/brand.js

export const BRAND_MAP = {
    nubank: { icon: "🟣", colorHex: "#8A05BE" },
    itau: { icon: "🟠", colorHex: "#EC7000" },
    inter: { icon: "🟧", colorHex: "#FF7A00" },
    c6: { icon: "⚫", colorHex: "#242424" },
    bb: { icon: "🟨", colorHex: "#F2D300" },
    wise: { icon: "🟦", colorHex: "#9FE870" }, // Wise bright green/yellowish or blue if preferred. Let's stick to user request "🟦"
    caixa: { icon: "🔵", colorHex: "#005CA9" },
    btg: { icon: "🟦", colorHex: "#002B5E" },
    xp: { icon: "🟡", colorHex: "#FFC20E" },
    santander: { icon: "🔴", colorHex: "#EC0000" },
    bradesco: { icon: "🔴", colorHex: "#CC092F" },
    default: { icon: "🏦", colorHex: "#6c757d" }
};

export function getBrandIcon(brandKey) {
    if (!brandKey) return BRAND_MAP.default.icon;
    const key = brandKey.toLowerCase().trim();
    if (BRAND_MAP[key]) return BRAND_MAP[key].icon;
    return BRAND_MAP.default.icon;
}

export function getBrandColor(brandKey, fallbackHex = null) {
    if (!brandKey) return fallbackHex || BRAND_MAP.default.colorHex;
    const key = brandKey.toLowerCase().trim();
    if (BRAND_MAP[key]) return BRAND_MAP[key].colorHex;
    return fallbackHex || BRAND_MAP.default.colorHex;
}

// Export the array of supported keys for UI dropdowns
export const SUPPORTED_BRANDS = [
    { key: "nubank", label: "Nubank" },
    { key: "itau", label: "Itaú" },
    { key: "inter", label: "Inter" },
    { key: "c6", label: "C6 Bank" },
    { key: "bb", label: "Banco do Brasil" },
    { key: "wise", label: "Wise" },
    { key: "caixa", label: "Caixa" },
    { key: "btg", label: "BTG Pactual" },
    { key: "xp", label: "XP Investimentos" },
    { key: "santander", label: "Santander" },
    { key: "bradesco", label: "Bradesco" }
];
