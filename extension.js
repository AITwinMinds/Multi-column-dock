import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { AppIcon } from 'resource:///org/gnome/shell/ui/appDisplay.js';

// Unity Launcher API DBus interface for notification badges
const LauncherEntryIface = `
<node>
  <interface name="com.canonical.Unity.LauncherEntry">
    <signal name="Update">
      <arg type="s" name="app_uri"/>
      <arg type="a{sv}" name="properties"/>
    </signal>
  </interface>
</node>`;

// Badge Manager - listens to Unity Launcher Entry signals
class BadgeManager {
    constructor() {
        this._badges = new Map(); // appId -> { count: number, urgent: boolean }
        this._listeners = new Set();
        this._dbusConnection = null;
        this._signalId = 0;
        
        this._initDBus();
    }

    _initDBus() {
        try {
            this._dbusConnection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
            
            // Listen for Unity LauncherEntry Update signals
            this._signalId = this._dbusConnection.signal_subscribe(
                null, // sender
                'com.canonical.Unity.LauncherEntry',
                'Update',
                null, // object path
                null, // arg0
                Gio.DBusSignalFlags.NONE,
                this._onUpdate.bind(this)
            );
        } catch (e) {
            log(`[Multi-Column Dock] Failed to init DBus for badges: ${e.message}`);
        }
    }

    _onUpdate(connection, sender, objectPath, interfaceName, signalName, parameters) {
        try {
            let [appUri, props] = parameters.deep_unpack();
            
            // appUri is like "application://org.telegram.desktop.desktop"
            // Convert to app ID: "org.telegram.desktop.desktop"
            let appId = appUri.replace('application://', '');
            
            let count = 0;
            let countVisible = false;
            let urgent = false;
            
            if (props['count']) {
                count = props['count'].deep_unpack();
            }
            if (props['count-visible']) {
                countVisible = props['count-visible'].deep_unpack();
            }
            if (props['urgent']) {
                urgent = props['urgent'].deep_unpack();
            }
            
            if (countVisible && count > 0) {
                this._badges.set(appId, { count, urgent });
            } else {
                this._badges.delete(appId);
            }
            
            // Notify listeners
            this._notifyListeners(appId);
        } catch (e) {
            log(`[Multi-Column Dock] Error parsing badge update: ${e.message}`);
        }
    }

    getBadge(appId) {
        return this._badges.get(appId) || null;
    }

    addListener(callback) {
        this._listeners.add(callback);
    }

    removeListener(callback) {
        this._listeners.delete(callback);
    }

    _notifyListeners(appId) {
        for (let callback of this._listeners) {
            try {
                callback(appId);
            } catch (e) {
                log(`[Multi-Column Dock] Badge listener error: ${e.message}`);
            }
        }
    }

    destroy() {
        if (this._dbusConnection && this._signalId) {
            this._dbusConnection.signal_unsubscribe(this._signalId);
            this._signalId = 0;
        }
        this._badges.clear();
        this._listeners.clear();
    }
}

// Global badge manager instance
let badgeManager = null;

