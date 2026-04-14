#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

mapfile -t TAGS < <(git for-each-ref --sort=-creatordate --format='%(refname:short)' refs/tags)

if [ "${#TAGS[@]}" -eq 0 ]; then
    echo "Error: No tags found. Create one:"
    echo "  git tag -a 1.0 -m 'Initial release'"
    exit 1
fi

MAINTAINER=$(grep -oP 'Maintainer: \K[^<]+' debian/control | sed 's/ *$//' || echo "Artel of Bots")
EMAIL=$(grep -oP 'Maintainer:.*<\K[^>]+' debian/control || echo "artelofbots@nowhere.funny")

OUTPUT=""

for TAG in "${TAGS[@]}"; do
    VERSION="$TAG"
    TAG_MESSAGE=$(git tag -l --format='%(contents)' "$TAG" | head -20)
    if [ -z "$TAG_MESSAGE" ]; then
        TAG_MESSAGE="Release $VERSION"
    fi
    TAG_DATE=$(git for-each-ref --format='%(creatordate:rfc2822)' "refs/tags/$TAG")

    OUTPUT+="gnome-shell-extension-multi-column-dock (${VERSION}-1) unstable; urgency=medium\n\n"

    while IFS= read -r line; do
        if [ -n "$line" ]; then
            if [ "${line#\* }" != "$line" ]; then
                line="${line#\* }"
            elif [ "${line#- }" != "$line" ]; then
                line="${line#- }"
            fi
            OUTPUT+="  * ${line}\n"
        fi
    done <<< "$TAG_MESSAGE"

    OUTPUT+="\n -- ${MAINTAINER} <${EMAIL}>  ${TAG_DATE}\n\n"
done

printf "%b" "$OUTPUT" > debian/changelog
