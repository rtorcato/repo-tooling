import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { checkBrand } from '../../../src/base/checks.js'
import {
	generateBrand,
	repointReadmeBanners,
	resolveBrandMeta,
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
