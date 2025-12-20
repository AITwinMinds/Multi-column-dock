/**
 * Dock View Widget for Multi-Column Dock
 * Main dock widget containing app icons, groups, and auto-hide functionality
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { AppIcon } from 'resource:///org/gnome/shell/ui/appDisplay.js';

import { parseHexColor } from './utils.js';
import { ScaleManager } from './scaleManager.js';
import { GroupContainer } from './groupContainer.js';

// Reference to global badge manager (set from extension.js)
let _badgeManager = null;

/**
 * Set the badge manager reference
 * @param {BadgeManager} manager - The badge manager instance
 */
export function setBadgeManager(manager) {
    _badgeManager = manager;
}

/**
 * DockView - Main dock widget
 */
export const DockView = GObject.registerClass(
    class DockView extends St.Widget {
        _init(settings, monitorIndex) {
            super._init({
                name: 'two-column-dock',
                layout_manager: new Clutter.BoxLayout({ orientation: Clutter.Orientation.VERTICAL }),
                reactive: true,
            });

            this._settings = settings;
            this._monitorIndex = monitorIndex;
            this._appSystem = Shell.AppSystem.get_default();
            this._appFavorites = AppFavorites.getAppFavorites();
            this._groups = [];
            this._groupContainers = new Map();
            this._iconWrappers = [];  // Track wrappers for timeout cleanup

            // Initialize ScaleManager for HiDPI support
            this._scaleManager = new ScaleManager(settings);

            // Enable Drag and Drop
            this._delegate = this;

            // Tooltip Label
            this._tooltip = new St.Label({
                style_class: 'dock-tooltip',
                text: '',
                visible: false,
            });
            // Add to uiGroup to ensure it floats above everything (including the dock)
            Main.layoutManager.uiGroup.add_child(this._tooltip);

            // Manage popup menus for app icons
            this._menuManager = new PopupMenu.PopupMenuManager(this);

            // Main container for groups and ungrouped apps
            this._mainContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: false,
                style_class: 'dock-main-container',
            });

            // Container for icons (legacy mode without groups)
            this._grid = new St.Widget({
                layout_manager: new Clutter.GridLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    column_spacing: 0,
                    row_spacing: 0,
                }),
                style_class: 'dock-grid',
            });

            // Anchor the grid to the top-left
            this._grid.set_x_align(Clutter.ActorAlign.START);
            this._grid.set_y_align(Clutter.ActorAlign.START);
            this._grid.set_x_expand(false);
            this._grid.set_y_expand(false);
            this._grid.set_style('padding: 2px;');

            this._mainContainer.add_child(this._grid);

            // Container for the content inside ScrollView
            this._scrollContent = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: false,
            });
            this._scrollContent.add_child(this._mainContainer);

            // ScrollView to enable scrolling when there are many apps
            this._scrollView = new St.ScrollView({
                style_class: 'dock-scroll-view',
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                overlay_scrollbars: true,
                x_expand: true,
                y_expand: true,
            });
            this._scrollView.set_child(this._scrollContent);

            this.add_child(this._scrollView);

            // Show Apps button
            this._showAppsIcon = new St.Icon({
                icon_name: 'view-app-grid-symbolic',
                style_class: 'dock-show-apps-icon',
            });

            this._showAppsButton = new St.Button({
                style_class: 'dock-show-apps',
                reactive: true,
                can_focus: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.START,
                child: this._showAppsIcon,
            });

            this._showAppsClickedId = this._showAppsButton.connect('clicked', () => {
                if (Main.overview.visible) {
                    let dash = Main.overview.dash;
                    let inAppGrid = false;

                    if (dash) {
                        if (dash.showAppsButton && dash.showAppsButton.checked) {
                            inAppGrid = true;
                        } else if (dash._showAppsIcon && dash._showAppsIcon.checked) {
                            inAppGrid = true;
                        }
                    }

                    if (inAppGrid) {
                        Main.overview.hide();
                    } else {
                        if (Main.overview.showApps) {
                            Main.overview.showApps();
                        } else if (Main.overview.dash && Main.overview.dash.showApps) {
                            Main.overview.dash.showApps();
                        } else {
                            Main.overview.hide();
                        }
                    }
                } else {
                    if (Main.overview.showApps) {
                        Main.overview.showApps();
                    } else if (Main.overview.dash && Main.overview.dash.showApps) {
                        Main.overview.dash.showApps();
                    } else {
                        Main.overview.show();
                    }
                }
            });

            this._showAppsButton.connect('enter-event', () => {
                this._showTooltip(this._showAppsButton, 'Show Apps');
            });
            this._showAppsButton.connect('leave-event', () => {
                this._hideTooltip();
            });
            this._showAppsButton.connect('notify::hover', () => {
                if (this._showAppsButton.hover)
                    this._showTooltip(this._showAppsButton, 'Show Apps');
                else
                    this._hideTooltip();
            });

            this.add_child(this._showAppsButton);

            // Initial position will be set by _updateDockPosition called from extension
            // Store position for later use
            this._dockPosition = this._settings.get_string('dock-position');

            // Auto-hide state
            this._autoHideEnabled = false;
            this._isHidden = false;
            this._showTimeoutId = 0;
            this._hideTimeoutId = 0;
            this._hotZone = null;

            // Badge tracking
            this._iconBadges = new Map();
            this._badgeListener = this._onBadgeUpdate.bind(this);
            if (_badgeManager) {
                _badgeManager.addListener(this._badgeListener);
            }

            // Load groups from settings
            this._loadGroups();

            // Connect settings
            this._settingsChangedId = this._settings.connect('changed', this._onSettingsChanged.bind(this));
            this._favoritesChangedId = this._appFavorites.connect('changed', this._redisplay.bind(this));
            this._appStateChangedId = this._appSystem.connect('app-state-changed', this._redisplay.bind(this));
            this._installedChangedId = this._appSystem.connect('installed-changed', this._redisplay.bind(this));

            this._updateStyle();
            this._redisplay();

            // Initialize auto-hide after a short delay to ensure dock dimensions are calculated
            this._initTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._initTimeoutId = 0;
                this._storeVisiblePosition();
                this._updateAutoHide();
                return GLib.SOURCE_REMOVE;
            });
        }

        // Store the visible position based on dock position setting
        _storeVisiblePosition() {
            this._dockVisibleX = this.x;
        }

        // Update dock position when width changes (for right-side dock, expand to left)
        _updatePositionForWidth(newWidth) {
            const dockPosition = this._settings.get_string('dock-position');
            if (dockPosition === 'right') {
                // Get the monitor for this dock
                const monitor = Main.layoutManager.monitors[this._monitorIndex];
                if (monitor) {
                    const newX = monitor.x + monitor.width - newWidth;
                    this.set_x(newX);
                    this._storeVisiblePosition();
                }
            }
        }

        _onSettingsChanged(settings, key) {
            if (key === 'app-groups' || key === 'enable-groups' || key === 'show-ungrouped') {
                this._loadGroups();
            }

            // Handle auto-hide settings changes
            if (key === 'auto-hide' || key === 'hot-zone-size') {
                this._updateAutoHide();
            }

            // Dock position change requires full recreation (handled by extension)
            if (key === 'dock-position') {
                this._dockPosition = this._settings.get_string('dock-position');
            }

            this._redisplay();

            if (key === 'background-color' || key === 'background-opacity' || key === 'corner-radius' || key === 'dock-position') {
                this._updateStyle();
            }
        }

        // Auto-hide functionality
        _updateAutoHide() {
            const autoHide = this._settings.get_boolean('auto-hide');

            if (autoHide && !this._autoHideEnabled) {
                this._enableAutoHide();
            } else if (!autoHide && this._autoHideEnabled) {
                this._disableAutoHide();
            } else if (autoHide && this._autoHideEnabled) {
                // Update hot zone size
                this._destroyHotZone();
                this._createHotZone();
            }
        }

        _enableAutoHide() {
            this._autoHideEnabled = true;

            // Connect enter/leave events to the dock itself
            this._dockEnterEventId = this.connect('enter-event', () => {
                this._onDockEnter();
            });
            this._dockLeaveEventId = this.connect('leave-event', () => {
                this._onDockLeave();
            });

            // Create the hot zone
            this._createHotZone();

            // Initially hide the dock
            this._hideDock(true);
        }

        _disableAutoHide() {
            this._autoHideEnabled = false;

            // Disconnect events
            if (this._dockEnterEventId) {
                this.disconnect(this._dockEnterEventId);
                this._dockEnterEventId = 0;
            }
            if (this._dockLeaveEventId) {
                this.disconnect(this._dockLeaveEventId);
                this._dockLeaveEventId = 0;
            }

            // Remove hot zone
            this._destroyHotZone();

            // Clear any pending timeouts
            this._clearAutoHideTimeouts();

            // Show the dock
            this._showDock(true);
        }

        _createHotZone() {
            if (this._hotZone) return;

            const monitor = Main.layoutManager.monitors[this._monitorIndex] || Main.layoutManager.primaryMonitor;
            const panelHeight = Main.panel.height;
            const hotZoneSize = this._settings.get_int('hot-zone-size');
            const position = this._settings.get_string('dock-position');

            let x, y, width, height;

            if (position === 'right') {
                x = monitor.x + monitor.width - hotZoneSize;
                y = monitor.y + panelHeight;
                width = hotZoneSize;
                height = monitor.height - panelHeight;
            } else {
                // Default to left
                x = monitor.x;
                y = monitor.y + panelHeight;
                width = hotZoneSize;
                height = monitor.height - panelHeight;
            }

            this._hotZone = new St.Widget({
                name: 'dock-hot-zone',
                reactive: true,
                track_hover: true,
                x: x,
                y: y,
                width: width,
                height: height,
                // Make it invisible but still reactive
                opacity: 0,
            });

            this._hotZoneEnterEventId = this._hotZone.connect('enter-event', () => {
                this._onHotZoneEnter();
            });

            // Add to the chrome layer so it's always accessible
            Main.layoutManager.addChrome(this._hotZone, {
                affectsInputRegion: true,
                trackFullscreen: true,
            });
        }

        _destroyHotZone() {
            if (this._hotZone) {
                if (this._hotZoneEnterEventId) {
                    this._hotZone.disconnect(this._hotZoneEnterEventId);
                    this._hotZoneEnterEventId = 0;
                }
                Main.layoutManager.removeChrome(this._hotZone);
                this._hotZone.destroy();
                this._hotZone = null;
            }
        }

        _onHotZoneEnter() {
            if (!this._autoHideEnabled || !this._isHidden) return;

            const showDelay = this._settings.get_int('show-delay');

            this._clearAutoHideTimeouts();

            if (showDelay > 0) {
                this._showTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, showDelay, () => {
                    this._showTimeoutId = 0;
                    this._showDock(false);
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this._showDock(false);
            }
        }

        _onDockEnter() {
            if (!this._autoHideEnabled) return;

            // Cancel any pending hide
            this._clearAutoHideTimeouts();
        }

        _onDockLeave() {
            if (!this._autoHideEnabled || this._isHidden) return;

            // Check if we have an active popup menu open
            if (this._hasActiveMenu()) return;

            const hideDelay = this._settings.get_int('auto-hide-delay');

            this._clearAutoHideTimeouts();

            if (hideDelay > 0) {
                this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, hideDelay, () => {
                    this._hideTimeoutId = 0;
                    // Double check mouse position before hiding
                    if (!this._isMouseOverDock()) {
                        this._hideDock(false);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                if (!this._isMouseOverDock()) {
                    this._hideDock(false);
                }
            }
        }

        _hasActiveMenu() {
            return this._menuManager?._activeMenu?.isOpen ? true : false;
        }

        _isMouseOverDock() {
            const [mouseX, mouseY] = global.get_pointer();
            const [dockX, dockY] = this.get_transformed_position();
            const [dockW, dockH] = this.get_transformed_size();

            return mouseX >= dockX && mouseX <= dockX + dockW &&
                mouseY >= dockY && mouseY <= dockY + dockH;
        }

        _showDock(immediate) {
            if (!this._isHidden) return;

            this._isHidden = false;
            this.show();

            // Hide the hot zone when dock is visible
            if (this._hotZone) {
                this._hotZone.hide();
            }

            if (immediate) {
                this.set_x(this._dockVisibleX);
                this.opacity = 255;
            } else {
                this.ease({
                    x: this._dockVisibleX,
                    opacity: 255,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }

        _hideDock(immediate) {
            if (this._isHidden) return;

            this._isHidden = true;

            const position = this._settings.get_string('dock-position');

            // Store the visible position if not already stored
            if (this._dockVisibleX === undefined) {
                this._dockVisibleX = this.x;
            }

            // Calculate hidden position based on dock position (left or right)
            let hiddenX;
            if (position === 'right') {
                hiddenX = this._dockVisibleX + this.get_width();
            } else {
                // Default to left
                hiddenX = this._dockVisibleX - this.get_width();
            }

            // Show the hot zone when dock is hidden
            if (this._hotZone) {
                this._hotZone.show();
            }

            if (immediate) {
                this.set_x(hiddenX);
                this.opacity = 0;
                this.hide();
            } else {
                this.ease({
                    x: hiddenX,
                    opacity: 0,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        this.hide();
                    }
                });
            }
        }

        _clearAutoHideTimeouts() {
            if (this._showTimeoutId) {
                GLib.source_remove(this._showTimeoutId);
                this._showTimeoutId = 0;
            }
            if (this._hideTimeoutId) {
                GLib.source_remove(this._hideTimeoutId);
                this._hideTimeoutId = 0;
            }
        }

        _cleanupWrapperTimeouts() {
            if (this._iconWrappers) {
                for (const wrapper of this._iconWrappers) {
                    if (wrapper._dragEndTimeoutId) {
                        GLib.source_remove(wrapper._dragEndTimeoutId);
                        wrapper._dragEndTimeoutId = 0;
                    }
                    if (wrapper._activateTimeoutId) {
                        GLib.source_remove(wrapper._activateTimeoutId);
                        wrapper._activateTimeoutId = 0;
                    }
                }
            }
        }

        _loadGroups() {
            try {
                let groupsJson = this._settings.get_string('app-groups');
                this._groups = JSON.parse(groupsJson) || [];
            } catch (e) {
                log(`[Multi-Column Dock] Error loading groups: ${e.message}`);
                this._groups = [];
            }

            // Ensure we always have a hidden group to store ungrouped ordering.
            this._ensureUngroupedOrderGroup();
            // Ensure we have the visible "Other" group for ungrouped apps
            this._ensureOtherGroup();
        }

        _ensureUngroupedOrderGroup() {
            const UNGROUPED_ORDER_ID = '__ungrouped_order__';
            if (!Array.isArray(this._groups))
                this._groups = [];

            let orderGroup = this._groups.find(g => g && g.id === UNGROUPED_ORDER_ID);
            if (!orderGroup) {
                this._groups.push({
                    id: UNGROUPED_ORDER_ID,
                    name: 'Ungrouped Order',
                    hidden: true,
                    apps: [],
                });
            } else {
                orderGroup.hidden = true;
                if (!Array.isArray(orderGroup.apps))
                    orderGroup.apps = [];
            }
        }

        // Ensure the visible "Other" group exists for ungrouped apps styling
        _ensureOtherGroup() {
            const OTHER_GROUP_ID = '__other__';
            if (!Array.isArray(this._groups))
                this._groups = [];

            let otherGroup = this._groups.find(g => g && g.id === OTHER_GROUP_ID);
            if (!otherGroup) {
                // Add "Other" group at the end (but before hidden groups)
                const insertIndex = this._groups.findIndex(g => g && g.hidden);
                const newOtherGroup = {
                    id: OTHER_GROUP_ID,
                    name: 'Other',
                    color: '#333333',
                    borderColor: '#555555',
                    borderWidth: 1,
                    opacity: 0.6,
                    collapsed: false,
                    isOtherGroup: true, // Special marker
                    apps: [], // Apps are auto-assigned, not stored here
                };
                if (insertIndex >= 0) {
                    this._groups.splice(insertIndex, 0, newOtherGroup);
                } else {
                    this._groups.push(newOtherGroup);
                }
                // Save the new group
                this._saveGroups();
            } else {
                // Ensure the marker is set
                otherGroup.isOtherGroup = true;
            }
        }

        _saveGroups() {
            try {
                this._settings.set_string('app-groups', JSON.stringify(this._groups));
            } catch (e) {
                log(`[Multi-Column Dock] Error saving groups: ${e.message}`);
            }
        }

        _saveGroupState() {
            // Save collapse states
            this._saveGroups();
        }

        _moveAppToGroup(appId, groupId, position = -1) {
            const UNGROUPED_ORDER_ID = '__ungrouped_order__';
            this._ensureUngroupedOrderGroup();

            const orderGroup = this._groups.find(g => g && g.id === UNGROUPED_ORDER_ID);

            // Remove app from all groups first
            for (let group of this._groups) {
                if (group.apps) {
                    group.apps = group.apps.filter(id => id !== appId);
                }
            }

            // If dropping into the special "Other" section, store order in the hidden order group.
            if (groupId === 'ungrouped') {
                if (orderGroup) {
                    const list = orderGroup.apps;
                    // Insert at specific position or append
                    if (position >= 0 && position <= list.length)
                        list.splice(position, 0, appId);
                    else
                        list.push(appId);
                }
            } else {
                // Add to target visible group
                let targetGroup = this._groups.find(g => g.id === groupId);
                if (targetGroup) {
                    if (!targetGroup.apps) targetGroup.apps = [];

                    if (position >= 0 && position < targetGroup.apps.length)
                        targetGroup.apps.splice(position, 0, appId);
                    else
                        targetGroup.apps.push(appId);
                }
            }

            this._saveGroups();
            this._redisplay();
        }

        _updateStyle() {
            let hex = this._settings.get_string('background-color');
            let opacity = this._settings.get_double('background-opacity');
            let radius = this._settings.get_int('corner-radius');
            let position = this._settings.get_string('dock-position');

            const { r, g, b } = parseHexColor(hex);

            // Scale the corner radius
            const scaleFactor = this._scaleManager.getScaleFactor();
            const scaledRadius = Math.round(radius * scaleFactor);

            // Apply border-radius based on dock position (left or right)
            let borderRadius;
            if (position === 'right') {
                borderRadius = `${scaledRadius}px 0 0 ${scaledRadius}px`;
            } else {
                // Default to left
                borderRadius = `0 ${scaledRadius}px ${scaledRadius}px 0`;
            }

            this.set_style(`
            background-color: rgba(${r}, ${g}, ${b}, ${opacity});
            border-radius: ${borderRadius};
        `);
        }

        destroy() {
            // Clean up wrapper timeouts
            this._cleanupWrapperTimeouts();

            // Clean up timeouts
            if (this._initTimeoutId) {
                GLib.source_remove(this._initTimeoutId);
                this._initTimeoutId = 0;
            }
            if (this._positionTimeoutId) {
                GLib.source_remove(this._positionTimeoutId);
                this._positionTimeoutId = 0;
            }

            // Clean up auto-hide resources
            this._clearAutoHideTimeouts();
            this._destroyHotZone();

            if (this._dockEnterEventId) {
                this.disconnect(this._dockEnterEventId);
                this._dockEnterEventId = 0;
            }
            if (this._dockLeaveEventId) {
                this.disconnect(this._dockLeaveEventId);
                this._dockLeaveEventId = 0;
            }

            if (_badgeManager && this._badgeListener) {
                _badgeManager.removeListener(this._badgeListener);
            }
            this._iconBadges.clear();

            if (this._settingsChangedId) {
                this._settings.disconnect(this._settingsChangedId);
                this._settingsChangedId = 0;
            }
            if (this._favoritesChangedId) {
                this._appFavorites.disconnect(this._favoritesChangedId);
                this._favoritesChangedId = 0;
            }
            if (this._appStateChangedId) {
                this._appSystem.disconnect(this._appStateChangedId);
                this._appStateChangedId = 0;
            }
            if (this._installedChangedId) {
                this._appSystem.disconnect(this._installedChangedId);
                this._installedChangedId = 0;
            }
            if (this._showAppsClickedId && this._showAppsButton) {
                this._showAppsButton.disconnect(this._showAppsClickedId);
                this._showAppsClickedId = 0;
            }

            if (this._tooltip) {
                Main.layoutManager.uiGroup.remove_child(this._tooltip);
                this._tooltip.destroy();
                this._tooltip = null;
            }

            super.destroy();
        }

        _onBadgeUpdate(appId) {
            let entry = this._iconBadges.get(appId);
            if (entry) {
                this._updateBadge(entry.icon, entry.badge, appId);
            }
        }

        _updateBadge(icon, badge, appId) {
            let badgeInfo = _badgeManager ? _badgeManager.getBadge(appId) : null;

            if (badgeInfo && badgeInfo.count > 0) {
                let text = badgeInfo.count > 99 ? '99+' : badgeInfo.count.toString();
                badge.set_text(text);
                badge.show();

                if (badgeInfo.urgent) {
                    badge.add_style_class_name('dock-badge-urgent');
                } else {
                    badge.remove_style_class_name('dock-badge-urgent');
                }
            } else {
                badge.hide();
            }
        }

        _createBadge() {
            // Create badge with scaled dimensions
            const scaledFontSize = this._scaleManager.getScaledFontSize(10);
            const scaledBorderRadius = this._scaleManager.getScaledBorderRadius(8);
            const scaledPaddingV = this._scaleManager.getScaledSpacing(1);
            const scaledPaddingH = this._scaleManager.getScaledSpacing(5);
            const scaledMinWidth = this._scaleManager.scale(14);
            const scaledMargin = this._scaleManager.getScaledSpacing(2);

            const badge = new St.Label({
                style_class: 'dock-badge',
                text: '',
                visible: false,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.START,
                x_expand: true,
                y_expand: true,
            });

            badge.set_style(`
            background-color: #e74c3c;
            color: white;
            border-radius: ${scaledBorderRadius}px;
            padding: ${scaledPaddingV}px ${scaledPaddingH}px;
            font-size: ${scaledFontSize}px;
            font-weight: bold;
            min-width: ${scaledMinWidth}px;
            text-align: center;
            margin: ${scaledMargin}px ${scaledMargin}px 0 0;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
        `);

            return badge;
        }

        _redisplay() {
            // Clean up wrapper timeouts before destroying
            this._cleanupWrapperTimeouts();

            // Clear existing children
            this._mainContainer.destroy_all_children();
            this._groupContainers.clear();
            this._iconBadges.clear();
            this._iconWrappers = [];

            const columns = this._settings.get_int('columns');
            const iconSize = this._settings.get_int('icon-size');
            const enableGroups = this._settings.get_boolean('enable-groups');
            const showUngrouped = this._settings.get_boolean('show-ungrouped');
            const groupSpacing = this._settings.get_int('group-spacing');

            // Get app lists
            const favorites = this._appFavorites.getFavorites();
            const running = this._appSystem.get_running();

            const seenIds = new Set();
            const allApps = [];

            favorites.forEach(app => {
                let id = app.get_id();
                if (!seenIds.has(id)) {
                    allApps.push(app);
                    seenIds.add(id);
                }
            });

            running.forEach(app => {
                let id = app.get_id();
                if (!seenIds.has(id)) {
                    allApps.push(app);
                    seenIds.add(id);
                }
            });

            // Add padding around icons for breathing room
            // The padding is part of the clickable/hover area
            const paddingBase = this._settings.get_int('icon-padding-base');
            const paddingScale = this._settings.get_double('icon-padding-scale');
            const iconPadding = Math.max(paddingBase, Math.round(iconSize * paddingScale));
            const totalIconSize = iconSize + iconPadding;

            // Additional spacing between cells in the grid
            const cellSpacing = 0;

            // Store metrics so DND uses the exact same numbers everywhere
            this._layoutMetrics = { columns, iconSize, totalIconSize, cellSpacing };

            // Calculate dock width with generous buffer
            let totalWidth;
            if (enableGroups) {
                // Add space for group margins (2px each side) and borders (1-2px each side)
                // Plus extra buffer to prevent cutoff
                const groupMargin = 4; // 2px margin on each side
                const groupBorder = 4; // border allowance
                const safetyBuffer = 16; // Extra space for scrollbars/rendering quirks
                totalWidth = (totalIconSize * columns) + (cellSpacing * Math.max(0, columns - 1)) + groupMargin + groupBorder + safetyBuffer;
            } else {
                totalWidth = (totalIconSize * columns) + (cellSpacing * Math.max(0, columns - 1)) + 16;
            }

            this.set_width(totalWidth);

            // Reposition dock if on right side (expand to left, not right)
            this._updatePositionForWidth(totalWidth);

            // Size Show Apps button
            if (this._showAppsButton) {
                this._showAppsButton.set_size(totalIconSize, totalIconSize);
                this._showAppsButton.set_style(`border: none; box-shadow: none; padding: 2px; margin: 4px auto 6px auto;`);
            }
            if (this._showAppsIcon) {
                this._showAppsIcon.set_icon_size(iconSize);
            }

            // Update tooltip styling
            this._updateTooltipStyle();

            if (enableGroups && this._groups.length > 0) {
                // GROUP MODE: Render apps organized by groups
                this._renderGroupedApps(allApps, columns, iconSize, totalIconSize, showUngrouped, groupSpacing, cellSpacing);
            } else {
                // LEGACY MODE: Render apps in a simple grid
                this._renderSimpleGrid(allApps, columns, iconSize, totalIconSize, cellSpacing);
            }

            this.add_style_class_name('two-column-dock-container');
            this.queue_relayout();
        }

        _updateTooltipStyle() {
            const scaleFactor = this._scaleManager.getScaleFactor();
            const fontSize = Math.round(12 * Math.min(scaleFactor, 1.25));
            const paddingV = Math.round(4 * scaleFactor);
            const paddingH = Math.round(8 * scaleFactor);
            const borderRadius = Math.round(4 * scaleFactor);

            this._tooltip.set_style(`
            background-color: rgba(0, 0, 0, 0.9);
            color: white;
            border-radius: ${borderRadius}px;
            padding: ${paddingV}px ${paddingH}px;
            text-align: center;
            font-weight: bold;
            font-size: ${fontSize}px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.5);
        `);
        }

        _renderSimpleGrid(apps, columns, iconSize, totalIconSize, cellSpacing) {
            // Create the legacy grid - vertical docks always use horizontal orientation (fill columns first)
            this._grid = new St.Widget({
                layout_manager: new Clutter.GridLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    column_spacing: cellSpacing,
                    row_spacing: cellSpacing,
                }),
                style_class: 'dock-grid',
            });
            this._grid.set_x_align(Clutter.ActorAlign.START);
            this._grid.set_y_align(Clutter.ActorAlign.START);
            this._grid.set_style(`padding: 2px;`);

            const layout = this._grid.layout_manager;
            layout.set_column_homogeneous(true);
            layout.set_row_homogeneous(true);

            let col = 0;
            let row = 0;

            apps.forEach(app => {
                let icon = this._createAppIcon(app, iconSize, totalIconSize);
                layout.attach(icon, col, row, 1, 1);

                col++;
                if (col >= columns) {
                    col = 0;
                    row++;
                }
            });

            this._mainContainer.add_child(this._grid);
        }

        _renderGroupedApps(apps, columns, iconSize, totalIconSize, showUngrouped, groupSpacing, cellSpacing) {
            // Create a map of appId -> app for quick lookup
            const appMap = new Map();
            apps.forEach(app => appMap.set(app.get_id(), app));

            // Track which apps are assigned to groups
            const assignedApps = new Set();

            // Group spacing - minimal scaling
            const scaleFactor = this._scaleManager.getScaleFactor();
            const scaledGroupSpacing = Math.round(groupSpacing * scaleFactor);

            const UNGROUPED_ORDER_ID = '__ungrouped_order__';
            const OTHER_GROUP_ID = '__other__';

            // First pass: collect assigned apps from regular groups
            for (let group of this._groups) {
                if (!group || group.hidden || group.id === UNGROUPED_ORDER_ID || group.id === OTHER_GROUP_ID)
                    continue;
                if (group.apps && group.apps.length > 0) {
                    for (let appId of group.apps) {
                        if (appMap.has(appId)) {
                            assignedApps.add(appId);
                        }
                    }
                }
            }

            // Prepare ungrouped apps list for the "Other" group
            let ungroupedAppsList = [];
            if (showUngrouped) {
                let ungroupedApps = apps.filter(app => !assignedApps.has(app.get_id()));
                if (ungroupedApps.length > 0) {
                    // Apply persistent ordering for ungrouped apps
                    const orderGroup = this._groups.find(g => g && g.id === UNGROUPED_ORDER_ID);
                    const order = Array.isArray(orderGroup?.apps) ? orderGroup.apps : [];
                    const ungroupedMap = new Map(ungroupedApps.map(a => [a.get_id(), a]));
                    for (const id of order) {
                        const app = ungroupedMap.get(id);
                        if (app) {
                            ungroupedAppsList.push(app);
                            ungroupedMap.delete(id);
                        }
                    }
                    // Append any remaining untracked apps
                    ungroupedAppsList.push(...ungroupedMap.values());
                }
            }

            // Render each visible group in order (including Other group at its position)
            for (let group of this._groups) {
                if (!group || group.hidden || group.id === UNGROUPED_ORDER_ID)
                    continue;

                let groupApps = [];
                let isOtherGroup = group.id === OTHER_GROUP_ID || group.isOtherGroup;

                if (isOtherGroup) {
                    // "Other" group uses ungrouped apps
                    if (!showUngrouped || ungroupedAppsList.length === 0)
                        continue; // Skip if no ungrouped apps or feature disabled
                    groupApps = ungroupedAppsList;
                } else {
                    // Regular group uses its assigned apps
                    if (group.apps && group.apps.length > 0) {
                        for (let appId of group.apps) {
                            let app = appMap.get(appId);
                            if (app) {
                                groupApps.push(app);
                            }
                        }
                    }
                }

                // Only render group if it has apps or is explicitly shown
                if (groupApps.length > 0 || group.showEmpty) {
                    // For "Other" group, create a modified group object with app list for display
                    let displayGroup = isOtherGroup ? {
                        ...group,
                        apps: groupApps.map(app => app.get_id()),
                    } : group;

                    let groupContainer = new GroupContainer(displayGroup, this._settings, this, this._scaleManager);
                    this._groupContainers.set(isOtherGroup ? 'ungrouped' : group.id, groupContainer);

                    // Add spacing between groups
                    groupContainer.set_style(groupContainer.get_style() + ` margin-bottom: ${scaledGroupSpacing}px;`);

                    // Populate the group's grid
                    if (!groupContainer.isCollapsed()) {
                        let grid = groupContainer.getGrid();
                        let layout = grid.layout_manager;
                        layout.set_column_spacing(cellSpacing);
                        layout.set_row_spacing(cellSpacing);
                        layout.set_column_homogeneous(true);
                        layout.set_row_homogeneous(true);

                        let col = 0;
                        let row = 0;

                        groupApps.forEach(app => {
                            let icon = this._createAppIcon(app, iconSize, totalIconSize);
                            layout.attach(icon, col, row, 1, 1);

                            col++;
                            if (col >= columns) {
                                col = 0;
                                row++;
                            }
                        });
                    }

                    this._mainContainer.add_child(groupContainer);
                }
            }
        }

        _createAppIcon(app, iconSize, totalIconSize) {
            // Create a simple St.Button wrapper instead of fighting AppIcon's internal layout
            const inset = Math.max(4, Math.floor((totalIconSize - iconSize) / 2));
            let wrapper = new St.Button({
                style_class: 'dock-app-button',
                reactive: true,
                can_focus: true,
                track_hover: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            // Use an overlay container so we can add a running indicator dot
            const overlay = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_expand: true,
            });

            // Put the icon in its own padded container so the running dot can sit
            // at the true bottom of the button (not above the padding).
            const iconContainer = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
            });
            iconContainer.set_style(`padding: ${inset}px; margin: 0;`);

            // Create a simple St.Icon directly - much simpler than AppIcon
            let iconWidget = new St.Icon({
                gicon: app.get_icon(),
                icon_size: iconSize,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
            });
            iconContainer.add_child(iconWidget);
            overlay.add_child(iconContainer);

            // Running indicator dot (restores the previous "open app" hint)
            const runningDot = new St.Widget({
                style_class: 'dock-running-dot',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.END,
                x_expand: true,
                y_expand: true,
            });
            // Show dot when app has at least one normal window
            const isRunning = app.get_windows().some(w => !w.skip_taskbar);
            if (!isRunning)
                runningDot.hide();
            overlay.add_child(runningDot);

            wrapper.set_child(overlay);
            wrapper.app = app; // Store app reference for DND and activation

            // Style the wrapper
            wrapper.set_style(`
            border: none;
            box-shadow: none;
            padding: 0;
            margin: 0;
            border-radius: 8px;
        `);
            wrapper.set_size(totalIconSize, totalIconSize);
            wrapper.set_pivot_point(0.5, 0.5);

            // Make it draggable like AppIcon
            wrapper._draggable = DND.makeDraggable(wrapper);
            wrapper._delegate = wrapper;

            // DND methods
            wrapper.getDragActor = () => {
                let dragIcon = new St.Icon({
                    gicon: app.get_icon(),
                    icon_size: iconSize,
                });
                return dragIcon;
            };

            wrapper.getDragActorSource = () => wrapper;

            // Drag state tracking
            let dragStarted = false;
            let pressTime = 0;
            let pressX = 0;
            let pressY = 0;

            wrapper._draggable.connect('drag-begin', () => {
                dragStarted = true;
            });
            wrapper._draggable.connect('drag-end', () => {
                if (wrapper._dragEndTimeoutId) {
                    GLib.source_remove(wrapper._dragEndTimeoutId);
                }
                wrapper._dragEndTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    wrapper._dragEndTimeoutId = 0;
                    dragStarted = false;
                    return GLib.SOURCE_REMOVE;
                });
            });

            wrapper.connect('button-press-event', (actor, event) => {
                const button = event.get_button();
                if (button === 3) {
                    this._showAppMenu(wrapper, app, event.get_time());
                    return Clutter.EVENT_STOP;
                }
                if (button === 1) {
                    pressTime = GLib.get_monotonic_time();
                    [pressX, pressY] = event.get_coords();
                }
                return Clutter.EVENT_PROPAGATE;
            });

            wrapper.connect('button-release-event', (actor, event) => {
                if (event.get_button() !== 1) {
                    return Clutter.EVENT_PROPAGATE;
                }

                if (dragStarted) {
                    return Clutter.EVENT_PROPAGATE;
                }

                let elapsed = GLib.get_monotonic_time() - pressTime;
                let [releaseX, releaseY] = event.get_coords();
                let distance = Math.sqrt(Math.pow(releaseX - pressX, 2) + Math.pow(releaseY - pressY, 2));

                if (elapsed > 300000 || distance > 10) {
                    return Clutter.EVENT_PROPAGATE;
                }

                wrapper.ease({
                    scale_x: 1.3,
                    scale_y: 1.3,
                    duration: 80,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        wrapper.ease({
                            scale_x: 1.0,
                            scale_y: 1.0,
                            duration: 120,
                            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                        });
                    }
                });

                if (wrapper._activateTimeoutId) {
                    GLib.source_remove(wrapper._activateTimeoutId);
                }
                wrapper._activateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    wrapper._activateTimeoutId = 0;
                    this._activateApp(app);
                    return GLib.SOURCE_REMOVE;
                });
                return Clutter.EVENT_STOP;
            });

            // Tooltip
            wrapper.connect('enter-event', () => {
                this._showTooltip(wrapper, app.get_name());
            });
            wrapper.connect('leave-event', () => {
                this._hideTooltip();
            });

            // Badge
            let appId = app.get_id();
            let badge = this._createBadge();
            wrapper.add_child(badge);
            this._iconBadges.set(appId, { icon: wrapper, badge });

            // Track wrapper for timeout cleanup
            this._iconWrappers.push(wrapper);
            this._updateBadge(wrapper, badge, appId);

            return wrapper;
        }

        _showAppMenu(wrapper, app, eventTime = 0) {
            if (!this._menuManager)
                return;

            // Lazily create and cache the menu per icon
            if (!wrapper._appMenu) {
                // Determine menu side based on dock position (left or right)
                const dockPosition = this._settings.get_string('dock-position');
                let menuSide;
                if (dockPosition === 'right') {
                    menuSide = St.Side.RIGHT; // Menu opens to the left, arrow on right
                } else {
                    // Default to left
                    menuSide = St.Side.LEFT;  // Menu opens to the right, arrow on left
                }

                const menu = new PopupMenu.PopupMenu(wrapper, 0.5, menuSide, 0);
                menu.box.add_style_class_name('dock-app-menu');
                Main.uiGroup.add_child(menu.actor);
                this._menuManager.addMenu(menu);
                wrapper._appMenu = menu;

                // Keep the clicked icon visually highlighted while the menu is open.
                menu.connect('open-state-changed', (_m, isOpen) => {
                    if (isOpen)
                        wrapper.add_style_pseudo_class('hover');
                    else
                        wrapper.remove_style_pseudo_class('hover');
                });

                // Destroy with the icon to avoid leaks
                wrapper.connect('destroy', () => {
                    if (wrapper._appMenu) {
                        wrapper._appMenu.destroy();
                        wrapper._appMenu = null;
                    }
                });
            } else {
                wrapper._appMenu.removeAll();
            }

            const appId = app.get_id();
            const isFavorite = this._appFavorites.isFavorite(appId);

            const openItem = new PopupMenu.PopupMenuItem('Open');
            openItem.connect('activate', () => this._activateApp(app));
            wrapper._appMenu.addMenuItem(openItem);

            const newWindowItem = new PopupMenu.PopupMenuItem('New Window');
            newWindowItem.connect('activate', () => app.open_new_window(-1));
            wrapper._appMenu.addMenuItem(newWindowItem);

            const favoriteItem = new PopupMenu.PopupMenuItem(isFavorite ? 'Remove from Favorites' : 'Add to Favorites');
            favoriteItem.connect('activate', () => {
                if (this._appFavorites.isFavorite(appId))
                    this._appFavorites.removeFavorite(appId);
                else
                    this._appFavorites.addFavorite(appId);
            });
            wrapper._appMenu.addMenuItem(favoriteItem);

            // App-specific desktop actions (e.g. Chrome "New Incognito Window")
            // Prefer DesktopAppInfo because it supports list_actions()/launch_action() reliably.
            const desktopInfo = Gio.DesktopAppInfo.new(appId);

            let actions = [];
            try {
                if (desktopInfo)
                    actions = desktopInfo.list_actions() || [];
            } catch (e) {
                actions = [];
            }

            if (actions.length > 0) {
                wrapper._appMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

                for (const action of actions) {
                    let label = action;
                    try {
                        if (desktopInfo)
                            label = desktopInfo.get_action_name(action) || action;
                    } catch (e) {
                        label = action;
                    }

                    const actionItem = new PopupMenu.PopupMenuItem(label);
                    actionItem.connect('activate', () => {
                        const timestamp = eventTime || global.get_current_time();
                        const workspaceIndex = global.workspace_manager?.get_active_workspace_index?.() ?? -1;
                        const context = global.create_app_launch_context(timestamp, workspaceIndex);
                        try {
                            if (desktopInfo) {
                                desktopInfo.launch_action(action, context);
                            } else {
                                app.open_new_window(-1);
                            }
                        } catch (e) {
                            log(`[Multi-Column Dock] Failed to launch action '${action}' for ${appId}: ${e.message}`);
                        }
                    });
                    wrapper._appMenu.addMenuItem(actionItem);
                }
            }

            wrapper._appMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const quitItem = new PopupMenu.PopupMenuItem('Quit');
            quitItem.connect('activate', () => app.request_quit());
            wrapper._appMenu.addMenuItem(quitItem);

            wrapper._appMenu.open(true);
        }

        _activateApp(app) {
            let windows = app.get_windows();

            if (windows.length === 0) {
                app.open_new_window(-1);
                Main.overview.hide();
                // Wait for the window to appear and activate it
                this._activateNewWindow(app);
                return;
            }

            let workspace = global.workspace_manager.get_active_workspace();
            let currentWindows = windows.filter(w => !w.skip_taskbar);

            if (currentWindows.length === 0) {
                app.open_new_window(-1);
                Main.overview.hide();
                // Wait for the window to appear and activate it
                this._activateNewWindow(app);
                return;
            }

            currentWindows.sort((a, b) => b.get_user_time() - a.get_user_time());
            let mostRecentWindow = currentWindows[0];

            if (mostRecentWindow.minimized) {
                mostRecentWindow.unminimize();
                mostRecentWindow.activate(global.get_current_time());
            } else if (mostRecentWindow.has_focus()) {
                mostRecentWindow.minimize();
            } else {
                mostRecentWindow.activate(global.get_current_time());
            }

            Main.overview.hide();
        }

        // Activate a newly opened window after a delay
        _activateNewWindow(app, retryCount = 0) {
            const maxRetries = 10;
            const retryDelay = 100; // ms

            GLib.timeout_add(GLib.PRIORITY_DEFAULT, retryDelay, () => {
                let windows = app.get_windows().filter(w => !w.skip_taskbar);
                if (windows.length > 0) {
                    // Sort by user time to get the newest window
                    windows.sort((a, b) => b.get_user_time() - a.get_user_time());
                    windows[0].activate(global.get_current_time());
                    return GLib.SOURCE_REMOVE;
                }

                // Retry if window hasn't appeared yet
                if (retryCount < maxRetries) {
                    this._activateNewWindow(app, retryCount + 1);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        _showTooltip(actor, text) {
            this._tooltip.set_text(text);
            this._tooltip.show();

            const [, natW] = this._tooltip.get_preferred_width(-1);
            const [, natH] = this._tooltip.get_preferred_height(-1);

            let [x, y] = actor.get_transformed_position();
            let [w, h] = actor.get_transformed_size();

            // Small offset for tooltip
            const offset = 8;
            const dockPosition = this._settings.get_string('dock-position');

            let tooltipX, tooltipY;

            if (dockPosition === 'right') {
                // Tooltip to the left of the icon
                tooltipX = Math.round(x - natW - offset);
                tooltipY = Math.round(y + (h / 2) - (natH / 2));
            } else {
                // Default to left - tooltip to the right of the icon
                tooltipX = Math.round(x + w + offset);
                tooltipY = Math.round(y + (h / 2) - (natH / 2));
            }

            this._tooltip.set_position(tooltipX, tooltipY);
        }

        _hideTooltip() {
            this._tooltip.hide();
        }

        vfunc_allocate(box) {
            super.vfunc_allocate(box);
        }

        vfunc_paint(paintContext) {
            super.vfunc_paint(paintContext);

            let width = this.get_width();
            let height = this.get_height();
            let columns = this._settings.get_int('columns');
            let enableGroups = this._settings.get_boolean('enable-groups');

            // Only draw column separators in non-grouped mode
            if (!enableGroups && columns >= 2) {
                let cr = paintContext.get_cairo_context();
                let colWidth = width / columns;

                cr.setSourceRGBA(1, 1, 1, 0.15);
                cr.setLineWidth(1);

                for (let i = 1; i < columns; i++) {
                    let x = Math.floor(colWidth * i);
                    cr.moveTo(x, 0);
                    cr.lineTo(x, height);
                    cr.stroke();
                }
            }
        }

        handleDragOver(source, actor, x, y, time) {
            // Check for .app property (our custom wrapper) or AppIcon
            if (source.app || source instanceof AppIcon) {
                return DND.DragMotionResult.MOVE_DROP;
            }
            return DND.DragMotionResult.NO_DROP;
        }

        acceptDrop(source, actor, x, y, time) {
            // Check for .app property (our custom wrapper) or AppIcon
            if (source.app || source instanceof AppIcon) {
                let app = source.app || source._app;
                if (!app) return false;

                let id = app.get_id();
                const columns = this._layoutMetrics?.columns ?? this._settings.get_int('columns');
                const totalIconSize = this._layoutMetrics?.totalIconSize ?? this._settings.get_int('icon-size');
                const cellSpacing = this._layoutMetrics?.cellSpacing ?? 6;
                const cellSize = totalIconSize + cellSpacing;

                // Transform stage coords into the legacy grid's local coords for accuracy
                let localX = x;
                let localY = y;
                try {
                    const [stageX, stageY] = global.get_pointer();
                    const [ok, gridLocalX, gridLocalY] = this._grid.transform_stage_point(stageX, stageY);
                    if (ok) {
                        localX = gridLocalX;
                        localY = gridLocalY;
                    }
                } catch (e) {
                    // fallback to given x,y
                }

                let col = Math.floor(localX / cellSize);
                let row = Math.floor(localY / cellSize);

                if (col >= columns) col = columns - 1;
                if (col < 0) col = 0;
                if (row < 0) row = 0;

                let index = row * columns + col;

                // Clamp to favorites length to avoid misplacement at end
                const favs = AppFavorites.getAppFavorites();
                const maxLen = favs.getFavorites().length;
                if (index > maxLen) index = maxLen;
                if (index < 0) index = 0;

                favs.moveFavoriteToPos(id, index);

                return true;
            }
            return false;
        }
    });
