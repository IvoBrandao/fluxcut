/**
 * FluxCut — src/zoneManager.js
 * Converts normalized preset zone rects → pixel Meta.Rectangle values,
 * and applies window snap assignments.
 */

import Meta from "gi://Meta";
import { getPresetById, PRESETS } from "./layoutPresets.js";

export class ZoneManager {
    constructor(settings, customZones, logger) {
        this._settings = settings;
        this._customZones = customZones;
        this._log = logger;
    }

    // ------------------------------------------------------------------ zone rect calculation

    /**
     * Get pixel zone rects for a preset on a specific monitor.
     *
     * @param {string} presetId     - built-in preset id OR custom zone set id
     * @param {number} monitorIndex - monitor index (from global.display)
     * @param {number} [gapSize]    - gap override; falls back to settings
     * @returns {Meta.Rectangle[]}
     */
    getZoneRects(presetId, monitorIndex, gapSize) {
        const gap = gapSize ?? this._settings.windowGapSize;
        const workarea = this._getWorkarea(monitorIndex);
        if (!workarea) return [];

        const preset = getPresetById(presetId) ?? this._customZones.getById(presetId);
        if (!preset) {
            this._log?.warn(`ZoneManager: unknown preset '${presetId}'`);
            return [];
        }

        return preset.zones.map(norm => this._normToPixel(norm, workarea, gap));
    }

    /**
     * Get zone rects for all built-in presets on a monitor (used by overlay).
     *
     * @param {number} monitorIndex
     * @returns {Map<string, Meta.Rectangle[]>}
     */
    getAllPresetRects(monitorIndex) {
        const map = new Map();
        const all = [...PRESETS, ...this._customZones.getAll()];
        for (const preset of all) {
            map.set(preset.id, this.getZoneRects(preset.id, monitorIndex));
        }
        return map;
    }

    /**
     * Find which zone (if any) the given pointer position falls within,
     * based on proximity to zone edges.
     *
     * @param {number} px           - pointer x (global coords)
     * @param {number} py           - pointer y
     * @param {string} presetId
     * @param {number} monitorIndex
     * @returns {{ rect: Meta.Rectangle, zoneIndex: number } | null}
     */
    getHoveredZone(px, py, presetId, monitorIndex) {
        const threshold = this._settings.dragEdgeThreshold;
        const rects = this.getZoneRects(presetId, monitorIndex);
        const workarea = this._getWorkarea(monitorIndex);
        if (!workarea) return null;

        // Check if pointer inside workarea at all
        if (px < workarea.x || px > workarea.x + workarea.width ||
            py < workarea.y || py > workarea.y + workarea.height)
            return null;

        // Find zone whose edge is closest to pointer
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            const nearLeft   = Math.abs(px - r.x) < threshold && py >= r.y && py <= r.y + r.height;
            const nearRight  = Math.abs(px - (r.x + r.width)) < threshold && py >= r.y && py <= r.y + r.height;
            const nearTop    = Math.abs(py - r.y) < threshold && px >= r.x && px <= r.x + r.width;
            const nearBottom = Math.abs(py - (r.y + r.height)) < threshold && px >= r.x && px <= r.x + r.width;

            if (nearLeft || nearRight || nearTop || nearBottom)
                return { rect: r, zoneIndex: i };
        }

