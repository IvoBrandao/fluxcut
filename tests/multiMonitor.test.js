/**
 * tests/multiMonitor.test.js
 *
 * Tests for the pure-logic parts of MultiMonitorManager that don't require a
 * live GNOME display: preset key composition, getActivePreset / setActivePreset
 * / cyclePreset, _loadPresetMap / _savePresetMap serialization.
 *
 * We test via a shim that avoids GObject.registerClass so the file runs in Node.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupGnomeGlobals, Rect } from "./helpers/gnome-globals.js";
import { getPresetsForAspectRatio } from "../src/layoutPresets.js";

// ── Shim (mirrors MultiMonitorManager without GObject base) ──────────────────

class MultiMonitorShim {
    constructor(settings, monitors = []) {
        this._settings = settings;
        this._monitors = monitors;
        this._activePresets = new Map();
    }

    _presetKey(monitorIndex, workspaceIndex = null) {
        const ws = workspaceIndex ?? global.workspace_manager.get_active_workspace_index();
        return `${monitorIndex}:${ws}`;
    }

    getMonitor(index) {
        return this._monitors.find(m => m.index === index);
    }

    getPresetsForMonitor(monitorIndex) {
        const m = this.getMonitor(monitorIndex);
        if (!m) return [];
        return getPresetsForAspectRatio(m.aspectRatio);
    }

    getActivePreset(monitorIndex, workspaceIndex = null) {
        const key = this._presetKey(monitorIndex, workspaceIndex);
        if (this._activePresets.has(key)) return this._activePresets.get(key);
        const monitor = this.getMonitor(monitorIndex);
        if (!monitor) return "halves";
        const presets = getPresetsForAspectRatio(monitor.aspectRatio);
        return presets.length ? presets[0].id : "halves";
    }

    setActivePreset(monitorIndex, presetId, workspaceIndex = null) {
        this._activePresets.set(this._presetKey(monitorIndex, workspaceIndex), presetId);
        this._savePresetMap();
    }

    cyclePreset(monitorIndex, direction = 1, workspaceIndex = null) {
        const available = this.getPresetsForMonitor(monitorIndex);
        const currentId = this.getActivePreset(monitorIndex, workspaceIndex);
        const idx = available.findIndex(p => p.id === currentId);
        const next = (idx + direction + available.length) % available.length;
        this.setActivePreset(monitorIndex, available[next].id, workspaceIndex);
        return available[next].id;
    }

    _loadPresetMap() {
        const entries = this._settings.monitorPresets;
        this._activePresets = new Map();
        for (const entry of entries) {
            try {
                const { key, presetId } = JSON.parse(entry);
                if (key && presetId) this._activePresets.set(key, presetId);
            } catch (_) {}
        }
    }

    _savePresetMap() {
        const entries = [];
        for (const [key, presetId] of this._activePresets)
            entries.push(JSON.stringify({ key, presetId }));
        this._settings.monitorPresets = entries;
    }
}

function makeSettings(presets = []) {
    let monitorPresets = [...presets];
    return {
        get monitorPresets() { return monitorPresets; },
        set monitorPresets(v) { monitorPresets = v; },
    };
}

const MONITOR_16_9  = { index: 0, aspectRatio: 16 / 9 };
const MONITOR_21_9  = { index: 1, aspectRatio: 21 / 9 };
const MONITOR_PORT  = { index: 2, aspectRatio: 0.6 };

// ── preset key composition ────────────────────────────────────────────────────

describe("MultiMonitor — preset key", () => {
    beforeEach(() => setupGnomeGlobals());

    it("builds 'monitorIndex:workspaceIndex' string", () => {
        const mm = new MultiMonitorShim(makeSettings(), [MONITOR_16_9]);
        // active workspace is 0 from stub
        assert.equal(mm._presetKey(0), "0:0");
        assert.equal(mm._presetKey(0, 3), "0:3");
        assert.equal(mm._presetKey(1, 0), "1:0");
    });

    it("uses the current active workspace when workspaceIndex is null", () => {
        const { workspace_manager } = setupGnomeGlobals();
        workspace_manager._setActiveWorkspace(2);
        const mm = new MultiMonitorShim(makeSettings(), [MONITOR_16_9]);
        assert.equal(mm._presetKey(0), "0:2");
    });
});

// ── getActivePreset / setActivePreset ─────────────────────────────────────────

describe("MultiMonitor — getActivePreset / setActivePreset", () => {
    beforeEach(() => setupGnomeGlobals());

    it("returns the first fitting preset by default", () => {
        const mm = new MultiMonitorShim(makeSettings(), [MONITOR_16_9]);
        const preset = mm.getActivePreset(0, 0);
        // halves is the first preset for 16:9
        assert.equal(preset, "halves");
    });

    it("returns 'halves' fallback for unknown monitor", () => {
        const mm = new MultiMonitorShim(makeSettings(), []);
        assert.equal(mm.getActivePreset(99, 0), "halves");
    });

    it("setActivePreset persists and is readable", () => {
        const mm = new MultiMonitorShim(makeSettings(), [MONITOR_16_9]);
        mm.setActivePreset(0, "quarters", 0);
        assert.equal(mm.getActivePreset(0, 0), "quarters");
    });

    it("presets are per-workspace (different ws = different preset)", () => {
        const mm = new MultiMonitorShim(makeSettings(), [MONITOR_16_9]);
        mm.setActivePreset(0, "quarters", 0);
        mm.setActivePreset(0, "halves",   1);
        assert.equal(mm.getActivePreset(0, 0), "quarters");
        assert.equal(mm.getActivePreset(0, 1), "halves");
    });

    it("presets are per-monitor", () => {
        const mm = new MultiMonitorShim(makeSettings(), [MONITOR_16_9, MONITOR_21_9]);
        mm.setActivePreset(0, "halves",  0);
        mm.setActivePreset(1, "sixths",  0);
        assert.equal(mm.getActivePreset(0, 0), "halves");
        assert.equal(mm.getActivePreset(1, 0), "sixths");
    });
});

// ── cyclePreset ───────────────────────────────────────────────────────────────

describe("MultiMonitor — cyclePreset", () => {
    beforeEach(() => setupGnomeGlobals());

    it("cycles forward through available presets", () => {
        const mm = new MultiMonitorShim(makeSettings(), [MONITOR_16_9]);
        const available = mm.getPresetsForMonitor(0);
        // Start on the first preset
        mm.setActivePreset(0, available[0].id, 0);
        mm.cyclePreset(0, 1, 0);
        assert.equal(mm.getActivePreset(0, 0), available[1].id);
    });

    it("cycles backward through available presets", () => {
        const mm = new MultiMonitorShim(makeSettings(), [MONITOR_16_9]);
        const available = mm.getPresetsForMonitor(0);
        mm.setActivePreset(0, available[0].id, 0);
        mm.cyclePreset(0, -1, 0);
        assert.equal(mm.getActivePreset(0, 0), available[available.length - 1].id);
    });

    it("wraps around from last to first (forward)", () => {
        const mm = new MultiMonitorShim(makeSettings(), [MONITOR_16_9]);
        const available = mm.getPresetsForMonitor(0);
        mm.setActivePreset(0, available[available.length - 1].id, 0);
        mm.cyclePreset(0, 1, 0);
        assert.equal(mm.getActivePreset(0, 0), available[0].id);
    });

    it("returns the new preset id", () => {
        const mm = new MultiMonitorShim(makeSettings(), [MONITOR_16_9]);
        const available = mm.getPresetsForMonitor(0);
        mm.setActivePreset(0, available[0].id, 0);
        const result = mm.cyclePreset(0, 1, 0);
        assert.equal(result, available[1].id);
    });
});

// ── _loadPresetMap / _savePresetMap serialization ─────────────────────────────

describe("MultiMonitor — preset map persistence", () => {
    beforeEach(() => setupGnomeGlobals());

    it("round-trips a preset map through save → load", () => {
        const settings = makeSettings();
        const mm = new MultiMonitorShim(settings, [MONITOR_16_9]);
        mm.setActivePreset(0, "quarters", 0);
        mm.setActivePreset(1, "halves",   1);

        // New instance loading from the same settings
        const mm2 = new MultiMonitorShim(settings, [MONITOR_16_9]);
        mm2._loadPresetMap();
        assert.equal(mm2.getActivePreset(0, 0), "quarters");
        assert.equal(mm2.getActivePreset(1, 1), "halves");
    });

    it("ignores malformed JSON in preset map", () => {
        const settings = makeSettings(["{bad json}"]);
        const mm = new MultiMonitorShim(settings, [MONITOR_16_9]);
        assert.doesNotThrow(() => mm._loadPresetMap());
        // Should fall back to default
        assert.equal(mm.getActivePreset(0, 0), "halves");
    });
});
