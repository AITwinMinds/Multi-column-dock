import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Helper function to generate unique IDs
function generateId() {
    return 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Helper to create color button (compatible with GTK4)
function createColorButton(initialHex) {
    let colorButton;
    try {
        const dialog = new Gtk.ColorDialog();
        colorButton = new Gtk.ColorDialogButton({ dialog });
    } catch (e) {
        colorButton = new Gtk.ColorButton();
    }

    const rgba = new Gdk.RGBA();
    rgba.parse(initialHex || '#333333');
    if (colorButton.set_rgba) {
        colorButton.set_rgba(rgba);
    } else {
        colorButton.rgba = rgba;
    }

    return colorButton;
}

// Helper to get hex color from color button
function getHexFromButton(colorButton) {
    const c = colorButton.rgba;
    return '#' +
        Math.round(c.red * 255).toString(16).padStart(2, '0') +
        Math.round(c.green * 255).toString(16).padStart(2, '0') +
        Math.round(c.blue * 255).toString(16).padStart(2, '0');
}

// Group Editor Dialog
const GroupEditorDialog = GObject.registerClass(
    class GroupEditorDialog extends Adw.Dialog {
        _init(group, installedApps, onSave) {
            super._init({
                title: group ? 'Edit Group' : 'New Group',
                content_width: 550,
                content_height: 700,
            });

            this._group = group ? JSON.parse(JSON.stringify(group)) : {
                id: generateId(),
                name: '',
                color: '#2a2a2a',
                borderColor: '#444444',
                borderWidth: 1,
                opacity: 0.8,
                apps: [],
                collapsed: false,
            };
            this._installedApps = installedApps;
            this._onSave = onSave;
            this._selectedApps = new Set(this._group.apps || []);

            this._buildUI();
        }

        _buildUI() {
            // Header bar with Save/Cancel
            const headerBar = new Adw.HeaderBar();

            const cancelBtn = new Gtk.Button({ label: 'Cancel' });
            cancelBtn.connect('clicked', () => this.close());
            headerBar.pack_start(cancelBtn);

            const saveBtn = new Gtk.Button({
                label: 'Save',
                css_classes: ['suggested-action'],
            });
            saveBtn.connect('clicked', () => this._save());
            headerBar.pack_end(saveBtn);

            // Main content box
            const mainBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 8,
                margin_top: 8,
                margin_bottom: 8,
                margin_start: 12,
                margin_end: 12,
            });

            // ===== Compact Settings Section =====
            const settingsFrame = new Gtk.Frame({
                label: 'Settings',
            });

            const settingsGrid = new Gtk.Grid({
                row_spacing: 6,
                column_spacing: 12,
                margin_top: 8,
                margin_bottom: 8,
                margin_start: 8,
                margin_end: 8,
            });

            // Row 0: Name
            settingsGrid.attach(new Gtk.Label({ label: 'Name:', halign: Gtk.Align.END }), 0, 0, 1, 1);
            this._nameEntry = new Gtk.Entry({
                text: this._group.name,
                placeholder_text: 'e.g., AI Tools',
                hexpand: true,
            });
            settingsGrid.attach(this._nameEntry, 1, 0, 3, 1);

            // Row 1: Background Color, Border Color
            settingsGrid.attach(new Gtk.Label({ label: 'Background:', halign: Gtk.Align.END }), 0, 1, 1, 1);
            this._bgColorButton = createColorButton(this._group.color);
            settingsGrid.attach(this._bgColorButton, 1, 1, 1, 1);

            settingsGrid.attach(new Gtk.Label({ label: 'Border:', halign: Gtk.Align.END }), 2, 1, 1, 1);
            this._borderColorButton = createColorButton(this._group.borderColor);
            settingsGrid.attach(this._borderColorButton, 3, 1, 1, 1);

            // Row 2: Border Width, Opacity
            settingsGrid.attach(new Gtk.Label({ label: 'Border Width:', halign: Gtk.Align.END }), 0, 2, 1, 1);
            this._borderWidthSpin = Gtk.SpinButton.new_with_range(0, 5, 1);
            this._borderWidthSpin.set_value(this._group.borderWidth || 1);
            settingsGrid.attach(this._borderWidthSpin, 1, 2, 1, 1);

            settingsGrid.attach(new Gtk.Label({ label: 'Opacity:', halign: Gtk.Align.END }), 2, 2, 1, 1);
            this._opacitySpin = Gtk.SpinButton.new_with_range(0.0, 1.0, 0.05);
            this._opacitySpin.set_value(this._group.opacity !== undefined ? this._group.opacity : 0.8);
            this._opacitySpin.set_digits(2);
            settingsGrid.attach(this._opacitySpin, 3, 2, 1, 1);

            settingsFrame.set_child(settingsGrid);
            mainBox.append(settingsFrame);

            // ===== Applications Section (takes remaining space) =====
            const appsFrame = new Gtk.Frame({
                label: 'Applications - Select apps for this group',
                vexpand: true,
            });

            const appsBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 4,
                margin_top: 4,
                margin_bottom: 4,
                margin_start: 4,
                margin_end: 4,
            });

            // Search entry for filtering apps
            this._searchEntry = new Gtk.SearchEntry({
                placeholder_text: 'Search applications...',
                hexpand: true,
                margin_start: 4,
                margin_end: 4,
                margin_bottom: 4,
            });
            this._searchEntry.connect('search-changed', () => {
                this._rebuildAppList();
            });
            appsBox.append(this._searchEntry);

            // App list with checkboxes
            this._appListBox = new Gtk.ListBox({
                selection_mode: Gtk.SelectionMode.NONE,
                css_classes: ['boxed-list'],
            });

            // Store app info for rebuilding
            this._sortedApps = [...this._installedApps].sort((a, b) =>
                a.name.localeCompare(b.name)
            );

            // Build initial app list
            this._rebuildAppList();

            // Scrollable app list
            const appScroll = new Gtk.ScrolledWindow({
                vexpand: true,
                hexpand: true,
                hscrollbar_policy: Gtk.PolicyType.NEVER,
                vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            });
            appScroll.set_child(this._appListBox);
            appsBox.append(appScroll);

            appsFrame.set_child(appsBox);
            mainBox.append(appsFrame);

            // Set up the dialog structure
            const toolbarView = new Adw.ToolbarView();
            toolbarView.add_top_bar(headerBar);
            toolbarView.set_content(mainBox);

            this.set_child(toolbarView);

            this.set_child(toolbarView);
        }

        _rebuildAppList() {
            // Clear existing rows
            let child = this._appListBox.get_first_child();
            while (child) {
                let next = child.get_next_sibling();
                this._appListBox.remove(child);
                child = next;
            }

            // Get search query
            const query = this._searchEntry.get_text().toLowerCase().trim();

            // Filter apps by search query
            let filteredApps = this._sortedApps;
            if (query) {
                filteredApps = this._sortedApps.filter(app =>
                    app.name.toLowerCase().includes(query) ||
                    app.id.toLowerCase().includes(query)
                );
            }

            // Sort: selected apps first, then alphabetically
            const sortedFiltered = [...filteredApps].sort((a, b) => {
                const aSelected = this._selectedApps.has(a.id);
                const bSelected = this._selectedApps.has(b.id);

                if (aSelected && !bSelected) return -1;
                if (!aSelected && bSelected) return 1;
                return a.name.localeCompare(b.name);
            });

            // Build app rows
            for (let appInfo of sortedFiltered) {
                const row = new Gtk.Box({
                    orientation: Gtk.Orientation.HORIZONTAL,
                    spacing: 8,
                    margin_top: 4,
                    margin_bottom: 4,
                    margin_start: 8,
                    margin_end: 8,
                });

                // Checkbox first
                const checkbox = new Gtk.CheckButton({
                    active: this._selectedApps.has(appInfo.id),
                });
                checkbox.connect('toggled', () => {
                    if (checkbox.get_active()) {
                        this._selectedApps.add(appInfo.id);
                    } else {
                        this._selectedApps.delete(appInfo.id);
                    }
                    // Rebuild list to move selected items to top
                    this._rebuildAppList();
                });
                row.append(checkbox);

                // App icon
                if (appInfo.icon) {
                    const icon = new Gtk.Image({
                        gicon: appInfo.icon,
                        pixel_size: 24,
                    });
                    row.append(icon);
                }

                // App name
                const label = new Gtk.Label({
                    label: appInfo.name,
                    halign: Gtk.Align.START,
                    hexpand: true,
                });
                row.append(label);

                // Add a visual indicator for selected apps
                if (this._selectedApps.has(appInfo.id)) {
                    const selectedIcon = new Gtk.Image({
                        icon_name: 'emblem-ok-symbolic',
                        pixel_size: 16,
                        css_classes: ['success'],
                    });
                    row.append(selectedIcon);
                }

                this._appListBox.append(row);
            }
        }

        _save() {
            const name = this._nameEntry.get_text().trim();
            if (!name) {
                // Show error - name is required
                this._nameEntry.add_css_class('error');
                return;
            }

            this._group.name = name;
            this._group.color = getHexFromButton(this._bgColorButton);
            this._group.borderColor = getHexFromButton(this._borderColorButton);
            this._group.borderWidth = this._borderWidthSpin.get_value();
            this._group.opacity = this._opacitySpin.get_value();
            this._group.apps = Array.from(this._selectedApps);

            this._onSave(this._group);
            this.close();
        }
    });

