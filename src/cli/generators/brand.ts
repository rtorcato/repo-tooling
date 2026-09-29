/**
 * Brand generator (#395) — the sources half of the brand-asset spec (#318).
 *
 * #318 standardised *which* images a repo ships; this writes **where they come
 * from**: `brand/` holds the SVG sources and `brand/render.sh` renders them to
 * PNG, so a banner can be recoloured, retitled or resized instead of being a
 * committed binary nobody can regenerate.
 *
 * Everything in the emitted SVGs is derived from the consuming repo — name from
 * its package.json, tagline from `rules.brand.tagline` in .repo-tooling.json or
 * else the package.json description (#666), accent from its own docs theme or favicon —
 * and falls back to a neutral grey. Nothing about any particular org is baked
 * in; the templates are meant to be hand-edited afterwards.
 */
import { execFileSync, spawnSync } from 'node:child_process'
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

/** `"` matters because this output also lands in double-quoted attributes (the `aria-label` below). */
function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
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

/** Where a repo already keeps a favicon — the docs site's first. */
const EXISTING_FAVICONS = [path.join('apps', 'docs', 'static', 'img', 'favicon.svg'), 'favicon.svg']

/** Failing that, the favicon's own ink — the other place a repo commits its colour. */
async function accentFromFavicon(targetDir: string): Promise<string | null> {
	for (const rel of EXISTING_FAVICONS) {
		const file = path.join(targetDir, rel)
		if (!(await fs.pathExists(file))) continue
		const svg = await fs.readFile(file, 'utf-8')
		for (const [hex] of svg.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
			if (!isBackgroundColour(hex)) return hex
		}
	}
	return null
}

/**
 * The narrowest tagline budget any canvas uses (the mobile banner). A tagline
 * that needs more than two lines of it crowds the layout and gets cut off.
 */
const TAGLINE_MAX_CHARS = 42

/** True when `tagline` fits in two lines on every canvas, without an ellipsis. */
export function taglineFits(tagline: string): boolean {
	const words = tagline.split(/\s+/).filter(Boolean).join(' ')
	return wrapText(tagline, TAGLINE_MAX_CHARS, 2).join(' ') === words
}

/**
 * `tagline` is `rules.brand.tagline` from .repo-tooling.json: a short line
 * written for the banner. Without it the package.json description stands in,
 * which is often a full sentence too long for the canvas (#666).
 */
export async function resolveBrandMeta(
	pkg: Pkg,
	targetDir: string,
	tagline?: string
): Promise<BrandMeta> {
	const pkgName = typeof pkg?.name === 'string' ? pkg.name : undefined
	const name = pkgName?.split('/').pop() ?? path.basename(path.resolve(targetDir))
	const description = typeof pkg?.description === 'string' ? pkg.description : ''
	const accent =
		(await accentFromDocsTheme(targetDir)) ?? (await accentFromFavicon(targetDir)) ?? NEUTRAL_ACCENT
	return {
		name,
		tagline:
			tagline || description || 'Add a short tagline as rules.brand.tagline in .repo-tooling.json.',
		accent,
		install: pkgName && pkg?.private !== true ? pkgName : null,
	}
}

/**
 * The logo tile: a rounded square in the accent carrying the project's
 * initial. It *is* `brand/favicon.svg`, and every canvas below draws that file
 * rather than a copy of it, so swapping in a real glyph is a one-file edit (#678).
 */
export function faviconSvg(meta: BrandMeta): string {
	const initial = esc((meta.name[0] ?? '?').toUpperCase())
	return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
	<title>${esc(meta.name)}</title>
	<rect width="32" height="32" rx="8" fill="${meta.accent}"/>
	<text x="16" y="23" text-anchor="middle" font-family="Avenir Next" font-weight="800" font-size="19" fill="${INK}">${initial}</text>
</svg>
`
}

/** The logo mark: `brand/favicon.svg`, drawn `size` px square. */
function mark(x: number, y: number, size: number): string {
	return `	<!-- Logo mark: brand/favicon.svg — edit that file to change it on every canvas. -->
	<image href="favicon.svg" x="${x}" y="${y}" width="${size}" height="${size}"/>`
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
${mark(60, 88, 72)}

	<text x="156" y="150" font-family="Avenir Next" font-weight="800" font-size="62" letter-spacing="-1.5">${wordmark(meta)}</text>

${taglineBlock(meta, { x: 62, y: 198, step: 28, size: 20, centred: false, maxChars: 44 })}
${installPanel(meta, { x: 845, y: 118, w: 378, h: 84, size: 20 })}
</svg>
`
}

