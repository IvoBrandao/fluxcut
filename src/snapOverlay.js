/**
 * FluxCut — src/snapOverlay.js
 * The Super+Z snap layout picker popup.
 *
 * Appears top-center (or top-right, per settings) on the focused window's
 * monitor. Shows one button per preset; hover highlights zones; click snaps.
 * Arrow-key navigable; Escape dismisses.
 */

import St from "gi://St";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { getPresetsForAspectRatio } from "./layoutPresets.js";
import { AccentColor } from "./accentColor.js";
import { _ } from "./i18n.js";

// Stable X11 keysym values — avoids Clutter.KEY_* dependency
const Key = {
    ESCAPE:   0xFF1B,
    RETURN:   0xFF0D,
    KP_ENTER: 0xFF8D,
    LEFT:     0xFF51,
    RIGHT:    0xFF53,
};

export class SnapOverlay {
    constructor(settings, zoneManager, customZones, multiMonitor,
                windowTracker, zoneHighlighter, animations, logger) {
        this._settings = settings;
        this._zoneManager = zoneManager;
        this._customZones = customZones;
        this._multiMonitor = multiMonitor;
        this._windowTracker = windowTracker;
        this._zoneHighlighter = zoneHighlighter;
        this._animations = animations;
        this._log = logger;

        this._widget = null;
        this._captureId = null;
        this._keyId = null;
        this._focusedWindow = null;
        this._buttons = [];
        this._focusedButtonIdx = 0;
        this._accent = new AccentColor(logger);

        // Rebuild buttons when custom zones change
        this._customZonesSignalId = this._customZones.connect("changed", () => {
            if (this._widget) {
                this.close();
            }
        });
    }

    // ------------------------------------------------------------------ public

