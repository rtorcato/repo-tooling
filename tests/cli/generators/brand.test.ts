import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it, vi } from 'vitest'
import { checkBrand } from '../../../src/base/checks.js'
import {
	addReadmeBanner,
	BANNER_START,
	buildBannerBlock,
	generateBrand,
	packIco,
	renderBrand,
	upsertBanner,
	repointReadmeBanners,
	resolveBrandMeta,
	taglineFits,
	wrapText,
} from '../../../src/cli/generators/brand.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const PKG = { name: '@acme/widget-kit', description: 'Widgets for everyone, everywhere.' }

describe('generateBrand', () => {
	it('scaffolds the three SVG sources and an executable render.sh', async () => {
		const dir = newTmpDir()
		const written = await generateBrand(PKG, dir)

		expect(written).toEqual([
			'brand/favicon.svg',
			'brand/banner.svg',
			'brand/banner-mobile.svg',
			'brand/social-card.svg',
			'brand/render.sh',
		])
		for (const rel of written) {
			expect(await fs.pathExists(join(dir, rel))).toBe(true)
		}
		const mode = (await fs.stat(join(dir, 'brand/render.sh'))).mode
		expect(mode & 0o111).toBeGreaterThan(0)
	})

	it('writes nothing on a second run and preserves hand-edited art', async () => {
		const dir = newTmpDir()
		await generateBrand(PKG, dir)
		await fs.writeFile(join(dir, 'brand/banner.svg'), '<svg>MINE</svg>')

		expect(await generateBrand(PKG, dir)).toEqual([])
		expect(await fs.readFile(join(dir, 'brand/banner.svg'), 'utf-8')).toBe('<svg>MINE</svg>')
	})

	it('derives name, tagline and install command from the consuming package', async () => {
		const dir = newTmpDir()
		await generateBrand(PKG, dir)
		const banner = await fs.readFile(join(dir, 'brand/banner.svg'), 'utf-8')

		expect(banner).toContain('widget-')
		expect(banner).toContain('kit')
		expect(banner).toContain('Widgets for everyone, everywhere.')
		expect(banner).toContain('npm i ')
		expect(banner).toContain('@acme/widget-kit')
	})

	it('omits the install pill for a private package', async () => {
		const dir = newTmpDir()
		await generateBrand({ ...PKG, private: true }, dir)
		expect(await fs.readFile(join(dir, 'brand/banner.svg'), 'utf-8')).not.toContain('npm i')
	})

	it('escapes XML-significant characters in the tagline', async () => {
		const dir = newTmpDir()
		await generateBrand({ name: 'x', description: 'Fast & <safe>' }, dir)
		const svg = await fs.readFile(join(dir, 'brand/social-card.svg'), 'utf-8')
		expect(svg).toContain('Fast &amp; &lt;safe&gt;')
		expect(svg).not.toContain('<safe>')
	})

	it('escapes quotes, which would otherwise break out of the aria-label attribute', async () => {
		const dir = newTmpDir()
		await generateBrand({ name: 'x', description: 'The "only" one' }, dir)
		const svg = await fs.readFile(join(dir, 'brand/social-card.svg'), 'utf-8')
		expect(svg).toContain('The &quot;only&quot; one')
		expect(svg).not.toContain('"only"')
		// the attribute must still be a single balanced pair, not three
		expect(svg.match(/aria-label="[^"]*"/)?.[0]).toContain('&quot;only&quot;')
	})
})

describe('favicon (#678)', () => {
	it('emits a favicon tile that every canvas draws', async () => {
		const dir = newTmpDir()
		await generateBrand(PKG, dir)

		const favicon = await fs.readFile(join(dir, 'brand/favicon.svg'), 'utf-8')
		expect(favicon).toContain('viewBox="0 0 32 32"')
		expect(favicon).toContain('>W</text>')
		for (const svg of ['banner', 'banner-mobile', 'social-card']) {
			const canvas = await fs.readFile(join(dir, `brand/${svg}.svg`), 'utf-8')
			expect(canvas).toContain('href="favicon.svg"')
		}
	})

	it("copies the repo's own favicon instead of the initial tile", async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'favicon.svg'), '<svg>REAL</svg>')
		await generateBrand(PKG, dir)
		expect(await fs.readFile(join(dir, 'brand/favicon.svg'), 'utf-8')).toBe('<svg>REAL</svg>')
	})
})

