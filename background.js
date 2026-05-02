// background.js — runs as the MV3 service worker.
// Handles API calls (no CORS issues here), context menus, and script injection.

"use strict";

// Hardcoded here because the service worker can't access config.js globals.
// If you update config.js, update these too.
const CONFIG_BG = {
    API_URL: "https://tmt.ilprl.ku.edu.np/lang-translate",
    BEARER_TOKEN: "team_XXXXXXXXXXXX"
};

const CONTENT_SCRIPTS = ["config.js", "lang.js", "errors.js", "cache.js", "utils.js", "content.js"];

// -- Context Menu Setup -------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "tmt-translate-page",
            title: "Translate This Page",
            contexts: ["page"]
        });
        chrome.contextMenus.create({
            id: "tmt-translate-selection",
            title: "Translate Selection",
            contexts: ["selection"]
        });
    });
});

// -- Script injection helper --------------------------------------------------

// Sends a message to a tab, injecting content scripts first if needed.
// We ping first to avoid re-injecting on tabs that already have it running.
// The __tmtLoaded reset is needed when the extension is reloaded mid-session —
// the old context dies but the flag stays on window, so content.js would bail early.
function injectAndSend(tabId, message) {
    chrome.tabs.sendMessage(tabId, { type: "PING" }, pingResp => {
        void chrome.runtime.lastError;
        if (pingResp?.ok) {
            chrome.tabs.sendMessage(tabId, message);
            return;
        }
        chrome.scripting.executeScript(
            { target: { tabId }, func: () => { window.__tmtLoaded = false; } },
            () => {
                void chrome.runtime.lastError;
                chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS }, () => {
                    if (chrome.runtime.lastError) return; // chrome:// pages, etc. — just skip
                    chrome.tabs.sendMessage(tabId, message);
                });
            }
        );
    });
}

// -- Translation API ----------------------------------------------------------

// Same logic as normalizeLangCode in utils.js, just duplicated here since
// service workers don't share globals with content scripts.
function normalizeLangCode(code) {
    const c = String(code || "").trim().toLowerCase();
    if (c === "tmz") return "tmg";
    if (c === "eng") return "en";
    return c;
}

// Logs to the service worker console and also pushes to the popup debug panel.
// The sendMessage will just silently fail if the popup isn't open.
function bgLog(level, message, detail) {
    const ts = new Date().toISOString().slice(11, 23);
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`[TMT BG ${ts}] ${message}`, detail != null ? detail : "");
    chrome.runtime.sendMessage({ type: "DEBUG_LOG", level, message, detail: detail != null ? String(detail) : undefined, ts }).catch(() => { });
}

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 2000; // starts at 2s, doubles each attempt: 2s, 4s, 8s

async function callTranslationAPI({ text, src_lang, tgt_lang }) {
    const src = normalizeLangCode(src_lang);
    const tgt = normalizeLangCode(tgt_lang);

    const requestInit = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${CONFIG_BG.BEARER_TOKEN}`
        },
        body: JSON.stringify({ text, src_lang: src, tgt_lang: tgt })
    };

    bgLog("info", `→ API POST ${src}→${tgt}`, text.slice(0, 80));

    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let response;
        try {
            response = await fetch(CONFIG_BG.API_URL, requestInit);
        } catch (err) {
            // Actual network failure (offline, DNS, etc.) — retrying won't help
            bgLog("error", `Attempt ${attempt}: network error`, err.message);
            lastError = new Error(`Network error: ${err.message}`);
            break;
        }

        bgLog("info", `Attempt ${attempt}: HTTP ${response.status}`, `${src}→${tgt}`);

        if (response.status === 429) {
            // Rate limited — respect Retry-After if the server sends one, otherwise back off
            const retryAfterHeader = response.headers.get("Retry-After");
            const waitMs = retryAfterHeader
                ? parseInt(retryAfterHeader, 10) * 1000
                : BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            bgLog("warn", `Rate limited (429) — waiting ${waitMs}ms before retry ${attempt}/${MAX_RETRIES}`, text.slice(0, 60));
            await new Promise(r => setTimeout(r, waitMs));
            lastError = new Error("Rate limited (429)");
            continue;
        }

        if (!response.ok) {
            bgLog("error", `HTTP error ${response.status}`, text.slice(0, 60));
            throw new Error(`API error: ${response.status}`);
        }

        let data;
        try {
            data = await response.json();
        } catch (_) {
            bgLog("error", "Invalid JSON in response");
            throw new Error("Invalid API response");
        }

        bgLog("info", `Response message_type: ${data.message_type}`, `output present: ${typeof data.output === "string"}`);

        if (data.message_type && data.message_type !== "SUCCESS") {
            bgLog("error", `API rejected: ${data.message_type}`, data.message);
            throw new Error(data.message || "Translation failed");
        }

        if (typeof data.output !== "string") {
            bgLog("error", "Unexpected response shape", JSON.stringify(data).slice(0, 120));
            throw new Error("Invalid API response");
        }

        bgLog("info", `✓ Translated`, `"${text.slice(0, 40)}" → "${data.output.slice(0, 40)}"`);
        return data.output;
    }

    const reason = lastError?.message || "unknown";
    throw new Error(`Max retries (${MAX_RETRIES}) exceeded — last error: ${reason}`);
}

// -- Message listener ---------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "TRANSLATE_TEXT") {
        callTranslationAPI(message.payload)
            .then(output => sendResponse({ ok: true, output }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true; // tells Chrome we'll call sendResponse asynchronously
    }
});

// -- Context menu click handler -----------------------------------------------

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;

    if (info.menuItemId === "tmt-translate-page") {
        // Pick up whatever language pair the user last set in the popup
        chrome.storage.local.get(["tmtSourceLang", "tmtTargetLang"], result => {
            injectAndSend(tab.id, {
                type: "TRANSLATE_PAGE",
                source: result.tmtSourceLang || "en",
                target: result.tmtTargetLang || "ne"
            });
        });
    }

    if (info.menuItemId === "tmt-translate-selection") {
        injectAndSend(tab.id, {
            type: "TRANSLATE_SELECTION",
            text: info.selectionText || ""
        });
    }
});