        // Fallback: check if pointer is inside any zone
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (px >= r.x && px <= r.x + r.width &&
                py >= r.y && py <= r.y + r.height)
                return { rect: r, zoneIndex: i };
        }

        return null;
    }

    /**
     * Check which zone index best matches a given pixel rect (used when
     * moving windows across monitors to find an equivalent zone).
     *
     * @param {Meta.Rectangle} rect  - current zone rect (from old monitor)
     * @param {string} presetId
     * @param {number} monitorIndex
     * @returns {number} best matching zone index, or 0 as fallback
     */
    findClosestZoneIndex(rect, presetId, monitorIndex) {
        const rects = this.getZoneRects(presetId, monitorIndex);
        if (!rects.length) return 0;

        const oldWorkarea = this._getWorkareaForRect(rect);
        if (!oldWorkarea) return 0;

        // Normalise the old rect
        const normX = (rect.x - oldWorkarea.x) / oldWorkarea.width;
        const normY = (rect.y - oldWorkarea.y) / oldWorkarea.height;

        const newWorkarea = this._getWorkarea(monitorIndex);
        if (!newWorkarea) return 0;

        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            const rNormX = (r.x - newWorkarea.x) / newWorkarea.width;
            const rNormY = (r.y - newWorkarea.y) / newWorkarea.height;
            const dist = Math.hypot(normX - rNormX, normY - rNormY);
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        }
        return best;
    }

    // ------------------------------------------------------------------ window assignment

    /**
     * Snap a window to a zone rect.
     *
     * Always applies the geometry immediately via move_resize_frame.
     * Mutter's compositor provides its own smooth window transitions,
     * so we do not need custom actor animation (easeRect was unreliable
     * because Mutter manages compositor actor allocation and overrides
     * animated x/y/width/height properties).
     *
     * @param {Meta.Window} metaWindow
     * @param {Meta.Rectangle} zoneRect
     */
    assignWindowToZone(metaWindow, zoneRect) {
        if (!metaWindow) return;

        // Must unmaximize before resizing (GNOME ignores move_resize on maximized windows)
        const maxFlags = metaWindow.get_maximized?.() ?? 0;
        if (maxFlags) {
            metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
        }

        metaWindow.move_resize_frame(
            true,
            zoneRect.x, zoneRect.y,
            zoneRect.width, zoneRect.height
        );
    }

    /**
     * Return the monitor index under the given pixel point.
     *
     * @param {number} px
     * @param {number} py
     * @returns {number}
     */
    getMonitorForPoint(px, py) {
        const n = global.display.get_n_monitors();
        for (let i = 0; i < n; i++) {
            const g = global.display.get_monitor_geometry(i);
            if (px >= g.x && px < g.x + g.width &&
                py >= g.y && py < g.y + g.height)
                return i;
        }
        return global.display.get_current_monitor();
    }

    // ------------------------------------------------------------------ private helpers

    /**
     * Convert a normalized rect to pixel Meta.Rectangle within a workarea,
     * applying inward gap on all sides.
     */
    _normToPixel(norm, workarea, gap) {
        const wa = workarea;
        const halfGap = gap / 2;

        const x = Math.round(wa.x + norm.x * wa.width  + halfGap);
        const y = Math.round(wa.y + norm.y * wa.height + halfGap);
        const w = Math.round(norm.w * wa.width  - gap);
        const h = Math.round(norm.h * wa.height - gap);

        // Clamp to workarea to avoid tiny rounding overflows
        return new Meta.Rectangle({
            x: Math.max(x, wa.x),
            y: Math.max(y, wa.y),
            width:  Math.max(w, 40),
            height: Math.max(h, 40),
        });
    }

    /**
     * Get the workarea for a monitor, merging panel/dock exclusions.
     *
     * get_work_area_for_monitor() can be called on ANY Meta.Window to return
     * the workarea for ANY monitor, so we just need a window reference — it
     * doesn't have to be on the target monitor.
     *
     * @param {number} monitorIndex
     * @returns {Meta.Rectangle|null}
     */
    _getWorkarea(monitorIndex) {
        try {
            // Prefer the focused window (cheapest lookup)
            const focused = global.display.get_focus_window();
            if (focused) {
                return focused.get_work_area_for_monitor(monitorIndex);
            }
            // Any managed window will do — use compositor actor list (fast C call)
            const actors = global.get_window_actors?.() ?? [];
            for (const actor of actors) {
                const w = actor.meta_window;
                if (w) return w.get_work_area_for_monitor(monitorIndex);
            }
            // Last resort: raw geometry (no panel subtraction)
            return global.display.get_monitor_geometry(monitorIndex);
        } catch (e) {
            this._log?.error("ZoneManager._getWorkarea:", e.message);
            return null;
        }
    }

    _getWorkareaForRect(rect) {
        const n = global.display.get_n_monitors();
        for (let i = 0; i < n; i++) {
            const g = global.display.get_monitor_geometry(i);
            if (rect.x >= g.x && rect.x < g.x + g.width)
                return this._getWorkarea(i);
        }
        return null;
    }
}
