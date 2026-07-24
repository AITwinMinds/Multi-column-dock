# Multi-Column Dock

<div align="center">
  <img src="icon.png" alt="Multi-Column Dock Icon" width="128" height="128"/>
  
  <h3>A powerful, customizable multi-column dock extension for GNOME Shell</h3>
  
  <p>
    <img src="https://img.shields.io/badge/GNOME_Shell-45%2B-blue?style=flat-square&logo=gnome" alt="GNOME Shell"/>
    <img src="https://img.shields.io/badge/License-GPL--3.0-green?style=flat-square" alt="License"/>
  </p>
  
  <h3>
    <a href="DONATE.md">
      <img src="https://img.shields.io/badge/💙_Support_Development-Donate_Now-ff69b4?style=for-the-badge&labelColor=6e5494" alt="Donate Now"/>
    </a>
  </h3>
  
  <p><i>Bringing a modern and efficient app launcher experience to your desktop with app grouping, auto-hide, and extensive customization options.</i></p>
</div>

---

<img width="1070" height="1080" alt="Multi_column_deck" src="https://github.com/user-attachments/assets/b6061746-f4f7-4b3f-82a4-f36fef401de8" />

## ✨ Features

### Core Features
- **Multi-Column Layout** – Organize your favorite apps in a configurable grid with 1-5 columns
- **Dock Position** – Place the dock on the left or right side of your screen
- **Smooth Scrolling** – Seamlessly scroll through all your apps when you have many pinned
- **Running App Indicators** – Visual dots showing which applications are currently running
- **Drag & Drop Support** – Reorder your favorite apps with intuitive drag and drop
- **Multi-Monitor Support** – Option to display the dock on all connected monitors
- **Notification Badges** – See app notification counts (Unity API compatible)

### App Grouping
- **Custom Groups** – Organize apps into named, color-coded groups
- **Collapsible Groups** – Click group headers to collapse/expand
- **Per-Group Styling** – Customize each group's background color, border, and opacity
- **Ungrouped Apps Section** – Apps not in groups appear in a separate "Other" section
- **Drag & Drop Between Groups** – Move apps between groups easily

### Auto-Hide
- **Smart Auto-Hide** – Dock hides automatically when not in use
- **Hot Zone Activation** – Move mouse to screen edge to reveal the dock
- **Configurable Delays** – Set custom show/hide delay timings
- **Adjustable Hot Zone Size** – Control the trigger area size

### Customization
- **Icon Size** – Adjust icon size from 16px to 128px
- **Icon Padding** – Fine-tune spacing around icons
- **Background Color & Opacity** – Full control over dock appearance
- **Corner Radius** – Customize dock and group corner roundness
- **Group Header Size** – Adjust the height of group labels
- **Group Spacing** – Control spacing between groups
- **HiDPI Support** – Manual scale factor override for high-resolution displays

### Additional Features
- **Integrated Show Apps Button** – Quick access to the GNOME app grid
- **Tooltips** – Hover over icons to see app names
- **Right-Click Menus** – Access app actions, pin/unpin, and quit options
- **Favorites Integration** – Syncs with GNOME favorites

## 📸 Screenshots

<img width="1068" height="1080" alt="Dock with groups" src="https://github.com/user-attachments/assets/8ce7dc99-a030-4070-afd8-90b80b30b0a3" />
<img width="1086" height="1078" alt="Dock customization" src="https://github.com/user-attachments/assets/033e3703-c121-401d-9c59-224b2042cce5" />

## 📦 Installation

