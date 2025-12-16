/**
 * Multi-Column Dock Extension for GNOME Shell
 * Main extension entry point
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { BadgeManager } from './badgeManager.js';
import { DockView, setBadgeManager } from './dockView.js';

// Global badge manager instance
let badgeManager = null;

/**
 * MultiColumnDockExtension - Main extension class
 */
export default class MultiColumnDockExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._docks = [];
        
        // Initialize badge manager
        badgeManager = new BadgeManager();
        setBadgeManager(badgeManager);
        
        this._createDocks();
        
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._createDocks.bind(this));
        this._settingsChangedIds = [
            this._settings.connect('changed::show-on-all-monitors', this._createDocks.bind(this)),
            this._settings.connect('changed::auto-hide', this._createDocks.bind(this)),
            this._settings.connect('changed::dock-position', this._createDocks.bind(this)),
        ];

        // Hide original dash
        this._originalDash = Main.overview.dash;
        if (this._originalDash) {
             this._originalDash.hide();
             if (this._originalDash.get_parent() && this._originalDash.get_parent().has_style_class_name('dock-container')) {
                 this._originalDash.get_parent().hide();
             }
        }

        // Global key handler for Escape in app grid
        this._globalKeyPressId = global.stage.connect('key-press-event', (actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Escape && Main.overview.visible) {
                let dash = Main.overview.dash;
                let inAppGrid = false;
                if (dash) {
                    if (dash.showAppsButton && dash.showAppsButton.checked) inAppGrid = true;
                    else if (dash._showAppsIcon && dash._showAppsIcon.checked) inAppGrid = true;
                }
                
                if (inAppGrid) {
                    Main.overview.hide();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _createDocks() {
        if (this._docks) {
            this._docks.forEach(dock => {
                Main.layoutManager.removeChrome(dock);
                dock.destroy();
            });
        }
        this._docks = [];

        let showOnAll = this._settings.get_boolean('show-on-all-monitors');
        let autoHide = this._settings.get_boolean('auto-hide');
        let monitors = Main.layoutManager.monitors;

        monitors.forEach((monitor, index) => {
            if (!showOnAll && index !== Main.layoutManager.primaryIndex) return;

            let dock = new DockView(this._settings, index);
            
            // When auto-hide is enabled, don't affect struts so apps can be fullscreen
            // The dock will appear on top of windows
            Main.layoutManager.addChrome(dock, {
                affectsInputRegion: true,
                trackFullscreen: !autoHide,  // Don't track fullscreen in auto-hide mode
                affectsStruts: !autoHide,    // Don't reserve space in auto-hide mode
            });
            
            this._updateDockPosition(dock, monitor);
            this._docks.push(dock);
        });
    }

    _updateDockPosition(dock, monitor) {
        const dockPosition = this._settings.get_string('dock-position');
        const isPrimary = monitor.index === Main.layoutManager.primaryIndex;
        const panelHeight = isPrimary ? Main.panel.height : 0;
        
        let x, y, height;
        
        // Height is the same for both left and right positions
        height = monitor.height - panelHeight;
        y = monitor.y + panelHeight;
        
        if (dockPosition === 'right') {
            // X position needs to account for dock width (set after width is known)
            x = monitor.x + monitor.width - dock.get_width();
        } else {
            // Default to left
            x = monitor.x;
        }
        
        dock.set_position(x, y);
        dock.set_height(height);
        
        // Store visible position for auto-hide after positioning
        dock._storeVisiblePosition();
        
        // For right position, we need to reposition after the dock calculates its size
        if (dockPosition === 'right') {
            // Clear any existing timeout before creating new one
            if (dock._positionTimeoutId) {
                GLib.source_remove(dock._positionTimeoutId);
            }
            dock._positionTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                dock._positionTimeoutId = 0;
                dock.set_x(monitor.x + monitor.width - dock.get_width());
                dock._storeVisiblePosition();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    disable() {
        if (this._globalKeyPressId) {
            global.stage.disconnect(this._globalKeyPressId);
            this._globalKeyPressId = 0;
        }

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        
        if (this._settingsChangedIds) {
            this._settingsChangedIds.forEach(id => this._settings.disconnect(id));
            this._settingsChangedIds = null;
        }

        if (this._docks) {
            this._docks.forEach(dock => {
                Main.layoutManager.removeChrome(dock);
                dock.destroy();
            });
            this._docks = [];
        }
        
        if (badgeManager) {
            badgeManager.destroy();
            badgeManager = null;
            setBadgeManager(null);
        }
        
        if (this._originalDash) {
            this._originalDash.show();
            if (this._originalDash.get_parent() && this._originalDash.get_parent().has_style_class_name('dock-container')) {
                 this._originalDash.get_parent().show();
             }
            this._originalDash = null;
        }
        
        this._settings = null;
    }
}
