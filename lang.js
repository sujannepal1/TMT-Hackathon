// Language enum — add/edit languages here; changes reflect everywhere automatically
if (typeof LANG === "undefined") {
    var LANG = {
        EN: { code: "en", label: "English" },
        NE: { code: "ne", label: "Nepali" },
        TMG: { code: "tmg", label: "Tamang" }
    };
}

// Special source-only option for auto language detection
if (typeof LANG_AUTO === "undefined") {
    var LANG_AUTO = { code: "auto", label: "Auto Detect" };
}

// All API-supported translation pairs — enforced in the popup and content script.
// Only these src→tgt combinations are accepted by the TMT API.
if (typeof LANG_PAIRS === "undefined") {
    var LANG_PAIRS = [
        ["ne", "en"],
        ["en", "ne"],
        ["en", "tmg"],
        ["tmg", "en"],
        ["tmg", "ne"],
        ["ne", "tmg"]
    ];
}
