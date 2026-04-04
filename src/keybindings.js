/**
 * FluxCut — src/keybindings.js
 * Registers all configurable keybindings via Main.wm.addKeybinding.
 *
 * Keybinding names must exactly match the keys declared under the
 * org.gnome.shell.extensions.fluxcut.keybindings GSettings child schema.
 */

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Meta from "gi://Meta";
import Shell from "gi://Shell";

/** Keybinding name → handler builder (receives controller reference). */
const KB_DEFS = [
    {
        name: "snap-left-half",
        handler: c => () => c.snapFocusedToPreset("halves", 0),
    },
    {
        name: "snap-right-half",
        handler: c => () => c.snapFocusedToPreset("halves", 1),
    },
    {
        name: "snap-maximize",
        // Win+Up: maximize if unsnapped; cycle to quadrant if snapped to a half
        handler: c => () => c.snapFocusedUp(),
    },
    {
        name: "snap-unsnap",
        // Win+Down: restore if maximized; halves if in quadrant; unsnap otherwise
        handler: c => () => c.snapFocusedDown(),
    },
    {
        name: "snap-top-left",
        handler: c => () => c.snapFocusedToPreset("quarters", 0),
    },
    {
        name: "snap-top-right",
        handler: c => () => c.snapFocusedToPreset("quarters", 1),
    },
    {
        name: "snap-bottom-left",
        handler: c => () => c.snapFocusedToPreset("quarters", 2),
    },
    {
        name: "snap-bottom-right",
        handler: c => () => c.snapFocusedToPreset("quarters", 3),
    },
    {
        name: "open-snap-overlay",
        handler: c => () => c.toggleSnapOverlay(),
    },
    {
        name: "open-zone-editor",
        handler: c => () => c.openZoneEditor(),
    },
    {
        name: "move-monitor-left",
        handler: c => () => c.moveFocusedToMonitor(Meta.DisplayDirection.LEFT),
    },
    {
        name: "move-monitor-right",
        handler: c => () => c.moveFocusedToMonitor(Meta.DisplayDirection.RIGHT),
    },
    {
        name: "cycle-preset-next",
        handler: c => () => c.cyclePreset(1),
    },
    {
        name: "cycle-preset-prev",
        handler: c => () => c.cyclePreset(-1),
    },
    {
        name: "restore-snap-group",
        handler: c => () => c.restoreLastSnapGroup(),
    },
];

export class Keybindings {
    constructor(settings, controller, logger) {
        this._settings = settings;
        this._controller = controller;
        this._log = logger;

        /** @type {string[]} */
        this._registered = [];
    }

    enable() {
        const kbSettings = this._settings.kbSettings;

        for (const def of KB_DEFS) {
            try {
                Main.wm.addKeybinding(
                    def.name,
                    kbSettings,
                    Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.NORMAL,
                    def.handler(this._controller)
                );
                this._registered.push(def.name);
            } catch (e) {
                this._log?.warn(`Keybindings: failed to register "${def.name}": ${e.message}`);
            }
        }

        this._log?.info(`Keybindings: registered ${this._registered.length} bindings`);
    }

    disable() {
        for (const name of this._registered) {
            try {
                Main.wm.removeKeybinding(name);
            } catch (e) {
                this._log?.warn(`Keybindings: failed to remove "${name}": ${e.message}`);
            }
        }
        this._registered = [];
    }
}