// Helper to parse hex color
function parseHexColor(hex) {
    let r = 30, g = 30, b = 30;
    if (hex && hex.match(/^#[0-9a-fA-F]{6}$/)) {
        r = parseInt(hex.substring(1, 3), 16);
        g = parseInt(hex.substring(3, 5), 16);
        b = parseInt(hex.substring(5, 7), 16);
    }
    return { r, g, b };
}

// ScaleManager - handles dynamic scaling for HiDPI/4K displays
class ScaleManager {
    constructor(settings) {
        this._settings = settings;
    }

    // Get the effective scale factor based on display and settings
    getScaleFactor() {
        // Check if user has set a manual scale factor
        const manualScale = this._settings.get_double('scale-factor');
        if (manualScale > 0) {
            return manualScale;
        }

        // Use GNOME Shell's built-in scale factor - this already handles HiDPI properly
        // No need to calculate our own - GNOME does this correctly
        let themeScale = 1.0;
        try {
            const themeContext = St.ThemeContext.get_for_stage(global.stage);
            if (themeContext) {
                themeScale = themeContext.scale_factor;
            }
        } catch (e) {
            log(`[Multi-Column Dock] Error getting theme scale: ${e.message}`);
        }

        return themeScale;
    }

    // Get scaled value for a dimension (UI elements like margins, padding)
    scale(baseValue) {
        return Math.round(baseValue * this.getScaleFactor());
    }

    // Get icon size - use base setting directly, GNOME handles icon scaling
    getScaledIconSize() {
        // Return the user's icon-size setting directly
        // GNOME Shell already handles HiDPI scaling for icons internally
        return this._settings.get_int('icon-size');
    }

    // Get padding for icons - minimal scaling needed
    getScaledPadding() {
        const basePadding = 8;
        return Math.round(basePadding * this.getScaleFactor());
    }

    // Get scaled font size - keep reasonable bounds
    getScaledFontSize(baseFontSize) {
        // Don't over-scale fonts - GNOME already handles font scaling
        // Just apply a modest scale factor
        const scaleFactor = this.getScaleFactor();
        const scaled = Math.round(baseFontSize * Math.min(scaleFactor, 1.5));
        return Math.max(9, Math.min(scaled, 16)); // Tighter bounds: 9-16px
    }

    // Get scaled border radius
    getScaledBorderRadius(baseRadius) {
        return Math.round(baseRadius * this.getScaleFactor());
    }

    // Get scaled margin/spacing
    getScaledSpacing(baseSpacing) {
        return Math.round(baseSpacing * this.getScaleFactor());
    }

    // Get current monitor info for debugging
    getMonitorInfo() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (monitor) {
            return {
                width: monitor.width,
                height: monitor.height,
                scaleFactor: this.getScaleFactor(),
                themeScale: St.ThemeContext.get_for_stage(global.stage)?.scale_factor || 1,
            };
        }
        return null;
    }
}

