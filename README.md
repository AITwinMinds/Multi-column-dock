# Multi-Column Dock

A sleek, customizable multi-column dock extension for GNOME Shell that brings a modern and efficient app launcher experience to your desktop.

![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-45%2B-blue?style=flat-square&logo=gnome)
![License](https://img.shields.io/badge/License-GPL--3.0-green?style=flat-square)

## ✨ Features

- **Multi-Column Layout** – Organize your favorite apps in a configurable grid with 1-4 columns
- **Smooth Scrolling** – Seamlessly scroll through all your apps when you have many pinned
- **Customizable Appearance** – Adjust background color, opacity, corner radius, and icon size
- **Running App Indicators** – Easily see which applications are currently running
- **Drag & Drop Support** – Reorder your favorite apps with intuitive drag and drop
- **Multi-Monitor Support** – Option to display the dock on all connected monitors
- **Integrated Show Apps Button** – Quick access to the GNOME app grid
- **Tooltips** – Hover over icons to see app names

<img width="1068" height="1080" alt="Screenshot from 2025-12-13 16-11-57" src="https://github.com/user-attachments/assets/8ce7dc99-a030-4070-afd8-90b80b30b0a3" />
<img width="1086" height="1078" alt="Screenshot from 2025-12-13 16-13-12" src="https://github.com/user-attachments/assets/033e3703-c121-401d-9c59-224b2042cce5" />


## 📦 Installation

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
   gnome-extensions enable multi-column-dock@ali.example.com
   ```

4. Restart GNOME Shell:
   - **X11**: Press `Alt+F2`, type `r`, press `Enter`
   - **Wayland**: Log out and log back in

### Manual Installation

1. Copy the extension files to your GNOME extensions directory:
   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions/multi-column-dock@ali.example.com
   cp -r * ~/.local/share/gnome-shell/extensions/multi-column-dock@ali.example.com/
   ```

2. Compile the schemas:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/multi-column-dock@ali.example.com/schemas/
   ```

3. Restart GNOME Shell and enable the extension.

## ⚙️ Configuration

Open the extension preferences to customize:
<img width="762" height="741" alt="Screenshot from 2025-12-13 16-13-55" src="https://github.com/user-attachments/assets/59b49c92-d46b-48de-99b3-8133b6f0d689" />
- **Columns**: Set the number of columns (1-4)
- **Icon Size**: Adjust the size of app icons
- **Background Color**: Choose your preferred dock background color
- **Background Opacity**: Set the transparency level
- **Corner Radius**: Customize the dock's corner roundness
- **Multi-Monitor**: Enable/disable dock on all monitors

Access preferences via:
```bash
gnome-extensions prefs multi-column-dock@ali.example.com
```

Or through the GNOME Extensions app.

## 🖥️ Requirements

- GNOME Shell 45 or later
- GLib 2.0

## 🗑️ Uninstallation

```bash
gnome-extensions disable multi-column-dock@ali.example.com
rm -rf ~/.local/share/gnome-shell/extensions/multi-column-dock@ali.example.com
```

## 📄 License

This project is licensed under the GPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## Support Us

If you find it helpful, consider supporting us in the following ways:

- ⭐ Star this repository on [GitHub](https://github.com/AITwinMinds/Multi-column-dock).
  
- 🐦 Follow us on X (Twitter): [@AITwinMinds](https://twitter.com/AITwinMinds)

- 📣 Join our Telegram Channel: [AITwinMinds](https://t.me/AITwinMinds) for discussions and announcements.

- 🎥 Subscribe to our YouTube Channel: [AITwinMinds](https://www.youtube.com/@AITwinMinds) for video tutorials and updates.

- 📸 Follow us on Instagram: [@AITwinMinds](https://www.instagram.com/AITwinMinds)

Don't forget to share it with your friends!

## Contact

For any inquiries, please contact us at [AITwinMinds@gmail.com](mailto:AITwinMinds@gmail.com).
