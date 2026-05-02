// content.js — runs in the context of every page at document_idle.
// Depends (as globals) on: CONFIG, LANG, ERRORS, cache, utils (all injected before this file).

(function () {
    "use strict";

    // Guard against double-injection (e.g. programmatic scripting + content_scripts)
    if (window.__tmtLoaded) return;
    window.__tmtLoaded = true;

    // ─── Debug logger ─────────────────────────────────────────────────────────

    const LEVELS = { info: "#4CAF50", warn: "#FF9800", error: "#f44336" };

    /**
     * Send a structured debug log to the popup (if open) and console.
     * Only active when CONFIG.DEBUG === true.
     */
    function dbg(level, message, detail) {
        if (!CONFIG.DEBUG) return;
        const entry = {
            type: "DEBUG_LOG",
            level,               // "info" | "warn" | "error"
            message,
            detail: detail != null ? String(detail) : undefined,
            ts: new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm
        };
        // Best-effort — popup may not be open
        chrome.runtime.sendMessage(entry).catch(() => { });
        // Also mirror to devtools console for browser-level debugging
        const fn = level === "error" ? console.error
            : level === "warn" ? console.warn
                : console.log;
        fn(`[TMT ${entry.ts}] ${message}`, detail != null ? detail : "");
    }

    // ─── State ────────────────────────────────────────────────────────────────

    const queue = [];          // { text, resolve, reject }
    let isProcessing = false;  // is the queue pump running?

    // Tracks original text of each translated text node so we can restore it
    // before re-translating with a different language pair.
    const originalTextNodes = new Map(); // TextNode → original string

    // Active language pair — set when the user triggers translation from the popup
    let activeLang = {
        source: LANG.EN.code,
        target: LANG.NE.code
    };

    // ─── Queue & API ──────────────────────────────────────────────────────────

    /**
     * Add a sentence to the translation queue and return a Promise that
     * resolves with the translated string. Bypasses the queue if cached.
     */
    function enqueue(text) {
        return new Promise((resolve, reject) => {
            if (cache.has(text)) {
                resolve(cache.get(text));
                return;
            }
            queue.push({ text, resolve, reject });
            if (!isProcessing) pumpQueue();
        });
    }

    /** Process queue items one at a time with a configurable delay between calls. */
    async function pumpQueue() {
        isProcessing = true;
        dbg("info", `Queue pump started — ${queue.length} item(s) waiting`);

        while (queue.length > 0) {
            const item = queue.shift();

            // Double-check cache (may have been populated while item waited)
            if (cache.has(item.text)) {
                dbg("info", "Cache hit", item.text.slice(0, 60));
                item.resolve(cache.get(item.text));
                continue;
            }

            try {
                dbg("info", "Translating", item.text.slice(0, 80));
                const translated = await callAPI(item.text);
                dbg("info", "✓ Translated", `"${item.text.slice(0, 40)}" → "${translated.slice(0, 40)}"`);
                cache.set(item.text, translated);
                item.resolve(translated);
                await delay(CONFIG.DELAY_MS);
            } catch (err) {
                dbg("error", "✗ Failed", `"${item.text.slice(0, 60)}" — ${err.message}`);
                item.reject(err);
            }
        }

        dbg("info", "Queue pump finished");
        isProcessing = false;
    }

    /** POST a single sentence to the translation REST API via the background service worker.
     *  The background worker is CORS-exempt; direct fetch from content scripts is not. */
    async function callAPI(text) {
        const src = normalizeLangCode(activeLang.source);
        const tgt = normalizeLangCode(activeLang.target);

        dbg("info", `POST ${src} → ${tgt}`, text.slice(0, 80));

        let response;
        try {
            response = await chrome.runtime.sendMessage({
                type: "TRANSLATE_TEXT",
                payload: { text, src_lang: src, tgt_lang: tgt }
            });
        } catch (err) {
            dbg("error", "Messaging error", err.message);
            throw new Error(ERRORS.NETWORK);
        }

        if (!response?.ok) {
            const errMsg = response?.error || ERRORS.API_FAIL;
            dbg("error", `API error`, errMsg);
            throw new Error(errMsg);
        }

        dbg("info", "✓ API response OK", response.output?.slice(0, 60));
        return response.output;
    }

    // ─── DOM Collection ───────────────────────────────────────────────────────

    /** Walk the DOM and return all translatable text nodes under `root`. */
    function collectTextNodes(root) {
        const nodes = [];
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    return isTranslatableNode(node)
                        ? NodeFilter.FILTER_ACCEPT
                        : NodeFilter.FILTER_REJECT;
                }
            }
        );
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        return nodes;
    }

    /** Return all input elements that have a non-empty, untranslated placeholder. */
    function collectInputPlaceholders(root) {
        return Array.from(
            root.querySelectorAll("input[placeholder]:not([data-tmt-translated])")
        ).filter(el => el.placeholder.trim().length > 0);
    }

    /**
     * Return all button-type inputs (<input type="submit|button|reset">) and
     * <button> elements whose value/text is not yet translated.
     * Regular <button> text nodes are already caught by the TreeWalker, so
     * this only targets input-based buttons (which have no text node child).
     */
    function collectButtonValues(root) {
        return Array.from(
            root.querySelectorAll(
                "input[type='submit']:not([data-tmt-translated])," +
                "input[type='button']:not([data-tmt-translated])," +
                "input[type='reset']:not([data-tmt-translated])"
            )
        ).filter(el => (el.value || "").trim().length > 0);
    }

    // ─── Per-Node Translation ─────────────────────────────────────────────────

    /** Translate a single text node in-place. */
    async function translateTextNode(node) {
        const original = node.textContent;
        if (!original.trim()) return;

        // Remember original so we can restore on re-translate
        if (!originalTextNodes.has(node)) {
            originalTextNodes.set(node, original);
        }

        // Mark parent element to prevent double-traversal
        if (node.parentElement) {
            node.parentElement.dataset.tmtTranslated = "true";
        }

        const sentences = splitIntoSentences(original.trim());

        const results = await Promise.all(
            sentences.map(s => enqueue(s).catch(() => s)) // fall back to original on error
        );

        node.textContent = results.join(" ");
    }

    /** Translate the placeholder attribute of an input element. */
    async function translatePlaceholder(input) {
        const original = input.placeholder.trim();
        if (!original) return;

        input.dataset.tmtOriginalPlaceholder = original;
        input.dataset.tmtTranslated = "true";

        const sentences = splitIntoSentences(original);
        const results = await Promise.all(
            sentences.map(s => enqueue(s).catch(() => s))
        );

        input.placeholder = results.join(" ");
    }

    /** Translate the value attribute of a button-type input element. */
    async function translateButtonValue(input) {
        const original = (input.value || "").trim();
        if (!original) return;

        input.dataset.tmtOriginalValue = original;
        input.dataset.tmtTranslated = "true";

        const sentences = splitIntoSentences(original);
        const results = await Promise.all(
            sentences.map(s => enqueue(s).catch(() => s))
        );

        input.value = results.join(" ");
    }

    // ─── Restore ──────────────────────────────────────────────────────────────

    /** Undo all translations so translatePage() can run fresh. */
    function restorePage() {
        // Restore text nodes
        originalTextNodes.forEach((original, node) => {
            node.textContent = original;
        });
        originalTextNodes.clear();

        // Remove translated markers from elements
        document.querySelectorAll("[data-tmt-translated]").forEach(el => {
            delete el.dataset.tmtTranslated;
        });

        // Restore input placeholders
        document.querySelectorAll("input[data-tmt-original-placeholder]").forEach(input => {
            input.placeholder = input.dataset.tmtOriginalPlaceholder;
            delete input.dataset.tmtOriginalPlaceholder;
        });

        // Restore button input values
        document.querySelectorAll("input[data-tmt-original-value]").forEach(input => {
            input.value = input.dataset.tmtOriginalValue;
            delete input.dataset.tmtOriginalValue;
        });
    }

    // ─── Page-Level Translation ───────────────────────────────────────────────

    /**
     * Translate the entire page.
     * @param {string} [sourceLang] - Source language code (defaults to CONFIG.SOURCE_LANG)
     * @param {string} [targetLang] - Target language code (defaults to CONFIG.TARGET_LANG)
     */
    async function translatePage(sourceLang, targetLang) {
        activeLang = {
            source: sourceLang || LANG.EN.code,
            target: targetLang || LANG.NE.code
        };

        dbg("info", `translatePage called`, `${activeLang.source} → ${activeLang.target}`);

        // Restore originals and clear cache before a language-change re-translate
        restorePage();
        cache.clear();

        const textNodes = collectTextNodes(document.body);
        const placeholders = collectInputPlaceholders(document.body);
        const buttonValues = collectButtonValues(document.body);
        const total = textNodes.length + placeholders.length + buttonValues.length;
        let done = 0;

        dbg("info", `Found ${textNodes.length} text node(s), ${placeholders.length} placeholder(s), ${buttonValues.length} button value(s)`, `total: ${total}`);

        if (total === 0) {
            dbg("warn", "No translatable content found on this page");
        }

        function reportProgress() {
            done++;
            // Notify popup (if open) — ignore if popup is closed
            chrome.runtime.sendMessage({ type: "TRANSLATION_PROGRESS", done, total })
                .catch(() => { });
        }

        await Promise.allSettled([
            ...textNodes.map(n => translateTextNode(n).finally(reportProgress)),
            ...placeholders.map(i => translatePlaceholder(i).finally(reportProgress)),
            ...buttonValues.map(i => translateButtonValue(i).finally(reportProgress))
        ]);

        return total;
    }

    // ─── Selection Tooltip ────────────────────────────────────────────────────

    /**
     * Show a floating tooltip with the translated selection.
     * Auto-removes after 5 s or on the next click.
     */
    function showTooltip(translated) {
        const existing = document.getElementById("tmt-tooltip");
        if (existing) existing.remove();

        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;

        const rect = sel.getRangeAt(0).getBoundingClientRect();

        const tooltip = document.createElement("div");
        tooltip.id = "tmt-tooltip";
        tooltip.textContent = translated;
        Object.assign(tooltip.style, {
            position: "fixed",
            top: `${rect.bottom + 8}px`,
            left: `${Math.max(0, rect.left)}px`,
            maxWidth: "400px",
            background: CONFIG.UI_COLOR,
            color: "#fff",
            padding: "8px 12px",
            borderRadius: "6px",
            fontSize: "14px",
            lineHeight: "1.4",
            zIndex: "2147483647",
            boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
            pointerEvents: "none"
        });

        document.body.appendChild(tooltip);
        setTimeout(() => tooltip.remove(), 5000);
        document.addEventListener("click", () => tooltip.remove(), { once: true });
    }

    // ─── Message Listener ─────────────────────────────────────────────────────

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === "PING") {
            sendResponse({ ok: true });
            return;
        }

        if (message.type === "RESTORE_PAGE") {
            restorePage();
            sendResponse({ ok: true });
            return;
        }

        if (message.type === "TRANSLATE_PAGE") {
            translatePage(message.source, message.target)
                .then(count => sendResponse({ success: true, count }))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true; // keep channel open for async response
        }

        if (message.type === "TRANSLATE_SELECTION") {
            const text = (message.text || "").trim();
            if (!text) {
                sendResponse({ success: false, error: "No text provided" });
                return;
            }

            // Re-use active language pair for selection translation
            enqueue(text)
                .then(translated => {
                    showTooltip(translated);
                    sendResponse({ success: true, translated });
                })
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true;
        }
    });

    // Translation is triggered by the user via the popup — not on load.
})();;
