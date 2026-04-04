/**
 * FluxCut — src/zoneEditor.js
 * Full-screen visual zone editor (FancyZones-style).
 *
 * NOTE: gi://Clutter is retained here solely for Clutter.ActorAlign — Mutter's
 * actor alignment enum, which has no St/CSS replacement for programmatic use.
 *
 * User can:
 *  - Draw new zones by dragging on empty area (rubber-band)
 *  - Resize zones by dragging edge/corner handles
 *  - Delete zones with middle-click
 *  - Save the layout as a new custom zone set
 *  - Open an existing custom set for editing
 *
 * All coordinates are snapped to a configurable grid (default 12×8).
 */

import St from "gi://St";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { _ } from "./i18n.js";

const HANDLE_SIZE = 10;
const MIN_ZONE_PX = 40;

export class ZoneEditor {
    constructor(settings, customZones, zoneManager, animations, logger) {
        this._settings = settings;
        this._customZones = customZones;
        this._zoneManager = zoneManager;
        this._animations = animations;
        this._log = logger;

        this._backdrop = null;
        this._canvas = null;
        this._toolbar = null;
        this._nameEntry = null;

        /** @type {{ normRect: NormRect, actor: St.Bin, handles: St.Bin[] }[]} */
        this._zones = [];

        this._monitorIndex = 0;
        this._editingSetId = null; // null = new set

        // Rubber-band draw state
        this._drawing = false;
        this._drawStart = null; // {x, y} in canvas coords
        this._rubberband = null;

        // Drag resize state
        this._draggingHandle = null; // { zoneIdx, edge, startX, startY, origRect }

        this._captureId = null;
    }

    // ------------------------------------------------------------------ public

