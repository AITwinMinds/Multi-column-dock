#!/bin/bash

# Name of the extension UUID
UUID="AITwinMinds@gmail.com"
ZIP_NAME="multi-column-dock.zip"

echo "Compiling schemas..."
glib-compile-schemas schemas/

echo "Creating zip package..."
rm -f $ZIP_NAME
zip -r $ZIP_NAME . -x "*.git*" -x "*.sh" -x "node_modules/*"

echo "Package created: $ZIP_NAME"
