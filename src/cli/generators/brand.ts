/**
 * Brand generator (#395) — the sources half of the brand-asset spec (#318).
 *
 * #318 standardised *which* images a repo ships; this writes **where they come
 * from**: `brand/` holds the SVG sources and `brand/render.sh` renders them to
 * PNG, so a banner can be recoloured, retitled or resized instead of being a
 * committed binary nobody can regenerate.
 *
 * Everything in the emitted SVGs is derived from the consuming repo — name and
 * tagline from its package.json, accent from its own docs theme or favicon —
 * and falls back to a neutral grey. Nothing about any particular org is baked
 * in; the templates are meant to be hand-edited afterwards.
 */
import path from 'node:path'
import fs from 'fs-extra'

type Pkg = Record<string, unknown> | null

/** Grey, so an unbranded repo reads as unbranded rather than borrowing a colour. */
const NEUTRAL_ACCENT = '#8b95a7'

/** The cool counter-glow in the corner opposite the accent one. Fixed — it reads as depth, not brand. */
const COUNTER_GLOW = '#6e7bff'

const INK = '#0A0E16'
const TEXT = '#e6edf3'
const MUTED = '#9ba6b8'

export interface BrandMeta {
	/** Bare project name, e.g. `repo-tooling`. */
	name: string
	tagline: string
	accent: string
	/** Package name for the `npm i` pill, or null for a repo that publishes nothing. */
	install: string | null
}

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Greedy word wrap to a character budget. Character-budgeted rather than
 * measured because there is no text metric available here — the templates are
 * meant to be nudged by hand once rendered.
 */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
	const lines: string[] = []
	let line = ''
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const next = line ? `${line} ${word}` : word
		if (next.length > maxChars && line) {
			lines.push(line)
			line = word
			if (lines.length === maxLines) break
		} else {
			line = next
		}
	}
	if (lines.length < maxLines && line) lines.push(line)
	// Anything that didn't fit is dropped rather than overflowing the canvas.
	if (lines.length === maxLines && text.length > lines.join(' ').length) {
		lines[maxLines - 1] = `${lines[maxLines - 1]}…`
	}
	return lines
}

/** Near-black and near-white are background, not brand — skip them when sniffing a favicon. */
function isBackgroundColour(hex: string): boolean {
	const n = Number.parseInt(hex.slice(1), 16)
	const r = (n >> 16) & 0xff
	const g = (n >> 8) & 0xff
	const b = n & 0xff
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
	return luminance < 60 || luminance > 225
}

/**
 * The docs site's own accent, which is the most deliberate colour choice a repo
 * makes. Prefers the dark-mode value: these banners sit on a dark canvas.
 */
