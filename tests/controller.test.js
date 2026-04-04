/**
 * tests/controller.test.js
 *
 * Tests for extension.js FluxCutController — keybinding handler dispatch,
 * null-safety guards during deferred init, quarter-tiling context-awareness,
 * move/swap navigation, and disable teardown.
 *
 * Uses a shim approach: instantiates controller-like logic with mock
 * dependencies so we don't need a full GNOME Shell environment.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals, Rect } from "./helpers/gnome-globals.js";

// ── Controller Shim ──────────────────────────────────────────────────────────
// We test the snap routing logic in isolation — the same code that runs
// inside FluxCutController.snapFocusedToPreset, snapFocusedToUpperQuarter,
// snapFocusedToLowerQuarter, and moveSwapFocused.

function makeSettings() {
    return { windowGapSize: 8 };
}

function makeZoneManager() {
    const HALVES = [
        new Rect(4, 4, 952, 1072),
        new Rect(964, 4, 952, 1072),
    ];
    const QUARTERS = [
        new Rect(4, 4, 952, 532),      // top-left
        new Rect(964, 4, 952, 532),     // top-right
        new Rect(4, 544, 952, 532),     // bottom-left
        new Rect(964, 544, 952, 532),   // bottom-right
    ];

    return {
        getZoneRects: (presetId, _monitorIndex, _gap) => {
            if (presetId === "halves") return HALVES;
            if (presetId === "quarters") return QUARTERS;
            return [];
        },
        assignWindowToZone: () => {},
    };
}

function makeWindowTracker() {
    const snapEntries = new Map();
    const snapCalls = [];

    return {
        getSnapEntry: (win) => snapEntries.get(win.get_id()) ?? null,
        snapWindow: (win, presetId, zoneIndex, rect) => {
            snapCalls.push({ win, presetId, zoneIndex, rect });
            snapEntries.set(win.get_id(), { presetId, zoneIndex });
        },
        unsnapWindow: (win) => {
            snapEntries.delete(win.get_id());
        },
        getActiveSnapGroups: () => new Map(),
        _snapCalls: snapCalls,
        _snapEntries: snapEntries,
    };
}

function makeWindow(id = 1, monitorIndex = 0) {
    return {
        get_id: () => id,
        get_monitor: () => monitorIndex,
        get_maximized: () => 0,
        maximize: () => {},
        unmaximize: () => {},
        minimize: () => {},
    };
}

/**
 * Minimal controller mirroring the snap dispatch logic from extension.js.
 */
class TestController {
    constructor() {
        this._settings = makeSettings();
        this._zoneManager = makeZoneManager();
        this._windowTracker = makeWindowTracker();
        this._multiMonitor = null;
        this._snapOverlay = null;
        this._maximizeHook = { bypass: () => {} };
    }

    snapFocusedToPreset(presetId, zoneIndex) {
        const win = global.display.get_focus_window();
        if (!win || !this._zoneManager) return;

        const monitorIndex = win.get_monitor();
        const rects = this._zoneManager.getZoneRects(presetId, monitorIndex, this._settings.windowGapSize);
        const rect = rects[zoneIndex];
        if (!rect) return;

        this._windowTracker.snapWindow(win, presetId, zoneIndex, rect);
    }

    snapFocusedToUpperQuarter() {
        if (!this._windowTracker) return;
        const win = global.display.get_focus_window();
        if (!win) return;

        const entry = this._windowTracker.getSnapEntry(win);
        if (!entry) return this.snapFocusedToPreset("quarters", 0);

        if (entry.presetId === "halves" && entry.zoneIndex === 0) return this.snapFocusedToPreset("quarters", 0);
        if (entry.presetId === "halves" && entry.zoneIndex === 1) return this.snapFocusedToPreset("quarters", 1);
        if (entry.presetId === "quarters" && entry.zoneIndex === 2) return this.snapFocusedToPreset("quarters", 0);
        if (entry.presetId === "quarters" && entry.zoneIndex === 3) return this.snapFocusedToPreset("quarters", 1);
        return this.snapFocusedToPreset("quarters", 0);
    }

    snapFocusedToLowerQuarter() {
        if (!this._windowTracker) return;
        const win = global.display.get_focus_window();
        if (!win) return;

        const entry = this._windowTracker.getSnapEntry(win);
        if (!entry) return this.snapFocusedToPreset("quarters", 2);

        if (entry.presetId === "halves" && entry.zoneIndex === 0) return this.snapFocusedToPreset("quarters", 2);
        if (entry.presetId === "halves" && entry.zoneIndex === 1) return this.snapFocusedToPreset("quarters", 3);
        if (entry.presetId === "quarters" && entry.zoneIndex === 0) return this.snapFocusedToPreset("quarters", 2);
        if (entry.presetId === "quarters" && entry.zoneIndex === 1) return this.snapFocusedToPreset("quarters", 3);
        return this.snapFocusedToPreset("quarters", 2);
    }

