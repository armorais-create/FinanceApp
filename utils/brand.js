// utils/brand.js

export const BRAND_MAP = {
    nubank: { icon: "🟣", colorHex: "#8A05BE" },
    itau: { icon: "🟠", colorHex: "#EC7000" },
    inter: { icon: "🟧", colorHex: "#FF7A00" },
    c6: { icon: "⚫", colorHex: "#242424" },
    bb: { icon: "🟨", colorHex: "#F2D300" },
    wise: { icon: "🟢", colorHex: "#00B9FF" }, // User requested green icon for Wise
    mercadopago: { icon: "🟦", colorHex: "#009EE3" },
    picpay: { icon: "🟢", colorHex: "#11C76F" },
    nomad: { icon: "🟡", colorHex: "#F2D800" },
    sicoob: { icon: "🟢", colorHex: "#00AE9D" },
    latampass: { icon: "🔴", colorHex: "#E51A2E" },
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
export const SUPPORTED_BANKS = [
    { key: "bb", label: "Banco do Brasil" },
    { key: "itau", label: "Itaú" },
    { key: "nubank", label: "Nubank" },
    { key: "c6", label: "C6 Bank" },
    { key: "mercadopago", label: "Mercado Pago" },
    { key: "picpay", label: "PicPay" },
    { key: "nomad", label: "Nomad" },
    { key: "wise", label: "Wise" },
    { key: "sicoob", label: "Sicoob" },
    { key: "inter", label: "Inter" }
];

export const SUPPORTED_CARDS = [
    { key: "bb", label: "Banco do Brasil" },
    { key: "itau", label: "Itaú" },
    { key: "nubank", label: "Nubank" },
    { key: "c6", label: "C6 Bank" },
    { key: "mercadopago", label: "Mercado Pago" },
    { key: "latampass", label: "Latam Pass" },
    { key: "nomad", label: "Nomad" },
    { key: "wise", label: "Wise" },
    { key: "sicoob", label: "Sicoob" },
    { key: "inter", label: "Inter" }
];