async function accentFromDocsTheme(targetDir: string): Promise<string | null> {
	const file = path.join(targetDir, 'apps', 'docs', 'src', 'css', 'custom.css')
	if (!(await fs.pathExists(file))) return null
	const css = await fs.readFile(file, 'utf-8')
	const dark = css.match(
		/\[data-theme=["']dark["']\][\s\S]*?--ifm-color-primary:\s*(#[0-9a-fA-F]{6})/
	)
	if (dark?.[1]) return dark[1]
	return css.match(/--ifm-color-primary:\s*(#[0-9a-fA-F]{6})/)?.[1] ?? null
}

/** Failing that, the favicon's own ink — the other place a repo commits its colour. */
async function accentFromFavicon(targetDir: string): Promise<string | null> {
	const candidates = [path.join('apps', 'docs', 'static', 'img', 'favicon.svg'), 'favicon.svg']
	for (const rel of candidates) {
		const file = path.join(targetDir, rel)
		if (!(await fs.pathExists(file))) continue
		const svg = await fs.readFile(file, 'utf-8')
		for (const [hex] of svg.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
			if (!isBackgroundColour(hex)) return hex
		}
	}
	return null
}

export async function resolveBrandMeta(pkg: Pkg, targetDir: string): Promise<BrandMeta> {
	const pkgName = typeof pkg?.name === 'string' ? pkg.name : undefined
	const name = pkgName?.split('/').pop() ?? path.basename(path.resolve(targetDir))
	const description = typeof pkg?.description === 'string' ? pkg.description : ''
	const accent =
		(await accentFromDocsTheme(targetDir)) ?? (await accentFromFavicon(targetDir)) ?? NEUTRAL_ACCENT
	return {
		name,
		tagline: description || 'Add a one-line tagline to package.json "description".',
		accent,
		install: pkgName && pkg?.private !== true ? pkgName : null,
	}
}

/**
 * The logo mark: a rounded square in the accent carrying the project's initial.
 * Authored on a 32 viewBox so it matches the favicon's geometry and can be
 * swapped for the real favicon glyph verbatim.
 */
function mark(meta: BrandMeta, translate: string, scale: number): string {
	const initial = esc((meta.name[0] ?? '?').toUpperCase())
	return `	<!-- Logo mark: a 32 viewBox, so the real favicon glyph can be pasted in over it. -->
	<g transform="translate(${translate}) scale(${scale})">
		<rect width="32" height="32" rx="8" fill="${meta.accent}"/>
		<text x="16" y="23" text-anchor="middle" font-family="Avenir Next" font-weight="800" font-size="19" fill="${INK}">${initial}</text>
	</g>`
}

/** `repo-tooling` renders as a muted `repo-` and an accented `tooling`. */
function wordmark(meta: BrandMeta): string {
	const i = meta.name.lastIndexOf('-')
	if (i <= 0) return `<tspan fill="${meta.accent}">${esc(meta.name)}</tspan>`
	return `<tspan fill="${TEXT}">${esc(meta.name.slice(0, i + 1))}</tspan><tspan fill="${meta.accent}">${esc(meta.name.slice(i + 1))}</tspan>`
}

function taglineBlock(
	meta: BrandMeta,
	opts: { x: number; y: number; step: number; size: number; centred: boolean; maxChars: number }
): string {
	// Three lines: every canvas has room for a third, and cutting a real tagline
	// short is worse than one extra line of copy.
	const lines = wrapText(meta.tagline, opts.maxChars, 3)
	// librsvg does not reset x on a y-only tspan, so every line repeats x.
	const tspans = lines
		.map((l, i) => `\t\t<tspan x="${opts.x}" y="${opts.y + i * opts.step}">${esc(l)}</tspan>`)
		.join('\n')
	const anchor = opts.centred ? ' text-anchor="middle"' : ''
	return `	<text${anchor} font-family="Avenir Next" font-weight="500" font-size="${opts.size}" fill="${MUTED}">
${tspans}
	</text>`
}

/** The install pill. Omitted entirely for a repo with nothing to `npm i`. */
function installPanel(
	meta: BrandMeta,
	opts: { x: number; y: number; w: number; h: number; size: number }
): string {
	if (!meta.install) return ''
	return `
	<rect x="${opts.x}" y="${opts.y}" width="${opts.w}" height="${opts.h}" rx="14" fill="#11151d" stroke="#232936" stroke-width="1"/>
	<text xml:space="preserve" x="${opts.x + opts.w / 2}" y="${opts.y + opts.h / 2 + opts.size / 3}" text-anchor="middle" font-family="Menlo" font-size="${opts.size}"><tspan fill="${meta.accent}">npm i </tspan><tspan fill="${TEXT}">${esc(meta.install)}</tspan></text>`
}

function canvas(meta: BrandMeta, w: number, h: number, glow: { cx: number; cy: number }): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(meta.name)} — ${esc(meta.tagline)}">
	<defs>
		<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#0d1117"/>
			<stop offset="1" stop-color="#090c13"/>
		</linearGradient>
		<radialGradient id="glow" cx="${glow.cx}" cy="${glow.cy}" r="0.55">
			<stop offset="0" stop-color="${meta.accent}" stop-opacity="0.15"/>
			<stop offset="1" stop-color="${meta.accent}" stop-opacity="0"/>
		</radialGradient>
		<radialGradient id="glow2" cx="0.92" cy="1" r="0.5">
			<stop offset="0" stop-color="${COUNTER_GLOW}" stop-opacity="0.12"/>
			<stop offset="1" stop-color="${COUNTER_GLOW}" stop-opacity="0"/>
		</radialGradient>
	</defs>

	<rect width="${w}" height="${h}" fill="url(#bg)"/>
	<rect width="${w}" height="${h}" fill="url(#glow)"/>
	<rect width="${w}" height="${h}" fill="url(#glow2)"/>
`
}

/** 1280×320 README banner — left-aligned lockup, install pill on the right. */
export function bannerSvg(meta: BrandMeta): string {
	return `${canvas(meta, 1280, 320, { cx: 0.16, cy: 0 })}
${mark(meta, '60 88', 2.25)}

	<text x="156" y="150" font-family="Avenir Next" font-weight="800" font-size="62" letter-spacing="-1.5">${wordmark(meta)}</text>

${taglineBlock(meta, { x: 62, y: 198, step: 28, size: 20, centred: false, maxChars: 44 })}
${installPanel(meta, { x: 845, y: 118, w: 378, h: 84, size: 20 })}
</svg>
`
}

/** 1280×786 mobile banner — the same content stacked so it stays legible on a phone. */
export function bannerMobileSvg(meta: BrandMeta): string {
	return `${canvas(meta, 1280, 786, { cx: 0.12, cy: 0.05 })}
${mark(meta, '565 104', 4.6875)}

	<text x="640" y="360" text-anchor="middle" font-family="Avenir Next" font-weight="800" font-size="76" letter-spacing="-1.8">${wordmark(meta)}</text>

${taglineBlock(meta, { x: 640, y: 510, step: 44, size: 30, centred: true, maxChars: 42 })}
${installPanel(meta, { x: 427, y: 650, w: 426, h: 78, size: 24 })}
</svg>
`
}

/** 1280×640 Open Graph / GitHub social card. Keep content inside an ~8% safe inset. */
export function socialCardSvg(meta: BrandMeta): string {
	return `${canvas(meta, 1280, 640, { cx: 0.1, cy: 0.05 })}
${mark(meta, '590 120', 3.125)}

	<text x="640" y="300" text-anchor="middle" font-family="Avenir Next" font-weight="800" font-size="76" letter-spacing="-1.8">${wordmark(meta)}</text>

${taglineBlock(meta, { x: 640, y: 372, step: 42, size: 28, centred: true, maxChars: 44 })}
${installPanel(meta, { x: 427, y: 470, w: 426, h: 78, size: 24 })}
</svg>
`
}

/**
 * The render script. Sizes come from the #318 spec. It self-skips outputs whose
 * source or destination doesn't exist, so the same script works in a repo with
 * no docs site.
 */
export const RENDER_SH = `#!/usr/bin/env bash
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
`

/** Write `contents` at `rel` only when absent, so re-running never clobbers hand-edited art. */
async function writeIfMissing(
	targetDir: string,
	rel: string,
	contents: string,
	mode?: number
): Promise<string | null> {
	const file = path.join(targetDir, rel)
	if (await fs.pathExists(file)) return null
	await fs.ensureDir(path.dirname(file))
	await fs.writeFile(file, contents, mode ? { mode } : undefined)
	return rel
}

/**
 * Repoint a README still using the pre-amendment root-level banner paths at
 * `brand/`. Only the two banner `srcset`/`src` values move — nothing else in the
 * README is touched.
 */
export async function repointReadmeBanners(targetDir: string): Promise<string | null> {
	const file = path.join(targetDir, 'README.md')
	if (!(await fs.pathExists(file))) return null
	const readme = await fs.readFile(file, 'utf-8')
	const next = readme.replace(/(?<!brand\/)(?:\.\/)?(banner(?:-mobile)?\.png)/g, './brand/$1')
	if (next === readme) return null
	await fs.writeFile(file, next)
	return 'README.md'
}

/**
 * Scaffold `brand/`: three SVG sources + the render script, then repoint a
 * README still on the old root-level paths. Every file is written only when
 * absent, so `fix brand` is idempotent.
 */
export async function generateBrand(pkg: Pkg, targetDir: string): Promise<string[]> {
	const meta = await resolveBrandMeta(pkg, targetDir)
	const written: string[] = []
	const files: Array<[string, string, number?]> = [
		['brand/banner.svg', bannerSvg(meta)],
		['brand/banner-mobile.svg', bannerMobileSvg(meta)],
		['brand/social-card.svg', socialCardSvg(meta)],
		['brand/render.sh', RENDER_SH, 0o755],
	]
	for (const [rel, contents, mode] of files) {
		const w = await writeIfMissing(targetDir, rel, contents, mode)
		if (w) written.push(w)
	}
	const readme = await repointReadmeBanners(targetDir)
	if (readme) written.push(readme)
	return written
}
