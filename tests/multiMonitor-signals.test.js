import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MultiMonitorManager } from "../src/multiMonitor.js";

function makeDisplay(signals) {
    return {
        connect: (signal, cb) => {
            if (!signals.includes(signal)) throw new Error(`No such signal: ${signal}`);
            return Math.random();
        },
        disconnect: () => {},
        signal_names: () => signals,
        get_n_monitors: () => 0,
        get_monitor_geometry: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    };
}

function makeSettings() {
    return { monitorPresets: [] };
}

function makeLogger() {
    return { debug() {}, info() {}, warn() {}, error() {} };
}

describe("MultiMonitorManager signal compatibility", () => {
    it("uses 'monitors-changed' if available", () => {
        globalThis.global = { display: makeDisplay(["monitors-changed", "workareas-changed"]) };
        const m = new MultiMonitorManager(makeSettings(), {}, makeLogger());
        assert.doesNotThrow(() => m.enable());
        m.disable();
    });
    it("uses 'monitors-config-changed' if 'monitors-changed' is missing", () => {
        globalThis.global = { display: makeDisplay(["monitors-config-changed", "workareas-changed"]) };
        const m = new MultiMonitorManager(makeSettings(), {}, makeLogger());
        assert.doesNotThrow(() => m.enable());
        m.disable();
    });
    it("tries both if neither is listed in signal_names", () => {
        globalThis.global = { display: makeDisplay(["workareas-changed"]) };
        const m = new MultiMonitorManager(makeSettings(), {}, makeLogger());
        // Should not throw, just not connect to monitor signals
        assert.doesNotThrow(() => m.enable());
        m.disable();
    });
});
