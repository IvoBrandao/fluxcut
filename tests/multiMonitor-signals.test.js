import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MultiMonitorManager } from "../src/multiMonitor.js";

function makeDisplay(signals) {
    return {
        connect: (signal, cb) => {
            if (!signals.includes(signal)) throw new Error(`No such signal: ${signal}`);
            return Math.random();
        },
        signal_names: () => signals,
    };
}

describe("MultiMonitorManager signal compatibility", () => {
    it("uses 'monitors-changed' if available", () => {
        globalThis.global = { display: makeDisplay(["monitors-changed", "workareas-changed"]) };
        const m = new MultiMonitorManager({}, {}, {});
        assert.doesNotThrow(() => m.enable());
        m.disable();
    });
    it("uses 'monitors-config-changed' if 'monitors-changed' is missing", () => {
        globalThis.global = { display: makeDisplay(["monitors-config-changed", "workareas-changed"]) };
        const m = new MultiMonitorManager({}, {}, {});
        assert.doesNotThrow(() => m.enable());
        m.disable();
    });
    it("tries both if neither is listed in signal_names", () => {
        globalThis.global = { display: makeDisplay(["workareas-changed"]) };
        const m = new MultiMonitorManager({}, {}, {});
        // Should not throw, just not connect to monitor signals
        assert.doesNotThrow(() => m.enable());
        m.disable();
    });
});
