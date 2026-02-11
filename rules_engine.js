/**
 * RULES ENGINE
 * 
 * Applies user-defined rules to modify draft transactions (e.g. from Import).
 */

/**
 * Apply rules to a SINGLE draft transaction.
 * @param {Object} draftTx - The transaction object (mutable or copy).
 * @param {Array} rules - List of rules (will be sorted by priority).
 * @param {Array} subcategories - List of all subcategories (for validation).
 * @returns {Object} { draftTx, appliedRuleIds }
 */
export function applyRulesToDraft(draftTx, rules, subcategories = []) {
    if (!rules || !Array.isArray(rules)) return { draftTx, appliedRuleIds: [] };

    // 1. Sort rules by priority (asc)
    // Filter enabled rules
    const activeRules = rules
        .filter(r => r.enabled !== false) // default enabled if undefined? usually enabled is explicit true/false
        .sort((a, b) => (a.priority || 0) - (b.priority || 0));

    const appliedRuleIds = [];

    // Work on a copy to avoid side effects if needed, but draftTx is usually mutable in this context.
    const tx = { ...draftTx };
    const desc = (tx.description || "").toLowerCase();

    for (const rule of activeRules) {
        if (!rule.match) continue;

        // 2. Check Match
        let isMatch = false;

        // "Description Includes" (Case Insensitive)
        if (rule.match.descriptionIncludes) {
            const term = rule.match.descriptionIncludes.toLowerCase();
            if (term && desc.includes(term)) {
                isMatch = true;
            }
        }

        // "Description Regex" (Future)
        // if (!isMatch && rule.match.descriptionRegex) ...

        if (!isMatch) continue;

        // 3. Apply Actions
        // Track applied rule
        appliedRuleIds.push(rule.id);

        const acts = rule.actions || {};
        const opts = rule.options || {};
        const overwrite = opts.overwrite === true;

        // Helper to set field if empty or overwrite
        const setField = (field, value) => {
            if (value && (!tx[field] || overwrite)) {
                tx[field] = value;
            }
        };

        // Actions Priority: Rule Category > Rule Subcategory
        // But we must validate Subcategory against the *Final* Category.

        // Determine Target Category for this rule application step
        // (It might be the existing one on Draft, or the new one from Rule)
        let targetCatId = tx.categoryId;
        if (acts.categoryId && (!tx.categoryId || overwrite)) {
            targetCatId = acts.categoryId;
        }

        // Apply Category first
        setField("categoryId", acts.categoryId);

        // Apply Subcategory (WITH VALIDATION)
        if (acts.subcategoryId) {
            // Check if subcategory belongs to the target category
            const sub = subcategories.find(s => s.id === acts.subcategoryId);
            if (sub && sub.categoryId === targetCatId) {
                setField("subcategoryId", acts.subcategoryId);
            } else {
                // Mismatch or invalid subcategory. 
                // If overwrite is ON, and we also set categoryId, it should have matched.
                // If overwrite is OFF, and we are keeping existing categoryId, but trying to apply a subcategory from a rule
                // that implies a DIFFERENT category, we should SKIP applying the subcategory to avoid inconsistency.
                // So, successfully ignored.
            }
        }

        setField("personId", acts.personId);
        setField("accountId", acts.accountId);
        if (acts.type) setField("type", acts.type);

        // Tags (Merge logic: always add unique tags, unless overwrite strategy differs? usually merge)
        if (acts.tags && Array.isArray(acts.tags)) {
            const currentTags = tx.tags || [];
            // If overwrite is true, maybe replace tags completely?
            // "overwrite" usually applies to single value fields. Tags are a set.
            // Let's assume merge for now as standard.
            const newTags = acts.tags.filter(t => !currentTags.includes(t));
            if (newTags.length > 0) {
                tx.tags = [...currentTags, ...newTags];
            }
        }
    }

    return { draftTx: tx, appliedRuleIds };
}

/**
 * Apply rules to MANY drafts.
 * @param {Array} drafts 
 * @param {Array} rules 
 * @param {Array} subcategories
 * @returns {Array} Array of { draftTx, appliedRuleIds } results
 */
export function applyRulesToMany(drafts, rules, subcategories = []) {
    if (!drafts) return [];
    return drafts.map(d => applyRulesToDraft(d, rules, subcategories));
}