    open(monitorIndex = 0, existingSetId = null) {
        if (this._backdrop) this.close();

        this._monitorIndex = monitorIndex;
        this._editingSetId = existingSetId;

        const geom = global.display.get_monitor_geometry(monitorIndex);

        // Dark backdrop covering the entire monitor
        this._backdrop = new St.Widget({
            style_class: "fluxcut-editor-backdrop",
            reactive: true,
        });
        this._backdrop.set_position(geom.x, geom.y);
        this._backdrop.set_size(geom.width, geom.height);

        // Canvas for zone actors (sits on top of backdrop)
        this._canvas = new St.Widget({
            reactive: true,
            can_focus: false,
            track_hover: true,
        });
        this._canvas.set_position(0, 0);
        this._canvas.set_size(geom.width, geom.height);
        this._backdrop.add_child(this._canvas);

        // Toolbar at bottom
        this._toolbar = this._buildToolbar();
        const toolbarH = 56;
        this._toolbar.set_position(0, geom.height - toolbarH);
        this._toolbar.set_size(geom.width, toolbarH);
        this._backdrop.add_child(this._toolbar);

        Main.uiGroup.add_child(this._backdrop);
        this._animations.fadeIn(this._backdrop);

        // Load existing zones or start blank
        if (existingSetId) {
            const set = this._customZones.getById(existingSetId);
            if (set) {
                for (const normRect of set.zones)
                    this._addZoneActor(normRect);
            }
        }

        // Use captured-event to intercept all events before child actors
        this._captureId = this._canvas.connect("captured-event", (_a, event) => {
            const type = event.type();

            if (type === Clutter.EventType.BUTTON_PRESS) {
                return this._onPress(event);
            } else if (type === Clutter.EventType.MOTION) {
                return this._onMotion(event);
            } else if (type === Clutter.EventType.BUTTON_RELEASE) {
                return this._onRelease(event);
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    close() {
        if (!this._backdrop) return;

        if (this._captureId) {
            this._canvas.disconnect(this._captureId);
            this._captureId = null;
        }

        const backdrop = this._backdrop;
        this._backdrop = null;
        this._canvas = null;
        this._toolbar = null;
        this._nameEntry = null;
        this._zones = [];
        this._drawing = false;
        this._rubberband = null;
        this._draggingHandle = null;

        this._animations.fadeOut(backdrop, undefined, () => {
            if (Main.uiGroup.contains(backdrop)) {
                Main.uiGroup.remove_child(backdrop);
                backdrop.destroy();
            }
        });
    }

    destroy() {
        this.close();
    }

    // ------------------------------------------------------------------ private — toolbar

    _buildToolbar() {
        const toolbar = new St.BoxLayout({
            style_class: "fluxcut-editor-toolbar",
            vertical: false,
        });

        // Zone set name entry
        this._nameEntry = new St.Entry({
            hint_text: _("Layout name…"),
            text: this._editingSetId
                ? (this._customZones.getById(this._editingSetId)?.label ?? "")
                : "",
            style_class: "fluxcut-editor-status",
            x_expand: true,
        });
        toolbar.add_child(this._nameEntry);

        // Zone count label
        this._statusLabel = new St.Label({
            text: _("0 zones"),
            style_class: "fluxcut-editor-status",
            y_align: Clutter.ActorAlign.CENTER,
        });
        toolbar.add_child(this._statusLabel);

        // Reset button
        const resetBtn = new St.Button({
            label: _("Reset to Default"),
            style_class: "fluxcut-editor-btn",
        });
        resetBtn.connect("clicked", () => this._resetZones());
        toolbar.add_child(resetBtn);

        // Cancel button
        const cancelBtn = new St.Button({
            label: _("Cancel"),
            style_class: "fluxcut-editor-btn",
        });
        cancelBtn.connect("clicked", () => this.close());
        toolbar.add_child(cancelBtn);

        // Save button
        const saveBtn = new St.Button({
            label: _("Save"),
            style_class: "fluxcut-editor-btn fluxcut-editor-btn-primary",
        });
        saveBtn.connect("clicked", () => this._saveZones());
        toolbar.add_child(saveBtn);

        return toolbar;
    }

    // ------------------------------------------------------------------ private — zone actors

    _addZoneActor(normRect) {
        const geom = global.display.get_monitor_geometry(this._monitorIndex);
        const actor = new St.Bin({ style_class: "fluxcut-editor-zone", reactive: true });

        this._updateActorFromNorm(actor, normRect, geom);
        this._canvas.add_child(actor);

        const handles = this._buildHandles(actor, normRect, geom);
        for (const h of handles)
            this._canvas.add_child(h);

        // Use object reference (not array index) so deletion stays correct
        // even after other zones are removed.
        const zone = { normRect, actor, handles };
        this._zones.push(zone);

        // Middle-click to delete
        actor.connect("button-press-event", (_a, event) => {
            if (event.get_button() === 2) { // middle button
                this._deleteZone(zone);
                return true;
            }
            return false;
        });

        this._updateStatus();
        return this._zones.length - 1;
    }

    _buildHandles(actor, normRect, geom) {
        const edges = [
            { name: "tl", nx: 0, ny: 0 }, { name: "tr", nx: 1, ny: 0 },
            { name: "bl", nx: 0, ny: 1 }, { name: "br", nx: 1, ny: 1 },
            { name: "t",  nx: 0.5, ny: 0 }, { name: "b",  nx: 0.5, ny: 1 },
            { name: "l",  nx: 0, ny: 0.5 }, { name: "r",  nx: 1, ny: 0.5 },
        ];

        return edges.map(edge => {
            const h = new St.Bin({
                style_class: "fluxcut-editor-handle",
                reactive: true,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
            });

            const ax = Math.round(normRect.x * geom.width  + edge.nx * normRect.w * geom.width  - HANDLE_SIZE / 2);
            const ay = Math.round(normRect.y * geom.height + edge.ny * normRect.h * geom.height - HANDLE_SIZE / 2);
            h.set_position(ax, ay);

            // Drag to resize — handled via canvas captured event
            h._fluxcutEdge = edge.name;
            h._fluxcutZoneActor = actor;

            return h;
        });
    }

    _updateActorFromNorm(actor, normRect, geom) {
        actor.set_position(
            Math.round(normRect.x * geom.width),
            Math.round(normRect.y * geom.height)
        );
        actor.set_size(
            Math.round(normRect.w * geom.width),
            Math.round(normRect.h * geom.height)
        );
    }

    _deleteZone(zoneEntry) {
        const idx = this._zones.indexOf(zoneEntry);
        if (idx === -1) return;

        zoneEntry.actor.destroy();
        for (const h of zoneEntry.handles)
            h.destroy();

        this._zones.splice(idx, 1);
        this._updateStatus();
    }

    _resetZones() {
        for (const zone of this._zones) {
            zone.actor.destroy();
            for (const h of zone.handles) h.destroy();
        }
        this._zones = [];
        this._updateStatus();
    }

    _updateStatus() {
        const count = this._zones.length;
        if (this._statusLabel)
            this._statusLabel.text = `${count} ${count === 1 ? _("zone") : _("zones")}`;
    }

    // ------------------------------------------------------------------ private — canvas input

    _onPress(event) {
        if (event.get_button() !== 1) // primary button
            return Clutter.EVENT_PROPAGATE;

        const [cx, cy] = event.get_coords();
        const [ox, oy] = this._canvas.get_transformed_position();
        const lx = cx - ox;
        const ly = cy - oy;

        // Check if pressing a handle
        const source = event.get_source();
        if (source._fluxcutEdge) {
            const targetActor = source._fluxcutZoneActor;
            const zone = this._zones.find(z => z.actor === targetActor);
            if (zone) {
                this._draggingHandle = {
                    zone,
                    edge: source._fluxcutEdge,
                    startX: lx,
                    startY: ly,
                    origRect: { ...zone.normRect },
                };
                return Clutter.EVENT_STOP;
            }
        }

        // Start rubber-band draw on empty canvas
        if (source === this._canvas || source === this._backdrop) {
            this._drawing = true;
            this._drawStart = { x: lx, y: ly };

            this._rubberband = new St.Bin({ style_class: "fluxcut-editor-rubberband" });
            this._rubberband.set_position(lx, ly);
            this._rubberband.set_size(1, 1);
            this._canvas.add_child(this._rubberband);

            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onMotion(event) {
        const [cx, cy] = event.get_coords();
        const [ox, oy] = this._canvas.get_transformed_position();
        const lx = cx - ox;
        const ly = cy - oy;

        const geom = global.display.get_monitor_geometry(this._monitorIndex);

        if (this._drawing && this._rubberband) {
            const x = Math.min(lx, this._drawStart.x);
            const y = Math.min(ly, this._drawStart.y);
            const w = Math.abs(lx - this._drawStart.x);
            const h = Math.abs(ly - this._drawStart.y);
            this._rubberband.set_position(x, y);
            this._rubberband.set_size(Math.max(w, 1), Math.max(h, 1));
            return Clutter.EVENT_STOP;
        }

        if (this._draggingHandle) {
            this._applyHandleDrag(lx, ly, geom);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onRelease(event) {
        if (event.get_button() !== 1) // primary button
            return Clutter.EVENT_PROPAGATE;

        const [cx, cy] = event.get_coords();
        const [ox, oy] = this._canvas.get_transformed_position();
        const lx = cx - ox;
        const ly = cy - oy;

        const geom = global.display.get_monitor_geometry(this._monitorIndex);

        if (this._drawing) {
            this._drawing = false;
            if (this._rubberband) {
                const rx = Math.min(lx, this._drawStart.x);
                const ry = Math.min(ly, this._drawStart.y);
                const rw = Math.abs(lx - this._drawStart.x);
                const rh = Math.abs(ly - this._drawStart.y);

                this._rubberband.destroy();
                this._rubberband = null;

                if (rw >= MIN_ZONE_PX && rh >= MIN_ZONE_PX) {
                    const norm = this._snapToGrid({
                        x: rx / geom.width,
                        y: ry / geom.height,
                        w: rw / geom.width,
                        h: rh / geom.height,
                    });
                    this._addZoneActor(norm);
                }
            }
            this._drawStart = null;
            return Clutter.EVENT_STOP;
        }

        if (this._draggingHandle) {
            this._draggingHandle = null;
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _applyHandleDrag(lx, ly, geom) {
        const dh = this._draggingHandle;
        if (!dh) return;

        const zone = dh.zone;
        if (!zone || !this._zones.includes(zone)) return;

        const dx = (lx - dh.startX) / geom.width;
        const dy = (ly - dh.startY) / geom.height;

        let { x, y, w, h } = dh.origRect;
        const edge = dh.edge;

        if (edge.includes("l")) { x += dx; w -= dx; }
        if (edge.includes("r")) { w += dx; }
        if (edge.includes("t")) { y += dy; h -= dy; }
        if (edge.includes("b")) { h += dy; }

        // Clamp
        x = Math.max(0, Math.min(x, 1 - MIN_ZONE_PX / geom.width));
        y = Math.max(0, Math.min(y, 1 - MIN_ZONE_PX / geom.height));
        w = Math.max(MIN_ZONE_PX / geom.width, Math.min(w, 1 - x));
        h = Math.max(MIN_ZONE_PX / geom.height, Math.min(h, 1 - y));

        const snapped = this._snapToGrid({ x, y, w, h });
        zone.normRect = snapped;
        this._updateActorFromNorm(zone.actor, snapped, geom);

        // Update handle positions
        for (const h of zone.handles) h.destroy();
        zone.handles = this._buildHandles(zone.actor, snapped, geom);
        for (const h of zone.handles) this._canvas.add_child(h);
    }

    // ------------------------------------------------------------------ private — grid snap

    _snapToGrid(normRect) {
        const cols = this._settings.zoneEditorGridColumns;
        const rows = this._settings.zoneEditorGridRows;

        const snap = (v, divisions) => Math.round(v * divisions) / divisions;

        return {
            x: snap(normRect.x, cols),
            y: snap(normRect.y, rows),
            w: Math.max(snap(normRect.w, cols), 1 / cols),
            h: Math.max(snap(normRect.h, rows), 1 / rows),
        };
    }

    // ------------------------------------------------------------------ private — save

    _saveZones() {
        const activeZones = this._zones.map(z => z.normRect);

        if (activeZones.length === 0) {
            this._log?.warn("ZoneEditor: cannot save with 0 zones");
            return;
        }

        const name = this._nameEntry?.get_text?.()?.trim() ||
                     `${_("Custom")} ${this._customZones.getAll().length + 1}`;

        if (this._editingSetId) {
            this._customZones.updateZoneSet(this._editingSetId, {
                label: name,
                zones: activeZones,
            });
        } else {
            this._customZones.addZoneSet({
                id: this._customZones.generateId(),
                label: name,
                zones: activeZones,
            });
        }

        this._log?.info(`ZoneEditor: saved "${name}" with ${activeZones.length} zones`);
        this.close();
    }
}
