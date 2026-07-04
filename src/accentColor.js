/**
 * Window Tiling Control — src/accentColor.js
 * Reads the GNOME desktop accent color (GNOME 47+) and exposes it as RGBA
 * strings for our overlays. Falls back to a blue accent on older GNOME or
 * when the key is unavailable.
 *
 * The accent enum values map to the standalone libadwaita accent colors.
 */

import Gio from "gi://Gio";

const IFACE_SCHEMA = "org.gnome.desktop.interface";
const ACCENT_KEY = "accent-color";

/** GNOME accent name → [r, g, b] (libadwaita standalone colors). */
const ACCENTS = {
    blue:   [53, 132, 228],
    teal:   [33, 144, 164],
    green:  [58, 148, 74],
    yellow: [200, 136, 0],
    orange: [237, 91, 0],
    red:    [230, 45, 66],
    pink:   [213, 97, 153],
    purple: [145, 65, 172],
    slate:  [111, 131, 150],
};

const FALLBACK = ACCENTS.blue;

export class AccentColor {
    constructor(logger) {
        this._log = logger;
        this._iface = null;
        this._sigId = null;

        try {
            this._iface = new Gio.Settings({ schema_id: IFACE_SCHEMA });
        } catch (_) {
            this._iface = null;
        }
    }

    /** True when the running GNOME exposes the accent-color key. */
    get available() {
        try {
            return !!this._iface?.settings_schema?.has_key?.(ACCENT_KEY);
        } catch (_) {
            return false;
        }
    }

    /** Subscribe to accent-color changes. Callback receives no args. */
    connect(callback) {
        if (!this.available || this._sigId !== null) return;
        try {
            this._sigId = this._iface.connect(`changed::${ACCENT_KEY}`, () => callback());
        } catch (_) {
            this._sigId = null;
        }
    }

    disconnect() {
        if (this._sigId !== null) {
            try { this._iface.disconnect(this._sigId); } catch (_) {}
            this._sigId = null;
        }
    }

    /** @returns {[number, number, number]} current accent RGB. */
    rgb() {
        if (!this.available) return FALLBACK;
        try {
            return ACCENTS[this._iface.get_string(ACCENT_KEY)] ?? FALLBACK;
        } catch (_) {
            return FALLBACK;
        }
    }

    /** @returns {string} `rgba(r,g,b,a)` at the given alpha (0–1). */
    rgba(alpha = 1) {
        const [r, g, b] = this.rgb();
        return `rgba(${r},${g},${b},${alpha})`;
    }
}
