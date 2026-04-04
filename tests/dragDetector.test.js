/**
 * tests/dragDetector.test.js
 *
 * Tests for the pure-logic parts of DragDetector:
 *   - _getEdgeZone corner/edge classification
 *   - _onDragEnd emit behaviour
 *   - enable/disable guard-flag interactions
 *
 * DragDetector uses GObject.registerClass; we test the internal methods
 * via a shim that mirrors the class body without extending GObject.Object.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals, Rect } from "./helpers/gnome-globals.js";

// Re-usable Meta.Rectangle constructor (mirrors the stub in gi-loader)
function mkRect(x, y, width, height) {
    return new Rect(x, y, width, height);
}

// ── DragDetectorShim  ─────────────────────────────────────────────────────────
// Duplicates _getEdgeZone logic without the GObject registration.

class DragDetectorShim {
    constructor(settings, draggedWindow = null) {
        this._settings = settings;
        this._draggedWindow = draggedWindow;
        this._lastHoveredZone = null;
        this._dragging = false;
        this._draggedWindow = draggedWindow;
        this._emitted = [];
    }

    emit(signal, ...args) {
        this._emitted.push({ signal, args });
    }

    _getEdgeZone(px, py, monitorIndex) {
        // Mirror production: detect proximity from MONITOR edge, zone rects from workarea
        const mon = global.display.get_monitor_geometry(monitorIndex);
        if (!mon) return null;

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
        const C = T * 2;

        // Detect proximity to MONITOR edges
        const nearLeft   = px < mon.x + C;
        const nearRight  = px > mon.x + mon.width - C;
        const nearTop    = py < mon.y + C;
        const nearBottom = py > mon.y + mon.height - C;

        const { x, y, width: w, height: h } = wa;
        const g = this._settings.windowGapSize ?? 0;
        const halfG = g / 2;
        const mk = (rx, ry, rw, rh) => mkRect(
            Math.round(rx + halfG),
            Math.round(ry + halfG),
            Math.round(rw - g),
            Math.round(rh - g)
        );

        if (nearLeft  && nearTop)    return { presetId: "quarters", zoneIndex: 0, rect: mk(x,       y,       w / 2, h / 2), isMaximize: false };
        if (nearRight && nearTop)    return { presetId: "quarters", zoneIndex: 1, rect: mk(x + w/2, y,       w / 2, h / 2), isMaximize: false };
        if (nearLeft  && nearBottom) return { presetId: "quarters", zoneIndex: 2, rect: mk(x,       y + h/2, w / 2, h / 2), isMaximize: false };
        if (nearRight && nearBottom) return { presetId: "quarters", zoneIndex: 3, rect: mk(x + w/2, y + h/2, w / 2, h / 2), isMaximize: false };

        if (py < mon.y + T) return { presetId: "__maximize__", zoneIndex: -1, rect: mk(x, y, w, h), isMaximize: true };

        if (px < mon.x + T)              return { presetId: "halves", zoneIndex: 0, rect: mk(x,       y, w / 2, h), isMaximize: false };
        if (px > mon.x + mon.width - T)  return { presetId: "halves", zoneIndex: 1, rect: mk(x + w/2, y, w / 2, h), isMaximize: false };

        return null;
    }

    _onDragEnd() {
        const last = this._lastHoveredZone;
        if (last?.isMaximize) {
            this._draggedWindow?.maximize?.();
            this.selectedZone = null;
            this.emit("zone-selected", "", -1, -1);
        } else if (last) {
            this.selectedZone = { presetId: last.presetId, monitorIndex: last.monitorIndex, rect: last.rect, zoneIndex: last.zoneIndex };
            this.emit("zone-selected", last.presetId, last.monitorIndex, last.zoneIndex);
        } else {
            this.selectedZone = null;
            this.emit("zone-selected", "", -1, -1);
        }
        this._lastHoveredZone = null;
        this._draggedWindow = null;
    }
}

// ── Test monitors ─────────────────────────────────────────────────────────────

const WA = { x: 0, y: 0, width: 1920, height: 1080 };

function makeShim(threshold = 20, gap = 0, draggedWindow = null) {
    return new DragDetectorShim(
        { dragEdgeThreshold: threshold, windowGapSize: gap },
        draggedWindow
    );
}

// ── _getEdgeZone — corners ────────────────────────────────────────────────────

describe("DragDetector._getEdgeZone — corners (priority over edges)", () => {
    beforeEach(() => {
        setupGnomeGlobals({ monitors: [WA] });
    });

    it("top-left corner → quarters[0]", () => {
        const d = makeShim();
        const z = d._getEdgeZone(5, 5, 0);
        assert.ok(z, "should detect corner zone");
        assert.equal(z.presetId, "quarters");
        assert.equal(z.zoneIndex, 0);
        assert.equal(z.isMaximize, false);
    });

    it("top-right corner → quarters[1]", () => {
        const d = makeShim();
        const z = d._getEdgeZone(1915, 5, 0);
        assert.ok(z);
        assert.equal(z.zoneIndex, 1);
    });

    it("bottom-left corner → quarters[2]", () => {
        const d = makeShim();
        const z = d._getEdgeZone(5, 1075, 0);
        assert.ok(z);
        assert.equal(z.zoneIndex, 2);
    });

    it("bottom-right corner → quarters[3]", () => {
        const d = makeShim();
        const z = d._getEdgeZone(1915, 1075, 0);
        assert.ok(z);
        assert.equal(z.zoneIndex, 3);
    });

    it("corner zone rect is the correct quadrant", () => {
        const d = makeShim();
        const z = d._getEdgeZone(5, 5, 0);  // top-left
        assert.equal(z.rect.x, 0);
        assert.equal(z.rect.y, 0);
        assert.equal(z.rect.width, 960);
        assert.equal(z.rect.height, 540);
    });

    it("gap is applied to corner rects", () => {
        const d = makeShim(20, 8);
        const z = d._getEdgeZone(5, 5, 0);
        assert.equal(z.rect.x, 4);     // 0 + halfGap
        assert.equal(z.rect.y, 4);
        assert.equal(z.rect.width, 960 - 8);
        assert.equal(z.rect.height, 540 - 8);
    });
});

// ── _getEdgeZone — top edge (maximize) ───────────────────────────────────────

describe("DragDetector._getEdgeZone — top edge maximize", () => {
    beforeEach(() => {
        setupGnomeGlobals({ monitors: [WA] });
    });

    it("top edge (non-corner) → isMaximize=true", () => {
        const d = makeShim();
        // px = 960 (centre, not near corners); py = 5 (within threshold)
        const z = d._getEdgeZone(960, 5, 0);
        assert.ok(z);
        assert.equal(z.isMaximize, true);
        assert.equal(z.presetId, "__maximize__");
        assert.equal(z.zoneIndex, -1);
    });

    it("top edge rect covers the full monitor", () => {
        const d = makeShim();
        const z = d._getEdgeZone(960, 5, 0);
        assert.equal(z.rect.width, 1920);
        assert.equal(z.rect.height, 1080);
    });
});

// ── _getEdgeZone — side edges ─────────────────────────────────────────────────

describe("DragDetector._getEdgeZone — side edges", () => {
    beforeEach(() => {
        setupGnomeGlobals({ monitors: [WA] });
    });

    it("left edge (non-corner) → halves[0]", () => {
        const d = makeShim();
        // py = 540 (mid-height, far from corners); px near left edge
        const z = d._getEdgeZone(5, 540, 0);
        assert.ok(z);
        assert.equal(z.presetId, "halves");
        assert.equal(z.zoneIndex, 0);
        assert.equal(z.isMaximize, false);
    });

    it("right edge (non-corner) → halves[1]", () => {
        const d = makeShim();
        const z = d._getEdgeZone(1915, 540, 0);
        assert.ok(z);
        assert.equal(z.presetId, "halves");
        assert.equal(z.zoneIndex, 1);
    });

    it("left half rect starts at x=0 and covers left half", () => {
        const d = makeShim();
        const z = d._getEdgeZone(5, 540, 0);
        assert.equal(z.rect.x, 0);
        assert.equal(z.rect.width, 960);
    });

    it("right half rect starts at x=960", () => {
        const d = makeShim();
        const z = d._getEdgeZone(1915, 540, 0);
        assert.equal(z.rect.x, 960);
        assert.equal(z.rect.width, 960);
    });
});

// ── _getEdgeZone — center (no zone) ──────────────────────────────────────────

describe("DragDetector._getEdgeZone — centre (no detection)", () => {
    beforeEach(() => {
        setupGnomeGlobals({ monitors: [WA] });
    });

    it("returns null when pointer is well within monitor", () => {
        const d = makeShim();
        assert.equal(d._getEdgeZone(960, 540, 0), null);
    });

    it("returns null when pointer is just outside threshold", () => {
        const d = makeShim(20);
        // x=25 is just outside the 20px threshold
        assert.equal(d._getEdgeZone(25, 540, 0), null);
    });
});

// ── _getEdgeZone — threshold clamping ────────────────────────────────────────

describe("DragDetector._getEdgeZone — threshold clamping", () => {
    beforeEach(() => {
        setupGnomeGlobals({ monitors: [WA] });
    });

    it("clamps threshold to at least 20px", () => {
        const d = makeShim(0);  // threshold=0 → clamped to 20
        // px=5 < 20*2=40 → corner; py=5 → corner detected
        const z = d._getEdgeZone(5, 5, 0);
        assert.ok(z, "corner should still be detected with clamp");
    });
});

// ── _onDragEnd ────────────────────────────────────────────────────────────────

describe("DragDetector._onDragEnd", () => {
    beforeEach(() => setupGnomeGlobals({ monitors: [WA] }));

    it("emits zone-selected with empty strings when no zone was hovered", () => {
        const d = makeShim();
        d._onDragEnd();
        assert.equal(d._emitted.length, 1);
        const { signal, args } = d._emitted[0];
        assert.equal(signal, "zone-selected");
        assert.equal(args[0], "");
        assert.equal(args[1], -1);
        assert.equal(args[2], -1);
    });

    it("emits zone-selected with preset data when a zone was hovered", () => {
        const d = makeShim();
        d._lastHoveredZone = {
            presetId: "halves", monitorIndex: 0,
            rect: mkRect(0, 0, 960, 1080), zoneIndex: 0, isMaximize: false,
        };
        d._onDragEnd();
        const { args } = d._emitted[0];
        assert.equal(args[0], "halves");
        assert.equal(args[1], 0);
        assert.equal(args[2], 0);
    });

    it("calls window.maximize when isMaximize=true and emits zone-selected(-1)", () => {
        let maximized = false;
        const win = { maximize: () => { maximized = true; } };
        const d = makeShim(20, 0, win);
        d._lastHoveredZone = {
            presetId: "__maximize__", monitorIndex: 0,
            rect: mkRect(0, 0, 1920, 1080), zoneIndex: -1, isMaximize: true,
        };
        d._onDragEnd();
        assert.ok(maximized, "maximize() should have been called");
        const { args } = d._emitted[0];
        assert.equal(args[1], -1);
    });

    it("clears lastHoveredZone and draggedWindow after end", () => {
        const d = makeShim();
        d._lastHoveredZone = { isMaximize: false, presetId: "halves", monitorIndex: 0, rect: null, zoneIndex: 0 };
        d._onDragEnd();
        assert.equal(d._lastHoveredZone, null);
        assert.equal(d._draggedWindow, null);
    });
});
