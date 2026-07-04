/**
 * tests/gnomeTiling.test.js
 *
 * Tests for _overrideGnomeTiling / _restoreGnomeTiling logic in extension.js.
 * Verifies that GNOME's active screen edges (edge-tiling) and native
 * keybindings are saved, overridden, and restored correctly — including
 * the soft-disable path via the tiling-enabled settings toggle.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Mock Gio.Settings ────────────────────────────────────────────────────────

class MockGioSettings {
    constructor({ schema_id }) {
        this._schemaId = schema_id;
        this._booleans = {};
        this._strvs = {};
    }
    get_boolean(key) {
        if (!(key in this._booleans))
            throw new Error(`Key ${key} not initialised`);
        return this._booleans[key];
    }
    set_boolean(key, val) { this._booleans[key] = val; }
    get_strv(key) {
        if (!(key in this._strvs))
            throw new Error(`Key ${key} not initialised`);
        return [...this._strvs[key]];
    }
    set_strv(key, val) { this._strvs[key] = [...val]; }
    static sync() { MockGioSettings._syncCalled = true; }
}

// ── Shim mirroring the override/restore logic from extension.js ──────────────

class TilingOverrideShim {
    constructor(settingsFactory) {
        this._makeSettings = settingsFactory;
        this._savedGnomeBindings = null;
        this._mutterSettings = null;
        this._wmSettings = null;
        this._mutterKbSettings = null;
        this._logs = [];
    }

    _overrideGnomeTiling() {
        this._savedGnomeBindings = {};

        try {
            this._mutterSettings = this._makeSettings("org.gnome.mutter");
            this._savedGnomeBindings["edge-tiling"] =
                this._mutterSettings.get_boolean("edge-tiling");
            this._mutterSettings.set_boolean("edge-tiling", false);
            this._logs.push("override:edge-tiling");
        } catch (e) {
            this._logs.push(`override:edge-tiling:fail:${e.message}`);
        }

        try {
            this._wmSettings = this._makeSettings("org.gnome.desktop.wm.keybindings");
            for (const key of ["maximize", "unmaximize"]) {
                try {
                    this._savedGnomeBindings[`wm:${key}`] =
                        this._wmSettings.get_strv(key);
                    this._wmSettings.set_strv(key, []);
                } catch (_) {}
            }
            this._logs.push("override:wm-keys");
        } catch (e) {
            this._logs.push(`override:wm-keys:fail`);
        }

        try {
            this._mutterKbSettings = this._makeSettings("org.gnome.mutter.keybindings");
            for (const key of ["toggle-tiled-left", "toggle-tiled-right"]) {
                try {
                    this._savedGnomeBindings[`mutter:${key}`] =
                        this._mutterKbSettings.get_strv(key);
                    this._mutterKbSettings.set_strv(key, []);
                } catch (_) {}
            }
            this._logs.push("override:mutter-keys");
        } catch (e) {
            this._logs.push(`override:mutter-keys:fail`);
        }
    }

    _restoreGnomeTiling() {
        if (!this._savedGnomeBindings) return;

        try {
            if (this._mutterSettings &&
                this._savedGnomeBindings["edge-tiling"] !== undefined) {
                this._mutterSettings.set_boolean(
                    "edge-tiling",
                    this._savedGnomeBindings["edge-tiling"]
                );
            }
        } catch (_) {}

        try {
            if (this._wmSettings) {
                for (const key of ["maximize", "unmaximize"]) {
                    const saved = this._savedGnomeBindings[`wm:${key}`];
                    if (saved) this._wmSettings.set_strv(key, saved);
                }
            }
        } catch (_) {}

        try {
            if (this._mutterKbSettings) {
                for (const key of ["toggle-tiled-left", "toggle-tiled-right"]) {
                    const saved = this._savedGnomeBindings[`mutter:${key}`];
                    if (saved) this._mutterKbSettings.set_strv(key, saved);
                }
            }
        } catch (_) {}

        this._savedGnomeBindings = null;
        this._mutterSettings = null;
        this._wmSettings = null;
        this._mutterKbSettings = null;

        try { MockGioSettings.sync(); } catch (_) {}
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSchemas() {
    const mutter = new MockGioSettings({ schema_id: "org.gnome.mutter" });
    mutter._booleans["edge-tiling"] = true;

    const wm = new MockGioSettings({ schema_id: "org.gnome.desktop.wm.keybindings" });
    wm._strvs["maximize"] = ["<Super>Up"];
    wm._strvs["unmaximize"] = ["<Super>Down"];

    const mutterKb = new MockGioSettings({ schema_id: "org.gnome.mutter.keybindings" });
    mutterKb._strvs["toggle-tiled-left"] = ["<Super>Left"];
    mutterKb._strvs["toggle-tiled-right"] = ["<Super>Right"];

    const map = new Map([
        ["org.gnome.mutter", mutter],
        ["org.gnome.desktop.wm.keybindings", wm],
        ["org.gnome.mutter.keybindings", mutterKb],
    ]);

    return { mutter, wm, mutterKb, factory: (id) => map.get(id) };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GNOME tiling override / restore", () => {
    let schemas, shim;

    beforeEach(() => {
        schemas = makeSchemas();
        shim = new TilingOverrideShim(schemas.factory);
        MockGioSettings._syncCalled = false;
    });

    it("override disables edge-tiling", () => {
        shim._overrideGnomeTiling();
        assert.equal(schemas.mutter.get_boolean("edge-tiling"), false);
    });

    it("override clears WM maximize/unmaximize keybindings", () => {
        shim._overrideGnomeTiling();
        assert.deepEqual(schemas.wm.get_strv("maximize"), []);
        assert.deepEqual(schemas.wm.get_strv("unmaximize"), []);
    });

    it("override clears mutter tile keybindings", () => {
        shim._overrideGnomeTiling();
        assert.deepEqual(schemas.mutterKb.get_strv("toggle-tiled-left"), []);
        assert.deepEqual(schemas.mutterKb.get_strv("toggle-tiled-right"), []);
    });

    it("restore re-enables edge-tiling (active screen edges)", () => {
        shim._overrideGnomeTiling();
        assert.equal(schemas.mutter.get_boolean("edge-tiling"), false);

        shim._restoreGnomeTiling();
        assert.equal(schemas.mutter.get_boolean("edge-tiling"), true,
            "Active screen edges must be re-enabled after restore");
    });

    it("restore brings back WM keybindings", () => {
        shim._overrideGnomeTiling();
        shim._restoreGnomeTiling();
        assert.deepEqual(schemas.wm.get_strv("maximize"), ["<Super>Up"]);
        assert.deepEqual(schemas.wm.get_strv("unmaximize"), ["<Super>Down"]);
    });

    it("restore brings back mutter tile keybindings", () => {
        shim._overrideGnomeTiling();
        shim._restoreGnomeTiling();
        assert.deepEqual(schemas.mutterKb.get_strv("toggle-tiled-left"), ["<Super>Left"]);
        assert.deepEqual(schemas.mutterKb.get_strv("toggle-tiled-right"), ["<Super>Right"]);
    });

    it("restore calls Gio.Settings.sync()", () => {
        shim._overrideGnomeTiling();
        shim._restoreGnomeTiling();
        assert.equal(MockGioSettings._syncCalled, true,
            "sync() must be called to flush restored values");
    });

    it("restore is a no-op when called without prior override", () => {
        // Should not throw
        shim._restoreGnomeTiling();
        assert.equal(schemas.mutter.get_boolean("edge-tiling"), true);
    });

    it("restore is idempotent (double-restore is safe)", () => {
        shim._overrideGnomeTiling();
        shim._restoreGnomeTiling();
        // Second restore should be a no-op
        shim._restoreGnomeTiling();
        assert.equal(schemas.mutter.get_boolean("edge-tiling"), true);
    });

    describe("soft-disable toggle cycle", () => {
        it("toggle OFF restores active screen edges, toggle ON re-overrides", () => {
            // Initial override (extension enable)
            shim._overrideGnomeTiling();
            assert.equal(schemas.mutter.get_boolean("edge-tiling"), false);

            // User toggles tiling-enabled OFF → restore
            shim._restoreGnomeTiling();
            assert.equal(schemas.mutter.get_boolean("edge-tiling"), true,
                "edge-tiling must be true after soft-disable");

            // User toggles tiling-enabled ON → re-override
            shim._overrideGnomeTiling();
            assert.equal(schemas.mutter.get_boolean("edge-tiling"), false);

            // Final disable
            shim._restoreGnomeTiling();
            assert.equal(schemas.mutter.get_boolean("edge-tiling"), true,
                "edge-tiling must be true after final disable");
        });

        it("rapid toggle cycles preserve the original values", () => {
            for (let i = 0; i < 5; i++) {
                shim._overrideGnomeTiling();
                assert.equal(schemas.mutter.get_boolean("edge-tiling"), false);
                shim._restoreGnomeTiling();
                assert.equal(schemas.mutter.get_boolean("edge-tiling"), true);
            }
            // WM keybindings should be fully intact
            assert.deepEqual(schemas.wm.get_strv("maximize"), ["<Super>Up"]);
            assert.deepEqual(schemas.wm.get_strv("unmaximize"), ["<Super>Down"]);
        });
    });
});
