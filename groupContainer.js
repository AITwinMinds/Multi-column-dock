/**
 * Group Container Widget for Multi-Column Dock
 * Visual container for a group of apps with header and collapsible content
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Pango from 'gi://Pango';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import { AppIcon } from 'resource:///org/gnome/shell/ui/appDisplay.js';
import { parseHexColor } from './utils.js';

/**
 * GroupContainer - Visual container for a group of apps
 */
export const GroupContainer = GObject.registerClass(
class GroupContainer extends St.BoxLayout {
    _init(group, settings, dockView, scaleManager, dockPadding) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'dock-group-container',
            x_expand: true,
            y_expand: false,
            reactive: true,
        });

        this._group = group;
        this._settings = settings;
        this._dockView = dockView;
        this._scaleManager = scaleManager;
        this._dockPadding = dockPadding || 0;
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
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'dock-group-content',
            x_expand: true,
        });

        // Apply dock padding inside the group border, around icons
        const dp = this._dockPadding;
        this._contentBox.set_style(`padding: ${dp}px ${dp}px ${dp + endPadding}px ${dp}px; spacing: 0px;`);

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

    /**
     * Get the grid widget for adding icons
     * @returns {St.Widget} The grid widget
     */
    getGrid() {
        return this._grid;
    }

    /**
     * Get the group data
     * @returns {Object} The group object
     */
    getGroup() {
        return this._group;
    }

    /**
     * Check if the group is collapsed
     * @returns {boolean} True if collapsed
     */
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
