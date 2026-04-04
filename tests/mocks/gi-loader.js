/**
 * tests/mocks/gi-loader.js
 *
 * Node.js custom ESM loader hook that resolves `gi://…` specifiers and
 * `resource:///…` specifiers to in-process stub modules so the pure-logic
 * source files can be required without a live GNOME Shell session.
 *
 * Stubs are intentionally minimal — they expose only what the src/ modules
 * actually call so misuse is caught at test-time as a missing-property error.
 */

// ── Utility ──────────────────────────────────────────────────────────────────

/**
 * Build a bare stub object that throws a descriptive error if any property
 * that has NOT been explicitly whitelisted is accessed.
 */
function stub(name, props = {}) {
    return new Proxy(
        { ...props, _stubName: name },
        {
            get(target, key) {
                if (key in target) return target[key];
                if (typeof key === "symbol") return undefined;
                throw new Error(
                    `[GJS mock] ${name}.${String(key)} accessed but not stubbed`
                );
            },
        }
    );
}

// ── GObject (minimal, only registerClass + TYPE_* constants) ─────────────────

const GObjectStub = (() => {
    function registerClass(metaOrClass, maybeClass) {
        // Support both single-arg and two-arg forms
        const klass = maybeClass ?? metaOrClass;
        return klass;
    }

    const TYPE_STRING  = "gchararray";
    const TYPE_INT     = "gint";
    const TYPE_UINT    = "guint";
    const TYPE_BOOLEAN = "gboolean";
    const TYPE_POINTER = "gpointer";
    const TYPE_DOUBLE  = "gdouble";

    class ObjectBase {
        constructor() { this._signalHandlers = new Map(); }
        connect(signal, cb) {
            if (!this._signalHandlers.has(signal)) this._signalHandlers.set(signal, []);
            const id = Math.random();
            this._signalHandlers.get(signal).push({ id, cb });
            return id;
        }
        disconnect(id) {
            for (const [, cbs] of this._signalHandlers)
                this._signalHandlers.set(signal, cbs.filter(h => h.id !== id));
        }
        emit(signal, ...args) {
            const handlers = this._signalHandlers.get(signal) ?? [];
            for (const { cb } of handlers) cb(this, ...args);
        }
    }

    return {
        registerClass,
        TYPE_STRING, TYPE_INT, TYPE_UINT, TYPE_BOOLEAN, TYPE_POINTER, TYPE_DOUBLE,
        Object: ObjectBase,
        ParamSpec: { string: () => ({}), boolean: () => ({}), uint: () => ({}) },
    };
})();

// ── GLib (timeout/idle stubs, PRIORITY_DEFAULT, SOURCE_REMOVE) ───────────────

const GLibStub = (() => {
    const PRIORITY_DEFAULT = 0;
    const SOURCE_REMOVE = false;
    const SOURCE_CONTINUE = true;

    /** Synchronously invoke the callback once and return SOURCE_REMOVE. */
    function timeout_add(_priority, _ms, cb) {
        Promise.resolve().then(() => cb());
        return 1;
    }

    function idle_add(_priority, cb) {
        Promise.resolve().then(() => cb());
        return 1;
    }

    const Source = { remove: (_id) => {} };

    return { PRIORITY_DEFAULT, SOURCE_REMOVE, SOURCE_CONTINUE, timeout_add, idle_add, Source };
})();

// ── Meta.Rectangle (pure data class used extensively) ────────────────────────

class MetaRectangle {
    constructor({ x = 0, y = 0, width = 0, height = 0 } = {}) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }
}

const MetaStub = {
    Rectangle: MetaRectangle,
    MaximizeFlags: { BOTH: 3, HORIZONTAL: 1, VERTICAL: 2 },
    GrabOp: { MOVING: 1 },
    DisplayDirection: { LEFT: 0, RIGHT: 1, UP: 2, DOWN: 3 },
};