// Group Container Widget - Visual container for a group of apps
const GroupContainer = GObject.registerClass(
class GroupContainer extends St.BoxLayout {
    _init(group, settings, dockView, scaleManager) {
        super._init({
            vertical: true,
            style_class: 'dock-group-container',
            x_expand: true,
            y_expand: false,
            reactive: true,
        });

        this._group = group;
        this._settings = settings;
        this._dockView = dockView;
        this._scaleManager = scaleManager;
        this._collapsed = group.collapsed || false;
        
        // Enable DND
        this._delegate = this;

        // Get scaled values
        const scaledCollapseIconSize = this._scaleManager.scale(12);
        const endPadding = this._scaleManager.getScaledSpacing(6);

        // Create header (clickable to collapse/expand)
        this._header = new St.BoxLayout({
            style_class: 'dock-group-header',
            reactive: true,
            track_hover: true,
            x_expand: true,
        });

        // Collapse/expand indicator
        this._collapseIcon = new St.Icon({
            icon_name: this._collapsed ? 'pan-end-symbolic' : 'pan-down-symbolic',
            style_class: 'dock-group-collapse-icon',
            icon_size: scaledCollapseIconSize,
        });
        this._header.add_child(this._collapseIcon);

        // Group name label
        this._label = new St.Label({
            text: group.name || 'Unnamed Group',
            style_class: 'dock-group-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._header.add_child(this._label);

        // Header click handler
        this._header.connect('button-press-event', (actor, event) => {
            if (event.get_button() === 1) {
                this._toggleCollapse();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.add_child(this._header);

        // Grid for icons (inside a container for the group background)
        this._contentBox = new St.BoxLayout({
            vertical: true,
            style_class: 'dock-group-content',
            x_expand: true,
        });

        // Keep layout tight but add a bit of breathing room under the icons
        this._contentBox.set_style(`padding: 0 0 ${endPadding}px 0; spacing: 0px;`);

        this._grid = new St.Widget({
            layout_manager: new Clutter.GridLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                column_spacing: 0,
                row_spacing: 0,
            }),
            style_class: 'dock-group-grid',
            x_expand: true,
        });
        this._grid.set_x_align(Clutter.ActorAlign.CENTER);
        this._grid.set_y_align(Clutter.ActorAlign.START);

        this._contentBox.add_child(this._grid);
        this.add_child(this._contentBox);

        // Apply group styling
        this._updateGroupStyle();

        // Initial collapse state
        if (this._collapsed) {
            this._contentBox.hide();
        }
    }

    _updateGroupStyle() {
        const group = this._group;
        const { r, g, b } = parseHexColor(group.color || '#2a2a2a');
        const opacity = group.opacity !== undefined ? group.opacity : 0.8;
        const borderColor = parseHexColor(group.borderColor || '#444444');
        const borderWidth = group.borderWidth !== undefined ? group.borderWidth : 1;

        // Use fixed pixel values - GNOME Shell already handles HiDPI scaling
        // Don't apply additional scaling to avoid double-scaling
        const baseRadius = this._settings.get_int('group-corner-radius');
        const borderRadius = Math.max(0, baseRadius);
        const margin = 2;
        const paddingH = 4;
        const paddingV = 2;
        
        // Dynamic sizing based on icon size
        // If icons are large (e.g. 4K), scale up the header slightly
        const iconSize = this._settings.get_int('icon-size');
        const isLarge = iconSize > 48;
        
        const headerHeight = isLarge ? 28 : 20;
        const fontSize = isLarge ? 13 : 11;
        const collapseIconMargin = 3;

        // Style the container with background and border
        this.set_style(`
            background-color: rgba(${r}, ${g}, ${b}, ${opacity});
            border: ${borderWidth}px solid rgba(${borderColor.r}, ${borderColor.g}, ${borderColor.b}, 0.8);
            border-radius: ${borderRadius}px;
            margin: ${margin}px;
            padding: 0;
            spacing: 0px;
        `);

        // Style the header - compact, no extra space
        this._header.set_style(`
            padding: ${paddingV}px ${paddingH}px;
            min-height: ${headerHeight}px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        `);

        // Style the collapse icon
        this._collapseIcon.set_style(`
            margin-right: ${collapseIconMargin}px;
        `);

        // Style the label - small font
        this._label.set_style(`
            font-weight: bold;
            font-size: ${fontSize}px;
            color: rgba(255, 255, 255, 0.9);
        `);
        
        // Set label to clip overflow with ellipsis
        this._label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
    }

    _toggleCollapse() {
        this._collapsed = !this._collapsed;
        this._group.collapsed = this._collapsed;
        
        // Update icon
        this._collapseIcon.set_icon_name(
            this._collapsed ? 'pan-end-symbolic' : 'pan-down-symbolic'
        );

        // Animate show/hide
        if (this._collapsed) {
            this._contentBox.ease({
                opacity: 0,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._contentBox.hide();
                }
            });
        } else {
            this._contentBox.show();
            this._contentBox.opacity = 0;
            this._contentBox.ease({
                opacity: 255,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            });
        }

        // Save collapse state
        this._dockView._saveGroupState();
    }

    getGrid() {
        return this._grid;
    }

    getGroup() {
        return this._group;
    }

    isCollapsed() {
        return this._collapsed;
    }

    // DND support for dropping apps into this group
    handleDragOver(source, actor, x, y, time) {
        // Check for .app property (our custom wrapper) or AppIcon
        if (source.app || source instanceof AppIcon) {
            this.add_style_class_name('dock-group-drop-target');
            return DND.DragMotionResult.MOVE_DROP;
        }
        return DND.DragMotionResult.NO_DROP;
    }

    acceptDrop(source, actor, x, y, time) {
        this.remove_style_class_name('dock-group-drop-target');
        
        // Check for .app property (our custom wrapper) or AppIcon
        if (source.app || source instanceof AppIcon) {
            const app = source.app || source._app;
            if (!app)
                return false;

            const appId = app.get_id();
            const metrics = this._dockView?._layoutMetrics;
            const columns = metrics?.columns ?? this._settings.get_int('columns');
            const totalIconSize = metrics?.totalIconSize ?? this._settings.get_int('icon-size');
            const cellSpacing = metrics?.cellSpacing ?? 6;
            const cellSize = totalIconSize + cellSpacing;

            // Robust coordinate handling: use stage pointer and transform into grid-local coords.
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
                // Fallback to provided coords
            }

            let col = Math.floor(localX / cellSize);
            let row = Math.floor(localY / cellSize);

            if (col < 0) col = 0;
            if (col >= columns) col = columns - 1;
            if (row < 0) row = 0;

            let position = row * columns + col;

            // Clamp to valid range (allow append)
            const currentLen = Array.isArray(this._group.apps) ? this._group.apps.length : 0;
            if (position > currentLen)
                position = currentLen;

            this._dockView._moveAppToGroup(appId, this._group.id, position);
            return true;
        }
        return false;
    }
});

const DockView = GObject.registerClass(
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

        // Position on screen
        const monitor = Main.layoutManager.primaryMonitor;
        const panelHeight = Main.panel.height;
        
        this.set_position(monitor.x, monitor.y + panelHeight);
        this.set_height(monitor.height - panelHeight); 

        // Badge tracking
        this._iconBadges = new Map();
        this._badgeListener = this._onBadgeUpdate.bind(this);
        if (badgeManager) {
            badgeManager.addListener(this._badgeListener);
        }

        // Load groups from settings
        this._loadGroups();

        // Connect settings
        this._settingsChangedId = this._settings.connect('changed', this._onSettingsChanged.bind(this));
        this._favoritesChangedId = this._appFavorites.connect('changed', this._redisplay.bind(this));
        this._appStateChangedId = this._appSystem.connect('app-state-changed', this._redisplay.bind(this));
        this._installedChangedId = this._appSystem.connect('installed-changed', this._redisplay.bind(this));
        
        this.connect('destroy', this._onDestroy.bind(this));

        this._updateStyle();
        this._redisplay();
    }

    _onSettingsChanged(settings, key) {
        if (key === 'app-groups' || key === 'enable-groups' || key === 'show-ungrouped') {
            this._loadGroups();
        }
        
        // Trigger redisplay for scale-factor changes or other display settings
        if (key === 'scale-factor' || key === 'icon-size' || key === 'columns' || 
            key === 'group-header-size' || key === 'group-spacing') {
            // Log scale factor change for debugging
            if (key === 'scale-factor') {
                const newScale = this._settings.get_double('scale-factor');
                log(`[Multi-Column Dock] Scale factor changed to: ${newScale === 0 ? 'Auto' : newScale}`);
            }
        }
        
        this._redisplay();
        
        if (key === 'background-color' || key === 'background-opacity' || key === 'corner-radius') {
            this._updateStyle();
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

        const { r, g, b } = parseHexColor(hex);
        
        // Scale the corner radius
        const scaleFactor = this._scaleManager.getScaleFactor();
        const scaledRadius = Math.round(radius * scaleFactor);

        this.set_style(`
            background-color: rgba(${r}, ${g}, ${b}, ${opacity});
            border-radius: 0 ${scaledRadius}px ${scaledRadius}px 0;
        `);
    }

    _onDestroy() {
        if (badgeManager && this._badgeListener) {
            badgeManager.removeListener(this._badgeListener);
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
    }

    _onBadgeUpdate(appId) {
        let entry = this._iconBadges.get(appId);
        if (entry) {
            this._updateBadge(entry.icon, entry.badge, appId);
        }
    }

    _updateBadge(icon, badge, appId) {
        let badgeInfo = badgeManager ? badgeManager.getBadge(appId) : null;
        
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
        // Clear existing children
        this._mainContainer.destroy_all_children();
        this._groupContainers.clear();
        this._iconBadges.clear();

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
        const iconPadding = Math.max(15, Math.round(iconSize * 0.30));
        const totalIconSize = iconSize + iconPadding;
        
        // Additional spacing between cells in the grid
        const cellSpacing = 0;

        // Store metrics so DND uses the exact same numbers everywhere
        this._layoutMetrics = { columns, iconSize, totalIconSize, cellSpacing };
        
        // Calculate dock width with generous buffer
        let totalWidth;
        if (enableGroups) {
            // Add space for group margins (2px each side) and borders (1-2px each side)
            // Plus extra buffer to prevent right-side cutoff
            const groupMargin = 4; // 2px margin on each side
            const groupBorder = 4; // border allowance
            const safetyBuffer = 16; // Extra space for scrollbars/rendering quirks
            totalWidth = (totalIconSize * columns) + (cellSpacing * Math.max(0, columns - 1)) + groupMargin + groupBorder + safetyBuffer;
        } else {
            totalWidth = (totalIconSize * columns) + (cellSpacing * Math.max(0, columns - 1)) + 16;
        }
        
        this.set_width(totalWidth);

        // Size Show Apps button
        if (this._showAppsButton) {
            this._showAppsButton.set_size(totalIconSize, totalIconSize);
            this._showAppsButton.set_style(`border: none; box-shadow: none; padding: 2px; margin: 4px auto 6px auto;`);
        }
        if (this._showAppsIcon && typeof this._showAppsIcon.set_icon_size === 'function') {
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
        // Create the legacy grid
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

        // Render each visible group
        for (let group of this._groups) {
            if (!group || group.hidden || group.id === UNGROUPED_ORDER_ID)
                continue;
            let groupApps = [];
            
            if (group.apps && group.apps.length > 0) {
                for (let appId of group.apps) {
                    let app = appMap.get(appId);
                    if (app) {
                        groupApps.push(app);
                        assignedApps.add(appId);
                    }
                }
            }

            // Only render group if it has apps or is explicitly shown
            if (groupApps.length > 0 || group.showEmpty) {
                let groupContainer = new GroupContainer(group, this._settings, this, this._scaleManager);
                this._groupContainers.set(group.id, groupContainer);

                // Add spacing between groups
                groupContainer.set_style(groupContainer.get_style() + ` margin-bottom: ${scaledGroupSpacing}px;`);

                // Populate the group's grid
                if (!groupContainer.isCollapsed()) {
                    let grid = groupContainer.getGrid();
                    let layout = grid.layout_manager;
                    // Provide spacing via the grid, not via oversized AppIcon actors.
                    if (typeof layout.set_column_spacing === 'function')
                        layout.set_column_spacing(cellSpacing);
                    else
                        layout.column_spacing = cellSpacing;
                    if (typeof layout.set_row_spacing === 'function')
                        layout.set_row_spacing(cellSpacing);
                    else
                        layout.row_spacing = cellSpacing;
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

        // Render ungrouped apps (if enabled)
        if (showUngrouped) {
            let ungroupedApps = apps.filter(app => !assignedApps.has(app.get_id()));
            
            if (ungroupedApps.length > 0) {
                // Apply persistent ordering for ungrouped apps
                const orderGroup = this._groups.find(g => g && g.id === UNGROUPED_ORDER_ID);
                const order = Array.isArray(orderGroup?.apps) ? orderGroup.apps : [];
                const ungroupedMap = new Map(ungroupedApps.map(a => [a.get_id(), a]));
                const orderedUngrouped = [];
                for (const id of order) {
                    const app = ungroupedMap.get(id);
                    if (app) {
                        orderedUngrouped.push(app);
                        ungroupedMap.delete(id);
                    }
                }
                // Append any remaining untracked apps
                orderedUngrouped.push(...ungroupedMap.values());

                // Create an "Other" group container
                let otherGroup = {
                    id: 'ungrouped',
                    name: 'Other',
                    color: '#333333',
                    borderColor: '#555555',
                    borderWidth: 1,
                    opacity: 0.6,
                    collapsed: false,
                    apps: orderedUngrouped.map(app => app.get_id()),
                };

                let groupContainer = new GroupContainer(otherGroup, this._settings, this, this._scaleManager);
                this._groupContainers.set('ungrouped', groupContainer);

                let grid = groupContainer.getGrid();
                let layout = grid.layout_manager;
                if (typeof layout.set_column_spacing === 'function')
                    layout.set_column_spacing(cellSpacing);
                else
                    layout.column_spacing = cellSpacing;
                if (typeof layout.set_row_spacing === 'function')
                    layout.set_row_spacing(cellSpacing);
                else
                    layout.row_spacing = cellSpacing;
                layout.set_column_homogeneous(true);
                layout.set_row_homogeneous(true);

                let col = 0;
                let row = 0;

                orderedUngrouped.forEach(app => {
                    let icon = this._createAppIcon(app, iconSize, totalIconSize);
                    layout.attach(icon, col, row, 1, 1);

                    col++;
                    if (col >= columns) {
                        col = 0;
                        row++;
                    }
                });

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
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                dragStarted = false;
                return GLib.SOURCE_REMOVE;
            });
        });

        wrapper.connect('button-press-event', (actor, event) => {
            if (event.get_button() === 1) {
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
            
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
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
        this._updateBadge(wrapper, badge, appId);

        return wrapper;
    }

    _activateApp(app) {
        let windows = app.get_windows();
        
        if (windows.length === 0) {
            app.open_new_window(-1);
            Main.overview.hide();
            return;
        }

        let workspace = global.workspace_manager.get_active_workspace();
        let currentWindows = windows.filter(w => !w.skip_taskbar);
        
        if (currentWindows.length === 0) {
            app.open_new_window(-1);
            Main.overview.hide();
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

    _showTooltip(actor, text) {
        this._tooltip.set_text(text);
        this._tooltip.show();

        const [, natW] = this._tooltip.get_preferred_width(-1);
        const [, natH] = this._tooltip.get_preferred_height(-1);

        let [x, y] = actor.get_transformed_position();
        let [w, h] = actor.get_transformed_size();
        
        // Small offset for tooltip
        const offset = 8;
        let tooltipX = Math.round(x + w + offset);
        let tooltipY = Math.round(y + (h / 2) - (natH / 2));

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

    destroy() {
        if (this._tooltip) {
            Main.layoutManager.uiGroup.remove_child(this._tooltip);
            this._tooltip.destroy();
            this._tooltip = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
        }
        if (this._favoritesChangedId) {
            this._appFavorites.disconnect(this._favoritesChangedId);
        }
        super.destroy();
    }
});

export default class TwoColumnDockExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._docks = [];
        
        // Initialize badge manager
        badgeManager = new BadgeManager();
        
        this._createDocks();
        
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._createDocks.bind(this));
        this._settings.connect('changed::show-on-all-monitors', this._createDocks.bind(this));

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
        let monitors = Main.layoutManager.monitors;

        monitors.forEach((monitor, index) => {
            if (!showOnAll && index !== Main.layoutManager.primaryIndex) return;

            let dock = new DockView(this._settings, index);
            
            Main.layoutManager.addChrome(dock, {
                affectsInputRegion: true,
                trackFullscreen: true,
                affectsStruts: true, 
            });
            
            this._updateDockPosition(dock, monitor);
            this._docks.push(dock);
        });
    }

    _updateDockPosition(dock, monitor) {
        let yOffset = 0;
        if (monitor.index === Main.layoutManager.primaryIndex) {
            yOffset = Main.panel.height;
        }

        dock.set_position(monitor.x, monitor.y + yOffset);
        dock.set_height(monitor.height - yOffset);
    }

    disable() {
        if (this._globalKeyPressId) {
            global.stage.disconnect(this._globalKeyPressId);
            this._globalKeyPressId = 0;
        }

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
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
