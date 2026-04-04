/**
 * tests/layoutPresets.test.js
 *
 * Tests for src/layoutPresets.js — pure JS, no GJS globals needed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PRESETS, getPresetById, getPresetsForAspectRatio } from "../src/layoutPresets.js";

// ── PRESETS array ─────────────────────────────────────────────────────────────

describe("PRESETS", () => {
    it("contains 8 built-in presets", () => {
        assert.equal(PRESETS.length, 8);
    });

    it("every preset has a non-empty id and label", () => {
        for (const p of PRESETS) {
            assert.ok(p.id.length > 0,    `preset missing id: ${JSON.stringify(p)}`);
            assert.ok(p.label.length > 0, `preset missing label: ${p.id}`);
        }
    });

    it("every preset has at least 2 zones", () => {
        for (const p of PRESETS) {
            assert.ok(p.zones.length >= 2, `${p.id} has < 2 zones`);
        }
    });

    it("all zone coordinates are normalized 0-1 with positive width/height", () => {
        for (const p of PRESETS) {
            for (const z of p.zones) {
                assert.ok(z.x >= 0 && z.x < 1,  `${p.id}: zone.x out of range: ${z.x}`);
                assert.ok(z.y >= 0 && z.y < 1,  `${p.id}: zone.y out of range: ${z.y}`);
                assert.ok(z.w > 0 && z.w <= 1,  `${p.id}: zone.w out of range: ${z.w}`);
                assert.ok(z.h > 0 && z.h <= 1,  `${p.id}: zone.h out of range: ${z.h}`);
            }
        }
    });

    it("halves preset covers the full monitor width with two equal halves", () => {
        const halves = PRESETS.find(p => p.id === "halves");
        assert.ok(halves, "halves preset not found");
        assert.equal(halves.zones.length, 2);

        const totalW = halves.zones.reduce((s, z) => s + z.w, 0);
        assert.ok(Math.abs(totalW - 1) < 1e-9, `halves total width = ${totalW}, expected 1`);
    });

    it("quarters preset has 4 zones each covering one quarter", () => {
        const quarters = PRESETS.find(p => p.id === "quarters");
        assert.ok(quarters, "quarters preset not found");
        assert.equal(quarters.zones.length, 4);

        for (const z of quarters.zones) {
            assert.ok(Math.abs(z.w - 0.5) < 1e-9, `quarter zone.w = ${z.w}`);
            assert.ok(Math.abs(z.h - 0.5) < 1e-9, `quarter zone.h = ${z.h}`);
        }
    });

    it("preset ids are all unique", () => {
        const ids = PRESETS.map(p => p.id);
        const unique = new Set(ids);
        assert.equal(unique.size, ids.length, "duplicate preset ids found");
    });
});

// ── getPresetById ─────────────────────────────────────────────────────────────

describe("getPresetById", () => {
    it("returns the correct preset for a known id", () => {
        const p = getPresetById("halves");
        assert.ok(p, "should return halves preset");
        assert.equal(p.id, "halves");
    });

    it("returns undefined for an unknown id", () => {
        assert.equal(getPresetById("nonexistent"), undefined);
    });

    it("returns the correct preset for all 8 built-in ids", () => {
        for (const p of PRESETS) {
            const found = getPresetById(p.id);
            assert.ok(found, `getPresetById('${p.id}') returned nothing`);
            assert.equal(found.id, p.id);
        }
    });
});

// ── getPresetsForAspectRatio ──────────────────────────────────────────────────

describe("getPresetsForAspectRatio", () => {
    it("standard 16:9 includes halves and quarters but not portrait-only presets", () => {
        const presets = getPresetsForAspectRatio(16 / 9);
        const ids = presets.map(p => p.id);
        assert.ok(ids.includes("halves"),   "halves should be available on 16:9");
        assert.ok(ids.includes("quarters"), "quarters should be available on 16:9");
        assert.ok(!ids.includes("top-thirds"), "top-thirds should NOT be on 16:9 (portrait-only)");
    });

    it("ultra-wide (21:9) includes sixths", () => {
        const presets = getPresetsForAspectRatio(21 / 9);
        assert.ok(presets.some(p => p.id === "sixths"), "sixths should appear on ultra-wide");
    });

    it("standard does NOT include ultra-wide-only preset sixths", () => {
        const presets = getPresetsForAspectRatio(16 / 9);
        assert.ok(!presets.some(p => p.id === "sixths"), "sixths should NOT appear on 16:9");
    });

    it("portrait (0.6) includes top-thirds", () => {
        const presets = getPresetsForAspectRatio(0.6);
        assert.ok(presets.some(p => p.id === "top-thirds"), "top-thirds should appear on portrait");
    });

    it("returns at least 1 preset for any aspect ratio", () => {
        for (const ar of [0.5, 0.75, 1.0, 1.33, 1.78, 2.0, 2.4]) {
            const presets = getPresetsForAspectRatio(ar);
            assert.ok(presets.length >= 1, `no presets for aspect ratio ${ar}`);
        }
    });

    it("returns an array (never null/undefined)", () => {
        assert.ok(Array.isArray(getPresetsForAspectRatio(1.78)));
        assert.ok(Array.isArray(getPresetsForAspectRatio(0.5)));
    });
});
