/**
 * FluxCut — src/zoneHighlight.js
 * Renders St.Bin overlays on global.window_group to show snap zones
 * during window drag operations and snap overlay hover previews.
 */

import St from "gi://St";

export class ZoneHighlighter {
    constructor(settings, dragDetector, windowTracker, zoneManager, animations, logger) {
        this._settings = settings;
        this._dragDetector = dragDetector;
        this._windowTracker = windowTracker;
        this._zoneManager = zoneManager;
        this._animations = animations;
        this._log = logger;

        // Current highlight actors: [{ actor: St.Bin, zoneIndex: number }]
        this._highlights = [];
        this._currentPreset = null;
        this._currentMonitor = -1;

        this._signalIds = [];
    }

    enable() {
        this._signalIds.push(
            this._dragDetector.connect("zone-hovered", (_, presetId, monitorIdx, rect, zoneIndex) => {
                this._onZoneHovered(presetId, monitorIdx, rect, zoneIndex);
            }),
            this._dragDetector.connect("zone-selected", (_, presetId, monitorIdx, rect, zoneIndex) => {
                this._onZoneSelected(presetId, monitorIdx, rect, zoneIndex);
            })
        );
    }

    disable() {
        for (const id of this._signalIds)
            this._dragDetector.disconnect(id);
        this._signalIds = [];
        this.clearAll();
    }

    // ------------------------------------------------------------------ public

    /**
     * Show all zone highlights for a given preset on a monitor (used by
     * snapOverlay on button hover — no active zone highlighted).
     */
    showPreviewForPreset(presetId, monitorIndex) {
        this._showAllZones(presetId, monitorIndex, -1);
    }

    /** Remove all highlight actors. */
    clearAll() {
        for (const h of this._highlights) {
            if (global.window_group.contains(h.actor))
                global.window_group.remove_child(h.actor);
            h.actor.destroy();
        }
        this._highlights = [];
        this._currentPreset = null;
        this._currentMonitor = -1;
    }

    // ------------------------------------------------------------------ private

    _onZoneHovered(presetId, monitorIndex, rect, zoneIndex) {
        if (!presetId || zoneIndex === -1) {
            this.clearAll();
            return;
        }

        // If preset changed, rebuild all zone actors
        if (presetId !== this._currentPreset || monitorIndex !== this._currentMonitor)
            this._showAllZones(presetId, monitorIndex, zoneIndex);
        else
            this._updateActiveZone(zoneIndex);
    }

    _onZoneSelected(presetId, monitorIndex, rect, zoneIndex) {
        if (zoneIndex === -1) {
            this.clearAll();
            return;
        }

        // Snap window and clear highlights
        if (this._dragDetector._draggedWindow) {
            const animate = this._animations.duration > 0;
            this._windowTracker.snapWindow(
                this._dragDetector._draggedWindow,
                presetId,
                zoneIndex,
                rect,
                animate,
                this._animations
            );

            // Scale snap feedback on window actor
            const actor = this._dragDetector._draggedWindow.get_compositor_private();
            if (actor)
                this._animations.scaleSnap(actor);
        }

        // Fade out all highlights
        for (const h of this._highlights) {
            this._animations.fadeOut(h.actor, undefined, () => {
                if (global.window_group.contains(h.actor))
                    global.window_group.remove_child(h.actor);
                h.actor.destroy();
            });
        }
        this._highlights = [];
        this._currentPreset = null;
        this._currentMonitor = -1;
    }

    _showAllZones(presetId, monitorIndex, activeZoneIndex) {
        this.clearAll();
        this._currentPreset = presetId;
        this._currentMonitor = monitorIndex;

        const rects = this._zoneManager.getZoneRects(presetId, monitorIndex);

        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            const isActive = i === activeZoneIndex;

            const actor = new St.Bin({
                style_class: isActive ? "fluxcut-zone-active" : "fluxcut-zone-inactive",
                reactive: false,
            });

            actor.set_position(r.x, r.y);
            actor.set_size(r.width, r.height);
            actor.opacity = 0;

            global.window_group.add_child(actor);
            this._animations.fadeIn(actor);

            this._highlights.push({ actor, zoneIndex: i });
        }
    }

    _updateActiveZone(activeZoneIndex) {
        for (const h of this._highlights) {
            const shouldBeActive = h.zoneIndex === activeZoneIndex;
            const isActive = h.actor.style_class === "fluxcut-zone-active";

            if (shouldBeActive && !isActive) {
                h.actor.style_class = "fluxcut-zone-active";
            } else if (!shouldBeActive && isActive) {
                h.actor.style_class = "fluxcut-zone-inactive";
            }
        }
    }
}
