import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { AppIcon } from 'resource:///org/gnome/shell/ui/appDisplay.js';

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

        // Container for icons
        this._grid = new St.Widget({
            layout_manager: new Clutter.GridLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                column_spacing: 0,
                row_spacing: 0,
            }),
            style_class: 'dock-grid',
        });

        // Anchor the grid to the top-left; prevent it from expanding
        // (If it expands to full height, the icon cluster can appear centered.)
        this._grid.set_x_align(Clutter.ActorAlign.START);
        this._grid.set_y_align(Clutter.ActorAlign.START);
        this._grid.set_x_expand(false);
        this._grid.set_y_expand(false);
        
        // Add some padding/styling
        // Removed background-color from here to apply custom styling
        this._grid.set_style('padding: 2px;');

        // Container for the grid inside ScrollView (BoxLayout is more compatible)
        this._scrollContent = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: false,
        });
        this._scrollContent.add_child(this._grid);

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

        // Show Apps button (sits at the bottom of the screen)
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
                // If overview is visible, check if we are already in the apps view
                // We can check the dash's showAppsButton state if available
                let dash = Main.overview.dash;
                let inAppGrid = false;
                
                if (dash) {
                    if (dash.showAppsButton && dash.showAppsButton.checked) {
                        inAppGrid = true;
                    } else if (dash._showAppsIcon && dash._showAppsIcon.checked) {
                        inAppGrid = true;
                    }
                }
                
                // If we are in app grid, close to desktop
                if (inAppGrid) {
                    Main.overview.hide();
                } else {
                    // If we are in window picker (or unknown), switch to apps
                    // But if we can't detect, we might just hide. 
                    // Let's assume if visible, we want to toggle OFF if we are likely in apps.
                    // If we are in window picker, showApps() usually switches to apps.
                    
                    // Try to switch to apps
                    if (Main.overview.showApps) {
                        Main.overview.showApps();
                    } else if (Main.overview.dash && Main.overview.dash.showApps) {
                        Main.overview.dash.showApps();
                    } else {
                        Main.overview.hide();
                    }
                    
                    // If we were already in app grid and detection failed, showApps() might do nothing.
                    // In that case, we should have hidden. 
                    // But without reliable detection, this is the best effort.
                }
            } else {
                // Not visible, show apps
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

        // Position on screen (Left side, below top panel)
        const monitor = Main.layoutManager.primaryMonitor;
        const panelHeight = Main.panel.height;
        
        this.set_position(monitor.x, monitor.y + panelHeight);
        this.set_height(monitor.height - panelHeight); 

        // Connect settings
        this._settingsChangedId = this._settings.connect('changed', this._redisplay.bind(this));
        this._favoritesChangedId = this._appFavorites.connect('changed', this._redisplay.bind(this));
        this._appStateChangedId = this._appSystem.connect('app-state-changed', this._redisplay.bind(this));
        this._installedChangedId = this._appSystem.connect('installed-changed', this._redisplay.bind(this));
        
        this.connect('destroy', this._onDestroy.bind(this));
        
        // Connect style settings
        this._settings.connect('changed::background-color', this._updateStyle.bind(this));
        this._settings.connect('changed::background-opacity', this._updateStyle.bind(this));
        this._settings.connect('changed::corner-radius', this._updateStyle.bind(this));

        this._updateStyle();
        this._redisplay();
    }

    _updateStyle() {
        let hex = this._settings.get_string('background-color');
        let opacity = this._settings.get_double('background-opacity');
        let radius = this._settings.get_int('corner-radius');

        // Basic hex parsing
        let r = 30, g = 30, b = 30; // Default fallback
        if (hex && hex.match(/^#[0-9a-fA-F]{6}$/)) {
            r = parseInt(hex.substring(1, 3), 16);
            g = parseInt(hex.substring(3, 5), 16);
            b = parseInt(hex.substring(5, 7), 16);
        }

        this.set_style(`
            background-color: rgba(${r}, ${g}, ${b}, ${opacity});
            border-radius: 0 ${radius}px ${radius}px 0;
        `);
    }

    _onDestroy() {
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

    _redisplay() {
        // Clear existing children
        this._grid.destroy_all_children();

        const columns = this._settings.get_int('columns');
        const iconSize = this._settings.get_int('icon-size');
        
        // 1. Get lists
        const favorites = this._appFavorites.getFavorites();
        const running = this._appSystem.get_running();

        // 2. Merge and Deduplicate
        // Use app ID for deduplication as object references might differ
        const seenIds = new Set();
        const apps = [];

        // Add favorites first
        favorites.forEach(app => {
            let id = app.get_id();
            if (!seenIds.has(id)) {
                apps.push(app);
                seenIds.add(id);
            }
        });

        // Add running apps not in favorites
        running.forEach(app => {
            let id = app.get_id();
            if (!seenIds.has(id)) {
                apps.push(app);
                seenIds.add(id);
            }
        });

        const layout = this._grid.layout_manager;
        
        // Reset layout
        layout.set_column_homogeneous(true);
        layout.set_row_homogeneous(true);

        // Calculate and set fixed width for the dock to ensure compact square icons
        // iconSize is the inner icon size. The button usually adds padding.
        // Standard app icon padding is often around 12px total (6px each side)
        const itemPadding = 12; 
        const totalIconSize = iconSize + itemPadding;
        const dockPadding = 4; // Container padding
        const totalWidth = (totalIconSize * columns) + (dockPadding * 2);
        
        this.set_width(totalWidth);

        // Size and style the Show Apps button to match icons
        if (this._showAppsButton) {
            this._showAppsButton.set_size(totalIconSize, totalIconSize);
            this._showAppsButton.set_style('border: none; box-shadow: none; padding: 6px; margin: 6px auto 8px auto;');
        }
        if (this._showAppsIcon && typeof this._showAppsIcon.set_icon_size === 'function') {
            this._showAppsIcon.set_icon_size(iconSize);
        }

        let col = 0;
        let row = 0;

        apps.forEach(app => {
            let icon = new AppIcon(app, {
                setSizeManually: true,
                showLabel: false,
            });
            
            // Set size on the internal BaseIcon
            if (icon.icon && typeof icon.icon.setIconSize === 'function') {
                icon.icon.setIconSize(iconSize);
            }

            // Force transparency and remove default styling on the button
            // We allow hover via CSS now, so we don't force background-color: transparent in inline style
            icon.set_style('border: none; box-shadow: none; padding: 6px; margin: 0;');
            
            // Force the icon widget to be square
            icon.set_size(totalIconSize, totalIconSize);
            icon.set_x_align(Clutter.ActorAlign.CENTER);
            icon.set_y_align(Clutter.ActorAlign.CENTER);

            // Override the default activate behavior to properly handle minimized windows
            icon.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) { // Left click
                    this._activateApp(app);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // Tooltip logic (use enter/leave for reliability)
            icon.connect('enter-event', () => {
                this._showTooltip(icon, app.get_name());
            });
            icon.connect('leave-event', () => {
                this._hideTooltip();
            });
            // Fallback for hover notify (some themes/actors may not emit enter-event)
            icon.connect('notify::hover', () => {
                if (icon.hover) {
                    this._showTooltip(icon, app.get_name());
                } else {
                    this._hideTooltip();
                }
            });

            // Add to grid
            layout.attach(icon, col, row, 1, 1);

            col++;
            if (col >= columns) {
                col = 0;
                row++;
            }
        });
        
        // Add a separator line between columns if we have more than 1 column
        // This is tricky with GridLayout. We might need to use CSS border on the items or a background image.
        // A simpler way is to style the grid to have a gap and a background that looks like a separator.
        // Or we can add a St.Widget as a separator line in the layout, but that messes up the grid indexing.
        
        // Let's try CSS styling for the separator look.
        // We will add a style class to the dock container.
        this.add_style_class_name('two-column-dock-container');
        
        // Adjust width based on columns and icon size
        // Simple estimation: iconSize * columns + padding
        // Ideally we let the layout handle it, but for a dock we might want fixed width
        
        // Force a redraw of the separator if we implement it via drawing
        this.queue_relayout();
    }

    // (Removed duplicate _redisplay() implementation)

    _activateApp(app) {
        // Get all windows for this app
        let windows = app.get_windows();
        
        if (windows.length === 0) {
            // No windows, open a new one
            app.open_new_window(-1);
            Main.overview.hide();
            return;
        }

        // Find the most recently used window
        let workspace = global.workspace_manager.get_active_workspace();
        let currentWindows = windows.filter(w => !w.skip_taskbar);
        
        if (currentWindows.length === 0) {
            app.open_new_window(-1);
            Main.overview.hide();
            return;
        }

        // Sort windows by user time (most recent first)
        currentWindows.sort((a, b) => b.get_user_time() - a.get_user_time());
        let mostRecentWindow = currentWindows[0];

        // Check if the window is minimized
        if (mostRecentWindow.minimized) {
            // Unminimize and activate the window
            mostRecentWindow.unminimize();
            mostRecentWindow.activate(global.get_current_time());
        } else if (mostRecentWindow.has_focus()) {
            // If focused, minimize it
            mostRecentWindow.minimize();
        } else {
            // Otherwise, just activate it
            mostRecentWindow.activate(global.get_current_time());
        }
        
        Main.overview.hide();
    }

    _showTooltip(actor, text) {
        this._tooltip.set_text(text);
        this._tooltip.show();

        // Ensure size is calculated
        const [, natW] = this._tooltip.get_preferred_width(-1);
        const [, natH] = this._tooltip.get_preferred_height(-1);

        // Get absolute coordinates of the icon
        let [x, y] = actor.get_transformed_position();
        let [w, h] = actor.get_transformed_size();
        
        // Position to the right of the icon
        let tooltipX = Math.round(x + w + 10);
        let tooltipY = Math.round(y + (h / 2) - (natH / 2));

        this._tooltip.set_position(tooltipX, tooltipY);
    }

    _hideTooltip() {
        this._tooltip.hide();
    }

    vfunc_allocate(box) {
        super.vfunc_allocate(box);
        // Custom drawing for the separator line could go here or in vfunc_paint
    }

    vfunc_paint(paintContext) {
        // Chain up first to paint background (from CSS/set_style) and children
        super.vfunc_paint(paintContext);

        let width = this.get_width();
        let height = this.get_height();
        let columns = this._settings.get_int('columns');

        // Draw separator line between columns
        if (columns >= 2) {
            let cr = paintContext.get_cairo_context();
            let colWidth = width / columns;
            
            // Draw a subtle separator line
            cr.setSourceRGBA(1, 1, 1, 0.15); 
            cr.setLineWidth(1);
            
            for (let i = 1; i < columns; i++) {
                let x = Math.floor(colWidth * i);
                // Draw line
                cr.moveTo(x, 0);
                cr.lineTo(x, height);
                cr.stroke();
            }
        }
    }

    handleDragOver(source, actor, x, y, time) {
        if (source instanceof AppIcon) {
            return DND.DragMotionResult.MOVE_DROP;
        }
        return DND.DragMotionResult.NO_DROP;
    }

    acceptDrop(source, actor, x, y, time) {
        if (source instanceof AppIcon) {
            let app = source.app;
            if (!app) return false;
            
            let id = app.get_id();
            
            // Calculate index
            const columns = this._settings.get_int('columns');
            const iconSize = this._settings.get_int('icon-size');
            const itemPadding = 12; 
            const totalIconSize = iconSize + itemPadding;
            
            let col = Math.floor(x / totalIconSize);
            let row = Math.floor(y / totalIconSize);
            
            // Clamp col
            if (col >= columns) col = columns - 1;
            if (col < 0) col = 0;
            if (row < 0) row = 0;
            
            let index = row * columns + col;
            
            // Move it
            AppFavorites.getAppFavorites().moveFavoriteToPos(id, index);
            
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
        
        this._createDocks();
        
        // Monitor changes to update position if resolution changes
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._createDocks.bind(this));
        this._settings.connect('changed::show-on-all-monitors', this._createDocks.bind(this));

        // Hide original dash (simple hack)
        // Note: This might conflict if Ubuntu Dock is very aggressive, but standard Dash will hide.
        this._originalDash = Main.overview.dash;
        if (this._originalDash) {
             this._originalDash.hide();
             // Also try to hide the parent container if it's the Ubuntu Dock
             if (this._originalDash.get_parent() && this._originalDash.get_parent().has_style_class_name('dock-container')) {
                 this._originalDash.get_parent().hide();
             }
        }

        // Monkey-patch the overview to skip the window picker when pressing Escape from the app grid
        // This is a bit invasive but necessary to change the Escape behavior
        this._originalShowApps = Main.overview.showApps;
        this._originalHide = Main.overview.hide;
        
        // We can try to intercept the 'hiding' signal or modify the view selector behavior if possible.
        // A safer approach for "Escape" specifically is to look at how the view selector handles it.
        // In GNOME 40+, the Overview controls the state transition.
        
        // Let's try to inject a key press handler or modify the state adjustment?
        // Actually, the simplest way might be to just listen to the 'hidden' signal of the app grid?
        // No, that's too late.
        
        // Let's try to override the 'hide' method of the overview to force a full exit if we are in app grid?
        // But 'hide' is called when we want to exit completely.
        
        // The issue is that Escape in App Grid triggers "showWindowPicker" (or similar) instead of "hide".
        // We need to find where that transition happens.
        // It is usually in `js/ui/overview.js` or `js/ui/viewSelector.js` (older) or `js/ui/overviewControls.js`.
        
        // Since we can't easily patch core files safely across versions, let's try a global key listener
        // that intercepts Escape when the overview is visible and in App Grid mode.
        
        this._globalKeyPressId = global.stage.connect('key-press-event', (actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Escape && Main.overview.visible) {
                // Check if we are in App Grid
                let dash = Main.overview.dash;
                let inAppGrid = false;
                if (dash) {
                    if (dash.showAppsButton && dash.showAppsButton.checked) inAppGrid = true;
                    else if (dash._showAppsIcon && dash._showAppsIcon.checked) inAppGrid = true;
                }
                
                if (inAppGrid) {
                    // Force close overview completely
                    Main.overview.hide();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _createDocks() {
        // Destroy existing docks
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
            // If not showing on all, only show on primary
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
        const panelHeight = Main.panel.height; // Assuming panel is on all monitors or just primary? 
        // Main.panel is usually only on primary unless multi-monitor extension is used.
        // But let's assume we want to avoid the top area regardless.
        
        // Check if this monitor has a panel? 
        // For simplicity, we assume panel is at top of monitor 0.
        // If monitor.y == 0, add panel height.
        
        let yOffset = 0;
        if (monitor.index === Main.layoutManager.primaryIndex) {
            yOffset = Main.panel.height;
        }

        dock.set_position(monitor.x, monitor.y + yOffset);
        dock.set_height(monitor.height - yOffset);
        
        // Anchor the grid to the top-left (child alignment, not layout alignment)
        dock._grid.set_x_align(Clutter.ActorAlign.START);
        dock._grid.set_y_align(Clutter.ActorAlign.START);
        dock._grid.set_x_expand(false);
        dock._grid.set_y_expand(false);
    }

    _updatePosition() {
        // Deprecated, logic moved to _createDocks and _updateDockPosition
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
