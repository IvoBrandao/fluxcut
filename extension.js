/**
 * FluxCut — Window Snap Zones for GNOME
 * extension.js — Main extension entry point and controller lifecycle
 *
 * GNOME Shell 45-49 compatible (ESM imports)
 */

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Meta from "gi://Meta";

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
        // Phase 1 — core services
        this._settings = new Settings(this._ext);
        this._logger = new Logger(this._settings);
        setExtensionObject(this._ext);
        this._animations = new Animations(this._settings);

        this._logger.info("FluxCut enabling…");

        // Phase 2 — zone logic
        this._customZones = new CustomZoneStore(this._settings, this._logger);
        this._zoneManager = new ZoneManager(this._settings, this._customZones, this._logger);

        // Phase 3 — monitor awareness
        this._multiMonitor = new MultiMonitorManager(this._settings, this._zoneManager, this._logger);
        this._multiMonitor.enable();

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

        // Phase 7 — snap overlay (Win+Z)
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
        this._logger.info("FluxCut disabling…");

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

        this._logger?.info("FluxCut disabled");
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
        if (!win) return;

        const monitorIndex = win.get_monitor();
        const rects = this._zoneManager.getZoneRects(presetId, monitorIndex, this._settings.windowGapSize);
        const rect  = rects[zoneIndex];
        if (!rect) return;

        this._windowTracker.snapWindow(
            win, presetId, zoneIndex, rect,
            this._animations.duration > 0, this._animations
        );
    }

    /**
     * Win+Up: context-aware maximize / snap-upward.
     *   Unsnapped            → maximize
     *   Left half            → top-left quarter
     *   Right half           → top-right quarter
     *   Bottom-left quarter  → top-left quarter
     *   Bottom-right quarter → top-right quarter
     *   Other snapped        → maximize
     */
    snapFocusedUp() {
        const win = global.display.get_focus_window();
        if (!win) return;

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
     * Win+Down: context-aware restore / snap-downward.
     *   Maximized           → restore
     *   Top-left quarter    → left half
     *   Top-right quarter   → right half
     *   Other snapped       → unsnap
     *   Unsnapped           → minimize
     */
    snapFocusedDown() {
        const win = global.display.get_focus_window();
        if (!win) return;

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
        if (!win) return;
        if (this._snapOverlay._widget)
            this._snapOverlay.close();
        else
            this._snapOverlay.open(win);
    }

    openZoneEditor() {
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
        if (!win) return;

        this._multiMonitor.moveWindowToMonitor(win, direction, newMonitorIndex => {
            const entry = this._windowTracker.getSnapEntry(win);
            if (entry) {
                const rects = this._zoneManager.getZoneRects(
                    entry.presetId, newMonitorIndex, this._settings.windowGapSize
                );
                const newRect = rects[entry.zoneIndex];
                if (newRect) {
                    this._windowTracker.snapWindow(
                        win, entry.presetId, entry.zoneIndex, newRect,
                        this._animations.duration > 0, this._animations
                    );
                }
            }
            // Re-snap the entire group on the new monitor
            this._windowTracker.moveGroupToMonitor(win, newMonitorIndex, this._animations);
        });
    }

    cyclePreset(direction) {
        const monitorIndex = global.display.get_focus_window()?.get_monitor()
            ?? global.display.get_current_monitor();
        this._multiMonitor.cyclePreset(monitorIndex, direction);
    }

    restoreLastSnapGroup() {
        const groups = this._windowTracker.getActiveSnapGroups();
        if (groups.size === 0) return;
        const [key] = groups.keys();
        this._snapGroups.restoreGroup(key);
    }
}
