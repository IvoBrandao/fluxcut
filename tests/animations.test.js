/**
 * tests/animations.test.js
 *
 * Tests for src/animations.js — animation helpers, instant mode,
 * actor.ease() call tracking, and null-safety.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Animations } from "../src/animations.js";

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeSettings(speed = 2) {
    return { animationSpeed: speed };
}

function makeActor(props = {}) {
    const eases = [];
    return {
        opacity: props.opacity ?? 255,
        x: props.x ?? 100,
        y: props.y ?? 200,
        scale_x: 1,
        scale_y: 1,
        width: props.width ?? 400,
        height: props.height ?? 300,
        ease: (opts) => {
            eases.push(opts);
            // Simulate immediate completion for onComplete chains
            if (opts.onComplete) opts.onComplete();
        },
        hide: () => { /* tracked via hide calls */ },
        show: () => {},
        set_position: function (x, y) { this.x = x; this.y = y; },
        _eases: eases,
        _hidden: false,
    };
}

function makeActorWithHideTracking(props = {}) {
    const actor = makeActor(props);
    actor._hidden = false;
    actor.hide = () => { actor._hidden = true; };
    return actor;
}

function makeMetaWindow(actor) {
    return {
        get_compositor_private: () => actor,
    };
}

// ── Duration tests ────────────────────────────────────────────────────────────

describe("Animations.duration", () => {
    it("returns 0 for speed=0 (off)", () => {
        const a = new Animations(makeSettings(0));
        assert.equal(a.duration, 0);
    });

    it("returns 100 for speed=1 (fast)", () => {
        const a = new Animations(makeSettings(1));
        assert.equal(a.duration, 100);
    });

    it("returns 200 for speed=2 (normal)", () => {
        const a = new Animations(makeSettings(2));
        assert.equal(a.duration, 200);
    });

    it("returns 400 for speed=3 (slow)", () => {
        const a = new Animations(makeSettings(3));
        assert.equal(a.duration, 400);
    });

    it("defaults to 200 when settings is null", () => {
        const a = new Animations(null);
        assert.equal(a.duration, 200);
    });

    it("defaults to 200 for out-of-range speed value", () => {
        const a = new Animations({ animationSpeed: 99 });
        assert.equal(a.duration, 200);
    });
});

// ── fadeIn tests ──────────────────────────────────────────────────────────────

describe("Animations.fadeIn", () => {
    it("does nothing for null actor", () => {
        const a = new Animations(makeSettings());
        assert.doesNotThrow(() => a.fadeIn(null));
    });

    it("instantly sets opacity=255 when duration=0", () => {
        const a = new Animations(makeSettings(0));
        const actor = makeActor({ opacity: 0 });
        a.fadeIn(actor);
        assert.equal(actor.opacity, 255);
        assert.equal(actor._eases.length, 0);
    });

    it("calls actor.ease() with correct params when animated", () => {
        const a = new Animations(makeSettings(2));
        const actor = makeActor({ opacity: 128 });
        a.fadeIn(actor, 200);

        assert.equal(actor.opacity, 0); // set to 0 before easing
        assert.equal(actor._eases.length, 1);
        assert.equal(actor._eases[0].opacity, 255);
        assert.equal(actor._eases[0].duration, 200);
    });
});

// ── fadeOut tests ─────────────────────────────────────────────────────────────

describe("Animations.fadeOut", () => {
    it("does nothing for null actor", () => {
        const a = new Animations(makeSettings());
        assert.doesNotThrow(() => a.fadeOut(null));
    });

    it("instantly hides and calls onComplete when duration=0", () => {
        const a = new Animations(makeSettings(0));
        const actor = makeActorWithHideTracking();
        let completed = false;
        a.fadeOut(actor, 0, () => { completed = true; });
        assert.equal(actor.opacity, 0);
        assert.equal(actor._hidden, true);
        assert.equal(completed, true);
    });

    it("calls actor.ease() and chains hide+onComplete when animated", () => {
        const a = new Animations(makeSettings(2));
        const actor = makeActorWithHideTracking();
        let completed = false;
        a.fadeOut(actor, 200, () => { completed = true; });

        assert.equal(actor._eases.length, 1);
        assert.equal(actor._eases[0].opacity, 0);
        // onComplete fires hide and callback (simulated by mock)
        assert.equal(actor._hidden, true);
        assert.equal(completed, true);
    });

    it("works without onComplete callback", () => {
        const a = new Animations(makeSettings(2));
        const actor = makeActorWithHideTracking();
        assert.doesNotThrow(() => a.fadeOut(actor, 200));
        assert.equal(actor._hidden, true);
    });
});

