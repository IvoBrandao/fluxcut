/**
 * tests/logger.test.js
 *
 * Tests for src/logger.js — pure JS, no GJS globals needed.
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import { Logger, LogLevel } from "../src/logger.js";

// ── LogLevel constants ────────────────────────────────────────────────────────

describe("LogLevel", () => {
    it("defines OFF=0, ERROR=1, WARN=2, INFO=3, DEBUG=4", () => {
        assert.equal(LogLevel.OFF,   0);
        assert.equal(LogLevel.ERROR, 1);
        assert.equal(LogLevel.WARN,  2);
        assert.equal(LogLevel.INFO,  3);
        assert.equal(LogLevel.DEBUG, 4);
    });

    it("is frozen (immutable)", () => {
        assert.ok(Object.isFrozen(LogLevel));
    });
});

// ── Logger ────────────────────────────────────────────────────────────────────

describe("Logger", () => {
    let consoleError, consoleWarn, consoleLog, consoleDebug;

    beforeEach(() => {
        consoleError = mock.method(console, "error", () => {});
        consoleWarn  = mock.method(console, "warn",  () => {});
        consoleLog   = mock.method(console, "log",   () => {});
        consoleDebug = mock.method(console, "debug", () => {});
    });

    function makeLogger(level) {
        return new Logger({ logLevel: level });
    }

    it("does NOT log anything when level is OFF", () => {
        const log = makeLogger(LogLevel.OFF);
        log.error("e"); log.warn("w"); log.info("i"); log.debug("d");
        assert.equal(consoleError.mock.callCount(), 0);
        assert.equal(consoleWarn.mock.callCount(),  0);
        assert.equal(consoleLog.mock.callCount(),   0);
        assert.equal(consoleDebug.mock.callCount(), 0);
    });

    it("logs error only when level is ERROR", () => {
        const log = makeLogger(LogLevel.ERROR);
        log.error("e"); log.warn("w"); log.info("i"); log.debug("d");
        assert.equal(consoleError.mock.callCount(), 1);
        assert.equal(consoleWarn.mock.callCount(),  0);
        assert.equal(consoleLog.mock.callCount(),   0);
        assert.equal(consoleDebug.mock.callCount(), 0);
    });

    it("logs error+warn when level is WARN", () => {
        const log = makeLogger(LogLevel.WARN);
        log.error("e"); log.warn("w"); log.info("i"); log.debug("d");
        assert.equal(consoleError.mock.callCount(), 1);
        assert.equal(consoleWarn.mock.callCount(),  1);
        assert.equal(consoleLog.mock.callCount(),   0);
        assert.equal(consoleDebug.mock.callCount(), 0);
    });

    it("logs error+warn+info when level is INFO", () => {
        const log = makeLogger(LogLevel.INFO);
        log.error("e"); log.warn("w"); log.info("i"); log.debug("d");
        assert.equal(consoleError.mock.callCount(), 1);
        assert.equal(consoleWarn.mock.callCount(),  1);
        assert.equal(consoleLog.mock.callCount(),   1);
        assert.equal(consoleDebug.mock.callCount(), 0);
    });

    it("logs all when level is DEBUG", () => {
        const log = makeLogger(LogLevel.DEBUG);
        log.error("e"); log.warn("w"); log.info("i"); log.debug("d");
        assert.equal(consoleError.mock.callCount(), 1);
        assert.equal(consoleWarn.mock.callCount(),  1);
        assert.equal(consoleLog.mock.callCount(),   1);
        assert.equal(consoleDebug.mock.callCount(), 1);
    });

    it("prefixes every log with [Window Tiling Control]", () => {
        const log = makeLogger(LogLevel.INFO);
        log.info("hello");
        const args = consoleLog.mock.calls[0].arguments;
        assert.equal(args[0], "[Window Tiling Control]");
        assert.equal(args[1], "hello");
    });

    it("passes additional arguments through", () => {
        const log = makeLogger(LogLevel.DEBUG);
        log.debug("msg", { key: "val" }, 42);
        const args = consoleDebug.mock.calls[0].arguments;
        assert.equal(args[1], "msg");
        assert.deepEqual(args[2], { key: "val" });
        assert.equal(args[3], 42);
    });

    it("works when settings is null (defaults to OFF)", () => {
        const log = new Logger(null);
        log.error("should not throw");
        assert.equal(consoleError.mock.callCount(), 0);
    });
});
