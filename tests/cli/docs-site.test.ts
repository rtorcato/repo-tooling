import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import selfPackageJson from '../../package.json' with { type: 'json' }
import { runDoctor } from '../../src/cli/commands/doctor.js'
import { generateDocsSite } from '../../src/cli/generators/docs-site.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const PKG = {
	name: '@rtorcato/repo-tooling',
	description: 'JS/TS tooling.',
	repository: 'git+https://github.com/rtorcato/js-tooling.git',
}

describe('generateDocsSite', () => {
	it('scaffolds a full site, inferring name/org/repo from package.json', async () => {
		const dir = newTmpDir()
		const written = await generateDocsSite(PKG, dir)

		// The whole file set lands.
		for (const rel of [
			'apps/docs/package.json',
			'apps/docs/docusaurus.config.ts',
			'apps/docs/sidebars.ts',
			'apps/docs/tsconfig.json',
			'apps/docs/src/css/custom.css',
			'apps/docs/src/css/_jt-tokens.css',
			'apps/docs/docs/intro.md',
			'apps/docs/playwright.config.ts',
			'apps/docs/tests/smoke.spec.ts',
			'scripts/sync-changelog.mjs',
			'.github/workflows/docs.yml',
			'pnpm-workspace.yaml',
		]) {
			expect(written).toContain(rel)
			expect(await fs.pathExists(join(dir, rel))).toBe(true)
		}

		// Docs package name = <name>-docs; build chains sync-changelog.
		const docsPkg = await fs.readJson(join(dir, 'apps/docs/package.json'))
		expect(docsPkg.name).toBe('@rtorcato/repo-tooling-docs')
		expect(docsPkg.scripts.build).toMatch(/sync-changelog/)
		expect(docsPkg.scripts['test:e2e']).toBe('playwright test')
		expect(docsPkg.devDependencies['@playwright/test']).toBeTruthy()

		// The guard that stops this rotting again: the self-pin handed to a
		// scaffolded site must track the running version. It had been a literal
		// `^2.47.0` — two majors stale — so new sites were given a pre-rename
		// version predating the peer-dependency split.
		expect(docsPkg.devDependencies['@rtorcato/repo-tooling']).toBe(`^${selfPackageJson.version}`)

		// Smoke test reuses the shipped preset and targets the site's base path.
		const pw = await fs.readFile(join(dir, 'apps/docs/playwright.config.ts'), 'utf-8')
		expect(pw).toContain("import base from '@rtorcato/repo-tooling/playwright'")
		expect(pw).toContain('http://localhost:3000/js-tooling/')

		// Config infers org/repo → GitHub Pages url + baseUrl.
		const config = await fs.readFile(join(dir, 'apps/docs/docusaurus.config.ts'), 'utf-8')
		expect(config).toContain("url: 'https://rtorcato.github.io'")
		expect(config).toContain("baseUrl: '/js-tooling/'")

		// #324: `theme` is the LIGHT-mode Prism theme. Both slots were vsDark, which
		// forced the shared stylesheet to pin fenced blocks dark in light mode too —
		// and the wrong pairing was copied into ten sites before anyone noticed.
		expect(config).toContain('theme: prismThemes.vsLight')
		expect(config).toContain('darkTheme: prismThemes.vsDark')

		// Workflow drives the shared reusable deploy with the docs package filter.
		const wf = await fs.readFile(join(dir, '.github/workflows/docs.yml'), 'utf-8')
		expect(wf).toContain('rtorcato/repo-tooling/.github/workflows/docs-deploy.yml@main')
		expect(wf).toContain("build-filter: '@rtorcato/repo-tooling-docs'")

		// custom.css imports the shared tokens, then overrides the accent.
		const css = await fs.readFile(join(dir, 'apps/docs/src/css/custom.css'), 'utf-8')
		expect(css).toContain('@import "./_jt-tokens.css"')
		expect(css).toMatch(/--ifm-color-primary/)
	})

	it('honours a primary-color override', async () => {
		const dir = newTmpDir()
		await generateDocsSite(PKG, dir, { primaryColor: { light: '#F38020', dark: '#ff9a4d' } })
		const css = await fs.readFile(join(dir, 'apps/docs/src/css/custom.css'), 'utf-8')
		expect(css).toContain('#F38020')
		expect(css).toContain('#ff9a4d')
	})

	it('is idempotent — a second run writes nothing and preserves edits', async () => {
		const dir = newTmpDir()
		await generateDocsSite(PKG, dir)
		// Hand-edit a generated file; the re-run must not clobber it.
		const configPath = join(dir, 'apps/docs/docusaurus.config.ts')
		await fs.writeFile(configPath, '// edited by hand\n')

		const second = await generateDocsSite(PKG, dir)
		expect(second).toEqual([])
		expect(await fs.readFile(configPath, 'utf-8')).toBe('// edited by hand\n')
	})

	it('adds apps/* to an existing pnpm-workspace without duplicating', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
		await generateDocsSite(PKG, dir)
		const ws = await fs.readFile(join(dir, 'pnpm-workspace.yaml'), 'utf-8')
		expect(ws).toMatch(/apps\/\*/)
		expect(ws).toMatch(/packages\/\*/)

		// Re-running does not add a second apps/* entry.
		await generateDocsSite(PKG, dir)
		const ws2 = await fs.readFile(join(dir, 'pnpm-workspace.yaml'), 'utf-8')
		expect(ws2.match(/apps\/\*/g)?.length).toBe(1)
	})

	it('produces a site the doctor Docs site check reports as ok', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), PKG)
		await generateDocsSite(PKG, dir)
		const docs = (await runDoctor(dir)).find((r) => r.check === 'Docs site')
		expect(docs?.status).toBe('ok')
	})

	// A Changesets repo writes per-package changelogs and its root package is
	// private, so there is no root CHANGELOG.md for sync-changelog to pump (#425).
	it('does not require sync-changelog on a Changesets repo (#425)', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), PKG)
		await generateDocsSite(PKG, dir)
		await fs.remove(join(dir, 'scripts/sync-changelog.mjs'))
		const docsPkgPath = join(dir, 'apps/docs/package.json')
		const docsPkg = await fs.readJson(docsPkgPath)
		docsPkg.scripts = { build: 'docusaurus build', start: 'docusaurus start' }
		await fs.writeJson(docsPkgPath, docsPkg)

		// Without Changesets the same layout is still drift.
		const before = (await runDoctor(dir)).find((r) => r.check === 'Docs site')
		expect(before?.status).toBe('drift')
		expect(before?.detail).toContain('sync-changelog.mjs missing')

		await fs.outputJson(join(dir, '.changeset/config.json'), { changelog: '@changesets/cli' })
		const after = (await runDoctor(dir)).find((r) => r.check === 'Docs site')
		expect(after?.status).toBe('ok')
	})

	it('emits the shared badge row into the docs homepage (#169)', async () => {
		const dir = newTmpDir()
		await generateDocsSite(PKG, dir)
		const intro = await fs.readFile(join(dir, 'apps/docs/docs/intro.md'), 'utf-8')
		expect(intro).toContain('actions/workflows/ci.yml/badge.svg') // CI
		expect(intro).toContain('img.shields.io/npm/v/@rtorcato/repo-tooling') // npm version
		expect(intro).toContain('License: MIT')
	})

	it('drops 404-prone badges on a private package (#169)', async () => {
		const dir = newTmpDir()
		await generateDocsSite({ ...PKG, private: true }, dir)
		const intro = await fs.readFile(join(dir, 'apps/docs/docs/intro.md'), 'utf-8')
		// Private → no npm/bundlephobia/codecov (they'd 404); CI + license stay.
		expect(intro).not.toMatch(/img\.shields\.io\/npm\/|bundlephobia|codecov\.io/)
		expect(intro).toContain('License: MIT')
	})

	it('omits TypeDoc wiring by default', async () => {
		const dir = newTmpDir()
		await generateDocsSite(PKG, dir)
		const config = await fs.readFile(join(dir, 'apps/docs/docusaurus.config.ts'), 'utf-8')
		expect(config).not.toContain('getTypedocPlugins')
		const docsPkg = await fs.readJson(join(dir, 'apps/docs/package.json'))
		expect(docsPkg.devDependencies['docusaurus-plugin-typedoc']).toBeUndefined()
		expect(await fs.pathExists(join(dir, 'apps/docs/.gitignore'))).toBe(false)
	})

	it('wires TypeDoc (#229) from single-segment subpath exports when enabled', async () => {
		const dir = newTmpDir()
		const modulePkg = {
			name: '@rtorcato/js-common',
			repository: 'git+https://github.com/rtorcato/js-common.git',
			exports: {
				'.': './dist/index.js',
				'./errors': './dist/errors/index.js',
				'./env': './dist/env/index.js',
				// Multi-segment = config/asset export, not a source module → excluded.
				'./typescript/base': './x.json',
			},
		}
		await generateDocsSite(modulePkg, dir, { typedoc: true })

		const config = await fs.readFile(join(dir, 'apps/docs/docusaurus.config.ts'), 'utf-8')
		expect(config).toContain(
			"import { getTypedocPlugins } from '@rtorcato/repo-tooling/docusaurus'"
		)
		expect(config).toContain('getTypedocPlugins(["errors","env"])')
		expect(config).not.toContain('typescript/base')

		const docsPkg = await fs.readJson(join(dir, 'apps/docs/package.json'))
		for (const dep of ['docusaurus-plugin-typedoc', 'typedoc', 'typedoc-plugin-markdown']) {
			expect(docsPkg.devDependencies[dep]).toBeTruthy()
		}

		const gitignore = await fs.readFile(join(dir, 'apps/docs/.gitignore'), 'utf-8')
		expect(gitignore).toContain('docs/api/')
	})

	it('is a no-op for TypeDoc when the package exposes no source modules', async () => {
		const dir = newTmpDir()
		// PKG has no `exports`, so there are no modules to document.
		await generateDocsSite(PKG, dir, { typedoc: true })
		const config = await fs.readFile(join(dir, 'apps/docs/docusaurus.config.ts'), 'utf-8')
		expect(config).not.toContain('getTypedocPlugins')
		expect(await fs.pathExists(join(dir, 'apps/docs/.gitignore'))).toBe(false)
	})
})
