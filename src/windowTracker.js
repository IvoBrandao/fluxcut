/**
 * Window Tiling Control — src/windowTracker.js
 * Tracks which windows are snapped, to which zone, on which monitor+workspace.
 *
 * SnapEntry: { presetId, zoneIndex, zoneRect: Meta.Rectangle, monitorIndex, workspaceIndex }
 *
 * State map: Map<windowId, SnapEntry>
 * (windowId is the integer from metaWindow.get_id())
 */

import GLib from "gi://GLib";
import Meta from "gi://Meta";
import { makeRect } from "./compat.js";

export class WindowTracker {
    constructor(settings, zoneManager, multiMonitor, logger) {
        this._settings = settings;
        this._zoneManager = zoneManager;
        this._multiMonitor = multiMonitor;
        this._log = logger;

        /** @type {Map<number, object>} windowId → SnapEntry */
        this._snapped = new Map();

        // Per-window signal IDs: Map<windowId, number[]>
        this._windowSignals = new Map();
        // Global display signal IDs
        this._signalIds = [];

        /** Pending one-shot GLib source ids (deferred watch / snap-assist). */
        this._pendingSources = new Set();

        this._snapAssist = null; // set by controller after construction
    }

    // ------------------------------------------------------------------ lifecycle

    enable() {
        this._signalIds.push(
            global.display.connect("window-created", (_dpy, metaWindow) => {
                this._onWindowCreated(metaWindow);
            })
        );

        // Track all existing windows
        for (const win of this._getAllWindows())
            this._watchWindow(win);
    }

    disable() {
        // Cancel pending one-shot sources so they never fire post-disable
        for (const id of this._pendingSources)
            try { GLib.Source.remove(id); } catch (_) {}
        this._pendingSources.clear();

        // Disconnect global signals
        for (const id of this._signalIds)
            global.display.disconnect(id);
        this._signalIds = [];

        // Disconnect per-window signals
        for (const [windowId, ids] of this._windowSignals) {
            const win = this._findWindowById(windowId);
            if (win) {
                for (const id of ids)
                    try { win.disconnect(id); } catch (_) {}
            }
        }
        this._windowSignals.clear();
        this._snapped.clear();
    }

    setSnapAssist(snapAssist) {
        this._snapAssist = snapAssist;
    }

    // ------------------------------------------------------------------ snap API

