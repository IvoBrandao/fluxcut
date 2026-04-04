/**
 * FluxCut — Window Snap Zones for GNOME
 * extension.js — Main extension entry point and controller lifecycle
 *
 * GNOME Shell 45-49 compatible (ESM imports)
 */

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Meta from "gi://Meta";
import GLib from "gi://GLib";

import { Settings } from "./src/settings.js";
import { Logger } from "./src/logger.js";
import { setExtensionObject } from "./src/i18n.js";
import { Animations } from "./src/animations.js";
import { ZoneManager } from "./src/zoneManager.js";
import { CustomZoneStore } from "./src/customZones.js";
import { MultiMonitorManager } from "./src/multiMonitor.js";
import { WindowTracker } from "./src/windowTracker.js";
import { SnapGroupsManager } from "./src/snapGroups.js";
import { DragDetector } from "./src/dragDetector.js";
import { ZoneHighlighter } from "./src/zoneHighlight.js";
import { SnapOverlay } from "./src/snapOverlay.js";
import { SnapAssist } from "./src/snapAssist.js";
import { ZoneEditor } from "./src/zoneEditor.js";
import { MaximizeHook } from "./src/maximizeHook.js";
import { Keybindings } from "./src/keybindings.js";
import { Indicator } from "./src/indicator.js";

// ---------------------------------------------------------------------------

export default class FluxCutExtension extends Extension {
    enable() {
        this._controller = new FluxCutController(this);
        this._controller.enable();
    }

    disable() {
        if (this._controller) {
            this._controller.disable();
            this._controller = null;
        }
    }
}

// ---------------------------------------------------------------------------

class FluxCutController {
    constructor(extension) {
        this._ext = extension;
    }

