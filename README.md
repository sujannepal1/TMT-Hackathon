# TMT Translator — Browser Extension

A Chrome browser extension that translates entire webpages between **English**, **Nepali**, and **Tamang** using the [ILPRL TMT Translation API](https://tmt.ilprl.ku.edu.np).

Built as part of the **Trilingual Machine Translation (TMT)** project at Kathmandu University.

---

## Supported Language Pairs

| Source | Target |
|--------|--------|
| Nepali (`ne`) | English (`en`) |
| English (`en`) | Nepali (`ne`) |
| English (`en`) | Tamang (`tmg`) |
| Tamang (`tmg`) | English (`en`) |
| Tamang (`tmg`) | Nepali (`ne`) |
| Nepali (`ne`) | Tamang (`tmg`) |

> The popup only shows valid target languages for the chosen source — invalid pairs are never sent to the API.

---

## Features

- **Full-page translation** — traverses all visible text nodes and input placeholders
- **Selection translation** — right-click any selected text → "Translate Selection" (shows a tooltip)
- **Context menu** — right-click anywhere on a page → "Translate This Page"
- **Real-time progress bar** — shows how many text blocks have been processed
- **Restore / undo** — "↩ Restore" button reverts the page to its original text
- **Intelligent caching** — translated sentences are cached in memory; repeated text costs zero API calls
- **Rate-limit handling** — automatic 1-second retry on HTTP 429
- **Language memory** — last-used language pair is persisted via `chrome.storage.local`
- **Swap button** — one click to flip source ↔ target (only enabled for reversible pairs)

---

## File Structure

```
extesnion_v2/
├── manifest.json     # MV3 manifest — permissions, content scripts, service worker
├── config.js         # API URL, bearer token, delay, UI color
├── lang.js           # LANG enum + LANG_AUTO + LANG_PAIRS (all valid API pairs)
├── errors.js         # Human-readable error constants
├── cache.js          # In-memory { original → translated } cache
├── utils.js          # normalizeLangCode, splitIntoSentences, delay, isTranslatableNode
├── content.js        # DOM traversal, queue pump, translation, progress reporting
├── background.js     # Service worker — context menus, inject-and-send helper
├── popup.html        # Popup markup
└── popup.js          # Popup logic — dropdowns, swap, progress, translate, restore
```

---

## Setup

### Prerequisites
- Google Chrome (or any Chromium browser)
- A valid TMT API bearer token

### Installation

1. **Clone or download** this repository.

2. **Set your API token** in `config.js`:
   ```js
   BEARER_TOKEN: "team_xxxxxxxxxxxxxxxxxxxx"
   ```

3. **Load the extension in Chrome:**
   - Open `chrome://extensions`
   - Enable **Developer mode** (top-right toggle)
   - Click **Load unpacked**
   - Select the `extesnion_v2/` folder

4. The TMT Translator icon appears in the toolbar. Pin it for easy access.

---

## Usage

### Translate a full page
1. Navigate to any webpage.
2. Click the **TMT Translator** toolbar icon.
3. Select **From** and **To** languages (only valid pairs are shown).
4. Click **Translate Page**.
5. A progress bar tracks completion. Click **↩ Restore** to undo.

### Translate selected text
1. Highlight any text on a page.
2. Right-click → **Translate Selection**.
3. A tooltip appears below the selection with the translated text (auto-dismisses after 5 s).

### Translate via context menu
1. Right-click anywhere on a page (no selection needed).
2. Click **Translate This Page** — uses your last-saved language pair.

---

## Architecture

```
Popup ──────────────────────────────────► Content Script
  │  TRANSLATE_PAGE / RESTORE_PAGE           │
  │  (via chrome.tabs.sendMessage)           │ translatePage()
  │◄──────────────────────────────────────── │ TRANSLATION_PROGRESS
  │                                          │ (chrome.runtime.sendMessage)
  │                                          │
Background ─────────────────────────────► Content Script
  │  TRANSLATE_PAGE / TRANSLATE_SELECTION    │
  │  (context menu → injectAndSend)          │
```

**Injection strategy:** Before sending any message the popup (and background) first sends a `PING`. If the content script responds, the message is sent directly. If not (tab was open before extension loaded), scripts are injected via `chrome.scripting.executeScript` first. All shared globals (`CONFIG`, `LANG`, `cache`, etc.) use `if (typeof X === "undefined")` guards to survive re-injection without re-declaration errors.

**Queue pump:** The API accepts one sentence per request. `content.js` maintains a FIFO queue and processes items one at a time with a configurable `DELAY_MS` between requests. Cached sentences are resolved immediately without hitting the queue.

---

## Configuration

Edit `config.js` to change any of these at any time:

| Key | Default | Description |
|-----|---------|-------------|
| `API_URL` | `https://tmt.ilprl.ku.edu.np/lang-translate` | Translation API endpoint |
| `BEARER_TOKEN` | `team_xxxx…` | Your team's bearer token |
| `DELAY_MS` | `500` | ms between API requests |
| `UI_COLOR` | `#4CAF50` | Accent color for buttons and progress bar |

---

## Adding a New Language

1. Add an entry to `LANG` in `lang.js`:
   ```js
   XX: { code: "xx", label: "New Language" }
   ```
2. Add its valid pairs to `LANG_PAIRS`:
   ```js
   ["xx", "en"],
   ["en", "xx"]
   ```
3. The popup dropdowns and validation update automatically — no other files need changing.

---

## Permissions Used

| Permission | Reason |
|------------|--------|
| `activeTab` | Read the active tab's ID for messaging |
| `scripting` | Inject content scripts into existing tabs |
| `contextMenus` | "Translate This Page" and "Translate Selection" right-click items |
| `storage` | Persist last-used language pair across sessions |
| `host_permissions: <all_urls>` | Allow content script injection on any website |

---

## Security Notes

- The bearer token is stored in `config.js` (local file, never transmitted except to the TMT API over HTTPS).
- No user text is logged or stored beyond the in-memory session cache, which is cleared on each language change.
- The extension does not request `tabs`, `history`, `cookies`, or any other sensitive permissions.

---

## License

This project is developed for the TMT Hackathon under Kathmandu University / ILPRL. All rights reserved.
