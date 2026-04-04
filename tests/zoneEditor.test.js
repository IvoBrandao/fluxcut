/**
 * tests/zoneEditor.test.js
 *
 * Tests for src/zoneEditor.js — grid snapping, zone CRUD,
 * deletion by object reference, status updates, and save logic.
 *
 * Uses a shim approach: extracts the pure-logic methods from ZoneEditor
 * without needing the full UI actor creation.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals } from "./helpers/gnome-globals.js";

// ── ZoneEditor Logic Shim ─────────────────────────────────────────────────────
// We import ZoneEditor but test internal methods directly since the UI
// construction methods require full St/Clutter mocks. For open/close
// lifecycle we mock the necessary UI objects.

import { ZoneEditor } from "../src/zoneEditor.js";

function makeSettings(overrides = {}) {
    return {
        zoneEditorGridColumns: 12,
        zoneEditorGridRows: 8,
        windowGapSize: 0,
        ...overrides,
    };
}

function makeCustomZones(existing = []) {
    const store = [...existing];
    let nextId = 100;
    return {
        getAll: () => store,
        getById: (id) => store.find(s => s.id === id) ?? null,
        addZoneSet: (set) => store.push(set),
        updateZoneSet: (id, data) => {
            const s = store.find(x => x.id === id);
            if (s) Object.assign(s, data);
        },
        removeZoneSet: (id) => {
            const idx = store.findIndex(s => s.id === id);
            if (idx >= 0) store.splice(idx, 1);
        },
        generateId: () => `custom-${nextId++}`,
        connect: () => Symbol("changed"),
        _store: store,
    };
}

function makeZoneManager() {
    return {
        getZoneRects: () => [],
    };
}

function makeAnimations() {
    return {
        fadeIn: () => {},
        fadeOut: (_actor, _dur, cb) => cb?.(),
        slideIn: () => {},
    };
}

function makeLogger() {
    const logs = [];
    return {
        debug: (...a) => logs.push(["debug", ...a]),
        info: (...a) => logs.push(["info", ...a]),
        warn: (...a) => logs.push(["warn", ...a]),
        error: (...a) => logs.push(["error", ...a]),
        _logs: logs,
    };
}

// ── Grid Snap Tests ──────────────────────────────────────────────────────────

describe("ZoneEditor._snapToGrid", () => {
    let editor;

    beforeEach(() => {
        setupGnomeGlobals();
        editor = new ZoneEditor(
            makeSettings(), makeCustomZones(), makeZoneManager(),
            makeAnimations(), makeLogger()
        );
    });

    it("snaps x to nearest column division (12 columns)", () => {
        const result = editor._snapToGrid({ x: 0.33, y: 0, w: 0.5, h: 0.5 });
        // snap(0.33, 12) = Math.round(0.33 * 12) / 12 = Math.round(3.96) / 12 = 4/12 = 0.333...
        assert.ok(Math.abs(result.x - 1 / 3) < 0.001);
    });

    it("snaps y to nearest row division (8 rows)", () => {
        const result = editor._snapToGrid({ x: 0, y: 0.44, w: 0.5, h: 0.5 });
        // snap(0.44, 8) = Math.round(0.44 * 8) / 8 = Math.round(3.52) / 8 = 4/8 = 0.5
        assert.equal(result.y, 0.5);
    });

    it("enforces minimum width of 1/cols", () => {
        const result = editor._snapToGrid({ x: 0, y: 0, w: 0.01, h: 0.5 });
        // min width = 1/12 ≈ 0.0833
        assert.ok(Math.abs(result.w - 1 / 12) < 0.001);
    });

    it("enforces minimum height of 1/rows", () => {
        const result = editor._snapToGrid({ x: 0, y: 0, w: 0.5, h: 0.01 });
        // min height = 1/8 = 0.125
        assert.equal(result.h, 0.125);
    });

    it("snaps half-width correctly", () => {
        const result = editor._snapToGrid({ x: 0, y: 0, w: 0.5, h: 1 });
        // snap(0.5, 12) = Math.round(6) / 12 = 0.5
        assert.equal(result.w, 0.5);
    });

    it("snaps to full width and height", () => {
        const result = editor._snapToGrid({ x: 0, y: 0, w: 1.0, h: 1.0 });
        assert.equal(result.w, 1.0);
        assert.equal(result.h, 1.0);
    });

    it("uses custom grid dimensions from settings", () => {
        const editor6x4 = new ZoneEditor(
            makeSettings({ zoneEditorGridColumns: 6, zoneEditorGridRows: 4 }),
            makeCustomZones(), makeZoneManager(), makeAnimations(), makeLogger()
        );
        const result = editor6x4._snapToGrid({ x: 0.16, y: 0.24, w: 0.5, h: 0.5 });
        // snap(0.16, 6) = Math.round(0.96) / 6 = 1/6 ≈ 0.1667
        assert.ok(Math.abs(result.x - 1 / 6) < 0.001);
        // snap(0.24, 4) = Math.round(0.96) / 4 = 1/4 = 0.25
        assert.equal(result.y, 0.25);
    });
});

// ── Zone CRUD Tests ──────────────────────────────────────────────────────────

describe("ZoneEditor zone management", () => {
    let editor, customZones, logger;

    beforeEach(() => {
        setupGnomeGlobals();
        customZones = makeCustomZones();
        logger = makeLogger();
        editor = new ZoneEditor(
            makeSettings(), customZones, makeZoneManager(),
            makeAnimations(), logger
        );
        // Set up minimal canvas context for _addZoneActor to work
        editor._monitorIndex = 0;
        editor._canvas = {
            add_child: () => {},
            remove_child: () => {},
        };
        editor._statusLabel = { text: "" };
    });

    it("_addZoneActor adds zone to internal array", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        assert.equal(editor._zones.length, 1);
    });

    it("_addZoneActor creates 8 handles per zone", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        assert.equal(editor._zones[0].handles.length, 8);
    });

    it("_addZoneActor returns index of new zone", () => {
        const idx = editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        assert.equal(idx, 0);
        const idx2 = editor._addZoneActor({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
        assert.equal(idx2, 1);
    });

    it("_deleteZone removes zone by object reference", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        editor._addZoneActor({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
        editor._addZoneActor({ x: 0, y: 0.5, w: 0.5, h: 0.5 });

        const secondZone = editor._zones[1];
        editor._deleteZone(secondZone);

        assert.equal(editor._zones.length, 2);
        // First and third zone remain
        assert.equal(editor._zones[0].normRect.x, 0);
        assert.equal(editor._zones[1].normRect.x, 0); // was third, now second
        assert.equal(editor._zones[1].normRect.y, 0.5);
    });

    it("_deleteZone with stale reference does nothing", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        const zone = editor._zones[0];
        editor._deleteZone(zone);
        // Try again with stale reference
        assert.doesNotThrow(() => editor._deleteZone(zone));
        assert.equal(editor._zones.length, 0);
    });

    it("sequential deletions maintain correct references", () => {
        // This is the critical bug test: old code captured array indices
        // which became stale after splice. New code uses object references.
        editor._addZoneActor({ x: 0, y: 0, w: 0.25, h: 0.5 });
        editor._addZoneActor({ x: 0.25, y: 0, w: 0.25, h: 0.5 });
        editor._addZoneActor({ x: 0.5, y: 0, w: 0.25, h: 0.5 });
        editor._addZoneActor({ x: 0.75, y: 0, w: 0.25, h: 0.5 });

        // Save references before any deletion
        const zone0 = editor._zones[0];
        const zone2 = editor._zones[2];

        // Delete zone at index 0
        editor._deleteZone(zone0);
        assert.equal(editor._zones.length, 3);

        // zone2 reference still valid, even though indices shifted
        editor._deleteZone(zone2);
        assert.equal(editor._zones.length, 2);

        // Remaining zones should be index 1 and 3 from original
        assert.equal(editor._zones[0].normRect.x, 0.25);
        assert.equal(editor._zones[1].normRect.x, 0.75);
    });

    it("_resetZones clears all zones", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        editor._addZoneActor({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
        editor._resetZones();
        assert.equal(editor._zones.length, 0);
    });

    it("_updateStatus shows zone count text", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 0.5 });
        assert.ok(editor._statusLabel.text.includes("1"));

        editor._addZoneActor({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
        assert.ok(editor._statusLabel.text.includes("2"));
    });
});

// ── Save Tests ───────────────────────────────────────────────────────────────

describe("ZoneEditor._saveZones", () => {
    let editor, customZones, logger;

    beforeEach(() => {
        setupGnomeGlobals();
        customZones = makeCustomZones();
        logger = makeLogger();
        editor = new ZoneEditor(
            makeSettings(), customZones, makeZoneManager(),
            makeAnimations(), logger
        );
        editor._monitorIndex = 0;
        editor._canvas = { add_child: () => {}, remove_child: () => {} };
        editor._statusLabel = { text: "" };
        editor._nameEntry = { get_text: () => "My Layout" };
        // Prevent close() from accessing null backdrop
        editor._backdrop = null;
    });

    it("saves new zone set with correct data", () => {
        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 1 });
        editor._addZoneActor({ x: 0.5, y: 0, w: 0.5, h: 1 });
        editor._saveZones();

        assert.equal(customZones._store.length, 1);
        assert.equal(customZones._store[0].label, "My Layout");
        assert.equal(customZones._store[0].zones.length, 2);
    });

    it("does not save with 0 zones", () => {
        editor._saveZones();
        assert.equal(customZones._store.length, 0);
        assert.ok(logger._logs.some(l => l[0] === "warn"));
    });

    it("updates existing zone set when editing", () => {
        customZones.addZoneSet({ id: "existing-1", label: "Old", zones: [{ x: 0, y: 0, w: 1, h: 1 }] });
        editor._editingSetId = "existing-1";

        editor._addZoneActor({ x: 0, y: 0, w: 0.5, h: 1 });
        editor._addZoneActor({ x: 0.5, y: 0, w: 0.5, h: 1 });
        editor._saveZones();

        assert.equal(customZones._store.length, 1);
        assert.equal(customZones._store[0].label, "My Layout");
        assert.equal(customZones._store[0].zones.length, 2);
    });

    it("generates default name when entry is empty", () => {
        editor._nameEntry = { get_text: () => "" };
        editor._addZoneActor({ x: 0, y: 0, w: 1, h: 1 });
        editor._saveZones();

        assert.ok(customZones._store[0].label.length > 0);
    });
});
