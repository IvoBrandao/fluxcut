/**
 * FluxCut — src/settings.js
 * Typed GSettings accessors for main and keybindings schemas.
 */

const MAIN_SCHEMA = "org.gnome.shell.extensions.fluxcut";
const KB_SCHEMA = "org.gnome.shell.extensions.fluxcut.keybindings";

export class Settings {
    constructor(extension) {
        this._settings = extension.getSettings(MAIN_SCHEMA);
        this._kbSettings = extension.getSettings(KB_SCHEMA);
    }

    // ------------------------------------------------------------------ main

    get enabled() { return this._settings.get_boolean("fluxcut-enabled"); }
    set enabled(v) { this._settings.set_boolean("fluxcut-enabled", v); }

    get snapOverlayEnabled() { return this._settings.get_boolean("snap-overlay-enabled"); }
    get snapAssistEnabled() { return this._settings.get_boolean("snap-assist-enabled"); }
    get dragHighlightEnabled() { return this._settings.get_boolean("drag-zone-highlight-enabled"); }
    get snapGroupsEnabled() { return this._settings.get_boolean("snap-groups-enabled"); }

    get windowGapSize() { return this._settings.get_uint("window-gap-size"); }
    get dragEdgeThreshold() { return this._settings.get_uint("drag-edge-threshold"); }
    get snapAssistTimeout() { return this._settings.get_uint("snap-assist-timeout"); }
    get animationSpeed() { return this._settings.get_uint("animation-speed"); }

    get overlayPosition() { return this._settings.get_string("overlay-position"); }
    get zoneHighlightColor() { return this._settings.get_string("zone-highlight-color"); }
    get zoneBorderColor() { return this._settings.get_string("zone-border-color"); }

    get customZoneSets() { return this._settings.get_strv("custom-zone-sets"); }
    set customZoneSets(v) { this._settings.set_strv("custom-zone-sets", v); }

    get monitorPresets() { return this._settings.get_strv("monitor-presets"); }
    set monitorPresets(v) { this._settings.set_strv("monitor-presets", v); }

    get zoneEditorGridColumns() { return this._settings.get_uint("zone-editor-grid-columns"); }
    get zoneEditorGridRows() { return this._settings.get_uint("zone-editor-grid-rows"); }

    get logLevel() { return this._settings.get_uint("log-level"); }

    get roundedCornersEnabled() { return this._settings.get_boolean("rounded-corners-enabled"); }
    get roundedCornersRadius() { return this._settings.get_uint("rounded-corners-radius"); }

    // ------------------------------------------------------------------ bind helpers

    /**
     * Bind a GSettings key to an object property.
     * Returns the binding for optional later unbinding.
     */
    bind(key, object, property, flags) {
        return this._settings.bind(key, object, property, flags);
    }

    bindKb(key, object, property, flags) {
        return this._kbSettings.bind(key, object, property, flags);
    }

    /**
     * Connect to main settings changes.
     * @returns signal ID
     */
    connect(signal, callback) {
        return this._settings.connect(signal, callback);
    }

    disconnect(id) {
        this._settings.disconnect(id);
    }

    // ------------------------------------------------------------------ keybindings

    get kbSettings() { return this._kbSettings; }

    getKeybinding(key) { return this._kbSettings.get_strv(key); }
    setKeybinding(key, value) { this._kbSettings.set_strv(key, value); }

    connectKb(signal, callback) {
        return this._kbSettings.connect(signal, callback);
    }

    disconnectKb(id) {
        this._kbSettings.disconnect(id);
    }

    // ------------------------------------------------------------------ raw access (for binding in prefs)

    get raw() { return this._settings; }
}
