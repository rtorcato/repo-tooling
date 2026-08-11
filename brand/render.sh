#!/usr/bin/env bash
# Render the committed brand PNGs from their SVG sources.
# Sizes come from the brand-asset spec: 1280x320 banner, 1280x786 mobile,
# 1280x640 social card, 512x512 PWA icon.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v rsvg-convert >/dev/null 2>&1; then
	echo "brand/render.sh needs librsvg — install it with: brew install librsvg" >&2
	echo "(apt: apt-get install librsvg2-bin)" >&2
	exit 1
fi

rsvg-convert -w 1280 -h 320 brand/banner.svg        -o brand/banner.png
rsvg-convert -w 1280 -h 786 brand/banner-mobile.svg -o brand/banner-mobile.png
echo "rendered: brand/banner.png brand/banner-mobile.png"

# The docs-site assets, rendered only when the site exists to hold them.
img=apps/docs/static/img
if [ -d "$img" ]; then
	rsvg-convert -w 1280 -h 640 brand/social-card.svg -o "$img/social-card.png"
	echo "rendered: $img/social-card.png"
	if [ -f "$img/favicon.svg" ]; then
		rsvg-convert -w 512 -h 512 "$img/favicon.svg" -o "$img/favicon-512.png"
		echo "rendered: $img/favicon-512.png"
	fi
fi
