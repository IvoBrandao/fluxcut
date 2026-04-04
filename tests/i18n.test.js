/**
 * tests/i18n.test.js
 *
 * Tests for src/i18n.js — pure JS, no GJS globals needed.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// We need to re-import after resetting state; use dynamic import with cache-bust.
let _i18nCounter = 0;
async function freshI18n() {
    const mod = await import(`../src/i18n.js?v=${++_i18nCounter}`);
    return mod;
}

describe("i18n", () => {
    it("_ returns the raw string when no extension object is set", async () => {
        const { _ } = await freshI18n();
        assert.equal(_("Hello"), "Hello");
        assert.equal(_(""), "");
    });

    it("_ delegates to ext.gettext when extension object is set", async () => {
        const { _, setExtensionObject } = await freshI18n();
        const fakeExt = { gettext: (s) => `[tr:${s}]` };
        setExtensionObject(fakeExt);
        assert.equal(_("Hello"), "[tr:Hello]");
    });

    it("ngettext returns singular when no ext and n=1", async () => {
        const { ngettext } = await freshI18n();
        assert.equal(ngettext("apple", "apples", 1), "apple");
    });

    it("ngettext returns plural when no ext and n≠1", async () => {
        const { ngettext } = await freshI18n();
        assert.equal(ngettext("apple", "apples", 0), "apples");
        assert.equal(ngettext("apple", "apples", 2), "apples");
    });

    it("ngettext delegates to ext.ngettext when extension object is set", async () => {
        const { ngettext, setExtensionObject } = await freshI18n();
        const fakeExt = { ngettext: (s, p, n) => `${n}:${n === 1 ? s : p}` };
        setExtensionObject(fakeExt);
        assert.equal(ngettext("apple", "apples", 1), "1:apple");
        assert.equal(ngettext("apple", "apples", 3), "3:apples");
    });
});
