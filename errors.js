// Human-readable error constants — reference these instead of raw strings
if (typeof ERRORS === "undefined") {
    var ERRORS = {
        API_FAIL: "Translation failed",
        NETWORK: "Network error",
        TIMEOUT: "Request timed out",
        INVALID_RESPONSE: "Invalid API response"
    };
}
