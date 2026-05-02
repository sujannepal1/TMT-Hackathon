# TMT Translator — Browser Extension

A Chrome browser extension that translates entire webpages between **English**, **Nepali**, and **Tamang** using the [ILPRL TMT Translation API](https://tmt.ilprl.ku.edu.np).

Built as part of the **Trilingual Machine Translation (TMT)** project at Kathmandu University.

---

## Table of Contents

1. [User Guide](#user-guide)
   - [Installation](#installation)
   - [Translating a Page](#translating-a-page)
   - [Translating Selected Text](#translating-selected-text)
   - [Using the Context Menu](#using-the-context-menu)
   - [Restoring the Original Page](#restoring-the-original-page)
   - [Troubleshooting](#troubleshooting)
2. [System Details](#system-details)
   - [Supported Language Pairs](#supported-language-pairs)
   - [File Structure](#file-structure)
   - [Architecture](#architecture)
   - [Configuration Reference](#configuration-reference)
   - [Permissions](#permissions)
   - [Adding a New Language](#adding-a-new-language)
   - [Security Notes](#security-notes)

---

## User Guide

### Installation

**What you need:**
- Google Chrome (version 88 or later) or any Chromium-based browser (Edge, Brave, etc.)
- A TMT API bearer token (provided by ILPRL / Kathmandu University)

**Steps:**

1. Download or clone this repository to your computer.

2. Open `config.js` in any text editor and paste your bearer token:
   ```js
   BEARER_TOKEN: "team_your_token_here"
   ```

3. Open Chrome and go to `chrome://extensions` in the address bar.

4. Turn on **Developer mode** using the toggle in the top-right corner.

5. Click **Load unpacked** and select the `extesnion_/` folder.

6. The TMT Translator icon (🌐) will appear in your toolbar. If you don't see it, click the puzzle-piece icon and pin TMT Translator.

---

### Translating a Page

1. Go to any webpage you want to translate.
2. Click the **TMT Translator** icon in the toolbar to open the popup.
3. In the **From** dropdown, choose the source language (or leave it on Auto Detect if unsure).
4. In the **To** dropdown, choose your target language. Only valid pairs are shown — if a language doesn't appear, that direction isn't supported by the API yet.
5. Click **Translate Page**.
6. A progress bar will show how many text blocks have been translated. Depending on the page length and API speed, this may take a few seconds to a couple of minutes.
7. Once done, the status line will show **Done! (N blocks)**.

> **Tip:** The extension remembers your last language pair, so you don't need to re-select it every time.

---

### Translating Selected Text

1. On any webpage, click and drag to highlight the text you want to translate.
2. Right-click on the highlighted text.
3. Choose **Translate Selection** from the context menu.
4. A small tooltip will appear just below your selection with the translated text. It disappears automatically after 5 seconds, or you can click anywhere to dismiss it.

---

### Using the Context Menu

You can translate a page without opening the popup:

1. Right-click anywhere on a page (no text needs to be selected).
2. Click **Translate This Page**.
3. The page will be translated using the last language pair you set in the popup.

---

### Restoring the Original Page

After translating, a **↩ Restore** button appears in the popup.

- Click it to revert every translated text block back to its original content.
- This also works if you want to switch to a different language pair — restore first, then translate again.

---

### Troubleshooting

| Problem | What to try |
|---------|-------------|
| "Could not reach page. Try reloading." | Reload the tab, then click Translate again. This usually happens on tabs that were open before the extension was installed. |
| Translation stops partway through | The API may be rate-limiting requests. Wait 10–15 seconds and try again. The extension will retry automatically up to 3 times per sentence. |
| Some text is not translated | Certain elements (code blocks, scripts, SVGs, math) are intentionally skipped to avoid breaking the page. |
| Popup shows no target languages | The source language you selected has no supported pairs. Try English or Nepali as the source. |
| Extension icon missing | Go to `chrome://extensions`, confirm TMT Translator is enabled, and pin it from the toolbar puzzle-piece menu. |

---

## System Details

### Supported Language Pairs

| Source | Target |
|--------|--------|
| Nepali (`ne`) | English (`en`) |
| English (`en`) | Nepali (`ne`) |
| English (`en`) | Tamang (`tmg`) |
| Tamang (`tmg`) | English (`en`) |
| Tamang (`tmg`) | Nepali (`ne`) |
| Nepali (`ne`) | Tamang (`tmg`) |

The popup filters target options at runtime based on `LANG_PAIRS` in `lang.js` — invalid pairs are never shown or sent to the API.

---

## File Structure

```
extesnion_/
├── manifest.json     # MV3 manifest — permissions, content scripts, service worker
├── config.js         # API URL, bearer token, request delay, UI color, debug flag
├── lang.js           # LANG enum + LANG_AUTO + LANG_PAIRS (all valid API combinations)
├── errors.js         # Human-readable error message constants
├── cache.js          # In-memory { original → translated } cache object
├── utils.js          # Shared helpers: normalizeLangCode, splitIntoSentences, isTranslatableNode
├── content.js        # DOM traversal, translation queue, progress reporting, message listener
├── background.js     # Service worker — API fetch, context menus, script injection helper
├── popup.html        # Popup markup and styles
└── popup.js          # Popup logic — dropdowns, swap, progress bar, translate, restore
```

---

## Architecture

### Request flow

```
User clicks "Translate Page"
        │
        ▼
   popup.js
   ├─ PING → content.js  (already loaded? send directly)
   └─ if not loaded: reset __tmtLoaded flag → inject scripts → send TRANSLATE_PAGE
        │
        ▼
   content.js  (running inside the page)
   ├─ collectTextNodes() + collectInputPlaceholders() + collectButtonValues()
   ├─ enqueue() each text string
   └─ pumpQueue() — one item at a time
        │
        ▼ chrome.runtime.sendMessage({ type: "TRANSLATE_TEXT" })
        │
        ▼
   background.js  (service worker — no CORS restrictions)
   └─ fetch() → TMT API → sendResponse({ ok, output })
        │
        ▼
   content.js updates the DOM node in-place
   └─ chrome.runtime.sendMessage({ type: "TRANSLATION_PROGRESS" }) → popup progress bar
```

### Why API calls go through the background script

Content scripts run inside the page's origin context, which means the browser enforces CORS on their `fetch()` calls. The TMT API server does not include `tmt.ilprl.ku.edu.np` on Google Docs' (or any other site's) allowed-origins list, so every direct `fetch()` from a content script fails immediately with "Failed to fetch".

The background service worker runs in the extension's own origin, which is exempt from CORS entirely. All API calls are routed through it via `chrome.runtime.sendMessage`.

### Queue pump

The TMT API accepts one sentence per request. `content.js` maintains a FIFO queue and processes sentences one at a time with a configurable `DELAY_MS` gap between requests to stay within rate limits. Sentences already in the in-memory cache skip the queue entirely.

### Re-injection safety

All content-script globals (`CONFIG`, `LANG`, `cache`, etc.) are declared with `var` inside `if (typeof X === "undefined")` guards. This lets Chrome re-inject the scripts into an already-running tab (after extension reload) without throwing `SyntaxError: Identifier already declared`.

The `window.__tmtLoaded` guard at the top of `content.js` prevents double-execution. It is reset to `false` by a tiny inline script before re-injection, so a stale flag from an invalidated context never blocks the fresh listener from registering.

---

## Configuration Reference

All user-configurable values live in `config.js`. Edit them there — no other files need touching.

| Key | Default | Description |
|-----|---------|-------------|
| `API_URL` | `https://tmt.ilprl.ku.edu.np/lang-translate` | Translation API endpoint |
| `BEARER_TOKEN` | `team_xxxx…` | Your team's API bearer token |
| `DELAY_MS` | `500` | Milliseconds between queued API calls |
| `UI_COLOR` | `#4CAF50` | Accent color for buttons, progress bar, and tooltip |
| `DEBUG` | `true` | Show/hide the live debug log panel in the popup |

`background.js` has its own `CONFIG_BG` with `API_URL` and `BEARER_TOKEN` duplicated — service workers cannot access content-script globals, so keep both in sync when you change the token.

---

## Permissions

| Permission | Why it's needed |
|------------|-----------------|
| `activeTab` | Get the current tab's ID so we can send it messages |
| `scripting` | Inject content scripts into tabs that were open before the extension loaded |
| `contextMenus` | Add "Translate This Page" and "Translate Selection" to the right-click menu |
| `storage` | Save the last-used language pair so it persists across browser sessions |
| `host_permissions: <all_urls>` | Allow script injection on any website the user visits |

---

## Adding a New Language

1. Add the language to `LANG` in `lang.js`:
   ```js
   XX: { code: "xx", label: "New Language" }
   ```
2. Add its valid translation pairs to `LANG_PAIRS`:
   ```js
   ["xx", "en"],
   ["en", "xx"]
   ```
3. That's it. The popup dropdowns, pair validation, and swap button all read from `LANG_PAIRS` at runtime — nothing else needs to change.

---

## Security Notes

- The bearer token is stored in `config.js` as a plain string. It is only ever sent to the TMT API over HTTPS.
- No user text is stored anywhere — the in-memory cache is scoped to the page session and is cleared on every language change.
- The extension does not request `tabs`, `history`, `cookies`, `webRequest`, or any other sensitive permission beyond what is listed above.
- DOM nodes are modified in-place by overwriting `.textContent` only. No HTML is injected from API responses.

---

## License

Developed for the TMT Hackathon under Kathmandu University / ILPRL. All rights reserved.
