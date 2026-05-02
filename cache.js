// In-memory translation cache: { "original": "translated" }
// Survives for the lifetime of the page; reset on language change.
if (typeof cache === "undefined") {
    var cache = {
        _store: {},

        /** Return the cached translation, or null if not present. */
        get(key) {
            return Object.prototype.hasOwnProperty.call(this._store, key)
                ? this._store[key]
                : null;
        },

        /** Store a translation result. */
        set(key, value) {
            this._store[key] = value;
        },

        /** Check existence without retrieving the value. */
        has(key) {
            return Object.prototype.hasOwnProperty.call(this._store, key);
        },

        /** Wipe the cache (called on language change). */
        clear() {
            this._store = {};
        }
    };
}