const hasRsvg = !spawnSync('rsvg-convert', ['--version']).error

describe('renderBrand (#678)', () => {
	it('skips rendering with the install hint when rsvg-convert is not on PATH', async () => {
		const dir = newTmpDir()
		await generateBrand(PKG, dir)
		const path = process.env.PATH
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		process.env.PATH = join(dir, 'empty-bin')
		try {
			expect(await renderBrand(dir)).toBeNull()
			expect(spy.mock.calls.flat().join('\n')).toContain('brew install librsvg')
			expect(await fs.pathExists(join(dir, 'brand/banner.png'))).toBe(false)
		} finally {
			process.env.PATH = path
			spy.mockRestore()
		}
	})

	it('does nothing when there are no sources', async () => {
		expect(await renderBrand(newTmpDir())).toEqual([])
	})

	it.skipIf(!hasRsvg)('renders the PNGs and favicon.ico, then nothing once fresh', async () => {
		const dir = newTmpDir()
		await generateBrand(PKG, dir)

		expect(await renderBrand(dir)).toEqual([
			'brand/banner.png',
			'brand/banner-mobile.png',
			'brand/social-card.png',
			'brand/favicon-512.png',
			'brand/favicon.ico',
		])
		const ico = await fs.readFile(join(dir, 'brand/favicon.ico'))
		expect(ico.readUInt16LE(4)).toBe(2)
		expect(await renderBrand(dir)).toEqual([])
	})
})

describe('packIco', () => {
	it('writes an ICO directory pointing at each PNG frame', () => {
		const a = Buffer.from('AAAA')
		const b = Buffer.from('BBBBBB')
		const ico = packIco([
			[16, a],
			[256, b],
		])
		expect(ico.readUInt16LE(2)).toBe(1)
		expect(ico.readUInt16LE(4)).toBe(2)
		expect(ico[6]).toBe(16)
		expect(ico[22]).toBe(0) // 256 is stored as 0
		expect(ico.readUInt32LE(6 + 12)).toBe(38)
		expect(ico.subarray(38, 42).toString()).toBe('AAAA')
		expect(ico.subarray(42).toString()).toBe('BBBBBB')
	})
})

describe('README banner block (#678)', () => {
	const block = buildBannerBlock('widget-kit')

	it('prepends the block once and is idempotent', () => {
		const once = upsertBanner('# widget-kit\n', block)
		expect(once.startsWith(BANNER_START)).toBe(true)
		expect(once).toContain('alt="widget-kit banner"')
		expect(upsertBanner(once, block)).toBe(once)
	})

	it('refreshes an existing block in place', () => {
		const old = upsertBanner('# x\n', buildBannerBlock('old'))
		expect(upsertBanner(old, block)).toBe(upsertBanner('# x\n', block))
	})

	it('leaves a hand-written banner alone', () => {
		const readme = '<picture><img src="./brand/banner.png"></picture>\n# x\n'
		expect(upsertBanner(readme, block)).toBe(readme)
	})

	it('waits for a rendered banner before touching the README', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'README.md'), '# x\n')
		expect(await addReadmeBanner(dir, 'x')).toBeNull()

		await fs.outputFile(join(dir, 'brand/banner.png'), 'PNG')
		expect(await addReadmeBanner(dir, 'x')).toBe('README.md')
		expect(await addReadmeBanner(dir, 'x')).toBeNull()
	})
})

describe('resolveBrandMeta', () => {
	it("takes the accent from the docs site's dark-mode primary", async () => {
		const dir = newTmpDir()
		await fs.outputFile(
			join(dir, 'apps/docs/src/css/custom.css'),
			':root { --ifm-color-primary: #10b981; }\n[data-theme="dark"] { --ifm-color-primary: #34d399; }\n'
		)
		expect((await resolveBrandMeta(PKG, dir)).accent).toBe('#34d399')
	})

	it('falls back to the favicon ink, skipping its near-black background', async () => {
		const dir = newTmpDir()
		await fs.outputFile(
			join(dir, 'favicon.svg'),
			'<svg><rect fill="#080b16"/><path stroke="#f7df1e"/></svg>'
		)
		expect((await resolveBrandMeta(PKG, dir)).accent).toBe('#f7df1e')
	})

	it('falls back to a neutral grey when the repo commits no colour', async () => {
		const dir = newTmpDir()
		expect((await resolveBrandMeta(PKG, dir)).accent).toBe('#8b95a7')
	})

	it('names the project after the directory when there is no package.json', async () => {
		const dir = newTmpDir()
		const meta = await resolveBrandMeta(null, dir)
		expect(meta.name).toBe(dir.split('/').pop())
		expect(meta.install).toBeNull()
	})
})

