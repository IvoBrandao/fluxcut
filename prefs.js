/**
 * FluxCut — prefs.js
 * Extension preferences UI — Adw-based, 5 pages.
 *
 * Pages:
 *   1. General      — master switch + window gap + drag threshold + log level
 *   2. Features     — toggle cards for each feature
 *   3. Appearance   — snap-assist timeout, animation speed, highlight colors
 *   4. Keybindings  — one row per keybinding with ShortcutLabel capture
 *   5. Layouts      — custom zone sets CRUD
 */

import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const UUID = "fluxcut@gnome-tiling";
const SCHEMA_ID = "org.gnome.shell.extensions.fluxcut";
const KB_SCHEMA_ID = "org.gnome.shell.extensions.fluxcut.keybindings";

// ── Keybinding names shown in Keybindings page ───────────────────────────────
const KB_ROWS = [
    { key: "snap-left-half",     label: "Snap left half" },
    { key: "snap-right-half",    label: "Snap right half" },
    { key: "snap-upper-quarter", label: "Snap upper quarter" },
    { key: "snap-lower-quarter", label: "Snap lower quarter" },
    { key: "snap-top-left",      label: "Snap top-left" },
    { key: "snap-top-right",     label: "Snap top-right" },
    { key: "snap-bottom-left",   label: "Snap bottom-left" },
    { key: "snap-bottom-right",  label: "Snap bottom-right" },
    { key: "move-swap-left",     label: "Move/swap window left" },
    { key: "move-swap-right",    label: "Move/swap window right" },
    { key: "move-swap-up",       label: "Move/swap window up" },
    { key: "move-swap-down",     label: "Move/swap window down" },
    { key: "open-snap-overlay",  label: "Open Snap Layout Picker" },
    { key: "open-zone-editor",   label: "Open Zone Editor" },
    { key: "move-monitor-left",  label: "Move window to left monitor" },
    { key: "move-monitor-right", label: "Move window to right monitor" },
    { key: "cycle-preset-next",  label: "Cycle preset forward" },
    { key: "cycle-preset-prev",  label: "Cycle preset backward" },
    { key: "restore-snap-group", label: "Restore last snap group" },
];