### From GNOME Extensions Website
Visit [GNOME Extensions](https://extensions.gnome.org/) and search for "Multi-Column Dock".

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/AITwinMinds/Multi-column-dock.git
   cd Multi-column-dock
   ```

2. Run the install script:
   ```bash
   ./install.sh
   ```

3. Enable the extension:
   ```bash
   gnome-extensions enable AITwinMinds@gmail.com
   ```

4. Restart GNOME Shell:
   - **X11**: Press `Alt+F2`, type `r`, press `Enter`
   - **Wayland**: Log out and log back in

### Manual Installation

1. Copy the extension files to your GNOME extensions directory:
   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions/AITwinMinds@gmail.com
   cp -r * ~/.local/share/gnome-shell/extensions/AITwinMinds@gmail.com/
   ```

2. Compile the schemas:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/AITwinMinds@gmail.com/schemas/
   ```

3. Restart GNOME Shell and enable the extension.

## ⚙️ Configuration

Open the extension preferences to customize all settings:

### Appearance Settings
| Setting | Description | Default |
|---------|-------------|---------|
| Dock Position | Left or Right side of screen | Left |
| Columns | Number of icon columns (1-5) | 2 |
| Icon Size | Size of app icons in pixels | 48px |
| Icon Padding | Spacing around icons | 15px base |
| Background Color | Dock background color | #1e1e1e |
| Background Opacity | Transparency level (0-1) | 0.95 |
| Corner Radius | Dock corner roundness | 0 |

<img width="668" height="898" alt="image" src="https://github.com/user-attachments/assets/45942203-fa49-4d58-a99f-feea2a472647" />

### Auto-Hide Settings
| Setting | Description | Default |
|---------|-------------|---------|
| Auto-Hide | Enable automatic hiding | Off |
| Hide Delay | Ms before dock hides | 300ms |
| Show Delay | Ms before dock appears | 100ms |
| Hot Zone Size | Trigger area in pixels | 5px |

### Group Settings
| Setting | Description | Default |
|---------|-------------|---------|
| Enable Groups | Turn on app grouping | Off |
| Group Header Size | Height of group labels | 24px |
| Group Spacing | Space between groups | 8px |
| Group Corner Radius | Group border roundness | 6 |
| Show Ungrouped | Show "Other" section | On |

<img width="668" height="898" alt="image" src="https://github.com/user-attachments/assets/6a192aaa-f8a6-40ed-9e67-0960e40d8319" />


### Display Settings
| Setting | Description | Default |
|---------|-------------|---------|
| Multi-Monitor | Show dock on all monitors | Off |
| Scale Factor | HiDPI override (0=auto) | Auto |

Access preferences via:
```bash
gnome-extensions prefs AITwinMinds@gmail.com
```

Or through the GNOME Extensions app.

## 🎨 Creating App Groups

1. Open extension preferences
2. Go to the "Groups" tab
3. Click "Add Group" to create a new group
4. Set the group name, colors, and appearance
5. Select which apps belong to this group
6. Enable "Enable Groups" in the Appearance tab

<img width="668" height="898" alt="image" src="https://github.com/user-attachments/assets/dbfcdda9-bc28-40b3-a72e-1d3959720a00" />

Groups can be reordered, collapsed, and styled individually!

## 🖥️ Requirements

- GNOME Shell 45, 46, 47, 48, 49, 50+ (Ubuntu 23.10 to Ubuntu 26.04+)
- GLib 2.0

## 🗑️ Uninstallation

```bash
gnome-extensions disable AITwinMinds@gmail.com
rm -rf ~/.local/share/gnome-shell/extensions/AITwinMinds@gmail.com
```

## 🐛 Troubleshooting

### Dock not appearing
- Ensure the extension is enabled: `gnome-extensions info AITwinMinds@gmail.com`
- Check for errors: `journalctl -f -o cat /usr/bin/gnome-shell`

### Icons too small/large on HiDPI
- Adjust the Scale Factor in preferences (try values between 1.0-2.0)

### Auto-hide not working
- Increase the Hot Zone Size in preferences
- Ensure no other extensions are blocking the screen edge

## 📄 License

This project is licensed under the GPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 💬 Support

- ⭐ Star this repository on [GitHub](https://github.com/AITwinMinds/Multi-column-dock)
- 🐛 Report issues on the [Issues page](https://github.com/AITwinMinds/Multi-column-dock/issues)
- 📧 Contact: [AITwinMinds@gmail.com](mailto:AITwinMinds@gmail.com)

## 🔗 Links

- [GitHub Repository](https://github.com/AITwinMinds/Multi-column-dock)
- [Twitter/X: @AITwinMinds](https://twitter.com/AITwinMinds)
- [YouTube: AITwinMinds](https://www.youtube.com/@AITwinMinds)
- [Telegram: AITwinMinds](https://t.me/AITwinMinds)