// ── Gio (SettingsBindFlags only — no real GSettings needed in tests) ──────────

const GioStub = {
    SettingsBindFlags: { DEFAULT: 0, GET: 1, SET: 2, NO_SENSITIVITY: 3 },
};

// ── Clutter (AnimationMode, ActorAlign) ───────────────────────────────────────

const ClutterStub = {
    AnimationMode: { EASE_OUT_CUBIC: 3, LINEAR: 1 },
    ActorAlign: { CENTER: 0, START: 1, END: 2, FILL: 3 },
    EventType: { BUTTON_PRESS: 1 },
};

// ── Mapping from specifier → stub module ─────────────────────────────────────

const STUBS = new Map([
    ["gi://GObject",  GObjectStub],
    ["gi://GLib",     GLibStub],
    ["gi://Meta",     MetaStub],
    ["gi://Gio",      GioStub],
    ["gi://Clutter",  ClutterStub],
    // Modules only used by UI layers (St, Shell, Adw, Gtk, Gdk) — return empty
    // stubs; tests shouldn't reach UI code directly.
    ["gi://St",       {}],
    ["gi://Shell",    {}],
    ["gi://Adw",      {}],
    ["gi://Gtk",      {}],
    ["gi://Gdk",      {}],
]);

// resource:/// imports (GNOME Shell UI) → empty stubs
const RESOURCE_STUBS = new Map([
    ["resource:///org/gnome/shell/ui/main.js",              { panel: {}, overview: {}, sessionMode: {}, wm: {}, extensionManager: {} }],
    ["resource:///org/gnome/shell/ui/quickSettings.js",     {}],
    ["resource:///org/gnome/shell/ui/popupMenu.js",         {}],
    ["resource:///org/gnome/shell/extensions/extension.js", { Extension: class Extension {} }],
    ["resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js", { ExtensionPreferences: class ExtensionPreferences {} }],
]);

// Relative stubs: local src/ files that import gi:// internally
// (handled transparently by the loader; only the top-level gi:// are stubbed)

// ── Node.js ESM loader hooks ─────────────────────────────────────────────────

const STUB_SCHEME = "node:fluxcut-stub:";

/**
 * Serialize a stub value into embeddable ES module source code.
 * Functions and classes are serialized via .toString() so they remain
 * self-contained in the generated module that runs in a different thread.
 */
function serializeValue(v) {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    const t = typeof v;
    if (t === "boolean" || t === "number") return JSON.stringify(v);
    if (t === "string") return JSON.stringify(v);
    if (t === "function") return v.toString();
    if (Array.isArray(v)) return `[${v.map(serializeValue).join(", ")}]`;
    if (t === "object") {
        const entries = Object.entries(v).map(([k, val]) => {
            const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
            return `${key}: ${serializeValue(val)}`;
        });
        return `{ ${entries.join(", ")} }`;
    }
    return "undefined";
}

export function resolve(specifier, context, nextResolve) {
    if (STUBS.has(specifier) || RESOURCE_STUBS.has(specifier)) {
        return { url: `${STUB_SCHEME}${encodeURIComponent(specifier)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
    if (url.startsWith(STUB_SCHEME)) {
        const specifier = decodeURIComponent(url.slice(STUB_SCHEME.length));
        const stubObj = STUBS.get(specifier) ?? RESOURCE_STUBS.get(specifier) ?? {};

        // Serialize each stub value inline so the generated module is fully
        // self-contained — no cross-thread globalThis references needed.
        const keys = Object.keys(stubObj);
        const namedExports = keys
            .map(k => `export const ${k} = ${serializeValue(stubObj[k])};`)
            .join("\n");
        const defaultExport = keys.length > 0
            ? `export default { ${keys.join(", ")} };`
            : `export default {};`;

        return { format: "module", source: `${namedExports}\n${defaultExport}`, shortCircuit: true };
    }
    return nextLoad(url, context);
}