/** 1280×786 mobile banner — the same content stacked so it stays legible on a phone. */
export function bannerMobileSvg(meta: BrandMeta): string {
	return `${canvas(meta, 1280, 786, { cx: 0.12, cy: 0.05 })}
${mark(565, 104, 150)}

	<text x="640" y="360" text-anchor="middle" font-family="Avenir Next" font-weight="800" font-size="76" letter-spacing="-1.8">${wordmark(meta)}</text>

${taglineBlock(meta, { x: 640, y: 510, step: 44, size: 30, centred: true, maxChars: 42 })}
${installPanel(meta, { x: 427, y: 650, w: 426, h: 78, size: 24 })}
</svg>
`
}

/** 1280×640 Open Graph / GitHub social card. Keep content inside an ~8% safe inset. */
export function socialCardSvg(meta: BrandMeta): string {
	return `${canvas(meta, 1280, 640, { cx: 0.1, cy: 0.05 })}
${mark(590, 120, 100)}

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
# 1280x640 social card, 512x512 PWA icon. (\`fix brand\` also packs favicon.ico.)
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v rsvg-convert >/dev/null 2>&1; then
	echo "brand/render.sh needs librsvg — install it with: brew install librsvg" >&2
	echo "(apt: apt-get install librsvg2-bin)" >&2
	exit 1
fi

rsvg-convert -w 1280 -h 320 brand/banner.svg        -o brand/banner.png
rsvg-convert -w 1280 -h 786 brand/banner-mobile.svg -o brand/banner-mobile.png
rsvg-convert -w 1280 -h 640 brand/social-card.svg   -o brand/social-card.png
rsvg-convert -w 512  -h 512 brand/favicon.svg       -o brand/favicon-512.png
echo "rendered: brand/banner.png brand/banner-mobile.png brand/social-card.png brand/favicon-512.png"

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

/** A favicon the repo already commits beats the generated initial tile. */
async function existingFavicon(targetDir: string): Promise<string | null> {
	for (const rel of EXISTING_FAVICONS) {
		const file = path.join(targetDir, rel)
		if (await fs.pathExists(file)) return fs.readFile(file, 'utf-8')
	}
	return null
}

/**
 * Scaffold `brand/`: the favicon tile, three SVG sources that draw it, and the
 * render script, then repoint a README still on the old root-level paths.
 * Every file is written only when absent, so `fix brand` is idempotent.
 */
export async function generateBrand(
	pkg: Pkg,
	targetDir: string,
	tagline?: string
): Promise<string[]> {
	const meta = await resolveBrandMeta(pkg, targetDir, tagline)
	const written: string[] = []
	const files: Array<[string, string, number?]> = [
		['brand/favicon.svg', (await existingFavicon(targetDir)) ?? faviconSvg(meta)],
		['brand/banner.svg', bannerSvg(meta)],
		['brand/banner-mobile.svg', bannerMobileSvg(meta)],
		['brand/social-card.svg', socialCardSvg(meta)],
		['brand/render.sh', RENDER_SH, 0o755],
	]
	for (const [rel, contents, mode] of files) {
		const w = await writeIfMissing(targetDir, rel, contents, mode)
		if (w) written.push(w)
	}
	// stderr, not stdout: `fix --json` owns stdout (#357).
	if (written.some((f) => f.endsWith('.svg')) && !taglineFits(meta.tagline)) {
		console.error(
			'   warning: the tagline needs more than two lines and will be cut off on the mobile banner — set a shorter one as rules.brand.tagline in .repo-tooling.json'
		)
	}
	const readme = await repointReadmeBanners(targetDir)
	if (readme) written.push(readme)
	return written
}

/** Printed when `rsvg-convert` is not on PATH — the sources are still written. */
export const RSVG_HINT =
	'   next: install librsvg to render the brand PNGs (`brew install librsvg`, apt: `apt-get install librsvg2-bin`), then re-run `fix brand` or `brand/render.sh`'

/** `[source, output, width, height]` under `brand/` — the same set render.sh draws. */
const RENDERS: Array<[string, string, number, number]> = [
	['banner.svg', 'banner.png', 1280, 320],
	['banner-mobile.svg', 'banner-mobile.png', 1280, 786],
	['social-card.svg', 'social-card.png', 1280, 640],
	['favicon.svg', 'favicon-512.png', 512, 512],
	['favicon.svg', 'favicon.ico', 32, 32],
]

/** Classic favicon sizes packed into favicon.ico. */
const ICO_SIZES = [16, 32]

/**
 * An ICO container holding PNG frames — every browser since IE Vista reads
 * PNG-in-ICO, so no bitmap conversion is needed.
 */
export function packIco(frames: Array<[size: number, png: Buffer]>): Buffer {
	const header = Buffer.alloc(6 + 16 * frames.length)
	header.writeUInt16LE(1, 2) // type: icon
	header.writeUInt16LE(frames.length, 4)
	let offset = header.length
	frames.forEach(([size, png], i) => {
		const e = 6 + 16 * i
		header.writeUInt8(size % 256, e) // 0 means 256
		header.writeUInt8(size % 256, e + 1)
		header.writeUInt16LE(1, e + 4) // colour planes
		header.writeUInt16LE(32, e + 6) // bits per pixel
		header.writeUInt32LE(png.length, e + 8)
		header.writeUInt32LE(offset, e + 12)
		offset += png.length
	})
	return Buffer.concat([header, ...frames.map(([, png]) => png)])
}

async function mtime(file: string): Promise<number> {
	return (await fs.stat(file)).mtimeMs
}

/**
 * Render every `brand/` PNG (and favicon.ico) that is missing or older than its
 * source — or than favicon.svg, which every canvas draws. Returns the files
 * written, or null when `rsvg-convert` is not on PATH (after printing
 * {@link RSVG_HINT}). Nothing stale means nothing to do and no PATH lookup.
 */
export async function renderBrand(targetDir: string): Promise<string[] | null> {
	const brand = path.join(targetDir, 'brand')
	const favicon = path.join(brand, 'favicon.svg')
	const stale: typeof RENDERS = []
	for (const job of RENDERS) {
		const [src, out] = job
		const srcFile = path.join(brand, src)
		const outFile = path.join(brand, out)
		if (!(await fs.pathExists(srcFile))) continue
		const newest = Math.max(
			await mtime(srcFile),
			(await fs.pathExists(favicon)) ? await mtime(favicon) : 0
		)
		if (!(await fs.pathExists(outFile)) || (await mtime(outFile)) < newest) stale.push(job)
	}
	if (stale.length === 0) return []

	if (spawnSync('rsvg-convert', ['--version']).error) {
		// stderr, not stdout: `fix --json` owns stdout (#357).
		console.error(RSVG_HINT)
		return null
	}
	// cwd = brand/ so each canvas's `href="favicon.svg"` resolves beside it.
	const rsvg = (src: string, w: number, h: number): Buffer =>
		execFileSync('rsvg-convert', ['-w', String(w), '-h', String(h), src], { cwd: brand })

	const written: string[] = []
	for (const [src, out, w, h] of stale) {
		const png = out.endsWith('.ico')
			? packIco(ICO_SIZES.map((s) => [s, rsvg(src, s, s)]))
			: rsvg(src, w, h)
		await fs.writeFile(path.join(brand, out), png)
		written.push(`brand/${out}`)
	}
	return written
}

export const BANNER_START = '<!-- js-tooling:banner:start -->'
export const BANNER_END = '<!-- js-tooling:banner:end -->'

/** The README `<picture>` banner, mobile variant under 640px, as a delimited block. */
export function buildBannerBlock(name: string): string {
	return `${BANNER_START}
<picture>
  <source media="(max-width: 640px)" srcset="./brand/banner-mobile.png">
  <img src="./brand/banner.png" alt="${esc(name)} banner" width="1600">
</picture>
${BANNER_END}`
}

/**
 * Put the banner block at the top of a README. Refreshes an existing block in
 * place; leaves alone a README that already shows a banner outside one (a
 * hand-written `<picture>`); otherwise prepends. Idempotent.
 */
export function upsertBanner(readme: string, block: string): string {
	const start = readme.indexOf(BANNER_START)
	const end = readme.indexOf(BANNER_END)
	if (start !== -1 && end > start) {
		return readme.slice(0, start) + block + readme.slice(end + BANNER_END.length)
	}
	if (/banner(?:-mobile)?\.png/.test(readme)) return readme
	return `${block}\n\n${readme}`
}

/** Add the banner block to README.md once `brand/banner.png` exists to show. */
export async function addReadmeBanner(targetDir: string, name: string): Promise<string | null> {
	const file = path.join(targetDir, 'README.md')
	if (!(await fs.pathExists(file))) return null
	if (!(await fs.pathExists(path.join(targetDir, 'brand', 'banner.png')))) return null
	const readme = await fs.readFile(file, 'utf-8')
	const next = upsertBanner(readme, buildBannerBlock(name))
	if (next === readme) return null
	await fs.writeFile(file, next)
	return 'README.md'
}
