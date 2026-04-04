/**
 * FluxCut — src/logger.js
 * Leveled logging using native console methods.
 * Levels: 0=Off, 1=Error, 2=Warn, 3=Info, 4=Debug
 */

const PREFIX = "[FluxCut]";

export const LogLevel = Object.freeze({
    OFF: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 3,
    DEBUG: 4,
});

export class Logger {
    constructor(settings) {
        this._settings = settings;
    }

    get _level() {
        return this._settings?.logLevel ?? LogLevel.OFF;
    }

    error(msg, ...args) {
        if (this._level >= LogLevel.ERROR)
            console.error(PREFIX, msg, ...args);
    }

    warn(msg, ...args) {
        if (this._level >= LogLevel.WARN)
            console.warn(PREFIX, msg, ...args);
    }

    info(msg, ...args) {
        if (this._level >= LogLevel.INFO)
            console.log(PREFIX, msg, ...args);
    }

    debug(msg, ...args) {
        if (this._level >= LogLevel.DEBUG)
            console.debug(PREFIX, msg, ...args);
    }
}
