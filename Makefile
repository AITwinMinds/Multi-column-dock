.PHONY: all build install uninstall clean deb zip release

EXTENSION_UUID = AITwinMinds@gmail.com
VERSION = $(shell git describe --tags --abbrev=0 2>/dev/null || echo "1.0")
EXTENSION_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(EXTENSION_UUID)
SCHEMA_DIR = /usr/share/glib-2.0/schemas

all: build

build:
	glib-compile-schemas schemas/

install: build
	mkdir -p $(EXTENSION_DIR)/schemas
	cp extension.js dockView.js groupContainer.js badgeManager.js scaleManager.js utils.js prefs.js metadata.json stylesheet.css $(EXTENSION_DIR)/
	cp schemas/*.xml $(EXTENSION_DIR)/schemas/
	glib-compile-schemas $(EXTENSION_DIR)/schemas/
	gnome-extensions enable $(EXTENSION_UUID)

uninstall:
	gnome-extensions disable $(EXTENSION_UUID) || true
	rm -rf $(EXTENSION_DIR)

clean:
	rm -rf build/
	rm -f *.deb
	rm -f schemas/gschemas.compiled
	rm -rf debian/.debhelper
	rm -f debian/debhelper-build-stamp
	rm -f debian/files
	rm -rf debian/gnome-shell-extension-multi-column-dock
	rm -f debian/*.substvars

deb:
	./scripts/gen-changelog.sh
	dpkg-buildpackage -us -uc -b

zip:
	zip -r $(EXTENSION_UUID).zip extension.js dockView.js groupContainer.js badgeManager.js scaleManager.js utils.js prefs.js metadata.json stylesheet.css schemas/ -x "schemas/gschemas.compiled"

release:
	./scripts/release.sh