// ── slideIn tests ─────────────────────────────────────────────────────────────

describe("Animations.slideIn", () => {
    it("does nothing for null actor", () => {
        const a = new Animations(makeSettings());
        assert.doesNotThrow(() => a.slideIn(null));
    });

    it("does nothing when duration=0", () => {
        const a = new Animations(makeSettings(0));
        const actor = makeActor();
        a.slideIn(actor, 0, -20, 0);
        assert.equal(actor._eases.length, 0);
    });

    it("offsets position then eases to original when animated", () => {
        const a = new Animations(makeSettings(2));
        const actor = makeActor({ x: 100, y: 200 });
        a.slideIn(actor, 10, -20, 200);

        // Actor position moved to offset
        assert.equal(actor.x, 110);
        assert.equal(actor.y, 180);
        assert.equal(actor.opacity, 0);

        // Ease target is original position
        assert.equal(actor._eases.length, 1);
        assert.equal(actor._eases[0].x, 100);
        assert.equal(actor._eases[0].y, 200);
        assert.equal(actor._eases[0].opacity, 255);
    });
});

// ── scaleSnap tests ──────────────────────────────────────────────────────────

describe("Animations.scaleSnap", () => {
    it("does nothing for null actor", () => {
        const a = new Animations(makeSettings());
        assert.doesNotThrow(() => a.scaleSnap(null));
    });

    it("does nothing when duration=0", () => {
        const a = new Animations(makeSettings(0));
        const actor = makeActor();
        a.scaleSnap(actor, 0);
        assert.equal(actor._eases.length, 0);
    });

    it("performs two-phase scale animation (shrink then expand)", () => {
        const a = new Animations(makeSettings(2));
        const actor = makeActor();
        a.scaleSnap(actor, 200);

        // Phase 1: shrink to 0.95, Phase 2: expand to 1.0 (chained via onComplete)
        assert.equal(actor._eases.length, 2);
        assert.equal(actor._eases[0].scale_x, 0.95);
        assert.equal(actor._eases[0].scale_y, 0.95);
        assert.equal(actor._eases[1].scale_x, 1.0);
        assert.equal(actor._eases[1].scale_y, 1.0);
    });

    it("uses minimum 50ms per phase", () => {
        const a = new Animations(makeSettings(1));
        const actor = makeActor();
        a.scaleSnap(actor, 60); // half = 30, but clamped to 50
        assert.equal(actor._eases[0].duration, 50);
    });
});

// ── easeRect tests ───────────────────────────────────────────────────────────

describe("Animations.easeRect", () => {
    it("does nothing for null metaWindow", () => {
        const a = new Animations(makeSettings());
        assert.doesNotThrow(() => a.easeRect(null, {}, {}, () => {}));
    });

    it("calls onComplete immediately when duration=0", () => {
        const a = new Animations(makeSettings(0));
        const actor = makeActor();
        const win = makeMetaWindow(actor);
        let completed = false;
        a.easeRect(win, {}, {}, () => { completed = true; }, 0);
        assert.equal(completed, true);
        assert.equal(actor._eases.length, 0);
    });

    it("calls onComplete immediately when no compositor actor", () => {
        const a = new Animations(makeSettings(2));
        const win = { get_compositor_private: () => null };
        let completed = false;
        a.easeRect(win, {}, {}, () => { completed = true; }, 200);
        assert.equal(completed, true);
    });

    it("eases actor to target rect when animated", () => {
        const a = new Animations(makeSettings(2));
        const actor = makeActor();
        const win = makeMetaWindow(actor);
        const toRect = { x: 0, y: 0, width: 960, height: 540 };
        let completed = false;
        a.easeRect(win, {}, toRect, () => { completed = true; }, 200);

        assert.equal(actor._eases.length, 1);
        assert.equal(actor._eases[0].x, 0);
        assert.equal(actor._eases[0].y, 0);
        assert.equal(actor._eases[0].width, 960);
        assert.equal(actor._eases[0].height, 540);
        assert.equal(completed, true); // onComplete chain fires via mock
    });
});
