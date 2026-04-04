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
             * @param {string|null} presetId
             * @param {number} monitorIndex
             * @param {Meta.Rectangle|null} zoneRect
             * @param {number} zoneIndex
             */
            "zone-hovered": {
                param_types: [
                    GObject.TYPE_STRING,  // presetId (or "")
                    GObject.TYPE_INT,     // monitorIndex
                    GObject.TYPE_POINTER, // zoneRect (boxed Meta.Rectangle or null-pointer)
                    GObject.TYPE_INT,     // zoneIndex (-1 if none)
                ],
            },
            /**
             * Emitted when a drag ends (with or without a zone selection).
             * Same parameters as zone-hovered.
             */
            "zone-selected": {
                param_types: [
                    GObject.TYPE_STRING,
                    GObject.TYPE_INT,
                    GObject.TYPE_POINTER,
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
        }

        enable() {
            // GNOME 45: grab-op-begin(display, window, grabOp) — 3 params
            // GNOME 46+: grab-op-begin(display, window) — 2 params,
            //            use display.get_grab_op() instead
            this._signalIds.push(
                global.display.connect("grab-op-begin", (_dpy, win, op) => {
                    const grabOp = op ?? global.display.get_grab_op?.();
                    if (grabOp === Meta.GrabOp.MOVING)
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
                this.emit("zone-selected", "", -1, null, -1);
            } else if (last) {
                this.emit("zone-selected",
                    last.presetId,
                    last.monitorIndex,
                    last.rect,
                    last.zoneIndex
                );
            } else {
                this.emit("zone-selected", "", -1, null, -1);
            }

            this._lastHoveredZone = null;
            this._draggedWindow = null;
        }

        _startPolling() {
            if (this._pollId) return;
            this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                if (!this._dragging) {
                    this._pollId = null;
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
                        this.emit("zone-hovered", "", monitorIndex, null, -1);
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
                this.emit("zone-hovered", presetId, monitorIndex, rect, zoneIndex);
            }
        }

        /**
         * Check whether the pointer is within the edge/corner snap threshold of
         * the monitor workarea and return a hardcoded zone if so.
         *
         * Priority: corners > top edge (maximize) > left/right edges.
         *
         * @returns {{ presetId, zoneIndex, rect: Meta.Rectangle, isMaximize: boolean }|null}
         */
        _getEdgeZone(px, py, monitorIndex) {
            let wa;
            try {
                wa = this._draggedWindow
                    ? this._draggedWindow.get_work_area_for_monitor(monitorIndex)
                    : global.display.get_monitor_geometry(monitorIndex);
            } catch (_) {
                wa = global.display.get_monitor_geometry(monitorIndex);
            }
            if (!wa) return null;

            const { x, y, width: w, height: h } = wa;
            const T = Math.max(this._settings.dragEdgeThreshold ?? 20, 8);
            const C = T * 2; // corner detection box

            const nearLeft   = px < x + C;
            const nearRight  = px > x + w - C;
            const nearTop    = py < y + C;
            const nearBottom = py > y + h - C;

            const g = this._settings.windowGapSize ?? 0;
            // Gap logic matches ZoneManager._normToPixel: half-gap inset on
            // each edge (giving full-gap between adjacent zones).
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

            // Top edge → maximize
            if (py < y + T) return { presetId: "__maximize__", zoneIndex: -1, rect: mk(x, y, w, h), isMaximize: true };

            // Side edges → left/right halves
            if (px < x + T)     return { presetId: "halves", zoneIndex: 0, rect: mk(x,       y, w / 2, h), isMaximize: false };
            if (px > x + w - T) return { presetId: "halves", zoneIndex: 1, rect: mk(x + w/2, y, w / 2, h), isMaximize: false };

            return null;
        }
    });