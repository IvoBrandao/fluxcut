/**
 * FluxCut — src/dragDetector.js
 * Detects window drag operations via grab-op signals + 16ms pointer polling.
 * Emits GObject signals "zone-hovered" and "zone-selected".
 */

import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import { makeRect } from "./compat.js";

export const DragDetector = GObject.registerClass(
    {
        Signals: {
            /**
             * Emitted when the pointer hovers over a snap zone during drag.
             * Read hoveredZone for zone details (rect etc.).
             * @param {string} presetId
             * @param {number} monitorIndex
             * @param {number} zoneIndex
             */
            "zone-hovered": {
                param_types: [
                    GObject.TYPE_STRING,  // presetId (or "")
                    GObject.TYPE_INT,     // monitorIndex
                    GObject.TYPE_INT,     // zoneIndex (-1 if none)
                ],
            },
            /**
             * Emitted when a drag ends (with or without a zone selection).
             * Read selectedZone for zone details (rect etc.).
             */
            "zone-selected": {
                param_types: [
                    GObject.TYPE_STRING,
                    GObject.TYPE_INT,
                    GObject.TYPE_INT,
                ],
            },
        },
    },
    class DragDetector extends GObject.Object {
        _init(settings, zoneManager, multiMonitor, logger) {
            super._init();
            this._settings = settings;
            this._zoneManager = zoneManager;
            this._multiMonitor = multiMonitor;
            this._log = logger;

            this._signalIds = [];
            this._pollId = null;
            this._dragging = false;
            this._draggedWindow = null;
            this._lastHoveredZone = null; // { presetId, monitorIndex, rect, zoneIndex }

            /** @type {{ presetId: string, monitorIndex: number, rect, zoneIndex: number }|null} */
            this.hoveredZone = null;
            /** @type {{ presetId: string, monitorIndex: number, rect, zoneIndex: number }|null} */
            this.selectedZone = null;
        }

        enable() {
            // GNOME 45-49: grab-op-begin(display, window, grabOp) — 3 params.
            // Some versions may drop the 3rd param; fall back to
            // display.get_grab_op() when available.
            this._signalIds.push(
                global.display.connect("grab-op-begin", (_dpy, win, op) => {
                    const grabOp = op ?? global.display.get_grab_op?.() ?? 0;
                    // Accept mouse-move, keyboard-move, and unconstrained move
                    if (grabOp === Meta.GrabOp.MOVING ||
                        grabOp === Meta.GrabOp.KEYBOARD_MOVING ||
                        grabOp === Meta.GrabOp.MOVING_UNCONSTRAINED)
                        this._onDragBegin(win);
                }),
                global.display.connect("grab-op-end", (_dpy, win, _op) => {
                    if (this._dragging && win === this._draggedWindow)
                        this._onDragEnd();
                })
            );
        }

        disable() {
            this._stopPolling();
            for (const id of this._signalIds)
                global.display.disconnect(id);
            this._signalIds = [];
            this._dragging = false;
            this._draggedWindow = null;
        }

        // ------------------------------------------------------------------ private

        _onDragBegin(metaWindow) {
            if (!this._settings.dragHighlightEnabled) return;
            this._dragging = true;
            this._draggedWindow = metaWindow;
            this._lastHoveredZone = null;
            this._lastPx = null;
            this._lastPy = null;
            this._startPolling();
        }

        _onDragEnd() {
            this._stopPolling();
            this._dragging = false;

            const last = this._lastHoveredZone;
            const win  = this._draggedWindow;

            if (last?.isMaximize) {
                // Top-edge drag → maximize directly
                win?.maximize(Meta.MaximizeFlags.BOTH);
                this.selectedZone = null;
                this.emit("zone-selected", "", -1, -1);
            } else if (last) {
                this.selectedZone = { presetId: last.presetId, monitorIndex: last.monitorIndex, rect: last.rect, zoneIndex: last.zoneIndex };
                this.emit("zone-selected",
                    last.presetId,
                    last.monitorIndex,
                    last.zoneIndex
                );
            } else {
                this.selectedZone = null;
                this.emit("zone-selected", "", -1, -1);
            }

            this._lastHoveredZone = null;
            this._draggedWindow = null;
        }

        _startPolling() {
            if (this._pollId) return;
            this._pollStart = GLib.get_monotonic_time();
            const MAX_POLL_US = 30 * 1000000; // 30 seconds safety limit
            this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                if (!this._dragging ||
                    GLib.get_monotonic_time() - this._pollStart > MAX_POLL_US) {
                    this._pollId = null;
                    if (this._dragging) this._onDragEnd();
                    return GLib.SOURCE_REMOVE;
                }
                this._poll();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopPolling() {
            if (this._pollId) {
                GLib.Source.remove(this._pollId);
                this._pollId = null;
            }
        }

        _poll() {
            const [px, py] = global.get_pointer();

            // Skip all zone math when the pointer hasn't moved since the last
            // 16ms frame — nothing can change, so there's no work to do.
            if (px === this._lastPx && py === this._lastPy) return;
            this._lastPx = px;
            this._lastPy = py;

            const monitorIndex = this._zoneManager.getMonitorForPoint(px, py);

            // Edge/corner detection takes priority over active-preset zones
            const edgeZone = this._getEdgeZone(px, py, monitorIndex);

            let presetId, rect, zoneIndex, isMaximize;

            if (edgeZone) {
                ({ presetId, rect, zoneIndex, isMaximize } = edgeZone);
            } else {
                const activePreset = this._multiMonitor.getActivePreset(monitorIndex);
                const hit = this._zoneManager.getHoveredZone(px, py, activePreset, monitorIndex);
                if (!hit) {
                    if (this._lastHoveredZone) {
                        this._lastHoveredZone = null;
                        this.hoveredZone = null;
                        this.emit("zone-hovered", "", monitorIndex, -1);
                    }
                    return;
                }
                presetId = activePreset;
                ({ rect, zoneIndex } = hit);
                isMaximize = false;
            }

            const changed = !this._lastHoveredZone ||
                this._lastHoveredZone.zoneIndex  !== zoneIndex  ||
                this._lastHoveredZone.presetId   !== presetId   ||
                this._lastHoveredZone.monitorIndex !== monitorIndex;

            if (changed) {
                this._lastHoveredZone = { presetId, monitorIndex, rect, zoneIndex, isMaximize };
                this.hoveredZone = { presetId, monitorIndex, rect, zoneIndex };
                this.emit("zone-hovered", presetId, monitorIndex, zoneIndex);
            }
        }

        /**
         * Check whether the pointer is within the edge/corner snap threshold of
         * the monitor and return a hardcoded zone if so.
         *
         * Uses the MONITOR geometry for proximity detection (users drag to the
         * physical screen edge) but the WORKAREA for the resulting zone rects
         * (so windows don't overlap the panel/taskbar).
         *
         * Priority: corners > top edge (maximize) > left/right edges.
         *
         * @returns {{ presetId, zoneIndex, rect: Meta.Rectangle, isMaximize: boolean }|null}
         */
        _getEdgeZone(px, py, monitorIndex) {
            // Monitor geometry for proximity detection
            const mon = global.display.get_monitor_geometry(monitorIndex);
            if (!mon) return null;

            // Workarea for zone rects
            let wa;
            try {
                wa = this._draggedWindow
                    ? this._draggedWindow.get_work_area_for_monitor(monitorIndex)
                    : mon;
            } catch (_) {
                wa = mon;
            }
            if (!wa) return null;

            const T = Math.max(this._settings.dragEdgeThreshold ?? 20, 20);
            const C = T * 2; // corner detection box

            // Detect proximity to MONITOR edges (not workarea)
            const nearLeft   = px < mon.x + C;
            const nearRight  = px > mon.x + mon.width - C;
            const nearTop    = py < mon.y + C;
            const nearBottom = py > mon.y + mon.height - C;

            const { x, y, width: w, height: h } = wa;
            const g = this._settings.windowGapSize ?? 0;
            const halfG = g / 2;
            const mk = (rx, ry, rw, rh) => makeRect({
                x:      Math.round(rx + halfG),
                y:      Math.round(ry + halfG),
                width:  Math.round(rw - g),
                height: Math.round(rh - g),
            });

            // Corners (evaluated first — highest priority)
            if (nearLeft  && nearTop)    return { presetId: "quarters", zoneIndex: 0, rect: mk(x,       y,       w / 2, h / 2), isMaximize: false };
            if (nearRight && nearTop)    return { presetId: "quarters", zoneIndex: 1, rect: mk(x + w/2, y,       w / 2, h / 2), isMaximize: false };
            if (nearLeft  && nearBottom) return { presetId: "quarters", zoneIndex: 2, rect: mk(x,       y + h/2, w / 2, h / 2), isMaximize: false };
            if (nearRight && nearBottom) return { presetId: "quarters", zoneIndex: 3, rect: mk(x + w/2, y + h/2, w / 2, h / 2), isMaximize: false };

            // Top edge → maximize (use same threshold as corners since monitor
            // edge is further from workarea edge when panel is present)
            if (py < mon.y + T) return { presetId: "__maximize__", zoneIndex: -1, rect: mk(x, y, w, h), isMaximize: true };

            // Side edges → left/right halves (detect from monitor edge)
            if (px < mon.x + T)              return { presetId: "halves", zoneIndex: 0, rect: mk(x,       y, w / 2, h), isMaximize: false };
            if (px > mon.x + mon.width - T)  return { presetId: "halves", zoneIndex: 1, rect: mk(x + w/2, y, w / 2, h), isMaximize: false };

            return null;
        }
    });