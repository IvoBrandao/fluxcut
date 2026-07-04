/**
 * tests/snapOverlay.test.js
 *
 * Tests for src/snapOverlay.js — keyboard navigation, button click flow,
 * preset activation, open/close lifecycle, and null-safety.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals, Rect } from "./helpers/gnome-globals.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { SnapOverlay } from "../src/snapOverlay.js";

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeSettings(overrides = {}) {
    return {
        snapOverlayEnabled: true,
        windowGapSize: 0,
        snapOverlayPosition: "center",
        ...overrides,
    };
}

function makeZoneManager(rects = null) {
    const defaultRects = [
        new Rect(0, 0, 960, 1080),
        new Rect(960, 0, 960, 1080),
    ];
    return {
        getZoneRects: () => rects ?? defaultRects,
        getAllPresetRects: () => new Map([["halves", rects ?? defaultRects]]),
    };
}

function makeCustomZones() {
    const handlers = new Map();
    return {
        getAll: () => [],
        getById: () => null,
        connect: (signal, cb) => {
            if (!handlers.has(signal)) handlers.set(signal, []);
            const id = Symbol(signal);
            handlers.get(signal).push({ id, cb });
            return id;
        },
        disconnect: () => {},
    };
}

function makeMultiMonitor() {
    const calls = [];
    return {
        getMonitor: (idx) => ({
            index: idx,
            aspectRatio: 1.78,
            geometry: { x: 0, y: 0, width: 1920, height: 1080 },
        }),
        setActivePreset: (monitorIndex, presetId) => {
            calls.push(["setActivePreset", monitorIndex, presetId]);
        },
        _calls: calls,
    };
}

function makeWindowTracker() {
    const calls = [];
    return {
        snapWindow: (...args) => calls.push(["snapWindow", ...args]),
        getTileableWindows: () => [],
        _calls: calls,
    };
}

function makeZoneHighlighter() {
    const calls = [];
    return {
        showPreviewForPreset: (...args) => calls.push(["showPreviewForPreset", ...args]),
        clearAll: () => calls.push(["clearAll"]),
        _calls: calls,
    };
}

function makeAnimations() {
    return {
        slideIn: () => {},
        fadeIn: () => {},
        fadeOut: (_actor, _dur, cb) => cb?.(),
        scaleSnap: () => {},
    };
}

function makeLogger() {
    return { debug() {}, info() {}, warn() {}, error() {} };
}

function makeWindow(monitorIndex = 0) {
    return {
        get_id: () => 42,
        get_monitor: () => monitorIndex,
        get_workspace: () => ({ index: () => 0 }),
        get_compositor_private: () => ({ opacity: 255 }),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SnapOverlay", () => {
    let overlay, settings, zoneManager, customZones, multiMonitor;
    let windowTracker, zoneHighlighter, animations;

    beforeEach(() => {
        setupGnomeGlobals();
        settings = makeSettings();
        zoneManager = makeZoneManager();
        customZones = makeCustomZones();
        multiMonitor = makeMultiMonitor();
        windowTracker = makeWindowTracker();
        zoneHighlighter = makeZoneHighlighter();
        animations = makeAnimations();

        // Ensure Main.uiGroup is available
        globalThis.__wtcMainSet__("uiGroup", {
            _children: [],
            add_child: function (c) { this._children.push(c); },
            remove_child: function (c) { this._children = this._children.filter(x => x !== c); },
            contains: function (c) { return this._children.includes(c); },
        });

        overlay = new SnapOverlay(
            settings, zoneManager, customZones, multiMonitor,
            windowTracker, zoneHighlighter, animations, makeLogger()
        );
    });

    describe("open/close lifecycle", () => {
        it("does not open when snapOverlayEnabled=false", () => {
            settings.snapOverlayEnabled = false;
            overlay.open(makeWindow());
            assert.equal(overlay._widget, null);
        });

        it("opens with a widget when enabled", () => {
            overlay.open(makeWindow());
            assert.notEqual(overlay._widget, null);
        });

        it("tracks focused window on open", () => {
            const win = makeWindow(1);
            overlay.open(win);
            assert.equal(overlay._focusedWindow, win);
            assert.equal(overlay._currentMonitor, 1);
        });

        it("close cleans up widget and state", () => {
            overlay.open(makeWindow());
            overlay.close();
            assert.equal(overlay._widget, null);
            assert.equal(overlay._focusedWindow, null);
            assert.equal(overlay._buttons.length, 0);
        });

        it("close clears zone highlights", () => {
            overlay.open(makeWindow());
            overlay.close();
            assert.ok(zoneHighlighter._calls.some(c => c[0] === "clearAll"));
        });

        it("double open closes first then opens new", () => {
            overlay.open(makeWindow());
            const firstWidget = overlay._widget;
            overlay.open(makeWindow());
            assert.notEqual(overlay._widget, firstWidget);
        });

        it("close is safe when not open", () => {
            assert.doesNotThrow(() => overlay.close());
        });
    });

    describe("_onButtonClicked", () => {
        it("sets active preset on multiMonitor", () => {
            overlay.open(makeWindow());
            const preset = { id: "halves", label: "Halves", zones: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] };
            overlay._onButtonClicked(preset, 0);

            assert.ok(multiMonitor._calls.some(c =>
                c[0] === "setActivePreset" && c[1] === 0 && c[2] === "halves"
            ));
        });

        it("snaps window to first zone of selected preset", () => {
            overlay.open(makeWindow());
            const preset = { id: "halves", label: "Halves", zones: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] };
            overlay._onButtonClicked(preset, 0);

            assert.equal(windowTracker._calls.length, 1);
            assert.equal(windowTracker._calls[0][0], "snapWindow");
            assert.equal(windowTracker._calls[0][2], "halves"); // presetId
            assert.equal(windowTracker._calls[0][3], 0);        // zoneIndex
        });

        it("closes overlay after snapping", () => {
            overlay.open(makeWindow());
            const preset = { id: "halves", label: "Halves", zones: [{ x: 0, y: 0, w: 0.5, h: 1 }] };
            overlay._onButtonClicked(preset, 0);
            assert.equal(overlay._widget, null);
        });

        it("closes if no focused window", () => {
            overlay.open(makeWindow());
            overlay._focusedWindow = null;
            const preset = { id: "halves", label: "Halves", zones: [] };
            overlay._onButtonClicked(preset, 0);
            assert.equal(overlay._widget, null);
        });

        it("closes if preset has no zones", () => {
            overlay.open(makeWindow());
            zoneManager.getZoneRects = () => [];
            const preset = { id: "empty", label: "Empty", zones: [] };
            overlay._onButtonClicked(preset, 0);
            assert.equal(overlay._widget, null);
        });

        it("distributes all windows across zones, wrapping extras", () => {
            const focused = makeWindow(0);
            const w2 = { ...makeWindow(0), get_id: () => 2 };
            const w3 = { ...makeWindow(0), get_id: () => 3 };
            windowTracker.getTileableWindows = () => [focused, w2, w3];

            overlay.open(focused);
            const preset = { id: "halves", label: "Halves", zones: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] };
            overlay._onButtonClicked(preset, 0);

            const snaps = windowTracker._calls.filter(c => c[0] === "snapWindow");
            assert.equal(snaps.length, 3);
            assert.equal(snaps[0][1], focused);  // focused → zone 0
            assert.equal(snaps[0][3], 0);
            assert.equal(snaps[1][3], 1);        // second → zone 1
            assert.equal(snaps[2][3], 0);        // third wraps → zone 0
        });
    });

    describe("keyboard navigation", () => {
        it("ESCAPE closes overlay", () => {
            overlay.open(makeWindow());
            const event = { get_key_symbol: () => 0xFF1B }; // Key.ESCAPE
            const result = overlay._onKeyPress(event);
            assert.equal(result, true);
            assert.equal(overlay._widget, null);
        });

        it("LEFT arrow decrements focused button index", () => {
            overlay.open(makeWindow());
            overlay._focusedButtonIdx = 1;
            const event = { get_key_symbol: () => 0xFF51 }; // Key.LEFT
            overlay._onKeyPress(event);
            assert.equal(overlay._focusedButtonIdx, 0);
        });

        it("RIGHT arrow increments focused button index", () => {
            overlay.open(makeWindow());
            overlay._focusedButtonIdx = 0;
            const event = { get_key_symbol: () => 0xFF53 }; // Key.RIGHT
            overlay._onKeyPress(event);
            assert.equal(overlay._focusedButtonIdx, 1);
        });

        it("LEFT arrow wraps around from 0 to last", () => {
            overlay.open(makeWindow());
            overlay._focusedButtonIdx = 0;
            const numButtons = overlay._buttons.length;
            const event = { get_key_symbol: () => 0xFF51 }; // Key.LEFT
            overlay._onKeyPress(event);
            assert.equal(overlay._focusedButtonIdx, numButtons - 1);
        });

        it("unknown key returns false (not consumed)", () => {
            overlay.open(makeWindow());
            const event = { get_key_symbol: () => 0x61 }; // 'a'
            const result = overlay._onKeyPress(event);
            assert.equal(result, false);
        });
    });

    describe("destroy", () => {
        it("calls close", () => {
            overlay.open(makeWindow());
            overlay.destroy();
            assert.equal(overlay._widget, null);
        });
    });
});
