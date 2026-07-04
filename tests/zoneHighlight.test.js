/**
 * tests/zoneHighlight.test.js
 *
 * Tests for src/zoneHighlight.js — zone overlay rendering, active zone
 * style switching, signal wiring, and clearAll cleanup.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals, Rect } from "./helpers/gnome-globals.js";
import { ZoneHighlighter } from "../src/zoneHighlight.js";

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeSettings() {
    return { windowGapSize: 0 };
}

function makeDragDetector() {
    const handlers = new Map();
    return {
        connect: (signal, cb) => {
            if (!handlers.has(signal)) handlers.set(signal, []);
            const id = Symbol(signal);
            handlers.get(signal).push({ id, cb });
            return id;
        },
        disconnect: (id) => {
            for (const [, cbs] of handlers) {
                const idx = cbs.findIndex(h => h.id === id);
                if (idx >= 0) cbs.splice(idx, 1);
            }
        },
        _emit: (signal, ...args) => {
            for (const { cb } of handlers.get(signal) ?? []) cb(null, ...args);
        },
        _draggedWindow: null,
    };
}

function makeWindowTracker() {
    const calls = [];
    return {
        snapWindow: (...args) => calls.push(["snapWindow", ...args]),
        _calls: calls,
    };
}

function makeZoneManager(rectSets = {}) {
    return {
        getZoneRects: (presetId, monitorIndex) => {
            return rectSets[presetId] ?? [
                new Rect(0, 0, 960, 540),
                new Rect(960, 0, 960, 540),
                new Rect(0, 540, 960, 540),
                new Rect(960, 540, 960, 540),
            ];
        },
    };
}

function makeAnimations() {
    const calls = [];
    return {
        fadeIn: (actor) => calls.push(["fadeIn", actor]),
        fadeOut: (actor, dur, onComplete) => {
            calls.push(["fadeOut", actor]);
            onComplete?.();
        },
        scaleSnap: (actor) => calls.push(["scaleSnap", actor]),
        _calls: calls,
    };
}

function makeLogger() {
    return { debug() {}, info() {}, warn() {}, error() {} };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ZoneHighlighter", () => {
    let settings, dragDetector, windowTracker, zoneManager, animations, highlighter;

    beforeEach(() => {
        setupGnomeGlobals();
        settings = makeSettings();
        dragDetector = makeDragDetector();
        windowTracker = makeWindowTracker();
        zoneManager = makeZoneManager();
        animations = makeAnimations();
        highlighter = new ZoneHighlighter(
            settings, dragDetector, windowTracker, zoneManager, animations, makeLogger()
        );
    });

    describe("enable/disable", () => {
        it("connects to dragDetector signals on enable", () => {
            highlighter.enable();
            assert.equal(highlighter._signalIds.length, 2);
        });

        it("disconnects signals on disable", () => {
            highlighter.enable();
            highlighter.disable();
            assert.equal(highlighter._signalIds.length, 0);
        });

        it("clears highlights on disable", () => {
            highlighter.enable();
            highlighter.showPreviewForPreset("quarters", 0);
            assert.ok(highlighter._highlights.length > 0);
            highlighter.disable();
            assert.equal(highlighter._highlights.length, 0);
        });
    });

    describe("showPreviewForPreset", () => {
        it("creates highlight actors for each zone", () => {
            highlighter.showPreviewForPreset("quarters", 0);
            assert.equal(highlighter._highlights.length, 4);
        });

        it("all highlights have inactive style (no active zone)", () => {
            highlighter.showPreviewForPreset("quarters", 0);
            for (const h of highlighter._highlights) {
                assert.equal(h.actor.style_class, "wtc-zone-inactive");
            }
        });

        it("adds actors to global.window_group", () => {
            highlighter.showPreviewForPreset("quarters", 0);
            assert.equal(global.window_group._children.length, 4);
        });

        it("calls fadeIn for each actor", () => {
            highlighter.showPreviewForPreset("quarters", 0);
            const fadeIns = animations._calls.filter(c => c[0] === "fadeIn");
            assert.equal(fadeIns.length, 4);
        });

        it("tracks current preset and monitor", () => {
            highlighter.showPreviewForPreset("halves", 1);
            assert.equal(highlighter._currentPreset, "halves");
            assert.equal(highlighter._currentMonitor, 1);
        });
    });

    describe("clearAll", () => {
        it("removes all highlight actors from window_group", () => {
            highlighter.showPreviewForPreset("quarters", 0);
            highlighter.clearAll();
            assert.equal(global.window_group._children.length, 0);
            assert.equal(highlighter._highlights.length, 0);
        });

        it("resets current preset and monitor", () => {
            highlighter.showPreviewForPreset("quarters", 0);
            highlighter.clearAll();
            assert.equal(highlighter._currentPreset, null);
            assert.equal(highlighter._currentMonitor, -1);
        });

        it("safe to call when no highlights exist", () => {
            assert.doesNotThrow(() => highlighter.clearAll());
        });
    });

    describe("_updateActiveZone", () => {
        it("sets active style on matching zone index", () => {
            highlighter.showPreviewForPreset("quarters", 0);
            highlighter._updateActiveZone(2);

            assert.equal(highlighter._highlights[2].actor.style_class, "wtc-zone-active");
            assert.equal(highlighter._highlights[0].actor.style_class, "wtc-zone-inactive");
            assert.equal(highlighter._highlights[1].actor.style_class, "wtc-zone-inactive");
            assert.equal(highlighter._highlights[3].actor.style_class, "wtc-zone-inactive");
        });

        it("switching active zone updates styles correctly", () => {
            highlighter.showPreviewForPreset("quarters", 0);
            highlighter._updateActiveZone(0);
            assert.equal(highlighter._highlights[0].actor.style_class, "wtc-zone-active");

            highlighter._updateActiveZone(3);
            assert.equal(highlighter._highlights[0].actor.style_class, "wtc-zone-inactive");
            assert.equal(highlighter._highlights[3].actor.style_class, "wtc-zone-active");
        });
    });

    describe("zone-hovered signal handling", () => {
        beforeEach(() => {
            highlighter.enable();
        });

        it("shows zones on first hover with preset", () => {
            dragDetector._emit("zone-hovered", "halves", 0, 0);
            assert.equal(highlighter._highlights.length, 4); // mock zoneManager returns 4
            assert.equal(highlighter._currentPreset, "halves");
        });

        it("clears on hover with empty preset", () => {
            dragDetector._emit("zone-hovered", "halves", 0, 0);
            dragDetector._emit("zone-hovered", "", 0, -1);
            assert.equal(highlighter._highlights.length, 0);
        });
    });

    describe("zone-selected signal handling", () => {
        beforeEach(() => {
            highlighter.enable();
        });

        it("snaps dragged window and clears highlights on zone selection", () => {
            const mockWin = {
                get_compositor_private: () => ({ opacity: 255 }),
            };
            dragDetector._draggedWindow = mockWin;

            const rect = new Rect(0, 0, 960, 1080);
            dragDetector.selectedZone = { presetId: "halves", monitorIndex: 0, rect, zoneIndex: 0 };
            dragDetector._emit("zone-selected", "halves", 0, 0);

            assert.deepEqual(windowTracker._calls[0], [
                "snapWindow", mockWin, "halves", 0, rect,
            ]);
        });

        it("clears highlights when zone-selected with no zone", () => {
            highlighter.showPreviewForPreset("quarters", 0);
            dragDetector._emit("zone-selected", "", 0, -1);
            assert.equal(highlighter._highlights.length, 0);
        });
    });
});
