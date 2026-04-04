/**
 * FluxCut — src/indicator.js
 * Quick Settings SystemIndicator + QuickMenuToggle for GNOME 43+.
 *
 * Adds a "FluxCut" entry to the Quick Settings panel with:
 *   - Enable/disable master toggle
 *   - Sub-switches for Snap Overlay, Snap Assist, Zone Highlights, Snap Groups
 *   - "Edit Zones…" action row that opens the Zone Editor
 *   - "Preferences…" action row that opens the extension preferences
 */

import St from "gi://St";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";
import {
    PopupMenuItem,
    PopupSeparatorMenuItem,
    PopupSwitchMenuItem,
} from "resource:///org/gnome/shell/ui/popupMenu.js";
import { _ } from "./i18n.js";

// ── Toggle (main button in Quick Settings grid) ──────────────────────────────

const FluxCutToggle = GObject.registerClass(
    class FluxCutToggle extends QuickSettings.QuickMenuToggle {
        _init(settings, controller) {
            super._init({
                title: "FluxCut",
                iconName: "view-grid-symbolic",
                toggleMode: true,
            });

            this._settings = settings;
            this._controller = controller;

            // Bind master enable setting
            settings.raw.bind(
                "fluxcut-enabled",
                this,
                "checked",
                Gio.SettingsBindFlags.DEFAULT
            );

            // Build submenu
            this._buildMenu();
        }

        _buildMenu() {
            this.menu.setHeader("view-grid-symbolic", "FluxCut");

            // Feature toggles
            const toggles = [
                { key: "snap-overlay-enabled",      label: _("Snap Layout Picker") },
                { key: "snap-assist-enabled",        label: _("Snap Assist") },
                { key: "drag-zone-highlight-enabled",label: _("Zone Highlights on Drag") },
                { key: "snap-groups-enabled",        label: _("Snap Groups in Panel") },
            ];

            for (const { key, label } of toggles) {
                const item = new PopupSwitchMenuItem(label, false);
                this._settings.raw.bind(
                    key,
                    item,
                    "state",
                    Gio.SettingsBindFlags.DEFAULT
                );
                this.menu.addMenuItem(item);
            }

            this.menu.addMenuItem(new PopupSeparatorMenuItem());

            // Edit Zones action
            const editItem = new PopupMenuItem(_("Edit Zones…"));
            editItem.connect("activate", () => {
                this.menu.close();
                this._controller?.openZoneEditor();
            });
            this.menu.addMenuItem(editItem);

            // Open Preferences action
            const prefsItem = new PopupMenuItem(_("Preferences…"));
            prefsItem.connect("activate", () => {
                this.menu.close();
                try {
                    Main.extensionManager.openExtensionPrefs(
                        "fluxcut@gnome-tiling",
                        "",
                        {}
                    );
                } catch (_e) { /* no-op if not available */ }
            });
            this.menu.addMenuItem(prefsItem);
        }
    }
);

// ── SystemIndicator wrapper ───────────────────────────────────────────────────

const FluxCutIndicator = GObject.registerClass(
    class FluxCutIndicator extends QuickSettings.SystemIndicator {
        _init(settings, controller) {
            super._init();

            this._indicator = this._addIndicator();
            this._indicator.iconName = "view-grid-symbolic";

            // Only show indicator dot when FluxCut is enabled
            settings.raw.bind(
                "fluxcut-enabled",
                this._indicator,
                "visible",
                Gio.SettingsBindFlags.GET
            );

            this._toggle = new FluxCutToggle(settings, controller);
            this.quickSettingsItems.push(this._toggle);
        }

        destroy() {
            this._toggle?.destroy();
            super.destroy();
        }
    }
);

// ── Public Indicator class ────────────────────────────────────────────────────

export class Indicator {
    constructor(settings, controller, logger) {
        this._settings = settings;
        this._controller = controller;
        this._log = logger;
        this._indicator = null;
    }

    enable() {
        this._indicator = new FluxCutIndicator(this._settings, this._controller);

        Main.panel.statusArea.quickSettings.addExternalIndicator(
            this._indicator
        );

        this._log?.info("Indicator: enabled");
    }

    disable() {
        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(i => i.destroy());
            this._indicator.destroy();
            this._indicator = null;
        }
        this._log?.info("Indicator: disabled");
    }

    show() { this._indicator?.show(); }
    hide() { this._indicator?.hide(); }
}
