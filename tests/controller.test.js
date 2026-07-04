/**
 * tests/controller.test.js
 *
 * Tests for extension.js WindowTilingControlController — keybinding handler dispatch,
 * null-safety guards during deferred init, quarter-tiling context-awareness,
 * move/swap navigation, and disable teardown.
 *
 * Uses a shim approach: instantiates controller-like logic with mock
 * dependencies so we don't need a full GNOME Shell environment.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals, Rect } from "./helpers/gnome-globals.js";
import { classifySlot, resolveMove } from "../src/directionalMove.js";

// ── Controller Shim ──────────────────────────────────────────────────────────
// We test the snap routing logic in isolation. The directional handlers
// delegate to the REAL geometry-based model (src/directionalMove.js), exactly
// as WindowTilingControlController does, so this exercises production code paths.

const WORKAREA = { x: 0, y: 0, width: 1920, height: 1080 };

// Frame rects that classify to each slot (see directionalMove.classifySlot).
const SLOT_FRAMES = {
    maxi: new Rect(0, 0, 1920, 1080),
    L:    new Rect(0, 0, 960, 1080),
    R:    new Rect(960, 0, 960, 1080),
    TL:   new Rect(0, 0, 960, 540),
    TR:   new Rect(960, 0, 960, 540),
    BL:   new Rect(0, 540, 960, 540),
    BR:   new Rect(960, 540, 960, 540),
};

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
        _getWorkarea: () => WORKAREA,
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
    let frame = SLOT_FRAMES.maxi;
    return {
        get_id: () => id,
        get_monitor: () => monitorIndex,
        get_maximized: () => 0,
        get_frame_rect: () => frame,
        _setSlot: (slot) => { frame = SLOT_FRAMES[slot]; },
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

    // Geometry-based directional move — the production code path.
    _directionalMove(direction) {
        if (!this._windowTracker || !this._zoneManager) return;
        const win = global.display.get_focus_window();
        if (!win) return;

        const wa = this._zoneManager._getWorkarea(win.get_monitor());
        if (!wa) return;
        const slot = classifySlot(win.get_frame_rect(), wa);
        const target = resolveMove(slot, direction);
        if (!target) return;

        const [presetId, zoneIndex] = target;
        this.snapFocusedToPreset(presetId, zoneIndex);
    }

    snapFocusedLeft()  { this._directionalMove("left"); }
    snapFocusedRight() { this._directionalMove("right"); }
    snapFocusedToUpperQuarter() { this._directionalMove("up"); }
    snapFocusedToLowerQuarter() { this._directionalMove("down"); }
    moveSwapFocused(direction) { this._directionalMove(direction); }
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

    // Focus a window classified into the given geometry slot.
    function focusSlot(slot) {
        const win = makeWindow();
        win._setSlot(slot);
        display._setFocusWindow(win);
        return win;
    }
    const lastSnap = () => ctrl._windowTracker._snapCalls[0];

    describe("directional move — Up (snapFocusedToUpperQuarter)", () => {
        it("left half → top-left quarter", () => {
            focusSlot("L"); ctrl.snapFocusedToUpperQuarter();
            assert.deepEqual([lastSnap().presetId, lastSnap().zoneIndex], ["quarters", 0]);
        });
        it("right half → top-right quarter", () => {
            focusSlot("R"); ctrl.snapFocusedToUpperQuarter();
            assert.deepEqual([lastSnap().presetId, lastSnap().zoneIndex], ["quarters", 1]);
        });
        it("bottom-left quarter → top-left quarter", () => {
            focusSlot("BL"); ctrl.snapFocusedToUpperQuarter();
            assert.equal(lastSnap().zoneIndex, 0);
        });
        it("bottom-right quarter → top-right quarter", () => {
            focusSlot("BR"); ctrl.snapFocusedToUpperQuarter();
            assert.equal(lastSnap().zoneIndex, 1);
        });
        it("top-left quarter → grows to left half (top edge)", () => {
            focusSlot("TL"); ctrl.snapFocusedToUpperQuarter();
            assert.deepEqual([lastSnap().presetId, lastSnap().zoneIndex], ["halves", 0]);
        });
        it("maximized → no-op", () => {
            focusSlot("maxi"); ctrl.snapFocusedToUpperQuarter();
            assert.equal(ctrl._windowTracker._snapCalls.length, 0);
        });
    });

    describe("directional move — Down (snapFocusedToLowerQuarter)", () => {
        it("top-right quarter → bottom-right quarter (user-reported case)", () => {
            focusSlot("TR"); ctrl.snapFocusedToLowerQuarter();
            assert.deepEqual([lastSnap().presetId, lastSnap().zoneIndex], ["quarters", 3]);
        });
        it("top-left quarter → bottom-left quarter", () => {
            focusSlot("TL"); ctrl.snapFocusedToLowerQuarter();
            assert.equal(lastSnap().zoneIndex, 2);
        });
        it("left half → bottom-left quarter", () => {
            focusSlot("L"); ctrl.snapFocusedToLowerQuarter();
            assert.equal(lastSnap().zoneIndex, 2);
        });
        it("bottom-right quarter → grows to right half (bottom edge)", () => {
            focusSlot("BR"); ctrl.snapFocusedToLowerQuarter();
            assert.deepEqual([lastSnap().presetId, lastSnap().zoneIndex], ["halves", 1]);
        });
    });

    describe("directional move — Left/Right (snapFocusedLeft/Right, moveSwapFocused)", () => {
        it("right half + Left → left half", () => {
            focusSlot("R"); ctrl.snapFocusedLeft();
            assert.deepEqual([lastSnap().presetId, lastSnap().zoneIndex], ["halves", 0]);
        });
        it("left half + Right → right half", () => {
            focusSlot("L"); ctrl.snapFocusedRight();
            assert.deepEqual([lastSnap().presetId, lastSnap().zoneIndex], ["halves", 1]);
        });
        it("top-left quarter + Right → top-right quarter", () => {
            focusSlot("TL"); ctrl.snapFocusedRight();
            assert.equal(lastSnap().zoneIndex, 1);
        });
        it("top-right quarter + Left → top-left quarter", () => {
            focusSlot("TR"); ctrl.snapFocusedLeft();
            assert.equal(lastSnap().zoneIndex, 0);
        });
        it("left half + Left → no-op (outer edge)", () => {
            focusSlot("L"); ctrl.snapFocusedLeft();
            assert.equal(ctrl._windowTracker._snapCalls.length, 0);
        });
        it("moveSwapFocused delegates to the same model (TR + down → BR)", () => {
            focusSlot("TR"); ctrl.moveSwapFocused("down");
            assert.deepEqual([lastSnap().presetId, lastSnap().zoneIndex], ["quarters", 3]);
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
