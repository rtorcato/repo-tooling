import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { generateReadme } from '../../../src/cli/generators/readme.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		projectName: 'my-lib',
		projectType: 'library',
		typescript: { enabled: true, config: 'base' },
		linting: { tool: 'biome' },
		formatting: { tool: 'biome' },
		testing: { framework: 'none' },
		gitHooks: false,
		commitLint: false,
		semanticRelease: false,
		bundler: 'none',
		...overrides,
	}
}

describe('generateReadme', () => {
	it('leaves an existing README.md byte-identical (#868)', async () => {
		const dir = newTmpDir()
		const original = '# My hand-written project\n\nKeep me.\n'
		await fs.writeFile(join(dir, 'README.md'), original)
		await generateReadme(baseConfig({ badges: true }), dir)

		expect(await fs.readFile(join(dir, 'README.md'), 'utf-8')).toBe(original)
	})

	it('creates README.md with the project name as the title', async () => {
		const dir = newTmpDir()
		await generateReadme(baseConfig({ projectName: 'super-lib' }), dir)

		const content = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(content).toContain('# super-lib')
		expect(content).toContain('@rtorcato/repo-tooling')
	})

	it('inserts a badge block after the title when badges is enabled', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'my-lib',
			repository: 'git+https://github.com/rtorcato/my-lib.git',
		})
		await generateReadme(baseConfig({ projectName: 'my-lib', badges: true }), dir)

		const content = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(content).toContain('<!-- js-tooling:badges:start -->')
		expect(content).toContain('actions/workflows/ci.yml')
		expect(content).toContain('img.shields.io/npm/v/my-lib')
	})

	it('omits the badge block when badges is disabled', async () => {
		const dir = newTmpDir()
		await generateReadme(baseConfig({ badges: false }), dir)

		const content = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(content).not.toContain('js-tooling:badges:start')
	})

	it('includes Biome in the tooling list when linting tool is biome', async () => {
		const dir = newTmpDir()
		await generateReadme(baseConfig({ linting: { tool: 'biome' } }), dir)

		const content = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(content).toContain('Biome')
		expect(content).not.toContain('ESLint')
		expect(content).not.toContain('Prettier')
	})

	it('includes ESLint and Prettier in the tooling list when linting tool is eslint', async () => {
		const dir = newTmpDir()
		await generateReadme(baseConfig({ linting: { tool: 'eslint' } }), dir)

		const content = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(content).toContain('ESLint')
		expect(content).toContain('Prettier')
	})

	it('includes vitest test commands in the testing section', async () => {
		const dir = newTmpDir()
		await generateReadme(baseConfig({ testing: { framework: 'vitest' } }), dir)

		const content = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(content).toContain('pnpm test')
		expect(content).toContain('pnpm coverage')
	})

	it('shows "No testing framework configured" when framework is none', async () => {
		const dir = newTmpDir()
		await generateReadme(baseConfig({ testing: { framework: 'none' } }), dir)

		const content = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(content).toContain('No testing framework configured')
	})

	it('includes build commands when bundler is set', async () => {
		const dir = newTmpDir()
		await generateReadme(baseConfig({ bundler: 'tsup' }), dir)

		const content = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(content).toContain('pnpm build')
	})

	it('shows "No build configuration" when bundler is none', async () => {
		const dir = newTmpDir()
		await generateReadme(baseConfig({ bundler: 'none' }), dir)

		const content = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(content).toContain('No build configuration')
	})

	it('includes commit convention section when commitLint is enabled', async () => {
		const dir = newTmpDir()
		await generateReadme(baseConfig({ commitLint: true }), dir)

		const content = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(content).toContain('Conventional Commits')
		expect(content).toContain('`feat:`')
	})

	it('omits commit convention section when commitLint is disabled', async () => {
		const dir = newTmpDir()
		await generateReadme(baseConfig({ commitLint: false }), dir)

		const content = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(content).not.toContain('Conventional Commits')
	})

	it('includes vite dev command in development section when bundler is vite', async () => {
		const dir = newTmpDir()
		await generateReadme(baseConfig({ bundler: 'vite' }), dir)

		const content = await fs.readFile(join(dir, 'README.md'), 'utf-8')
		expect(content).toContain('pnpm dev')
	})
})