    moveSwapFocused(direction) {
        const win = global.display.get_focus_window();
        if (!win || !this._zoneManager) return;

        const entry = this._windowTracker.getSnapEntry(win);
        const monitorIndex = win.get_monitor();
        let targetPreset, targetZone;

        if (!entry) {
            if (direction === "left") { targetPreset = "halves"; targetZone = 0; }
            else if (direction === "right") { targetPreset = "halves"; targetZone = 1; }
            else if (direction === "up") { targetPreset = "quarters"; targetZone = 0; }
            else if (direction === "down") { targetPreset = "quarters"; targetZone = 2; }
        } else if (entry.presetId === "halves") {
            if (entry.zoneIndex === 0) {
                if (direction === "right") { targetPreset = "halves"; targetZone = 1; }
                else if (direction === "up") { targetPreset = "quarters"; targetZone = 0; }
                else if (direction === "down") { targetPreset = "quarters"; targetZone = 2; }
            } else {
                if (direction === "left") { targetPreset = "halves"; targetZone = 0; }
                else if (direction === "up") { targetPreset = "quarters"; targetZone = 1; }
                else if (direction === "down") { targetPreset = "quarters"; targetZone = 3; }
            }
        } else if (entry.presetId === "quarters") {
            const quarterMap = {
                0: { left: null, right: 1, up: null, down: 2 },
                1: { left: 0, right: null, up: null, down: 3 },
                2: { left: null, right: 3, up: 0, down: null },
                3: { left: 2, right: null, up: 1, down: null },
            };
            targetZone = quarterMap[entry.zoneIndex]?.[direction];
            if (targetZone !== null && targetZone !== undefined)
                targetPreset = "quarters";
        }

        if (targetPreset && targetZone !== undefined) {
            const rects = this._zoneManager.getZoneRects(targetPreset, monitorIndex, this._settings.windowGapSize);
            const rect = rects[targetZone];
            if (rect)
                this._windowTracker.snapWindow(win, targetPreset, targetZone, rect);
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Controller snap dispatch", () => {
    let ctrl, display;

    beforeEach(() => {
        const globals = setupGnomeGlobals();
        display = globals.display;
        ctrl = new TestController();
    });

    describe("snapFocusedToPreset", () => {
        it("snaps to left half", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl.snapFocusedToPreset("halves", 0);

            assert.equal(ctrl._windowTracker._snapCalls.length, 1);
            assert.equal(ctrl._windowTracker._snapCalls[0].presetId, "halves");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 0);
        });

        it("snaps to right half", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl.snapFocusedToPreset("halves", 1);
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 1);
        });

        it("snaps to all four quarters", () => {
            const win = makeWindow();
            display._setFocusWindow(win);

            for (let i = 0; i < 4; i++) {
                ctrl.snapFocusedToPreset("quarters", i);
                assert.equal(ctrl._windowTracker._snapCalls[i].presetId, "quarters");
                assert.equal(ctrl._windowTracker._snapCalls[i].zoneIndex, i);
            }
        });

        it("does nothing when no focused window", () => {
            display._setFocusWindow(null);
            ctrl.snapFocusedToPreset("halves", 0);
            assert.equal(ctrl._windowTracker._snapCalls.length, 0);
        });

