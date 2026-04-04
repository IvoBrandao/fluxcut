/**
 * FluxCut — src/maximizeHook.js
 * Feature: "Hovering the maximize button shows snap layouts"
 *
 * GNOME Shell 45-49 does not expose a pre-maximize hook, so this module
 * uses a retroactive intercept: when any window transitions to the fully
 * maximized state AND the intercept is enabled, it immediately unmaximizes
 * the window and opens the Snap Layout Overlay instead.
 *
 * The unmaximize+overlay sequence is invisible to users at normal animation
 * speeds (same technique used by PopShell and KDE Bismuth).
 *
 * To prevent intercepting our own programmatic maximizes (snapFocusedUp),
 * call bypass(windowId) right before calling win.maximize().
 */

import Meta from "gi://Meta";
import GLib from "gi://GLib";

export class MaximizeHook {
    constructor(settings, snapOverlay, logger) {
        this._settings = settings;
        this._snapOverlay = snapOverlay;
        this._log = logger;

        /** windowIds exempt from interception (programmatic maximizes) */
        this._bypassed = new Set();

        /** windowIds of recently-created windows (skip startup maximizes) */
        this._recentlyCreated = new Set();

        /** True during the initial startup grace period (avoid intercepting
         *  session-restored maximized windows that cause login blocking). */
        this._startupGrace = true;

        /** True while a grab-op (drag) is in progress or just ended.
         *  Prevents intercepting a drag-to-top-edge maximize. */
        this._grabActive = false;

        this._wmSignals = [];
        this._displaySignals = [];
        this._startupTimerId = null;
        this._grabCooldownId = null;
    }

    enable() {
        // Startup grace: don't intercept any maximizes for the first 4 seconds
        // after enable.  This avoids the login-time blocking where session-
        // restored windows get their maximize intercepted, causing repeated
        // overlay open/close cycles.
        this._startupGrace = true;
        this._startupTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4000, () => {
            this._startupGrace = false;
            this._startupTimerId = null;
            return GLib.SOURCE_REMOVE;
        });

        this._wmSignals.push(
            global.window_manager.connect("size-changed", (_wm, actor) => {
                this._onSizeChanged(actor);
            })
        );

        this._displaySignals.push(
            global.display.connect("window-created", (_dpy, win) => {
                const id = win.get_id();
                this._recentlyCreated.add(id);
                // Clear the new-window flag after 3 s (increased from 1.5 s)
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                    this._recentlyCreated.delete(id);
                    return GLib.SOURCE_REMOVE;
                });
            }),
            // Track grab operations so drag-to-top-edge maximize is not
            // intercepted (the user intends to maximize, not open the overlay).
            global.display.connect("grab-op-begin", () => {
                this._grabActive = true;
            }),
            global.display.connect("grab-op-end", () => {
                // Keep the flag for a short cooldown so the maximize triggered
                // at the very end of the drag is also skipped.
                if (this._grabCooldownId) GLib.Source.remove(this._grabCooldownId);
                this._grabCooldownId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    this._grabActive = false;
                    this._grabCooldownId = null;
                    return GLib.SOURCE_REMOVE;
                });
            })
        );

        this._log?.debug("MaximizeHook: enabled");
    }

    disable() {
        if (this._startupTimerId) {
            GLib.Source.remove(this._startupTimerId);
            this._startupTimerId = null;
        }
        if (this._grabCooldownId) {
            GLib.Source.remove(this._grabCooldownId);
            this._grabCooldownId = null;
        }

        for (const id of this._wmSignals)
            try { global.window_manager.disconnect(id); } catch (_) {}
        this._wmSignals = [];

        for (const id of this._displaySignals)
            try { global.display.disconnect(id); } catch (_) {}
        this._displaySignals = [];

        this._bypassed.clear();
        this._recentlyCreated.clear();
        this._startupGrace = true;
        this._grabActive = false;
    }

    /**
     * Mark windowId as exempt from interception for the next ~500 ms.
     * Call this before any intentional win.maximize() in the controller.
     * @param {number} windowId
     */
    bypass(windowId) {
        this._bypassed.add(windowId);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._bypassed.delete(windowId);
            return GLib.SOURCE_REMOVE;
        });
    }

    // ------------------------------------------------------------------ private

    _onSizeChanged(actor) {
        if (!this._settings.snapOverlayEnabled) return;

        const win = actor?.meta_window;
        if (!win) return;

        // Only intercept full maximizes (both axes)
        if (win.get_maximized() !== Meta.MaximizeFlags.BOTH) return;

        // Skip if we deliberately maximized this window
        if (this._bypassed.has(win.get_id())) return;

        // Skip app-startup maximizes
        if (this._recentlyCreated.has(win.get_id())) return;

        // Skip during startup grace period (session-restored windows)
        if (this._startupGrace) return;

        // Skip during or right after a drag (drag-to-top-edge maximize)
        if (this._grabActive) return;

        // Skip windows that forbid resize/move (fullscreen, docks, etc.)
        if (!win.allows_resize() && !win.allows_move()) return;

        this._log?.debug(`MaximizeHook: intercepting maximize win=${win.get_id()}`);

        // Exempt during our own unmaximize call to prevent recursion
        this._bypassed.add(win.get_id());
        win.unmaximize(Meta.MaximizeFlags.BOTH);

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._bypassed.delete(win.get_id());
            if (!win.is_hidden())
                this._snapOverlay.open(win);
            return GLib.SOURCE_REMOVE;
        });
    }
}
