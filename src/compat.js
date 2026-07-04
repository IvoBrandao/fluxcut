/**
 * Window Tiling Control — src/compat.js
 * GNOME Shell version compatibility shim (45–50+).
 *
 * API changes across versions:
 *   - GNOME 46+: Meta.Rectangle removed → Mtk.Rectangle
 *   - GNOME 49+: MetaWindow.get_maximized() → get_maximize_flags()
 */

import Meta from "gi://Meta";

// ── Rectangle constructor ────────────────────────────────────────────────────
// GNOME 45: Meta.Rectangle exists
// GNOME 46+: Meta.Rectangle removed; Mtk.Rectangle is the replacement.
//            However Mtk may not exist on 45, so try both.

let _RectClass = Meta.Rectangle;

if (!_RectClass) {
    try {
        const Mtk = (await import("gi://Mtk")).default;
        _RectClass = Mtk.Rectangle;
    } catch (_) {
        // Fallback: plain object with the same shape. Anything that only reads
        // .x/.y/.width/.height will work; GObject-typed APIs will not.
        _RectClass = null;
    }
}

/**
 * Create a rectangle compatible with the running GNOME version.
 *
 * @param {{ x: number, y: number, width: number, height: number }} params
 * @returns {Meta.Rectangle|Mtk.Rectangle|{ x, y, width, height }}
 */
export function makeRect({ x, y, width, height }) {
    if (_RectClass) {
        return new _RectClass({ x, y, width, height });
    }
    // Ultimate fallback — a plain object.
    return { x, y, width, height };
}

// ── Maximize helpers ─────────────────────────────────────────────────────────
// GNOME 45-48: MetaWindow.get_maximized()   returns Meta.MaximizeFlags
// GNOME 49+:   MetaWindow.get_maximize_flags() (get_maximized removed)
//              MetaWindow.is_maximized() exists on 49+ too

/**
 * Get the maximize flags for a window, compatible across GNOME 45-49+.
 *
 * @param {Meta.Window} win
 * @returns {number} Meta.MaximizeFlags value (0 = not maximized)
 */
export function getMaximizeFlags(win) {
    if (typeof win.get_maximized === "function")
        return win.get_maximized();
    if (typeof win.get_maximize_flags === "function")
        return win.get_maximize_flags();
    // Fallback: check boolean properties (GNOME 49+)
    if (win.maximized_horizontally && win.maximized_vertically)
        return Meta.MaximizeFlags.BOTH;
    if (win.maximized_horizontally)
        return Meta.MaximizeFlags.HORIZONTAL;
    if (win.maximized_vertically)
        return Meta.MaximizeFlags.VERTICAL;
    return 0;
}

/**
 * Check if a window is fully maximized (both axes).
 *
 * @param {Meta.Window} win
 * @returns {boolean}
 */
export function isFullyMaximized(win) {
    return getMaximizeFlags(win) === Meta.MaximizeFlags.BOTH;
}