    open(metaWindow) {
        if (!this._settings.snapOverlayEnabled) return;
        if (this._widget) this.close();

        this._focusedWindow = metaWindow ?? global.display.get_focus_window();
        if (!this._focusedWindow) return;

        const monitorIndex = this._focusedWindow.get_monitor();
        this._currentMonitor = monitorIndex;

        this._widget = new St.BoxLayout({
            style_class: "fluxcut-snap-overlay",
            vertical: false,
            reactive: true,
        });

        this._buildButtons(monitorIndex);

        Main.uiGroup.add_child(this._widget);
        this._positionWidget(monitorIndex);
        this._animations.slideIn(this._widget, 0, -16);

        // Keyboard navigation
        this._keyId = this._widget.connect("key-press-event", (_a, event) => {
            return this._onKeyPress(event);
        });
        this._widget.grab_key_focus();

        // Click-outside dismiss (avoid event.get_source(), removed in GNOME 47+)
        this._captureId = global.stage.connect("captured-event", (_a, event) => {
            if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                const [cx, cy] = event.get_coords();
                const [wx, wy] = this._widget.get_transformed_position();
                const ww = this._widget.width;
                const wh = this._widget.height;
                if (cx < wx || cx > wx + ww || cy < wy || cy > wy + wh)
                    this.close();
            }
            return false;
        });
    }

    close() {
        if (!this._widget) return;

        if (this._captureId) {
            global.stage.disconnect(this._captureId);
            this._captureId = null;
        }
        if (this._keyId) {
            this._widget.disconnect(this._keyId);
            this._keyId = null;
        }

        this._zoneHighlighter.clearAll();

        const widget = this._widget;
        this._widget = null;
        this._buttons = [];
        this._focusedWindow = null;

        this._animations.fadeOut(widget, undefined, () => {
            Main.uiGroup.remove_child(widget);
            widget.destroy();
        });
    }

    destroy() {
        this.close();
        if (this._customZonesSignalId) {
            this._customZones.disconnect(this._customZonesSignalId);
            this._customZonesSignalId = null;
        }
    }

    // ------------------------------------------------------------------ private — build

    _buildButtons(monitorIndex) {
        const monitorInfo = this._multiMonitor.getMonitor(monitorIndex);
        const aspect = monitorInfo?.aspectRatio ?? 1.78;

        const builtIn = getPresetsForAspectRatio(aspect);
        const custom = this._customZones.getAll();
        const allPresets = [...builtIn, ...custom];

        this._buttons = [];
        this._focusedButtonIdx = 0;

        for (let i = 0; i < allPresets.length; i++) {
            const preset = allPresets[i];
            const btn = this._buildPresetButton(preset, monitorIndex, i);
            this._widget.add_child(btn);
            this._buttons.push(btn);
        }
    }

    _buildPresetButton(preset, monitorIndex, buttonIdx) {
        const btn = new St.Button({
            style_class: "fluxcut-preset-button",
            can_focus: true,
            reactive: true,
        });

        const inner = new St.BoxLayout({ vertical: true });
        const diagram = this._buildZoneDiagram(preset.zones);
        inner.add_child(diagram);

        const label = new St.Label({
            text: _(preset.label),
            style_class: "fluxcut-preset-label",
            x_align: Clutter.ActorAlign.CENTER,
        });
        inner.add_child(label);
        btn.set_child(inner);

        btn.connect("enter-event", () => {
            this._focusedButtonIdx = buttonIdx;
            this._onButtonHover(preset.id, monitorIndex);
        });

        btn.connect("leave-event", () => {
            this._zoneHighlighter.clearAll();
        });

        btn.connect("clicked", () => {
            this._onButtonClicked(preset, monitorIndex);
        });

        return btn;
    }

    /**
     * Build a miniature zone layout diagram inside the preset button.
     * Uses an absolutely-positioned St.BoxLayout with St.Bin blocks.
     */
    _buildZoneDiagram(zones) {
        const DIAGRAM_W = 56;
        const DIAGRAM_H = 36;

        const container = new St.Widget({
            width: DIAGRAM_W,
            height: DIAGRAM_H,
        });

        for (let i = 0; i < zones.length; i++) {
            const z = zones[i];
            const block = new St.Bin({
                style_class: i === 0 ? "fluxcut-zone-block-primary" : "fluxcut-zone-block",
            });
            if (i === 0 && this._settings.useAccentColor) {
                block.style =
                    `background-color: ${this._accent.rgba(0.55)}; ` +
                    `border: 1px solid ${this._accent.rgba(0.90)};`;
            }
            const margin = 1;
            block.set_position(
                Math.round(z.x * DIAGRAM_W) + margin,
                Math.round(z.y * DIAGRAM_H) + margin
            );
            block.set_size(
                Math.max(Math.round(z.w * DIAGRAM_W) - margin * 2, 4),
                Math.max(Math.round(z.h * DIAGRAM_H) - margin * 2, 4)
            );
            container.add_child(block);
        }

        return container;
    }

    // ------------------------------------------------------------------ private — interaction

    _onButtonHover(presetId, monitorIndex) {
        this._zoneHighlighter.showPreviewForPreset(presetId, monitorIndex);
    }

    _onButtonClicked(preset, monitorIndex) {
        const win = this._focusedWindow;
        if (!win) {
            this.close();
            return;
        }

        // Set this as the active preset for the monitor (so future
        // drags and keybindings use the selected layout)
        this._multiMonitor.setActivePreset(monitorIndex, preset.id);

        const rects = this._zoneManager.getZoneRects(preset.id, monitorIndex, this._settings.windowGapSize);
        if (!rects.length) {
            this.close();
            return;
        }

        this._distributeWindows(win, preset.id, monitorIndex, rects);
        this.close();
    }

    /**
     * Assign every tileable window on the monitor+workspace to the preset's
     * zones, in order. The focused window takes the first zone. When there are
     * more windows than zones, the extras wrap around and stack on top of the
     * earlier zones (window i → zone i % zoneCount). When there are fewer
     * windows than zones, the trailing zones are simply left empty.
     */
    _distributeWindows(focusedWin, presetId, monitorIndex, rects) {
        const wsIndex = focusedWin.get_workspace().index();

        // Focused window first, then the rest in their current stacking order.
        const others = this._windowTracker
            .getTileableWindows(monitorIndex, wsIndex)
            .filter(w => w !== focusedWin);
        const ordered = [focusedWin, ...others];

        for (let i = 0; i < ordered.length; i++) {
            const zoneIndex = i % rects.length;
            this._windowTracker.snapWindow(ordered[i], presetId, zoneIndex, rects[zoneIndex]);
        }

        // Scale snap feedback on the focused window.
        const actor = focusedWin.get_compositor_private();
        if (actor) this._animations.scaleSnap(actor);
    }

    _onKeyPress(event) {
        const sym = event.get_key_symbol();

        if (sym === Key.ESCAPE) {
            this.close();
            return true;
        }

        if (sym === Key.RETURN || sym === Key.KP_ENTER) {
            const btn = this._buttons[this._focusedButtonIdx];
            btn?.emit("clicked");
            return true;
        }

        if (sym === Key.LEFT || sym === Key.RIGHT) {
            const delta = sym === Key.RIGHT ? 1 : -1;
            this._focusedButtonIdx =
                (this._focusedButtonIdx + delta + this._buttons.length) % this._buttons.length;
            this._buttons[this._focusedButtonIdx]?.grab_key_focus();
            return true;
        }

        return false;
    }

    // ------------------------------------------------------------------ private — position

    _positionWidget(monitorIndex) {
        if (!this._widget) return;

        // Ensure widget is allocated before measuring
        this._widget.ensure_style();

        const geom = global.display.get_monitor_geometry(monitorIndex);
        const ww = this._widget.width || 300;
        const wh = this._widget.height || 80;

        const position = this._settings.overlayPosition;
        let wx;

        if (position === "top-right") {
            wx = geom.x + geom.width - ww - 16;
        } else {
            // top-center (default)
            wx = geom.x + Math.round((geom.width - ww) / 2);
        }

        const wy = geom.y + 8; // near top of monitor
        this._widget.set_position(wx, wy);
    }
}
