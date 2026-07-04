/**
 * tests/accentColor.test.js
 *
 * Tests for src/accentColor.js. The gi mock does not provide Gio.Settings,
 * so these exercise the defensive fallback path (no accent key available →
 * blue fallback, never throws).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AccentColor } from "../src/accentColor.js";

describe("AccentColor", () => {
    it("constructs without throwing when Gio.Settings is unavailable", () => {
        assert.doesNotThrow(() => new AccentColor(null));
    });

    it("reports unavailable when the accent key cannot be read", () => {
        const accent = new AccentColor(null);
        assert.equal(accent.available, false);
    });

    it("falls back to the blue accent RGB", () => {
        const accent = new AccentColor(null);
        assert.deepEqual(accent.rgb(), [53, 132, 228]);
    });

    it("formats rgba() at the requested alpha", () => {
        const accent = new AccentColor(null);
        assert.equal(accent.rgba(0.3), "rgba(53,132,228,0.3)");
        assert.equal(accent.rgba(1), "rgba(53,132,228,1)");
    });

    it("connect/disconnect are safe no-ops when unavailable", () => {
        const accent = new AccentColor(null);
        assert.doesNotThrow(() => accent.connect(() => {}));
        assert.doesNotThrow(() => accent.disconnect());
    });
});
