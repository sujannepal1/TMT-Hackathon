/**
 * Normalize language codes to what the TMT API expects.
 * e.g. "tmz" → "tmg", "eng" → "en"
 */
function normalizeLangCode(code) {
    const c = String(code || "").trim().toLowerCase();
    if (c === "tmz") return "tmg";
    if (c === "eng") return "en";
    return c;
}

/**
 * Split a block of text into individual sentences.
 * Handles Latin (.!?) and Devanagari/Nepali (।) sentence terminators.
 */
function splitIntoSentences(text) {
    // Split after terminator punctuation followed by whitespace.
    // Lookbehind is safe in Chrome (V8 ES2018+).
    const parts = text.split(/(?<=[.!?।])\s+/).filter(s => s.trim().length > 0);
    return parts.length > 0 ? parts : [text];
}

/**
 * Return a Promise that resolves after `ms` milliseconds.
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determine whether a DOM text node should be translated.
 * Returns false for:
 *  - Nodes inside script / style / code / pre / SVG / MathML
 *  - Nodes whose parent is already marked as translated
 *  - Whitespace-only nodes
 */
function isTranslatableNode(node) {
    const parent = node.parentElement;
    if (!parent) return false;

    if (!node.textContent.trim()) return false;

    const SKIP_TAGS = new Set([
        "script", "style", "noscript", "code", "pre",
        "kbd", "samp", "var", "math", "svg"
    ]);

    // Walk up the ancestor chain: skip content inside layout-breaking or
    // already-translated subtrees, but always allow button/link text.
    let el = parent;
    while (el && el !== document.body) {
        const tag = el.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag)) return false;
        // If a node is marked translated AND it's not a button/link (those
        // should always be re-evaluated so their own text gets translated).
        if (el.dataset.tmtTranslated && tag !== "a" && tag !== "button") return false;
        el = el.parentElement;
    }

    return true;
}