export default class FluxCutPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(SCHEMA_ID);
        const kbSettings = this.getSettings(KB_SCHEMA_ID);

        window.set_default_size(720, 640);
        window.add(this._buildGeneralPage(settings));
        window.add(this._buildFeaturesPage(settings));
        window.add(this._buildAppearancePage(settings));
        window.add(this._buildKeybindingsPage(kbSettings));
        window.add(this._buildLayoutsPage(settings));
    }

    // ── Page 1 — General ─────────────────────────────────────────────────────

    _buildGeneralPage(settings) {
        const page = new Adw.PreferencesPage({
            title: "General",
            icon_name: "preferences-system-symbolic",
        });

        const group = new Adw.PreferencesGroup({ title: "General Settings" });
        page.add(group);

        // Master enable
        group.add(this._switchRow(
            settings, "fluxcut-enabled",
            "Enable FluxCut",
            "Master switch for all FluxCut features"
        ));

        // Window gap
        group.add(this._spinRow(
            settings, "window-gap-size",
            "Window Gap (px)",
            "Gap between tiled windows",
            0, 40, 1
        ));

        // Drag edge threshold
        group.add(this._spinRow(
            settings, "drag-edge-threshold",
            "Drag Edge Threshold (px)",
            "Distance from monitor edge that triggers zone detection",
            0, 100, 1
        ));

        // Log level
        const logGroup = new Adw.PreferencesGroup({ title: "Diagnostics" });
        page.add(logGroup);
        logGroup.add(this._comboRow(
            settings, "log-level",
            "Log Level",
            "Verbosity of debug output in journalctl",
            ["Off", "Error", "Warning", "Info", "Debug"]
        ));

        return page;
    }

    // ── Page 2 — Features ────────────────────────────────────────────────────

    _buildFeaturesPage(settings) {
        const page = new Adw.PreferencesPage({
            title: "Features",
            icon_name: "view-grid-symbolic",
        });

        const group = new Adw.PreferencesGroup({ title: "Feature Toggles" });
        page.add(group);

        const rows = [
            ["snap-overlay-enabled",       "Snap Layout Picker",        "Super+Z overlay for choosing a layout"],
            ["snap-assist-enabled",        "Snap Assist",               "Show window thumbnails for remaining zones after snapping"],
            ["drag-zone-highlight-enabled","Zone Highlights on Drag",   "Highlight zones while dragging a window"],
            ["snap-groups-enabled",        "Snap Groups in Panel",      "Show snap group button in the top panel"],
        ];

        for (const [key, title, subtitle] of rows)
            group.add(this._switchRow(settings, key, title, subtitle));

        return page;
    }

    // ── Page 3 — Appearance ──────────────────────────────────────────────────

    _buildAppearancePage(settings) {
        const page = new Adw.PreferencesPage({
            title: "Appearance",
            icon_name: "applications-graphics-symbolic",
        });

        const timingGroup = new Adw.PreferencesGroup({ title: "Timing" });
        page.add(timingGroup);

        timingGroup.add(this._spinRow(
            settings, "snap-assist-timeout",
            "Snap Assist Timeout (s)",
            "Seconds before Snap Assist auto-dismisses",
            1, 30, 1
        ));

        timingGroup.add(this._comboRow(
            settings, "animation-speed",
            "Animation Speed",
            "Speed of snap and overlay animations",
            ["Off", "Fast", "Normal", "Slow"]
        ));

        const colorGroup = new Adw.PreferencesGroup({ title: "Zone Colors" });
        page.add(colorGroup);

        colorGroup.add(this._colorRow(
            settings, "zone-highlight-color",
            "Highlight Fill Color",
            "RGBA fill color of hovered zone highlight"
        ));

        colorGroup.add(this._colorRow(
            settings, "zone-border-color",
            "Highlight Border Color",
            "RGBA border color of hovered zone highlight"
        ));

        return page;
    }

    // ── Page 4 — Keybindings ─────────────────────────────────────────────────

    _buildKeybindingsPage(kbSettings) {
        const page = new Adw.PreferencesPage({
            title: "Keybindings",
            icon_name: "input-keyboard-symbolic",
        });

        const group = new Adw.PreferencesGroup({ title: "Configurable Shortcuts" });
        page.add(group);

        for (const { key, label } of KB_ROWS)
            group.add(this._keybindingRow(kbSettings, key, label));

        return page;
    }

    // ── Page 5 — Layouts ─────────────────────────────────────────────────────

    _buildLayoutsPage(settings) {
        const page = new Adw.PreferencesPage({
            title: "Layouts",
            icon_name: "view-paged-symbolic",
        });

        const group = new Adw.PreferencesGroup({
            title: "Custom Zone Layouts",
            description: "Saved zone sets you can use as snap targets",
        });
        page.add(group);

        this._layoutGroup = group;
        this._layoutSettings = settings;
        this._rebuildLayoutRows();

        // "Add new" button in header suffix
        const addBtn = new Gtk.Button({
            icon_name: "list-add-symbolic",
            valign: Gtk.Align.CENTER,
            css_classes: ["flat"],
            tooltip_text: "Add new zone layout",
        });
        addBtn.connect("clicked", () => this._addLayoutPlaceholder());
        group.set_header_suffix(addBtn);

        return page;
    }

    _rebuildLayoutRows() {
        // Remove existing dynamic rows (all except the add button suffix)
        // Adw.PreferencesGroup has no bulk-remove; workaround: destroy + re-add children
        // For simplicity we store references
        if (this._layoutRows) {
            for (const row of this._layoutRows)
                this._layoutGroup.remove(row);
        }
        this._layoutRows = [];

        const raw = this._layoutSettings.get_strv("custom-zone-sets");
        const sets = raw.map(s => { try { return JSON.parse(s); } catch { return null; } })
                        .filter(Boolean);

        for (const set of sets) {
            const row = new Adw.ActionRow({
                title: set.label ?? "Unnamed",
                subtitle: `${(set.zones ?? []).length} zones`,
            });

            const deleteBtn = new Gtk.Button({
                icon_name: "user-trash-symbolic",
                valign: Gtk.Align.CENTER,
                css_classes: ["flat", "destructive-action"],
                tooltip_text: "Delete this layout",
            });
            deleteBtn.connect("clicked", () => {
                const updated = raw.filter(s => {
                    try { return JSON.parse(s).id !== set.id; } catch { return true; }
                });
                this._layoutSettings.set_strv("custom-zone-sets", updated);
                this._rebuildLayoutRows();
            });
            row.add_suffix(deleteBtn);

            this._layoutGroup.add(row);
            this._layoutRows.push(row);
        }
    }

    _addLayoutPlaceholder() {
        // Add a blank entry that tells the user to use the in-shell editor
        const infoRow = new Adw.ActionRow({
            title: "Open the Zone Editor",
            subtitle: "Use Super+E or the Quick Settings button to draw zones",
        });
        this._layoutGroup.add(infoRow);
        this._layoutRows.push(infoRow);
    }

    // ── Row builders ─────────────────────────────────────────────────────────

    _switchRow(settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({ title, subtitle });
        settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _spinRow(settings, key, title, subtitle, min, max, step) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            adjustment: new Gtk.Adjustment({ lower: min, upper: max, step_increment: step }),
        });
        settings.bind(key, row, "value", Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _comboRow(settings, key, title, subtitle, choices) {
        const row = new Adw.ComboRow({ title, subtitle });
        const model = Gtk.StringList.new(choices);
        row.set_model(model);
        row.set_selected(settings.get_uint(key));
        row.connect("notify::selected", () => {
            settings.set_uint(key, row.selected);
        });
        // Update if changed externally
        const handlerId = settings.connect(`changed::${key}`, () => {
            row.set_selected(settings.get_uint(key));
        });
        row.connect("destroy", () => settings.disconnect(handlerId));
        return row;
    }

    _colorRow(settings, key, title, subtitle) {
        const row = new Adw.ActionRow({ title, subtitle });

        let colorWidget;
        try {
            // GNOME 46+: use Gtk.ColorDialogButton
            const dialog = new Gtk.ColorDialog({ title, with_alpha: true });
            colorWidget = new Gtk.ColorDialogButton({ dialog, valign: Gtk.Align.CENTER });
            this._bindColor(settings, key, colorWidget, "rgba", true);
        } catch (_) {
            // Fallback for GNOME 45
            colorWidget = new Gtk.ColorButton({ use_alpha: true, valign: Gtk.Align.CENTER });
            this._bindColor(settings, key, colorWidget, "rgba", false);
        }

        row.add_suffix(colorWidget);
        row.set_activatable_widget(colorWidget);
        return row;
    }

    _bindColor(settings, key, widget, prop, isDialog) {
        const load = () => {
            const str = settings.get_string(key);
            const rgba = new Gdk.RGBA();
            if (rgba.parse(str)) widget[prop] = rgba;
        };
        load();
        widget.connect(`notify::${prop}`, () => {
            settings.set_string(key, widget[prop].to_string());
        });
        const h = settings.connect(`changed::${key}`, load);
        widget.connect("destroy", () => settings.disconnect(h));
    }

    _keybindingRow(kbSettings, key, label) {
        const row = new Adw.ActionRow({ title: label });

        const shortcutLabel = new Gtk.ShortcutLabel({
            valign: Gtk.Align.CENTER,
            disabled_text: "Disabled",
        });

        const currentBindings = kbSettings.get_strv(key);
        shortcutLabel.set_accelerator(currentBindings[0] ?? "");

        // Capture button — opens key capture dialog
        const editBtn = new Gtk.Button({
            icon_name: "input-keyboard-symbolic",
            valign: Gtk.Align.CENTER,
            css_classes: ["flat"],
            tooltip_text: "Capture shortcut (press key combination)",
        });
        editBtn.connect("clicked", () => this._captureShortcut(row, kbSettings, key, shortcutLabel));

        // Type button — opens text entry for typing accelerator string
        const typeBtn = new Gtk.Button({
            icon_name: "document-edit-symbolic",
            valign: Gtk.Align.CENTER,
            css_classes: ["flat"],
            tooltip_text: "Type shortcut (e.g. <Super>Left)",
        });
        typeBtn.connect("clicked", () => this._typeShortcut(row, kbSettings, key, shortcutLabel));

        const clearBtn = new Gtk.Button({
            icon_name: "edit-clear-symbolic",
            valign: Gtk.Align.CENTER,
            css_classes: ["flat"],
            tooltip_text: "Clear shortcut",
        });
        clearBtn.connect("clicked", () => {
            kbSettings.set_strv(key, []);
            shortcutLabel.set_accelerator("");
        });

        row.add_suffix(shortcutLabel);
        row.add_suffix(editBtn);
        row.add_suffix(typeBtn);
        row.add_suffix(clearBtn);
        return row;
    }

    _captureShortcut(parentRow, kbSettings, key, shortcutLabel) {
        const dialog = new Gtk.Dialog({
            title: `Set shortcut for: ${parentRow.title}`,
            modal: true,
            resizable: false,
        });

        // Try to find the parent window
        let topLevel = parentRow.get_root?.();
        if (topLevel instanceof Gtk.Window)
            dialog.set_transient_for(topLevel);

        const content = dialog.get_content_area();
        const hintLabel = new Gtk.Label({
            label: "Press the desired key combination…\n" +
                   "Press Escape to cancel.\n\n" +
                   "Note: if the compositor grabs the key combo\n" +
                   "(e.g. Super+Arrow), use the ✎ Type button instead.",
            margin_top: 24,
            margin_bottom: 12,
            margin_start: 24,
            margin_end: 24,
        });
        content.append(hintLabel);

        const feedbackLabel = new Gtk.Label({
            label: "",
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
            css_classes: ["dim-label"],
        });
        content.append(feedbackLabel);

        // Known modifier keysyms — must be ignored as standalone presses
        const MODIFIER_KEYSYMS = new Set([
            Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
            Gdk.KEY_Control_L, Gdk.KEY_Control_R,
            Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
            Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
            Gdk.KEY_Hyper_L, Gdk.KEY_Hyper_R,
        ]);
        // Super_L/R may be undefined in some GTK4 GJS versions – add safely
        if (Gdk.KEY_Super_L != null) MODIFIER_KEYSYMS.add(Gdk.KEY_Super_L);
        if (Gdk.KEY_Super_R != null) MODIFIER_KEYSYMS.add(Gdk.KEY_Super_R);
        if (Gdk.KEY_ISO_Level3_Shift != null) MODIFIER_KEYSYMS.add(Gdk.KEY_ISO_Level3_Shift);
        if (Gdk.KEY_Mode_switch != null) MODIFIER_KEYSYMS.add(Gdk.KEY_Mode_switch);
        // Extra: numeric keysyms that appear when Num Lock is active overlay
        if (Gdk.KEY_Num_Lock != null) MODIFIER_KEYSYMS.add(Gdk.KEY_Num_Lock);
        if (Gdk.KEY_Caps_Lock != null) MODIFIER_KEYSYMS.add(Gdk.KEY_Caps_Lock);

        const controller = new Gtk.EventControllerKey();
        controller.connect("key-pressed", (_c, keyval, keycode, state) => {
            if (keyval === Gdk.KEY_Escape) {
                dialog.close();
                return true; // EVENT_STOP
            }

            // Ignore lone modifier presses — wait for the real key
            if (MODIFIER_KEYSYMS.has(keyval)) {
                // Show what modifiers are held so far
                const mask = Gtk.accelerator_get_default_mod_mask();
                const mods = state & mask;
                const partial = Gtk.accelerator_name(0, mods);
                if (partial)
                    feedbackLabel.set_text(`Holding: ${partial}…`);
                return true; // Consume to prevent WM from seeing lone Super
            }

            // Build the accelerator with cleaned modifier state
            const mask = Gtk.accelerator_get_default_mod_mask();
            const effectiveMods = state & mask;
            const accel = Gtk.accelerator_name(keyval, effectiveMods);

            if (!accel || accel.length < 2) {
                feedbackLabel.set_text("Invalid key combination, try again.");
                return true;
            }

            // Validate — Gtk.accelerator_parse returns [success, key, mods]
            const [valid] = Gtk.accelerator_parse(accel);
            if (!valid) {
                feedbackLabel.set_text(`"${accel}" is not a valid shortcut.`);
                return true;
            }

            kbSettings.set_strv(key, [accel]);
            shortcutLabel.set_accelerator(accel);
            dialog.close();
            return true; // EVENT_STOP
        });
        dialog.add_controller(controller);

        dialog.present();
    }

    /**
     * Alternative shortcut entry: user types the GTK accelerator string
     * (e.g. "<Super>Left", "<Primary><Shift>a").
     * This bypasses compositor key grabs entirely.
     */
    _typeShortcut(parentRow, kbSettings, key, shortcutLabel) {
        const dialog = new Gtk.Dialog({
            title: `Type shortcut for: ${parentRow.title}`,
            modal: true,
            resizable: false,
        });

        let topLevel = parentRow.get_root?.();
        if (topLevel instanceof Gtk.Window)
            dialog.set_transient_for(topLevel);

        const content = dialog.get_content_area();

        const hintLabel = new Gtk.Label({
            label: "Type the shortcut string using GTK format:\n" +
                   "  <Super>Left   <Super>z   <Primary><Alt>t\n" +
                   "  <Super>Home   <Super><Shift>Right",
            margin_top: 16,
            margin_start: 24,
            margin_end: 24,
            wrap: true,
        });
        content.append(hintLabel);

        const entry = new Gtk.Entry({
            placeholder_text: "<Super>Left",
            margin_top: 12,
            margin_bottom: 8,
            margin_start: 24,
            margin_end: 24,
        });

        // Pre-fill with current binding
        const current = kbSettings.get_strv(key);
        if (current.length > 0)
            entry.set_text(current[0]);

        content.append(entry);

        const statusLabel = new Gtk.Label({
            label: "",
            margin_bottom: 16,
            margin_start: 24,
            margin_end: 24,
            css_classes: ["dim-label"],
        });
        content.append(statusLabel);

        const btnBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            margin_bottom: 16,
            margin_start: 24,
            margin_end: 24,
            halign: Gtk.Align.END,
        });

        const cancelBtn = new Gtk.Button({ label: "Cancel" });
        cancelBtn.connect("clicked", () => dialog.close());
        btnBox.append(cancelBtn);

        const applyBtn = new Gtk.Button({
            label: "Apply",
            css_classes: ["suggested-action"],
        });
        applyBtn.connect("clicked", () => {
            const text = entry.get_text().trim();
            if (!text) {
                statusLabel.set_text("Enter a shortcut string.");
                return;
            }

            // Validate the accelerator string
            const [valid, parsedKey, parsedMods] = Gtk.accelerator_parse(text);
            if (!valid || parsedKey === 0) {
                statusLabel.set_text(`"${text}" is not a valid GTK shortcut.`);
                return;
            }

            // Normalise to canonical form
            const canonical = Gtk.accelerator_name(parsedKey, parsedMods);
            kbSettings.set_strv(key, [canonical]);
            shortcutLabel.set_accelerator(canonical);
            dialog.close();
        });
        btnBox.append(applyBtn);

        // Also accept Enter in the text entry
        entry.connect("activate", () => applyBtn.emit("clicked"));

        content.append(btnBox);
        dialog.present();
        entry.grab_focus();
    }
}
