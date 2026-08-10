import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { generateGitLabCI } from '../../../src/cli/generators/gitlab-ci.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		projectName: 'demo',
		projectType: 'library',
		typescript: { enabled: true, config: 'base' },
		linting: { tool: 'biome' },
		formatting: { tool: 'biome' },
		testing: { framework: 'vitest', environment: 'node' },
		gitHooks: true,
		commitLint: true,
		semanticRelease: false,
		securityAutomation: false,
		bundler: 'tsup',
		...overrides,
	}
}

describe('generateGitLabCI', () => {
	it('writes .gitlab-ci.yml with lint/typecheck/test/build for a full library config', async () => {
		const dir = newTmpDir()
		await generateGitLabCI(baseConfig(), dir)
		const yaml = await fs.readFile(join(dir, '.gitlab-ci.yml'), 'utf-8')
		expect(yaml).toMatch(/^lint:$/m)
		expect(yaml).toMatch(/^typecheck:$/m)
		expect(yaml).toMatch(/^test:$/m)
		expect(yaml).toMatch(/^build:$/m)
		expect(yaml).toContain('pnpm check')
		expect(yaml).toContain('pnpm exec vitest run')
		expect(yaml).toContain('pnpm install --frozen-lockfile')
	})

	it('emits pnpm lint when linting tool is eslint', async () => {
		const dir = newTmpDir()
		await generateGitLabCI(baseConfig({ linting: { tool: 'eslint' } }), dir)
		const yaml = await fs.readFile(join(dir, '.gitlab-ci.yml'), 'utf-8')
		expect(yaml).toContain('pnpm lint')
		expect(yaml).not.toContain('pnpm check')
	})

	it('omits typecheck stage when TypeScript is disabled', async () => {
		const dir = newTmpDir()
		await generateGitLabCI(
			baseConfig({ typescript: { enabled: false, config: 'base' } }),
			dir
		)
		const yaml = await fs.readFile(join(dir, '.gitlab-ci.yml'), 'utf-8')
		expect(yaml).not.toMatch(/^typecheck:/m)
	})

	it('omits build stage when bundler is none', async () => {
		const dir = newTmpDir()
		await generateGitLabCI(baseConfig({ bundler: 'none' }), dir)
		const yaml = await fs.readFile(join(dir, '.gitlab-ci.yml'), 'utf-8')
		expect(yaml).not.toMatch(/^build:/m)
		expect(yaml).not.toContain('pnpm build')
	})

	it('uses pnpm test:e2e for playwright projects', async () => {
		const dir = newTmpDir()
		await generateGitLabCI(baseConfig({ testing: { framework: 'playwright' } }), dir)
		const yaml = await fs.readFile(join(dir, '.gitlab-ci.yml'), 'utf-8')
		expect(yaml).toContain('pnpm test:e2e')
	})

	it('uses pnpm test:e2e for cypress projects', async () => {
		const dir = newTmpDir()
		await generateGitLabCI(baseConfig({ testing: { framework: 'cypress' } }), dir)
		const yaml = await fs.readFile(join(dir, '.gitlab-ci.yml'), 'utf-8')
		expect(yaml).toContain('pnpm test:e2e')
	})
})

describe('generateGitLabCI script gating', () => {
	async function render(config: ProjectConfig, scripts?: Record<string, string>) {
		const dir = newTmpDir()
		await generateGitLabCI(config, dir, { scripts })
		return fs.readFile(join(dir, '.gitlab-ci.yml'), 'utf-8')
	}

	it('omits jobs whose scripts the repo does not define', async () => {
		const yaml = await render(baseConfig(), { typecheck: 'tsc --noEmit' })

		expect(yaml).toMatch(/^typecheck:$/m)
		expect(yaml).not.toMatch(/^lint:$/m)
		expect(yaml).not.toContain('pnpm check')
		// No build script → no build job, and the artifacts block goes with it.
		expect(yaml).not.toMatch(/^build:$/m)
		expect(yaml).not.toContain('pnpm build')
		expect(yaml).not.toContain('dist/')
	})

	it('keeps the vitest job without a test script — pnpm exec needs none', async () => {
		const yaml = await render(baseConfig(), {})

		expect(yaml).toMatch(/^test:$/m)
		expect(yaml).toContain('pnpm exec vitest run')
	})

	it('drops the e2e job when test:e2e is missing, keeps it when present', async () => {
		const config = baseConfig({ testing: { framework: 'playwright' } })

		expect(await render(config, {})).not.toMatch(/^test:$/m)
		expect(await render(config, { 'test:e2e': 'playwright test' })).toContain('pnpm test:e2e')
	})

	it('keeps every job when the scripts are there', async () => {
		const yaml = await render(baseConfig(), {
			check: 'biome check .',
			typecheck: 'tsc --noEmit',
			build: 'tsup',
		})

		expect(yaml).toContain('pnpm check')
		expect(yaml).toContain('pnpm typecheck')
		expect(yaml).toContain('pnpm build')
		expect(yaml).toContain('- dist/')
	})

	it('assumes the full setup shape when no scripts are supplied', async () => {
		// setup writes these scripts as part of the same scaffold, so gating on a
		// package.json that doesn't exist yet would strip a working pipeline.
		const yaml = await render(baseConfig())

		expect(yaml).toContain('pnpm check')
		expect(yaml).toContain('pnpm typecheck')
		expect(yaml).toContain('pnpm build')
	})

	it('still emits a valid stages: key when every job is dropped', async () => {
		const yaml = await render(baseConfig({ testing: { framework: 'jest' } }), {})

		expect(yaml).toContain('stages:\n  - test\n')
		expect(yaml).not.toMatch(/^lint:$/m)
		expect(yaml).not.toMatch(/^typecheck:$/m)
		expect(yaml).not.toMatch(/^test:$/m)
		expect(yaml).not.toMatch(/^build:$/m)
	})
})