    /**
     * Record a window as snapped and physically move it.
     *
     * @param {Meta.Window} metaWindow
     * @param {string} presetId
     * @param {number} zoneIndex
     * @param {Meta.Rectangle} zoneRect
     */
    snapWindow(metaWindow, presetId, zoneIndex, zoneRect) {
        const windowId = metaWindow.get_id();
        const monitorIndex = metaWindow.get_monitor();
        const workspaceIndex = metaWindow.get_workspace().index();

        const entry = { presetId, zoneIndex, zoneRect, monitorIndex, workspaceIndex };
        this._snapped.set(windowId, entry);

        this._log?.debug(
            `WindowTracker: snap win=${windowId} preset=${presetId} zone=${zoneIndex}`
        );

        this._zoneManager.assignWindowToZone(metaWindow, zoneRect);

        // Trigger Snap Assist for remaining unfilled zones
        if (this._snapAssist && this._settings.snapAssistEnabled) {
            const allZoneRects = this._zoneManager.getZoneRects(presetId, monitorIndex);
            const filledZoneIndices = this._getFilledZoneIndices(presetId, monitorIndex, workspaceIndex);
            const remaining = allZoneRects
                .map((r, i) => ({ rect: r, zoneIndex: i }))
                .filter(z => !filledZoneIndices.includes(z.zoneIndex));

            if (remaining.length > 0) {
                // Brief delay so Mutter finishes the window transition
                let sid;
                sid = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    this._pendingSources.delete(sid);
                    this._snapAssist?.show(presetId, monitorIndex, workspaceIndex, remaining);
                    return GLib.SOURCE_REMOVE;
                });
                this._pendingSources.add(sid);
            } else {
                this._snapAssist?.destroyAll();
            }
        }
    }

    /**
     * Remove snap tracking for a window (called when window moves, resizes
     * outside of snap, or closes).
     */
    unsnapWindow(metaWindow) {
        const windowId = metaWindow.get_id();
        if (this._snapped.has(windowId)) {
            this._log?.debug(`WindowTracker: unsnap win=${windowId}`);
            this._snapped.delete(windowId);
        }
    }

    /**
     * Get the snap entry for a window, or null.
     * @returns {object|null}
     */
    getSnapEntry(metaWindow) {
        return this._snapped.get(metaWindow.get_id()) ?? null;
    }

    /**
     * Find the window currently snapped to a specific zone on a monitor.
     * Returns the Meta.Window or null.
     */
    getWindowAtZone(presetId, zoneIndex, monitorIndex) {
        const wsIndex = global.workspace_manager.get_active_workspace_index();
        for (const [windowId, entry] of this._snapped) {
            if (entry.presetId === presetId &&
                entry.zoneIndex === zoneIndex &&
                entry.monitorIndex === monitorIndex &&
                entry.workspaceIndex === wsIndex) {
                const win = this._findWindowById(windowId);
                if (win) return win;
            }
        }
        return null;
    }

    /**
     * Get all windows snapped to the same preset on the same monitor+workspace.
     *
     * @returns {{ metaWindow: Meta.Window, entry: object }[]}
     */
    getSnapGroup(metaWindow) {
        const entry = this.getSnapEntry(metaWindow);
        if (!entry) return [];

        const result = [];
        for (const [windowId, e] of this._snapped) {
            if (e.presetId === entry.presetId &&
                e.monitorIndex === entry.monitorIndex &&
                e.workspaceIndex === entry.workspaceIndex) {
                const win = this._findWindowById(windowId);
                if (win)
                    result.push({ metaWindow: win, entry: e });
            }
        }
        return result;
    }

    /**
     * Get all snap groups on the active workspace.
     * Returns: Map<groupKey, { presetId, monitorIndex, workspaceIndex, members[] }>
     */
    getActiveSnapGroups() {
        const wsIndex = global.workspace_manager.get_active_workspace_index();
        const groups = new Map();

        for (const [windowId, entry] of this._snapped) {
            if (entry.workspaceIndex !== wsIndex) continue;

            const key = `${entry.presetId}:${entry.monitorIndex}:${entry.workspaceIndex}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    id: key,
                    presetId: entry.presetId,
                    monitorIndex: entry.monitorIndex,
                    workspaceIndex: entry.workspaceIndex,
                    members: [],
                });
            }

            const win = this._findWindowById(windowId);
            if (win)
                groups.get(key).members.push({ metaWindow: win, entry });
        }

        // Only return groups with ≥2 windows
        for (const [key, group] of groups) {
            if (group.members.length < 2)
                groups.delete(key);
        }

        return groups;
    }

    /**
     * Get all visible, non-snapped windows on a given monitor+workspace.
     * Excludes minimized, always-on-top, and skip-taskbar windows.
     */
    getUnsnappedWindows(monitorIndex, workspaceIndex) {
        const snappedIds = new Set(
            [...this._snapped.entries()]
                .filter(([, e]) => e.monitorIndex === monitorIndex && e.workspaceIndex === workspaceIndex)
                .map(([id]) => id)
        );

        return this._getAllWindows().filter(win => {
            if (win.get_monitor() !== monitorIndex) return false;
            if (win.get_workspace().index() !== workspaceIndex) return false;
            if (win.minimized) return false;
            if (win.skip_taskbar) return false;
            if (snappedIds.has(win.get_id())) return false;
            return true;
        });
    }

    /**
     * All tileable windows on a monitor+workspace, whether currently snapped
     * or not.  Excludes minimized, skip-taskbar and non-normal windows.
     * Used when (re)distributing every window across a chosen preset.
     */
    getTileableWindows(monitorIndex, workspaceIndex) {
        return this._getAllWindows().filter(win => {
            if (win.get_monitor() !== monitorIndex) return false;
            if (win.get_workspace().index() !== workspaceIndex) return false;
            if (win.minimized) return false;
            if (win.skip_taskbar) return false;
            return true;
        });
    }

    // ------------------------------------------------------------------ private

    _onWindowCreated(metaWindow) {
        // Give the window time to get a workspace and monitor assigned
        let sid;
        sid = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._pendingSources.delete(sid);
            // The window may have been unmanaged while we waited.
            try { this._watchWindow(metaWindow); } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });
        this._pendingSources.add(sid);
    }

    _watchWindow(metaWindow) {
        const windowId = metaWindow.get_id();
        if (this._windowSignals.has(windowId)) return;

        const signals = [];

        // Unsnap if the user manually moves or resizes the window
        signals.push(
            metaWindow.connect("position-changed", () => {
                if (this._snapped.has(windowId))
                    this._onWindowMoved(metaWindow);
            }),
            metaWindow.connect("size-changed", () => {
                if (this._snapped.has(windowId))
                    this._onWindowResized(metaWindow);
            }),
            metaWindow.connect("workspace-changed", () => {
                this.unsnapWindow(metaWindow);
            }),
            metaWindow.connect("unmanaged", () => {
                this.unsnapWindow(metaWindow);
                this._cleanupWindow(windowId);
            })
        );

        // Handle minimize — remove from snap tracking
        try {
            signals.push(
                metaWindow.connect("notify::minimized", () => {
                    if (metaWindow.minimized)
                        this.unsnapWindow(metaWindow);
                })
            );
        } catch (_) {}

        this._windowSignals.set(windowId, signals);
    }

    _onWindowMoved(metaWindow) {
        // Check if the window's current rect still roughly matches its snapped rect
        const entry = this.getSnapEntry(metaWindow);
        if (!entry) return;

        const current = metaWindow.get_frame_rect();
        const r = entry.zoneRect;
        const tolerance = 30; // px

        const drifted = Math.abs(current.x - r.x) > tolerance ||
                        Math.abs(current.y - r.y) > tolerance;

        if (drifted)
            this.unsnapWindow(metaWindow);
    }

    _onWindowResized(metaWindow) {
        const entry = this.getSnapEntry(metaWindow);
        if (!entry) return;

        const current = metaWindow.get_frame_rect();
        const r = entry.zoneRect;
        const tolerance = 30;

        const resized = Math.abs(current.width  - r.width)  > tolerance ||
                        Math.abs(current.height - r.height) > tolerance;

        if (!resized) return;

        const group = this.getSnapGroup(metaWindow);
        if (group.length < 2) {
            // Solo window — just unsnap
            this.unsnapWindow(metaWindow);
            return;
        }

        // Propagate the resize to adjacent group members
        this._propagateResize(metaWindow, r, current);
    }

    /**
     * When a snapped window is manually resized, adjust touching group members
     * so the layout stays gap-free.
     *
     * @param {Meta.Window} metaWindow   - window that was resized
     * @param {Meta.Rectangle} oldRect   - stored zone rect before the resize
     * @param {Meta.Rectangle} newRect   - new frame rect after the resize
     */
    _propagateResize(metaWindow, oldRect, newRect) {
        const group = this.getSnapGroup(metaWindow);
        const winId  = metaWindow.get_id();
        const TOL    = 4; // px edge-alignment tolerance

        const oldRight  = oldRect.x + oldRect.width;
        const oldBottom = oldRect.y + oldRect.height;
        const newRight  = newRect.x + newRect.width;
        const newBottom = newRect.y + newRect.height;

        // Update the resized window's own stored rect
        const selfEntry = this._snapped.get(winId);
        if (selfEntry)
            selfEntry.zoneRect = makeRect(
                { x: newRect.x, y: newRect.y, width: newRect.width, height: newRect.height }
            );

        for (const { metaWindow: other, entry: oz } of group) {
            if (other.get_id() === winId) continue;

            const zr = oz.zoneRect;
            const zRight  = zr.x + zr.width;
            const zBottom = zr.y + zr.height;

            let nx = zr.x, ny = zr.y, nw = zr.width, nh = zr.height;
            let changed = false;

            // Right edge of resized aligns with left edge of neighbor
            if (Math.abs(oldRight - zr.x) < TOL) {
                nx = newRight; nw -= (newRight - oldRight); changed = true;
            }
            // Left edge of resized aligns with right edge of neighbor
            else if (Math.abs(oldRect.x - zRight) < TOL) {
                nw += (oldRect.x - newRect.x); changed = true;
            }
            // Bottom edge of resized aligns with top edge of neighbor
            else if (Math.abs(oldBottom - zr.y) < TOL) {
                ny = newBottom; nh -= (newBottom - oldBottom); changed = true;
            }
            // Top edge of resized aligns with bottom edge of neighbor
            else if (Math.abs(oldRect.y - zBottom) < TOL) {
                nh += (oldRect.y - newRect.y); changed = true;
            }

            if (changed && nw > 40 && nh > 40) {
                oz.zoneRect = makeRect({ x: nx, y: ny, width: nw, height: nh });
                other.move_resize_frame(true, nx, ny, nw, nh);
            }
        }
    }

    /**
     * Move every member of the snap group (except the already-moved origin
     * window) to newMonitorIndex and re-snap them to their equivalent zones.
     *
     * Call this after moveWindowToMonitor() succeeds.
     *
     * @param {Meta.Window} originWindow   - window that was already moved
     * @param {number}      newMonitorIndex
     */
    moveGroupToMonitor(originWindow, newMonitorIndex) {
        const group = this.getSnapGroup(originWindow);
        if (group.length < 2) return;

        const originId = originWindow.get_id();

        for (const { metaWindow: win, entry } of group) {
            if (win.get_id() === originId) continue;

            const newRects = this._zoneManager.getZoneRects(
                entry.presetId, newMonitorIndex, this._settings.windowGapSize
            );
            const newRect = newRects[entry.zoneIndex];
            if (!newRect) continue;

            win.move_to_monitor(newMonitorIndex);
            this.snapWindow(win, entry.presetId, entry.zoneIndex, newRect);
        }
    }

    _cleanupWindow(windowId) {
        const signals = this._windowSignals.get(windowId);
        if (signals) {
            // Window is already unmanaged so we can't disconnect, just drop
            this._windowSignals.delete(windowId);
        }
    }

    _getFilledZoneIndices(presetId, monitorIndex, workspaceIndex) {
        const filled = [];
        for (const [, entry] of this._snapped) {
            if (entry.presetId === presetId &&
                entry.monitorIndex === monitorIndex &&
                entry.workspaceIndex === workspaceIndex)
                filled.push(entry.zoneIndex);
        }
        return filled;
    }

    _getAllWindows() {
        const wsm = global.workspace_manager;
        const windows = [];
        for (let wi = 0; wi < wsm.get_n_workspaces(); wi++) {
            const ws = wsm.get_workspace_by_index(wi);
            windows.push(...ws.list_windows());
        }
        // Deduplicate (sticky windows appear on every workspace)
        const seen = new Set();
        return windows.filter(w => {
            const id = w.get_id();
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    }

    _findWindowById(windowId) {
        // Use compositor actors for O(n) lookup without workspace iteration
        const actors = global.get_window_actors?.() ?? [];
        for (const actor of actors) {
            const w = actor.meta_window;
            if (w && w.get_id() === windowId) return w;
        }
        // Fallback for edge cases
        for (const win of this._getAllWindows()) {
            if (win.get_id() === windowId)
                return win;
        }
        return null;
    }
}
