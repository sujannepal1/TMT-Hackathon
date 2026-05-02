// Central configuration — edit here, reflects everywhere
if (typeof CONFIG === "undefined") {
    var CONFIG = {
        API_URL: "https://tmt.ilprl.ku.edu.np/lang-translate",
        BEARER_TOKEN: "team_XXXXXXXXXXXX",
        DELAY_MS: 500,     // Milliseconds to wait between API calls (rate-limit friendliness)
        UI_COLOR: "#4CAF50",  // Accent color used across popup and tooltip UI
        DEBUG: true           // Set to false to hide the debug panel in the popup
    };
}
