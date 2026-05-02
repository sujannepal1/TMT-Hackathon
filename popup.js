// popup.js — Popup UI logic.
// Depends on CONFIG, LANG, LANG_AUTO, LANG_PAIRS loaded as globals from config.js / lang.js.

"use strict";

const sourceSelect = document.getElementById("source-lang");
const targetSelect = document.getElementById("target-lang");
const translateBtn = document.getElementById("translate-btn");
const restoreBtn = document.getElementById("restore-btn");
const swapBtn = document.getElementById("swap-btn");
const statusMsg = document.getElementById("status-msg");
const pairHintText = document.getElementById("pair-hint-text");
const progressWrap = document.getElementById("progress-wrap");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");
const popupTitle = document.getElementById("popup-title");
const debugPanel = document.getElementById("debug-panel");
const debugLog = document.getElementById("debug-log");
const debugCount = document.getElementById("debug-count");
const debugClear = document.getElementById("debug-clear");
// ── Branding ──────────────────────────────────────────────────────────────────

translateBtn.style.backgroundColor = CONFIG.UI_COLOR;
popupTitle.style.color = CONFIG.UI_COLOR;
progressFill.style.backgroundColor = CONFIG.UI_COLOR;
// ── Debug panel ─────────────────────────────────────────────────────────────

if (CONFIG.DEBUG) {
    debugPanel.hidden = false;
}

let _debugEntryCount = 0;

const LEVEL_ICON = { info: "ℹ️", warn: "⚠️", error: "❌" };

function appendDebugLog({ level, message, detail, ts }) {
    _debugEntryCount++;
    debugCount.textContent = `${_debugEntryCount} entr${_debugEntryCount === 1 ? "y" : "ies"}`;

    const row = document.createElement("div");
    row.className = `dlog dlog-${level || "info"}`;

    const icon = LEVEL_ICON[level] || "ℹ️";
    row.innerHTML =
        `<span class="dlog-ts">${ts || ""}</span>` +
        `<span class="dlog-msg">${icon} ${escHtml(message)}</span>` +
        (detail ? `<span class="dlog-detail">${escHtml(detail)}</span>` : "");

    debugLog.appendChild(row);
    // Auto-scroll to latest entry
    debugLog.scrollTop = debugLog.scrollHeight;
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

debugClear.addEventListener("click", e => {
    e.stopPropagation();
    debugLog.innerHTML = "";
    _debugEntryCount = 0;
    debugCount.textContent = "0 entries";
});

// Collapse / expand the log list when clicking the header bar
document.getElementById("debug-header").addEventListener("click", () => {
    debugLog.style.display = debugLog.style.display === "none" ? "" : "none";
});
// ── Dropdown builders ─────────────────────────────────────────────────────────

function buildSourceDropdown() {
    sourceSelect.innerHTML = "";
    const autoOpt = document.createElement("option");
    autoOpt.value = LANG_AUTO.code;
    autoOpt.textContent = LANG_AUTO.label;
    sourceSelect.appendChild(autoOpt);

    Object.values(LANG).forEach(({ code, label }) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = label;
        sourceSelect.appendChild(opt);
    });
}

/** Rebuild target dropdown showing only API-valid targets for the given source. */
function buildTargetDropdown(sourceCode) {
    const prev = targetSelect.value;
    targetSelect.innerHTML = "";

    const validTargets = sourceCode === LANG_AUTO.code
        ? Object.values(LANG)
        : Object.values(LANG).filter(({ code }) =>
            LANG_PAIRS.some(([s, t]) => s === sourceCode && t === code)
        );

    validTargets.forEach(({ code, label }) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = label;
        targetSelect.appendChild(opt);
    });

    // Restore previous selection when still valid, else pick first
    targetSelect.value = validTargets.some(l => l.code === prev)
        ? prev
        : (validTargets[0]?.code || "");

    updatePairHint();
    updateSwapBtn();
}

// ── Pair hint & swap ──────────────────────────────────────────────────────────

function updatePairHint() {
    const src = sourceSelect.value;
    const tgt = targetSelect.value;

    if (!src || !tgt || src === tgt) {
        pairHintText.textContent = "";
        return;
    }

    const srcLabel = src === LANG_AUTO.code
        ? LANG_AUTO.label
        : (Object.values(LANG).find(l => l.code === src)?.label || src);
    const tgtLabel = Object.values(LANG).find(l => l.code === tgt)?.label || tgt;
    pairHintText.textContent = `${srcLabel} → ${tgtLabel}`;
}

function updateSwapBtn() {
    const src = sourceSelect.value;
    const tgt = targetSelect.value;
    swapBtn.disabled = src === LANG_AUTO.code ||
        !LANG_PAIRS.some(([s, t]) => s === tgt && t === src);
}

swapBtn.addEventListener("click", () => {
    const src = sourceSelect.value;
    const tgt = targetSelect.value;
    sourceSelect.value = tgt;
    buildTargetDropdown(tgt);
    targetSelect.value = src;
    updatePairHint();
    updateSwapBtn();
    savePreferences();
});