        it("does nothing for invalid zone index", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl.snapFocusedToPreset("halves", 99);
            assert.equal(ctrl._windowTracker._snapCalls.length, 0);
        });

        it("does nothing for unknown preset", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl.snapFocusedToPreset("nonexistent", 0);
            assert.equal(ctrl._windowTracker._snapCalls.length, 0);
        });
    });

    describe("snapFocusedToUpperQuarter (context-aware)", () => {
        it("unsnapped → top-left quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl.snapFocusedToUpperQuarter();
            assert.equal(ctrl._windowTracker._snapCalls[0].presetId, "quarters");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 0);
        });

        it("left half → top-left quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "halves", zoneIndex: 0 });
            ctrl.snapFocusedToUpperQuarter();
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 0);
        });

        it("right half → top-right quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "halves", zoneIndex: 1 });
            ctrl.snapFocusedToUpperQuarter();
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 1);
        });

        it("bottom-left quarter → top-left quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "quarters", zoneIndex: 2 });
            ctrl.snapFocusedToUpperQuarter();
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 0);
        });

        it("bottom-right quarter → top-right quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "quarters", zoneIndex: 3 });
            ctrl.snapFocusedToUpperQuarter();
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 1);
        });
    });

    describe("snapFocusedToLowerQuarter (context-aware)", () => {
        it("unsnapped → bottom-left quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl.snapFocusedToLowerQuarter();
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 2);
        });

        it("left half → bottom-left quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "halves", zoneIndex: 0 });
            ctrl.snapFocusedToLowerQuarter();
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 2);
        });

        it("right half → bottom-right quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "halves", zoneIndex: 1 });
            ctrl.snapFocusedToLowerQuarter();
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 3);
        });

        it("top-left quarter → bottom-left quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "quarters", zoneIndex: 0 });
            ctrl.snapFocusedToLowerQuarter();
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 2);
        });

        it("top-right quarter → bottom-right quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "quarters", zoneIndex: 1 });
            ctrl.snapFocusedToLowerQuarter();
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 3);
        });
    });

    describe("moveSwapFocused", () => {
        it("unsnapped + left → left half", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl.moveSwapFocused("left");
            assert.equal(ctrl._windowTracker._snapCalls[0].presetId, "halves");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 0);
        });

        it("unsnapped + right → right half", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl.moveSwapFocused("right");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 1);
        });

        it("unsnapped + up → top-left quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl.moveSwapFocused("up");
            assert.equal(ctrl._windowTracker._snapCalls[0].presetId, "quarters");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 0);
        });

        it("unsnapped + down → bottom-left quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl.moveSwapFocused("down");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 2);
        });

        it("left half + right → right half", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "halves", zoneIndex: 0 });
            ctrl.moveSwapFocused("right");
            assert.equal(ctrl._windowTracker._snapCalls[0].presetId, "halves");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 1);
        });

        it("right half + left → left half", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "halves", zoneIndex: 1 });
            ctrl.moveSwapFocused("left");
            assert.equal(ctrl._windowTracker._snapCalls[0].presetId, "halves");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 0);
        });

        it("left half + up → top-left quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "halves", zoneIndex: 0 });
            ctrl.moveSwapFocused("up");
            assert.equal(ctrl._windowTracker._snapCalls[0].presetId, "quarters");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 0);
        });

        it("right half + down → bottom-right quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "halves", zoneIndex: 1 });
            ctrl.moveSwapFocused("down");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 3);
        });

        it("top-left quarter + right → top-right quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "quarters", zoneIndex: 0 });
            ctrl.moveSwapFocused("right");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 1);
        });

        it("top-left quarter + down → bottom-left quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "quarters", zoneIndex: 0 });
            ctrl.moveSwapFocused("down");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 2);
        });

        it("bottom-right quarter + left → bottom-left quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "quarters", zoneIndex: 3 });
            ctrl.moveSwapFocused("left");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 2);
        });

        it("bottom-right quarter + up → top-right quarter", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "quarters", zoneIndex: 3 });
            ctrl.moveSwapFocused("up");
            assert.equal(ctrl._windowTracker._snapCalls[0].zoneIndex, 1);
        });

        it("top-right quarter + right → no-op (edge of screen)", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "quarters", zoneIndex: 1 });
            ctrl.moveSwapFocused("right");
            assert.equal(ctrl._windowTracker._snapCalls.length, 0);
        });

        it("bottom-left quarter + left → no-op (edge of screen)", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker._snapEntries.set(win.get_id(), { presetId: "quarters", zoneIndex: 2 });
            ctrl.moveSwapFocused("left");
            assert.equal(ctrl._windowTracker._snapCalls.length, 0);
        });

        it("does nothing when no focused window", () => {
            display._setFocusWindow(null);
            ctrl.moveSwapFocused("left");
            assert.equal(ctrl._windowTracker._snapCalls.length, 0);
        });
    });

    describe("null-safety guards", () => {
        it("snapFocusedToPreset returns early when _zoneManager is null", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._zoneManager = null;
            assert.doesNotThrow(() => ctrl.snapFocusedToPreset("halves", 0));
            assert.equal(ctrl._windowTracker._snapCalls.length, 0);
        });

        it("snapFocusedToUpperQuarter returns early when _windowTracker is null", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker = null;
            assert.doesNotThrow(() => ctrl.snapFocusedToUpperQuarter());
        });

        it("snapFocusedToLowerQuarter returns early when _windowTracker is null", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._windowTracker = null;
            assert.doesNotThrow(() => ctrl.snapFocusedToLowerQuarter());
        });

        it("moveSwapFocused returns early when _zoneManager is null", () => {
            const win = makeWindow();
            display._setFocusWindow(win);
            ctrl._zoneManager = null;
            assert.doesNotThrow(() => ctrl.moveSwapFocused("left"));
        });
    });
});