    enable() {
        // Phase 1 — core services (lightweight, runs synchronously)
        this._settings = new Settings(this._ext);
        this._logger = new Logger(this._settings);
        setExtensionObject(this._ext);
        this._animations = new Animations(this._settings);

        this._logger.info("FluxCut enabling…");

        // Phase 2 — zone logic (lightweight)
        this._customZones = new CustomZoneStore(this._settings, this._logger);
        this._zoneManager = new ZoneManager(this._settings, this._customZones, this._logger);

        // Phase 3 — monitor awareness (lightweight)
        this._multiMonitor = new MultiMonitorManager(this._settings, this._zoneManager, this._logger);
        this._multiMonitor.enable();

        // Phases 4-12 are deferred to avoid blocking shell startup.
        // This prevents the "every program locks for a while on login" issue.
        this._deferredInitId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._deferredInitId = null;
            if (!this._settings) return GLib.SOURCE_REMOVE; // disabled before idle fired
            this._enableDeferred();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Deferred initialisation — runs after the shell has finished its own
     * startup processing so we don't block window rendering.
     */
    _enableDeferred() {
        // Phase 4 — window state
        this._windowTracker = new WindowTracker(
            this._settings, this._zoneManager, this._multiMonitor, this._logger
        );
        this._windowTracker.enable();

        // Phase 5 — snap groups
        this._snapGroups = new SnapGroupsManager(
            this._settings, this._windowTracker, this._animations, this._logger
        );
        this._snapGroups.enable();

        // Phase 6 — drag + highlights
        this._dragDetector = new DragDetector(
            this._settings, this._zoneManager, this._multiMonitor, this._logger
        );
        this._dragDetector.enable();

        this._zoneHighlighter = new ZoneHighlighter(
            this._settings, this._dragDetector, this._windowTracker,
            this._zoneManager, this._animations, this._logger
        );
        this._zoneHighlighter.enable();

        // Phase 7 — snap overlay (Super+Z)
        this._snapOverlay = new SnapOverlay(
            this._settings, this._zoneManager, this._customZones, this._multiMonitor,
            this._windowTracker, this._zoneHighlighter, this._animations, this._logger
        );

        // Phase 8 — snap assist
        this._snapAssist = new SnapAssist(
            this._settings, this._windowTracker, this._zoneManager,
            this._animations, this._logger
        );
        this._windowTracker.setSnapAssist(this._snapAssist);

        // Phase 9 — zone editor
        this._zoneEditor = new ZoneEditor(
            this._settings, this._customZones, this._zoneManager,
            this._animations, this._logger
        );

        // Phase 10 — maximize-button intercept (maximize → snap overlay)
        this._maximizeHook = new MaximizeHook(this._settings, this._snapOverlay, this._logger);
        this._maximizeHook.enable();

        // Phase 11 — keybindings (this controller is the handler target)
        this._keybindings = new Keybindings(this._settings, this, this._logger);
        this._keybindings.enable();

        // Phase 12 — quick settings indicator
        this._indicator = new Indicator(this._settings, this, this._logger);
        this._indicator.enable();

        // Session mode handling (lock screen)
        this._sessionSignalId = Main.sessionMode.connect(
            "updated",
            this._onSessionModeUpdated.bind(this)
        );

        // Overview handling — hide popups when activities open
        this._overviewShowId = Main.overview.connect(
            "showing",
            this._onOverviewShowing.bind(this)
        );

        this._logger.info("FluxCut enabled");
    }

    disable() {
        this._logger?.info("FluxCut disabling…");

        // Cancel deferred init if it hasn't run yet
        if (this._deferredInitId) {
            GLib.Source.remove(this._deferredInitId);
            this._deferredInitId = null;
        }

        if (this._sessionSignalId) {
            Main.sessionMode.disconnect(this._sessionSignalId);
            this._sessionSignalId = null;
        }
        if (this._overviewShowId) {
            Main.overview.disconnect(this._overviewShowId);
            this._overviewShowId = null;
        }

        // Reverse order
        this._indicator?.disable();
        this._keybindings?.disable();
        this._maximizeHook?.disable();
        this._zoneEditor?.destroy();
        this._snapAssist?.destroy();
        this._snapOverlay?.destroy();
        this._zoneHighlighter?.disable();
        this._dragDetector?.disable();
        this._snapGroups?.disable();
        this._windowTracker?.disable();
        this._multiMonitor?.disable();

        this._indicator = null;
        this._keybindings = null;
        this._maximizeHook = null;
        this._zoneEditor = null;
        this._snapAssist = null;
        this._snapOverlay = null;
        this._zoneHighlighter = null;
        this._dragDetector = null;
        this._snapGroups = null;
        this._windowTracker = null;
        this._multiMonitor = null;
        this._zoneManager = null;
        this._customZones = null;
        this._animations = null;
        this._settings = null;
        this._logger = null;
    }

    _onSessionModeUpdated(sessionMode) {
        const isLocked = sessionMode.currentMode === "unlock-dialog" ||
                         sessionMode.parentMode === "unlock-dialog";

        if (isLocked) {
            this._keybindings?.disable();
            this._indicator?.hide();
            this._snapOverlay?.close();
            this._snapAssist?.destroyAll();
            this._dragDetector?.disable();
            this._maximizeHook?.disable();
        } else {
            this._keybindings?.enable();
            this._indicator?.show();
            this._dragDetector?.enable();
            this._maximizeHook?.enable();
        }
    }

    _onOverviewShowing() {
        this._snapOverlay?.close();
        this._snapAssist?.destroyAll();
        this._zoneEditor?.close();
        this._zoneHighlighter?.clearAll();
    }

    // ------------------------------------------------------------------ public API (used by Keybindings)

    /**
     * Snap the focused window to a specific preset zone.
     * @param {string} presetId
     * @param {number} zoneIndex
     */
    snapFocusedToPreset(presetId, zoneIndex) {
        const win = global.display.get_focus_window();
        if (!win || !this._zoneManager) return;

        const monitorIndex = win.get_monitor();
        const rects = this._zoneManager.getZoneRects(presetId, monitorIndex, this._settings.windowGapSize);
        const rect  = rects[zoneIndex];
        if (!rect) return;

        this._windowTracker.snapWindow(win, presetId, zoneIndex, rect);
    }

    /**
     * Super+Up: Snap to upper quarter (context-aware).
     *   Unsnapped            → top-left quarter
     *   Left half            → top-left quarter
     *   Right half           → top-right quarter
     *   Bottom-left quarter  → top-left quarter
     *   Bottom-right quarter → top-right quarter
     *   Other snapped        → top-left quarter
     */
    snapFocusedToUpperQuarter() {
        if (!this._windowTracker) return;
        const win = global.display.get_focus_window();
        if (!win) return;

        const entry = this._windowTracker.getSnapEntry(win);
        if (!entry) {
            // Default to top-left quarter
            return this.snapFocusedToPreset("quarters", 0);
        }

        if (entry.presetId === "halves"   && entry.zoneIndex === 0) return this.snapFocusedToPreset("quarters", 0);
        if (entry.presetId === "halves"   && entry.zoneIndex === 1) return this.snapFocusedToPreset("quarters", 1);
        if (entry.presetId === "quarters" && entry.zoneIndex === 2) return this.snapFocusedToPreset("quarters", 0);
        if (entry.presetId === "quarters" && entry.zoneIndex === 3) return this.snapFocusedToPreset("quarters", 1);

        // Default to top-left quarter
        return this.snapFocusedToPreset("quarters", 0);
    }

    /**
     * Super+Down: Snap to lower quarter (context-aware).
     *   Unsnapped           → bottom-left quarter
     *   Left half           → bottom-left quarter
     *   Right half          → bottom-right quarter
     *   Top-left quarter    → bottom-left quarter
     *   Top-right quarter   → bottom-right quarter
     *   Other snapped       → bottom-left quarter
     */
    snapFocusedToLowerQuarter() {
        if (!this._windowTracker) return;
        const win = global.display.get_focus_window();
        if (!win) return;

        const entry = this._windowTracker.getSnapEntry(win);
        if (!entry) {
            // Default to bottom-left quarter
            return this.snapFocusedToPreset("quarters", 2);
        }

        if (entry.presetId === "halves"   && entry.zoneIndex === 0) return this.snapFocusedToPreset("quarters", 2);
        if (entry.presetId === "halves"   && entry.zoneIndex === 1) return this.snapFocusedToPreset("quarters", 3);
        if (entry.presetId === "quarters" && entry.zoneIndex === 0) return this.snapFocusedToPreset("quarters", 2);
        if (entry.presetId === "quarters" && entry.zoneIndex === 1) return this.snapFocusedToPreset("quarters", 3);

        // Default to bottom-left quarter
        return this.snapFocusedToPreset("quarters", 2);
    }

    /**
     * Ctrl+Super+Arrow: Move/swap focused window to adjacent zone.
     * @param {string} direction - "left", "right", "up", "down"
     */
    moveSwapFocused(direction) {
        const win = global.display.get_focus_window();
        if (!win || !this._zoneManager) return;

        const entry = this._windowTracker.getSnapEntry(win);
        const monitorIndex = win.get_monitor();

        // Map current position + direction to new preset+zone
        let targetPreset, targetZone;

        if (!entry) {
            // Unsnapped window — snap to edge/quarter based on direction
            if (direction === "left")       { targetPreset = "halves";   targetZone = 0; }
            else if (direction === "right") { targetPreset = "halves";   targetZone = 1; }
            else if (direction === "up")    { targetPreset = "quarters"; targetZone = 0; }
            else if (direction === "down")  { targetPreset = "quarters"; targetZone = 2; }
        } else if (entry.presetId === "halves") {
            // In a half — move to quarters
            if (entry.zoneIndex === 0) { // left half
                if (direction === "right")      { targetPreset = "halves";   targetZone = 1; }
                else if (direction === "up")    { targetPreset = "quarters"; targetZone = 0; }
                else if (direction === "down")  { targetPreset = "quarters"; targetZone = 2; }
            } else { // right half
                if (direction === "left")       { targetPreset = "halves";   targetZone = 0; }
                else if (direction === "up")    { targetPreset = "quarters"; targetZone = 1; }
                else if (direction === "down")  { targetPreset = "quarters"; targetZone = 3; }
            }
        } else if (entry.presetId === "quarters") {
            // In a quarter — move to adjacent quarter or half
            const quarterMap = {
                0: { left: null, right: 1, up: null, down: 2 },    // top-left
                1: { left: 0, right: null, up: null, down: 3 },    // top-right
                2: { left: null, right: 3, up: 0, down: null },    // bottom-left
                3: { left: 2, right: null, up: 1, down: null },    // bottom-right
            };
            targetZone = quarterMap[entry.zoneIndex]?.[direction];
            if (targetZone !== null && targetZone !== undefined) {
                targetPreset = "quarters";
            }
        }

        if (targetPreset && targetZone !== undefined) {
            const rects = this._zoneManager.getZoneRects(targetPreset, monitorIndex, this._settings.windowGapSize);
            const rect = rects[targetZone];
            if (rect) {
                this._windowTracker.snapWindow(win, targetPreset, targetZone, rect);
            }
        }
    }

    /**
     * Super+Up: context-aware maximize / snap-upward.
     *   Unsnapped            → maximize
     *   Left half            → top-left quarter
     *   Right half           → top-right quarter
     *   Bottom-left quarter  → top-left quarter
     *   Bottom-right quarter → top-right quarter
     *   Other snapped        → maximize
     */
    snapFocusedUp() {
        const win = global.display.get_focus_window();
        if (!win || !this._windowTracker) return;

        const entry = this._windowTracker.getSnapEntry(win);
        if (!entry) {
            this._maximizeHook?.bypass(win.get_id());
            win.maximize(Meta.MaximizeFlags.BOTH);
            return;
        }

        if (entry.presetId === "halves"   && entry.zoneIndex === 0) return this.snapFocusedToPreset("quarters", 0);
        if (entry.presetId === "halves"   && entry.zoneIndex === 1) return this.snapFocusedToPreset("quarters", 1);
        if (entry.presetId === "quarters" && entry.zoneIndex === 2) return this.snapFocusedToPreset("quarters", 0);
        if (entry.presetId === "quarters" && entry.zoneIndex === 3) return this.snapFocusedToPreset("quarters", 1);

        this._maximizeHook?.bypass(win.get_id());
        win.maximize(Meta.MaximizeFlags.BOTH);
    }

    /**
     * Super+Down: context-aware restore / snap-downward.
     *   Maximized           → restore
     *   Top-left quarter    → left half
     *   Top-right quarter   → right half
     *   Other snapped       → unsnap
     *   Unsnapped           → minimize
     */
    snapFocusedDown() {
        const win = global.display.get_focus_window();
        if (!win || !this._windowTracker) return;

        if (win.get_maximized() === Meta.MaximizeFlags.BOTH) {
            win.unmaximize(Meta.MaximizeFlags.BOTH);
            return;
        }

        const entry = this._windowTracker.getSnapEntry(win);
        if (!entry) { win.minimize(); return; }

        if (entry.presetId === "quarters" && entry.zoneIndex === 0) return this.snapFocusedToPreset("halves", 0);
        if (entry.presetId === "quarters" && entry.zoneIndex === 1) return this.snapFocusedToPreset("halves", 1);

        this._windowTracker.unsnapWindow(win);
    }

    toggleSnapOverlay() {
        const win = global.display.get_focus_window();
        if (!win || !this._snapOverlay) return;
        if (this._snapOverlay._widget)
            this._snapOverlay.close();
        else
            this._snapOverlay.open(win);
    }

    openZoneEditor() {
        if (!this._zoneEditor) return;
        const monitorIndex = global.display.get_focus_window()?.get_monitor()
            ?? global.display.get_current_monitor();
        this._zoneEditor.open(monitorIndex);
    }

    /**
     * Move the focused window (and its snap group) to an adjacent monitor.
     * @param {Meta.DisplayDirection|string} direction
     */
    moveFocusedToMonitor(direction) {
        const win = global.display.get_focus_window();
        if (!win || !this._multiMonitor) return;

        this._multiMonitor.moveWindowToMonitor(win, direction, newMonitorIndex => {
            const entry = this._windowTracker.getSnapEntry(win);
            if (entry) {
                const rects = this._zoneManager.getZoneRects(
                    entry.presetId, newMonitorIndex, this._settings.windowGapSize
                );
                const newRect = rects[entry.zoneIndex];
                if (newRect) {
                    this._windowTracker.snapWindow(win, entry.presetId, entry.zoneIndex, newRect);
                }
            }
            // Re-snap the entire group on the new monitor
            this._windowTracker.moveGroupToMonitor(win, newMonitorIndex);
        });
    }

    cyclePreset(direction) {
        if (!this._multiMonitor) return;
        const monitorIndex = global.display.get_focus_window()?.get_monitor()
            ?? global.display.get_current_monitor();
        this._multiMonitor.cyclePreset(monitorIndex, direction);
    }

    restoreLastSnapGroup() {
        if (!this._windowTracker) return;
        const groups = this._windowTracker.getActiveSnapGroups();
        if (groups.size === 0) return;
        const [key] = groups.keys();
        this._snapGroups.restoreGroup(key);
    }
}