sourceSelect.addEventListener("change", () => {
    buildTargetDropdown(sourceSelect.value);
    savePreferences();
});

targetSelect.addEventListener("change", () => {
    updatePairHint();
    updateSwapBtn();
    savePreferences();
});

// ── Preferences ───────────────────────────────────────────────────────────────

function loadSavedPreferences() {
    chrome.storage.local.get(["tmtSourceLang", "tmtTargetLang"], result => {
        if (result.tmtSourceLang) sourceSelect.value = result.tmtSourceLang;
        buildTargetDropdown(sourceSelect.value);
        if (result.tmtTargetLang &&
            targetSelect.querySelector(`option[value="${result.tmtTargetLang}"]`)) {
            targetSelect.value = result.tmtTargetLang;
        }
        updatePairHint();
        updateSwapBtn();
    });
}

function savePreferences() {
    chrome.storage.local.set({
        tmtSourceLang: sourceSelect.value,
        tmtTargetLang: targetSelect.value
    });
}

// ── Status & progress ─────────────────────────────────────────────────────────

function setStatus(text, type) {
    statusMsg.textContent = text;
    statusMsg.className = type || "";
}

function showProgress(done, total) {
    progressWrap.hidden = false;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    progressLabel.textContent = total > 0
        ? `${done} / ${total} text blocks`
        : "Scanning page…";
}

function hideProgress() {
    progressWrap.hidden = true;
    progressFill.style.width = "0%";
}

// Listen for real-time messages from content.js
chrome.runtime.onMessage.addListener(msg => {
    if (msg?.type === "TRANSLATION_PROGRESS") {
        showProgress(msg.done, msg.total);
    }
    if (msg?.type === "DEBUG_LOG") {
        appendDebugLog(msg);
    }
});

// ── Inject + message helper ───────────────────────────────────────────────────

const CONTENT_SCRIPTS = ["config.js", "lang.js", "errors.js", "cache.js", "utils.js", "content.js"];

function injectAndMessage(tabId, message, callback) {
    // PING first: skip injection if content script is already running
    chrome.tabs.sendMessage(tabId, { type: "PING" }, pingResp => {
        void chrome.runtime.lastError; // suppress unchecked-error console warning
        if (pingResp?.ok) {
            chrome.tabs.sendMessage(tabId, message, callback);
            return;
        }
        // Reset the load guard first — if the extension was reloaded, the old
        // context is invalidated but window.__tmtLoaded may still be true,
        // which would cause content.js to exit early without registering a listener.
        chrome.scripting.executeScript(
            { target: { tabId }, func: () => { window.__tmtLoaded = false; } },
            () => {
                void chrome.runtime.lastError; // ignore if page is restricted
                chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS }, () => {
                    if (chrome.runtime.lastError) {
                        callback({ error: "Cannot translate this page." });
                        return;
                    }
                    chrome.tabs.sendMessage(tabId, message, callback);
                });
            }
        );
    });
}

// ── Translate ─────────────────────────────────────────────────────────────────

translateBtn.addEventListener("click", () => {
    const source = sourceSelect.value;
    const target = targetSelect.value;

    if (source !== LANG_AUTO.code && source === target) {
        setStatus("Source and target must differ.", "error");
        return;
    }

    savePreferences();
    setStatus("Scanning page…");
    translateBtn.disabled = true;
    restoreBtn.hidden = true;
    showProgress(0, 0);

    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs?.[0]?.id) {
            setStatus("No active tab found.", "error");
            translateBtn.disabled = false;
            hideProgress();
            return;
        }

        injectAndMessage(
            tabs[0].id,
            { type: "TRANSLATE_PAGE", source, target },
            response => {
                translateBtn.disabled = false;
                hideProgress();

                if (chrome.runtime.lastError || !response) {
                    setStatus("Could not reach page. Try reloading.", "error");
                    return;
                }

                if (response.error) {
                    setStatus(response.error, "error");
                    return;
                }

                if (response.success) {
                    const label = response.count != null ? ` (${response.count} blocks)` : "";
                    setStatus(`Done!${label}`, "success");
                    restoreBtn.hidden = false;
                } else {
                    setStatus(response.error || "Translation failed.", "error");
                }
            }
        );
    });
});

// ── Restore ───────────────────────────────────────────────────────────────────

restoreBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs?.[0]?.id) return;
        chrome.tabs.sendMessage(tabs[0].id, { type: "RESTORE_PAGE" }, () => {
            void chrome.runtime.lastError;
            restoreBtn.hidden = true;
            setStatus("Page restored.", "");
        });
    });
});

// ── Init ──────────────────────────────────────────────────────────────────────

buildSourceDropdown();
buildTargetDropdown(LANG.EN.code); // default before prefs load
loadSavedPreferences();
