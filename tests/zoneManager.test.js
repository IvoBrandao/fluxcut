/**
 * tests/zoneManager.test.js
 *
 * Tests for src/zoneManager.js — exercises _normToPixel, getZoneRects,
 * getHoveredZone, findClosestZoneIndex, and getMonitorForPoint with a
 * stubbed global.display.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals, Rect } from "./helpers/gnome-globals.js";
import { ZoneManager } from "../src/zoneManager.js";
import { PRESETS } from "../src/layoutPresets.js";

// ── shared setup ──────────────────────────────────────────────────────────────

function makeSettings(overrides = {}) {
    return {
        windowGapSize: 0,
        dragEdgeThreshold: 20,
        ...overrides,
    };
}

function makeCustomZones(sets = []) {
    return {
        getAll: () => sets,
        getById: (id) => sets.find(s => s.id === id),
    };
}

const MONITOR_1920 = { x: 0, y: 0, width: 1920, height: 1080 };
const MONITOR_2560 = { x: 1920, y: 0, width: 2560, height: 1440 };

// ── _normToPixel via getZoneRects ─────────────────────────────────────────────

describe("ZoneManager.getZoneRects", () => {
    let zm;

    beforeEach(() => {
        const { display } = setupGnomeGlobals({ monitors: [MONITOR_1920] });
        // _getWorkarea used inside getZoneRects; stub get_focus_window
        display._setFocusWindow({
            get_work_area_for_monitor: (_i) => new Rect(0, 0, 1920, 1080),
        });
        zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
    });

    it("returns 2 rects for the halves preset", () => {
        const rects = zm.getZoneRects("halves", 0);
        assert.equal(rects.length, 2);
    });

    it("halves left rect occupies the left half of 1920-wide monitor", () => {
        const rects = zm.getZoneRects("halves", 0);
        assert.equal(rects[0].x, 0);
        assert.equal(rects[0].y, 0);
        assert.equal(rects[0].width, 960);
        assert.equal(rects[0].height, 1080);
    });

    it("halves right rect starts at x=960", () => {
        const rects = zm.getZoneRects("halves", 0);
        assert.equal(rects[1].x, 960);
        assert.equal(rects[1].width, 960);
    });

    it("applies gap correctly", () => {
        const zmGap = new ZoneManager(makeSettings({ windowGapSize: 8 }), makeCustomZones(), null);
        const rects = zmGap.getZoneRects("halves", 0);
        // Left zone: x = 0 + 4 = 4, width = 960 - 8 = 952
        assert.equal(rects[0].x, 4);
        assert.equal(rects[0].width, 952);
    });

    it("returns 4 rects for quarters preset", () => {
        const rects = zm.getZoneRects("quarters", 0);
        assert.equal(rects.length, 4);
    });

    it("quarters top-left rect is in the top-left quadrant", () => {
        const rects = zm.getZoneRects("quarters", 0);
        assert.equal(rects[0].x, 0);
        assert.equal(rects[0].y, 0);
        assert.equal(rects[0].width, 960);
        assert.equal(rects[0].height, 540);
    });

    it("returns [] for unknown preset", () => {
        const rects = zm.getZoneRects("no-such-preset", 0);
        assert.deepEqual(rects, []);
    });

    it("returns rects from a custom zone set", () => {
        const customSet = {
            id: "my-custom",
            label: "My Layout",
            zones: [
                { x: 0, y: 0, w: 0.3, h: 1 },
                { x: 0.3, y: 0, w: 0.7, h: 1 },
            ],
        };
        const zmCustom = new ZoneManager(makeSettings(), makeCustomZones([customSet]), null);
        const rects = zmCustom.getZoneRects("my-custom", 0);
        assert.equal(rects.length, 2);
        assert.equal(rects[0].width, Math.round(0.3 * 1920));
    });
});

// ── getHoveredZone ────────────────────────────────────────────────────────────

describe("ZoneManager.getHoveredZone", () => {
    let zm;

    beforeEach(() => {
        setupGnomeGlobals({ monitors: [MONITOR_1920] });
        global.display._setFocusWindow({
            get_work_area_for_monitor: () => new Rect(0, 0, 1920, 1080),
        });
        zm = new ZoneManager(makeSettings({ dragEdgeThreshold: 20 }), makeCustomZones(), null);
    });

    it("returns null when pointer is outside workarea", () => {
        const hit = zm.getHoveredZone(-100, -100, "halves", 0);
        assert.equal(hit, null);
    });

    it("returns left zone when pointer is in left half", () => {
        const hit = zm.getHoveredZone(480, 540, "halves", 0);
        assert.ok(hit, "should hit a zone");
        assert.equal(hit.zoneIndex, 0);
    });

    it("returns right zone when pointer is in right half", () => {
        const hit = zm.getHoveredZone(1440, 540, "halves", 0);
        assert.ok(hit, "should hit a zone");
        assert.equal(hit.zoneIndex, 1);
    });

    it("returns null for unknown preset", () => {
        const hit = zm.getHoveredZone(100, 100, "no-preset", 0);
        assert.equal(hit, null);
    });
});

// ── getMonitorForPoint ────────────────────────────────────────────────────────

describe("ZoneManager.getMonitorForPoint", () => {
    it("returns 0 for point in monitor 0", () => {
        setupGnomeGlobals({ monitors: [MONITOR_1920, MONITOR_2560] });
        const zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
        assert.equal(zm.getMonitorForPoint(100, 100), 0);
    });

    it("returns 1 for point in monitor 1 (offset at x=1920)", () => {
        setupGnomeGlobals({ monitors: [MONITOR_1920, MONITOR_2560] });
        const zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
        assert.equal(zm.getMonitorForPoint(2000, 100), 1);
    });

    it("returns current monitor for a point outside all monitors", () => {
        setupGnomeGlobals({ monitors: [MONITOR_1920] });
        const zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
        // Falls back to get_current_monitor() which is 0
        assert.equal(zm.getMonitorForPoint(99999, 99999), 0);
    });
});

// ── findClosestZoneIndex ──────────────────────────────────────────────────────

describe("ZoneManager.findClosestZoneIndex", () => {
    beforeEach(() => {
        setupGnomeGlobals({ monitors: [MONITOR_1920] });
        global.display._setFocusWindow({
            get_work_area_for_monitor: () => new Rect(0, 0, 1920, 1080),
        });
    });

    it("returns 0 for a rect that aligns with the left zone of halves", () => {
        const zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
        const leftRect = new Rect(0, 0, 960, 1080);
        assert.equal(zm.findClosestZoneIndex(leftRect, "halves", 0), 0);
    });

    it("returns 1 for a rect that aligns with the right zone of halves", () => {
        const zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
        const rightRect = new Rect(960, 0, 960, 1080);
        assert.equal(zm.findClosestZoneIndex(rightRect, "halves", 0), 1);
    });

    it("returns 0 as fallback for empty preset", () => {
        const zm = new ZoneManager(makeSettings(), makeCustomZones(), null);
        const rect = new Rect(0, 0, 100, 100);
        assert.equal(zm.findClosestZoneIndex(rect, "nonexistent", 0), 0);
    });
});
