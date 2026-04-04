/**
 * tests/helpers/gnome-globals.js
 *
 * Sets up the subset of the GNOME Shell `global` object that FluxCut's
 * pure-logic modules reference.  Import this at the top of any test file
 * that exercises code touching `global.*`.
 */

// ── Minimal Meta.Rectangle clone (already stubbed in gi-loader, but tests
//   often need to construct one without importing gi://Meta) ─────────────────

export class Rect {
    constructor(x, y, width, height) {
        this.x = x; this.y = y; this.width = width; this.height = height;
    }
    equal(other) {
        return this.x === other.x && this.y === other.y &&
               this.width === other.width && this.height === other.height;
    }
}

// ── global.display stub ───────────────────────────────────────────────────────

function makeDisplay({ monitors = [{ x: 0, y: 0, width: 1920, height: 1080 }] } = {}) {
    const signalHandlers = new Map();
    let focusWindow = null;

    return {
        get_n_monitors: () => monitors.length,
        get_monitor_geometry: (i) => {
            const m = monitors[i] ?? monitors[0];
            return new Rect(m.x, m.y, m.width, m.height);
        },
        get_current_monitor: () => 0,
        get_focus_window: () => focusWindow,
        list_all_windows: () => [],
        get_monitor_neighbor_index: (_idx, _dir) => -1,
        connect: (signal, cb) => {
            if (!signalHandlers.has(signal)) signalHandlers.set(signal, []);
            const id = Symbol(signal);
            signalHandlers.get(signal).push({ id, cb });
            return id;
        },
        disconnect: () => {},
        _setFocusWindow: (w) => { focusWindow = w; },
        _emit: (signal, ...args) => {
            for (const { cb } of signalHandlers.get(signal) ?? []) cb(null, ...args);
        },
    };
}

// ── global.workspace_manager stub ────────────────────────────────────────────

function makeWorkspaceManager({ wsCount = 1 } = {}) {
    let activeWs = 0;
    const handlers = new Map();

    const workspaces = Array.from({ length: wsCount }, (_, i) => ({
        index: () => i,
        list_windows: () => [],
    }));

    return {
        get_n_workspaces: () => wsCount,
        get_active_workspace_index: () => activeWs,
        get_workspace_by_index: (i) => workspaces[i],
        connect: (signal, cb) => {
            if (!handlers.has(signal)) handlers.set(signal, []);
            const id = Symbol(signal);
            handlers.get(signal).push({ id, cb });
            return id;
        },
        disconnect: () => {},
        _setActiveWorkspace: (i) => { activeWs = i; },
    };
}

// ── global.get_pointer stub ───────────────────────────────────────────────────

let _pointer = [0, 0];

// ── global.stage stub ─────────────────────────────────────────────────────────

const stage = {
    connect: () => Symbol("stage-signal"),
    disconnect: () => {},
};

// ── global.window_group stub ──────────────────────────────────────────────────

const window_group = {
    _children: [],
    add_child: (c) => window_group._children.push(c),
    remove_child: (c) => { window_group._children = window_group._children.filter(x => x !== c); },
    contains: (c) => window_group._children.includes(c),
};

// ── global.window_manager stub ────────────────────────────────────────────────

const window_manager = {
    connect: () => Symbol("wm-signal"),
    disconnect: () => {},
};

// ── Export setup function ─────────────────────────────────────────────────────

export function setupGnomeGlobals(opts = {}) {
    const display = makeDisplay(opts);
    const workspace_manager = makeWorkspaceManager(opts);

    globalThis.global = {
        display,
        workspace_manager,
        stage,
        window_group,
        window_manager,
        get_pointer: () => _pointer,
        _setPointer: (x, y) => { _pointer = [x, y]; },
        log: (...args) => {},
    };

    return { display, workspace_manager };
}
