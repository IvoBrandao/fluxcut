/**
 * Window Tiling Control — src/multiMonitor.js
 * Per-monitor state management, aspect-ratio detection, and cross-monitor
 * window moves. Supports horizontal, vertical, and mixed monitor arrangements.
 */

import GObject from "gi://GObject";
import Meta from "gi://Meta";
import { getPresetsForAspectRatio } from "./layoutPresets.js";

/** @typedef {{ index: number, aspectRatio: number, isUltraWide: boolean, isPortrait: boolean, geometry: Meta.Rectangle, workarea: Meta.Rectangle }} MonitorInfo */

export const MultiMonitorManager = GObject.registerClass(
    {
        Signals: {
            "monitors-updated": {},
        },
    },
    class MultiMonitorManager extends GObject.Object {
        _init(settings, zoneManager, logger) {
            super._init();
            this._settings = settings;
            this._zoneManager = zoneManager;
            this._log = logger;

            /** @type {MonitorInfo[]} */
            this._monitors = [];

            // Per-monitor active preset: Map<monitorIndex, presetId>
            // Kept in memory; persisted to GSettings on change.
            this._activePresets = new Map();

            this._signalIds = [];
        }

        enable() {
            const display = global.display;

            // monitors-changed signal location varies by GNOME version:
            //   GNOME 45: global.display has monitors-changed
            //   GNOME 46+: moved to Meta.MonitorManager (backend)
            // Either way, workareas-changed (always on display) is a reliable
            // fallback since it fires after any monitor reconfiguration.
            let monitorConnected = false;

            // Try backend monitor manager first (GNOME 46+)
            try {
                const monMgr = global.backend.get_monitor_manager();
                if (monMgr) {
                    this._monitorManager = monMgr;
                    this._monMgrSignalId = monMgr.connect("monitors-changed", () => this._rebuild());
                    monitorConnected = true;
                }
            } catch (_) { /* not available on this GNOME version */ }

            // Fallback: try display.monitors-changed (GNOME 45)
            if (!monitorConnected) {
                try {
                    this._signalIds.push(display.connect("monitors-changed", () => this._rebuild()));
                } catch (_) { /* signal not on display in this version */ }
            }

            // workareas-changed always exists and serves as a reliable catch-all
            this._signalIds.push(display.connect("workareas-changed", () => this._rebuild()));
            this._rebuild();
            this._loadPresetMap();
        }

        disable() {
            for (const id of this._signalIds)
                global.display.disconnect(id);
            this._signalIds = [];
            if (this._monMgrSignalId && this._monitorManager) {
                this._monitorManager.disconnect(this._monMgrSignalId);
                this._monMgrSignalId = null;
                this._monitorManager = null;
            }
        }

        // ------------------------------------------------------------------ monitors

        /** @returns {MonitorInfo[]} */
        get monitors() { return this._monitors; }

        /** @returns {MonitorInfo|undefined} */
        getMonitor(index) { return this._monitors.find(m => m.index === index); }

        get count() { return global.display.get_n_monitors(); }

        /** @returns {MonitorInfo[]} Monitors sorted left→right, top→bottom. */
        get sorted() {
            return [...this._monitors].sort((a, b) => {
                if (a.geometry.y !== b.geometry.y)
                    return a.geometry.y - b.geometry.y;
                return a.geometry.x - b.geometry.x;
            });
        }

        /**
         * Return available presets for a given monitor (filtered by aspect).
         */
        getPresetsForMonitor(monitorIndex) {
            const m = this.getMonitor(monitorIndex);
            if (!m) return [];
            return getPresetsForAspectRatio(m.aspectRatio);
        }

        // ------------------------------------------------------------------ active preset

        /**
         * Composite map key: 'monitorIndex:workspaceIndex'.
         * workspaceIndex defaults to the current active workspace.
         */
        _presetKey(monitorIndex, workspaceIndex = null) {
            const ws = workspaceIndex ?? global.workspace_manager.get_active_workspace_index();
            return `${monitorIndex}:${ws}`;
        }

        getActivePreset(monitorIndex, workspaceIndex = null) {
            const key = this._presetKey(monitorIndex, workspaceIndex);
            if (this._activePresets.has(key))
                return this._activePresets.get(key);

            // Default: first preset appropriate for this monitor's aspect ratio
            const monitor = this.getMonitor(monitorIndex);
            if (!monitor) return "halves";

            const presets = getPresetsForAspectRatio(monitor.aspectRatio);
            return presets.length ? presets[0].id : "halves";
        }

        setActivePreset(monitorIndex, presetId, workspaceIndex = null) {
            this._activePresets.set(this._presetKey(monitorIndex, workspaceIndex), presetId);
            this._savePresetMap();
        }

        cyclePreset(monitorIndex, direction = 1, workspaceIndex = null) {
            const available = this.getPresetsForMonitor(monitorIndex);
            const currentId = this.getActivePreset(monitorIndex, workspaceIndex);
            const idx = available.findIndex(p => p.id === currentId);
            const next = (idx + direction + available.length) % available.length;
            this.setActivePreset(monitorIndex, available[next].id, workspaceIndex);
            return available[next].id;
        }

        // ------------------------------------------------------------------ cross-monitor moves

        /**
         * Move a window to an adjacent monitor.
         *
         * @param {Meta.Window} metaWindow
         * @param {'left'|'right'|'up'|'down'} direction
         * @param {Function} [onMoved] - called after move_to_monitor, receives new monitorIndex
         */
        moveWindowToMonitor(metaWindow, direction, onMoved) {
            const currentMonitor = metaWindow.get_monitor();

            // Accept both Meta.DisplayDirection integers and string directions
            let directionEnum;
            if (typeof direction === "string") {
                directionEnum = {
                    left:  Meta.DisplayDirection.LEFT,
                    right: Meta.DisplayDirection.RIGHT,
                    up:    Meta.DisplayDirection.UP,
                    down:  Meta.DisplayDirection.DOWN,
                }[direction];
            } else {
                directionEnum = direction; // already a Meta.DisplayDirection value
            }

            if (directionEnum === undefined || directionEnum === null) return;

            const neighbor = global.display.get_monitor_neighbor_index(
                currentMonitor, directionEnum
            );

            if (neighbor === -1) {
                this._log?.debug(`MultiMonitor: no monitor to the ${direction}`);
                return;
            }

            metaWindow.move_to_monitor(neighbor);
            onMoved?.(neighbor);
        }

        // ------------------------------------------------------------------ private

        _rebuild() {
            const n = global.display.get_n_monitors();
            this._monitors = [];

            for (let i = 0; i < n; i++) {
                const geom = global.display.get_monitor_geometry(i);
                const aspect = geom.width / Math.max(geom.height, 1);

                this._monitors.push({
                    index: i,
                    aspectRatio: aspect,
                    isUltraWide: aspect >= 2.1,
                    isPortrait:  aspect < 0.8,
                    geometry: geom,
                    // Workarea is computed lazily by ZoneManager._getWorkarea()
                    // when zone rects are actually needed. Computing it here
                    // during init would iterate all windows on each monitor and
                    // block extension startup.
                });
            }

            this._log?.debug(`MultiMonitor: rebuilt — ${n} monitor(s)`);
            this.emit("monitors-updated");
        }

        _loadPresetMap() {
            const entries = this._settings.monitorPresets;
            this._activePresets = new Map();
            for (const entry of entries) {
                try {
                    const { key, presetId } = JSON.parse(entry);
                    if (key && presetId) this._activePresets.set(key, presetId);
                } catch (_) {}
            }
        }

        _savePresetMap() {
            const entries = [];
            for (const [key, presetId] of this._activePresets)
                entries.push(JSON.stringify({ key, presetId }));
            this._settings.monitorPresets = entries;
        }
    }
);