describe('tagline (#666)', () => {
	const LONG =
		'A one-package JavaScript and TypeScript tooling distribution with every preset plus a CLI to scaffold and audit projects.'

	it('prefers rules.brand.tagline over the package.json description', async () => {
		const meta = await resolveBrandMeta(PKG, newTmpDir(), 'Short and sweet.')
		expect(meta.tagline).toBe('Short and sweet.')
	})

	it('falls back to the package.json description', async () => {
		const meta = await resolveBrandMeta(PKG, newTmpDir(), undefined)
		expect(meta.tagline).toBe('Widgets for everyone, everywhere.')
	})

	it('taglineFits allows two lines of the mobile budget and no more', () => {
		expect(taglineFits('Widgets for everyone, everywhere.')).toBe(true)
		expect(taglineFits(LONG)).toBe(false)
	})

	it('warns on stderr when the tagline will be cut off, and stays quiet otherwise', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			await generateBrand({ ...PKG, description: LONG }, newTmpDir())
			expect(spy.mock.calls.flat().join('\n')).toContain('rules.brand.tagline')
			spy.mockClear()
			await generateBrand({ ...PKG, description: LONG }, newTmpDir(), 'Short and sweet.')
			expect(spy).not.toHaveBeenCalled()
		} finally {
			spy.mockRestore()
		}
	})
})

describe('repointReadmeBanners', () => {
	it('moves root-level banner paths under brand/ and leaves everything else alone', async () => {
		const dir = newTmpDir()
		await fs.writeFile(
			join(dir, 'README.md'),
			'<source srcset="./banner-mobile.png">\n<img src="./banner.png">\n\n![docs](./docs/screenshot.png)\n'
		)

		expect(await repointReadmeBanners(dir)).toBe('README.md')
		const readme = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(readme).toContain('srcset="./brand/banner-mobile.png"')
		expect(readme).toContain('src="./brand/banner.png"')
		expect(readme).toContain('![docs](./docs/screenshot.png)')
	})

	it('is a no-op once the README already points at brand/', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'README.md'), '<img src="./brand/banner.png">\n')
		expect(await repointReadmeBanners(dir)).toBeNull()
	})
})

describe('wrapText', () => {
	it('wraps on word boundaries and ellipsises what does not fit', () => {
		expect(wrapText('one two three four', 8, 2)).toEqual(['one two', 'three…'])
		expect(wrapText('one two three four', 8, 2).join(' ')).not.toContain('four')
		expect(wrapText('aa bb cc dd ee ff', 5, 2)[1]).toMatch(/…$/)
	})
})

describe('checkBrand', () => {
	it('flags a rendered banner with no SVG source', async () => {
		const dir = newTmpDir()
		await fs.outputFile(join(dir, 'banner.png'), 'PNG')

		const result = await checkBrand(dir)
		expect(result.status).toBe('drift')
		expect(result.detail).toContain('no brand/*.svg source')
	})

	it('flags a README still pointing at root-level banners', async () => {
		const dir = newTmpDir()
		await generateBrand(PKG, dir)
		await fs.writeFile(join(dir, 'README.md'), '<img src="./banner.png">\n')

		const result = await checkBrand(dir)
		expect(result.status).toBe('drift')
		expect(result.detail).toContain('root-level banner PNGs')
	})

	it('flags sources that cannot be rendered', async () => {
		const dir = newTmpDir()
		await generateBrand(PKG, dir)
		await fs.remove(join(dir, 'brand/render.sh'))

		const result = await checkBrand(dir)
		expect(result.status).toBe('drift')
		expect(result.detail).toContain('render.sh')
	})

	it('is optional-missing for a repo with no brand images at all', async () => {
		const result = await checkBrand(newTmpDir())
		expect(result.status).toBe('optional-missing')
	})

	it('passes once the scaffolder has run and the README is repointed', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'README.md'), '<img src="./banner.png">\n')
		await fs.outputFile(join(dir, 'banner.png'), 'PNG')
		await generateBrand(PKG, dir)
		await fs.move(join(dir, 'banner.png'), join(dir, 'brand/banner.png'))

		expect((await checkBrand(dir)).status).toBe('ok')
	})
})