export default class MultiColumnDockPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Get installed applications
        const installedApps = this._getInstalledApps();

        // Page 1: Dock Appearance
        const appearancePage = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'preferences-desktop-appearance-symbolic',
        });

        const dockGroup = new Adw.PreferencesGroup({
            title: 'Dock Layout',
            description: 'Configure the dock layout settings.'
        });
        appearancePage.add(dockGroup);

        // Dock Position
        const positionRow = new Adw.ActionRow({
            title: 'Dock Position',
            subtitle: 'Choose where the dock appears on screen'
        });
        const positionCombo = new Gtk.ComboBoxText();
        positionCombo.append('left', 'Left');
        positionCombo.append('right', 'Right');
        positionCombo.set_active_id(settings.get_string('dock-position'));
        positionCombo.connect('changed', () => {
            settings.set_string('dock-position', positionCombo.get_active_id());
        });
        positionCombo.set_valign(Gtk.Align.CENTER);
        positionRow.add_suffix(positionCombo);
        dockGroup.add(positionRow);

        // Columns
        const columnsRow = new Adw.ActionRow({
            title: 'Number of Columns',
            subtitle: 'Number of icon columns in the dock'
        });
        const columnsSpin = Gtk.SpinButton.new_with_range(1, 5, 1);
        settings.bind('columns', columnsSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        columnsRow.add_suffix(columnsSpin);
        dockGroup.add(columnsRow);

        // Icon Size
        const sizeRow = new Adw.ActionRow({ title: 'Icon Size (px)' });
        const sizeSpin = Gtk.SpinButton.new_with_range(16, 128, 4);
        settings.bind('icon-size', sizeSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        sizeRow.add_suffix(sizeSpin);
        dockGroup.add(sizeRow);

        const paddingBaseRow = new Adw.ActionRow({ title: 'Icon Padding Min (px)' });
        const paddingBaseSpin = Gtk.SpinButton.new_with_range(0, 64, 1);
        settings.bind('icon-padding-base', paddingBaseSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        paddingBaseRow.add_suffix(paddingBaseSpin);
        dockGroup.add(paddingBaseRow);

        const paddingScaleRow = new Adw.ActionRow({ title: 'Icon Padding Scale' });
        const paddingScaleSpin = Gtk.SpinButton.new_with_range(0.0, 1.0, 0.05);
        paddingScaleSpin.set_digits(2);
        settings.bind('icon-padding-scale', paddingScaleSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        paddingScaleRow.add_suffix(paddingScaleSpin);
        dockGroup.add(paddingScaleRow);

        // Visual Style Group
        const styleGroup = new Adw.PreferencesGroup({
            title: 'Visual Style',
            description: 'Customize the dock appearance.'
        });
        appearancePage.add(styleGroup);

        // Background Color
        const colorRow = new Adw.ActionRow({ title: 'Background Color' });
        const colorButton = createColorButton(settings.get_string('background-color'));
        colorButton.connect('notify::rgba', () => {
            settings.set_string('background-color', getHexFromButton(colorButton));
        });
        colorRow.add_suffix(colorButton);
        styleGroup.add(colorRow);

        // Opacity
        const opacityRow = new Adw.ActionRow({ title: 'Opacity (0.0 - 1.0)' });
        const opacitySpin = Gtk.SpinButton.new_with_range(0.0, 1.0, 0.05);
        opacitySpin.set_digits(2);
        settings.bind('background-opacity', opacitySpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        opacityRow.add_suffix(opacitySpin);
        styleGroup.add(opacityRow);

        // Corner Radius
        const radiusRow = new Adw.ActionRow({ title: 'Corner Radius' });
        const radiusSpin = Gtk.SpinButton.new_with_range(0, 50, 1);
        settings.bind('corner-radius', radiusSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        radiusRow.add_suffix(radiusSpin);
        styleGroup.add(radiusRow);

        // Multi-monitor
        const monitorGroup = new Adw.PreferencesGroup({
            title: 'Multi-Monitor',
        });
        appearancePage.add(monitorGroup);

        const monitorRow = new Adw.SwitchRow({ title: 'Show on all monitors' });
        settings.bind('show-on-all-monitors', monitorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        monitorGroup.add(monitorRow);

        // Auto-hide Group
        const autoHideGroup = new Adw.PreferencesGroup({
            title: 'Auto-hide',
            description: 'Configure the dock to hide automatically and appear when you move the mouse to the dock edge.'
        });
        appearancePage.add(autoHideGroup);

        const autoHideRow = new Adw.SwitchRow({
            title: 'Auto-hide Dock',
            subtitle: 'Hide the dock and show it when mouse reaches the dock edge'
        });
        settings.bind('auto-hide', autoHideRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        autoHideGroup.add(autoHideRow);

        const hideDelayRow = new Adw.ActionRow({
            title: 'Hide Delay (ms)',
            subtitle: 'Time before dock hides after mouse leaves'
        });
        const hideDelaySpin = Gtk.SpinButton.new_with_range(0, 2000, 50);
        settings.bind('auto-hide-delay', hideDelaySpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        hideDelayRow.add_suffix(hideDelaySpin);
        autoHideGroup.add(hideDelayRow);

        const showDelayRow = new Adw.ActionRow({
            title: 'Show Delay (ms)',
            subtitle: 'Time before dock appears when mouse enters hot zone'
        });
        const showDelaySpin = Gtk.SpinButton.new_with_range(0, 1000, 50);
        settings.bind('show-delay', showDelaySpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        showDelayRow.add_suffix(showDelaySpin);
        autoHideGroup.add(showDelayRow);

        const hotZoneRow = new Adw.ActionRow({
            title: 'Hot Zone Size (px)',
            subtitle: 'Size of the invisible trigger area at the dock edge'
        });
        const hotZoneSpin = Gtk.SpinButton.new_with_range(1, 20, 1);
        settings.bind('hot-zone-size', hotZoneSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        hotZoneRow.add_suffix(hotZoneSpin);
        autoHideGroup.add(hotZoneRow);

        // Display Scaling Group (for HiDPI/4K support)
        const scalingGroup = new Adw.PreferencesGroup({
            title: 'Display Scaling',
            description: 'Configure scaling for HiDPI and 4K displays. Set to 0 for automatic detection.'
        });
        appearancePage.add(scalingGroup);

        const scaleRow = new Adw.ActionRow({
            title: 'Scale Factor',
            subtitle: '0 = Auto, 1.0 = Normal, 1.5-2.0 = 4K displays'
        });
        const scaleSpin = Gtk.SpinButton.new_with_range(0.0, 3.0, 0.1);
        scaleSpin.set_digits(1);
        settings.bind('scale-factor', scaleSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        scaleRow.add_suffix(scaleSpin);
        scalingGroup.add(scaleRow);

        // Add info label about auto scaling
        const scaleInfoRow = new Adw.ActionRow({
            title: 'Auto Detection Info',
            subtitle: 'When set to 0, the dock automatically scales based on your display resolution and GNOME\'s scaling settings.'
        });
        scaleInfoRow.set_activatable(false);
        scalingGroup.add(scaleInfoRow);

        window.add(appearancePage);

        // Page 2: Groups
        const groupsPage = new Adw.PreferencesPage({
            title: 'Groups',
            icon_name: 'folder-symbolic',
        });

        // Enable Groups Toggle
        const enableGroup = new Adw.PreferencesGroup({
            title: 'App Grouping',
            description: 'Organize your dock apps into custom groups with distinct visual styles.'
        });
        groupsPage.add(enableGroup);

        const enableGroupsRow = new Adw.SwitchRow({
            title: 'Enable App Groups',
            subtitle: 'When enabled, apps will be organized into defined groups'
        });
        settings.bind('enable-groups', enableGroupsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        enableGroup.add(enableGroupsRow);

        const showUngroupedRow = new Adw.SwitchRow({
            title: 'Show Ungrouped Apps',
            subtitle: 'Display apps not assigned to any group in an "Other" section'
        });
        settings.bind('show-ungrouped', showUngroupedRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        enableGroup.add(showUngroupedRow);

        // Group Settings
        const groupSettingsGroup = new Adw.PreferencesGroup({
            title: 'Group Display Settings',
        });
        groupsPage.add(groupSettingsGroup);

        const headerSizeRow = new Adw.ActionRow({ title: 'Group Header Size' });
        const headerSizeSpin = Gtk.SpinButton.new_with_range(16, 40, 2);
        settings.bind('group-header-size', headerSizeSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        headerSizeRow.add_suffix(headerSizeSpin);
        groupSettingsGroup.add(headerSizeRow);

        const spacingRow = new Adw.ActionRow({ title: 'Space Between Groups' });
        const spacingSpin = Gtk.SpinButton.new_with_range(0, 24, 2);
        settings.bind('group-spacing', spacingSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        spacingRow.add_suffix(spacingSpin);
        groupSettingsGroup.add(spacingRow);

        const groupRadiusRow = new Adw.ActionRow({ title: 'Group Corner Radius' });
        const groupRadiusSpin = Gtk.SpinButton.new_with_range(0, 50, 1);
        settings.bind('group-corner-radius', groupRadiusSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        groupRadiusRow.add_suffix(groupRadiusSpin);
        groupSettingsGroup.add(groupRadiusRow);

        // Groups List
        const groupsListGroup = new Adw.PreferencesGroup({
            title: 'Defined Groups',
            description: 'Create and manage your app groups. Use buttons to reorder.'
        });
        groupsPage.add(groupsListGroup);

        // Add Group Button
        const addGroupBtn = new Gtk.Button({
            child: new Adw.ButtonContent({
                icon_name: 'list-add-symbolic',
                label: 'Add New Group',
            }),
            css_classes: ['suggested-action'],
        });
        addGroupBtn.connect('clicked', () => {
            this._showGroupEditor(window, null, installedApps, settings, groupsListBox);
        });

        const addBtnBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            halign: Gtk.Align.CENTER,
            margin_top: 8,
            margin_bottom: 8,
        });
        addBtnBox.append(addGroupBtn);

        // Groups ListBox
        const groupsListBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });

        // Populate groups
        this._populateGroupsList(groupsListBox, settings, window, installedApps);

        // Watch for changes
        settings.connect('changed::app-groups', () => {
            this._populateGroupsList(groupsListBox, settings, window, installedApps);
        });

        const groupsFrame = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
        });
        groupsFrame.append(groupsListBox);
        groupsFrame.append(addBtnBox);
        groupsListGroup.add(groupsFrame);

        window.add(groupsPage);
    }

    _getInstalledApps() {
        const apps = [];
        const appSystem = Gio.AppInfo.get_all();

        for (let appInfo of appSystem) {
            if (!appInfo.should_show()) continue;

            apps.push({
                id: appInfo.get_id(),
                name: appInfo.get_display_name(),
                icon: appInfo.get_icon(),
            });
        }

        return apps;
    }

    _populateGroupsList(listBox, settings, window, installedApps) {
        // Clear existing
        let child = listBox.get_first_child();
        while (child) {
            let next = child.get_next_sibling();
            listBox.remove(child);
            child = next;
        }

        let groups = [];
        try {
            groups = JSON.parse(settings.get_string('app-groups')) || [];
        } catch (e) {
            groups = [];
        }

        // Hide internal/system groups (used for ordering/metadata)
        groups = groups.filter(g => !(g && g.hidden));

        if (groups.length === 0) {
            const emptyRow = new Adw.ActionRow({
                title: 'No groups defined',
                subtitle: 'Click "Add New Group" to create your first group',
            });
            emptyRow.add_prefix(new Gtk.Image({
                icon_name: 'folder-new-symbolic',
                pixel_size: 32,
            }));
            listBox.append(emptyRow);
            return;
        }

        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const row = new Adw.ActionRow({
                title: group.name || 'Unnamed Group',
                subtitle: `${(group.apps || []).length} apps`,
            });

            // Color indicator
            const colorBox = new Gtk.DrawingArea({
                content_width: 24,
                content_height: 24,
            });
            colorBox.set_draw_func((area, cr, width, height) => {
                const { r, g, b } = this._parseHexColor(group.color || '#333333');
                cr.setSourceRGB(r / 255, g / 255, b / 255);
                cr.arc(width / 2, height / 2, 10, 0, 2 * Math.PI);
                cr.fill();

                // Border
                const border = this._parseHexColor(group.borderColor || '#444444');
                cr.setSourceRGB(border.r / 255, border.g / 255, border.b / 255);
                cr.setLineWidth(2);
                cr.arc(width / 2, height / 2, 10, 0, 2 * Math.PI);
                cr.stroke();
            });
            row.add_prefix(colorBox);

            // Edit button
            const editBtn = new Gtk.Button({
                icon_name: 'document-edit-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                tooltip_text: 'Edit group',
            });
            editBtn.connect('clicked', () => {
                this._showGroupEditor(window, group, installedApps, settings, listBox);
            });
            row.add_suffix(editBtn);

            // Move up button - always show, disable when at top
            const upBtn = new Gtk.Button({
                icon_name: 'go-up-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                tooltip_text: 'Move up',
                sensitive: i > 0,
            });
            upBtn.connect('clicked', () => {
                this._moveGroup(settings, group.id, -1, listBox, window, installedApps);
            });
            row.add_suffix(upBtn);

            // Move down button - always show, disable when at bottom
            const downBtn = new Gtk.Button({
                icon_name: 'go-down-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                tooltip_text: 'Move down',
                sensitive: i < groups.length - 1,
            });
            downBtn.connect('clicked', () => {
                this._moveGroup(settings, group.id, 1, listBox, window, installedApps);
            });
            row.add_suffix(downBtn);

            // Delete button
            const deleteBtn = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'destructive-action'],
                tooltip_text: 'Delete group',
            });
            deleteBtn.connect('clicked', () => {
                this._deleteGroup(settings, group.id, listBox, window, installedApps);
            });
            row.add_suffix(deleteBtn);

            listBox.append(row);
        }
    }

    _showGroupEditor(window, group, installedApps, settings, listBox) {
        const dialog = new GroupEditorDialog(group, installedApps, (savedGroup) => {
            let groups = [];
            try {
                groups = JSON.parse(settings.get_string('app-groups')) || [];
            } catch (e) {
                groups = [];
            }

            if (group) {
                // Update existing
                const idx = groups.findIndex(g => g.id === savedGroup.id);
                if (idx >= 0) {
                    groups[idx] = savedGroup;
                }
            } else {
                // Add new
                groups.push(savedGroup);
            }

            settings.set_string('app-groups', JSON.stringify(groups));
            this._populateGroupsList(listBox, settings, window, installedApps);
        });

        dialog.present(window);
    }

    _moveGroup(settings, groupId, direction, listBox, window, installedApps) {
        let groups = [];
        try {
            groups = JSON.parse(settings.get_string('app-groups')) || [];
        } catch (e) {
            return;
        }

        // Find the actual index of the group by ID (works with filtered lists)
        const index = groups.findIndex(g => g.id === groupId);
        if (index < 0) return;

        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= groups.length) return;

        // Swap
        [groups[index], groups[newIndex]] = [groups[newIndex], groups[index]];
        settings.set_string('app-groups', JSON.stringify(groups));
        this._populateGroupsList(listBox, settings, window, installedApps);
    }

    _deleteGroup(settings, groupId, listBox, window, installedApps) {
        let groups = [];
        try {
            groups = JSON.parse(settings.get_string('app-groups')) || [];
        } catch (e) {
            return;
        }

        groups = groups.filter(g => g.id !== groupId);
        settings.set_string('app-groups', JSON.stringify(groups));
        this._populateGroupsList(listBox, settings, window, installedApps);
    }

    _parseHexColor(hex) {
        let r = 51, g = 51, b = 51;
        if (hex && hex.match(/^#[0-9a-fA-F]{6}$/)) {
            r = parseInt(hex.substring(1, 3), 16);
            g = parseInt(hex.substring(3, 5), 16);
            b = parseInt(hex.substring(5, 7), 16);
        }
        return { r, g, b };
    }
}
