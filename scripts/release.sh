#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Get latest tag by resolved creator date
LATEST_TAG=$(git for-each-ref --sort=-creatordate --format='%(refname:short)' refs/tags | head -1 || true)

if [ -z "$LATEST_TAG" ]; then
    echo "Error: No tags found. Create one:"
    echo "  git tag -a 1.0 -m 'Initial release'"
    exit 1
fi

VERSION="$LATEST_TAG"
TAG_DATE=$(git for-each-ref --format='%(creatordate:rfc2822)' "refs/tags/$LATEST_TAG")

echo "=== Release Info ==="
echo "Tag: $LATEST_TAG"
echo "Version: $VERSION"
echo "Date: $TAG_DATE"
echo "===================="

echo "Generating debian/changelog from tags..."
./scripts/gen-changelog.sh

# Update metadata.json version (integer part only)
META_VERSION=$(echo "$VERSION" | cut -d. -f1)
sed -i "s/\"version\": [0-9]*/\"version\": $META_VERSION/" metadata.json

echo "Building deb package..."
dpkg-buildpackage -us -uc -b

echo ""
echo "=== Done ==="
echo "Package: ../gnome-shell-extension-multi-column-dock_${VERSION}-1_all.deb"
