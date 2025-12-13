#!/bin/bash

UUID="AITwinMinds@gmail.com"
ZIP_NAME="multi-column-dock.zip"
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

# Always rebuild package to ensure latest changes
echo "Building package..."
./package.sh

echo "Installing to $INSTALL_DIR..."

# Create directory
mkdir -p "$INSTALL_DIR"

# Unzip
unzip -o $ZIP_NAME -d "$INSTALL_DIR"

echo "Extension installed."
echo "To enable it, run: gnome-extensions enable $UUID"
echo "You may need to restart GNOME Shell (Alt+F2, 'r') or log out/in."

# Try to enable
gnome-extensions enable $UUID
