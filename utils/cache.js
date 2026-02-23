/* =========================================
   MEMORY CACHE HELPER (Phase 20B-1)
   ========================================= */

const memoryCache = {};

export function getCache(key) {
    if (memoryCache[key] !== undefined) {
        return memoryCache[key];
    }
    return null;
}

export function setCache(key, value) {
    memoryCache[key] = value;
}

export function clearCache(prefix = '') {
    if (!prefix) {
        // Clear all
        for (const k in memoryCache) delete memoryCache[k];
        return;
    }
    // Clear keys starting with prefix
    for (const k in memoryCache) {
        if (k.startsWith(prefix)) {
            delete memoryCache[k];
        }
    }
}
