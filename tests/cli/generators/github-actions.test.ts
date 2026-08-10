import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { CI_WORKFLOW, generateGitHubActions } from '../../../src/cli/generators/github-actions.js'
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

const WORKFLOW_PATH = join('.github', 'workflows', 'ci.yml')

describe('generateGitHubActions', () => {
	it('creates .github/workflows/ci.yml', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig(), dir)

		expect(await fs.pathExists(join(dir, WORKFLOW_PATH))).toBe(true)
		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).toContain('CI/CD Pipeline')
		// Read Node from .nvmrc rather than a hardcoded literal — a pinned '20'
		// drifts from engines (>=22) and crashes under pnpm 11 (node:sqlite).
		expect(content).toContain('node-version-file: .nvmrc')
		expect(content).not.toContain("node-version: '20'")
	})

	it('sets up pnpm without a version input (packageManager is the source of truth)', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig(), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).toContain('uses: pnpm/action-setup@v6')
		expect(content).not.toContain('version: latest')
	})

	it('adds a publint step to the build job when publint is enabled', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ bundler: 'tsup', publint: true }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).toContain('Validate package with publint')
		expect(content).toContain('pnpm exec publint --strict')
	})

	it('omits the publint step when publint is disabled', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ bundler: 'tsup', publint: false }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).not.toContain('publint')
	})

	it('includes typecheck job when TypeScript is enabled', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ typescript: { enabled: true, config: 'base' } }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).toContain('typecheck:')
		expect(content).toContain('pnpm typecheck')
	})

	it('omits typecheck job when TypeScript is disabled', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(
			baseConfig({ typescript: { enabled: false, config: 'base' } }),
			dir
		)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).not.toContain('typecheck:')
	})

	it('includes test job when a testing framework is configured', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ testing: { framework: 'jest' } }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).toContain('test:')
		expect(content).toContain('pnpm test')
	})

	it('omits test job when testing framework is none', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ testing: { framework: 'none' } }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).not.toContain('Run tests')
	})

	it('uploads coverage and emits codecov.yml for Vitest', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ testing: { framework: 'vitest' } }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).toContain('pnpm coverage')
		expect(content).toContain('codecov/codecov-action@v7')
		expect(content).toContain('CODECOV_TOKEN')
		expect(await fs.pathExists(join(dir, 'codecov.yml'))).toBe(true)
	})

	it('does not upload coverage or emit codecov.yml when tests are absent', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ testing: { framework: 'none' } }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).not.toContain('codecov')
		expect(await fs.pathExists(join(dir, 'codecov.yml'))).toBe(false)
	})

	it('includes build job when bundler is configured', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ bundler: 'tsup' }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).toContain('build:')
		expect(content).toContain('pnpm build')
		expect(content).toContain('upload-artifact')
	})

	it('adds an attw type-resolution step to the build job for libraries', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ projectType: 'library', bundler: 'tsup' }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).toContain('are-the-types-wrong')
		expect(content).toContain('pnpm attw')
	})

	it('omits the attw step for non-library projects', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ projectType: 'react-app', bundler: 'vite' }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).not.toContain('pnpm attw')
	})

	it('omits build job when bundler is none', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ bundler: 'none' }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).not.toContain('Build project')
	})

	it('includes release job for library + semanticRelease', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(
			baseConfig({ projectType: 'library', semanticRelease: true, bundler: 'tsup' }),
			dir
		)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).toContain('release:')
		expect(content).toContain('semantic-release')
		// Publishes via OIDC trusted publishing — id-token permission, no NPM_TOKEN secret.
		expect(content).toContain('id-token: write')
		expect(content).not.toContain('secrets.NPM_TOKEN')
	})

	it('omits release job when semanticRelease is false', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ semanticRelease: false }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).not.toContain('semantic-release')
	})

	it('uses pnpm check in lint job when linting tool is biome', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig({ linting: { tool: 'biome' } }), dir)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).toContain('pnpm check')
	})

	// #349/#340: this generator used to writeFile unconditionally, so a consuming
	// repo's Dependabot-bumped pin was reverted on every sync — no diff, no prompt,
	// no backup — and Dependabot re-opened the identical PR forever.
	it('leaves a customized ci.yml alone rather than silently overwriting it', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig(), dir)
		const customized = `${await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')}\n# hand-edited\n`
		await fs.writeFile(join(dir, WORKFLOW_PATH), customized)

		const written = await generateGitHubActions(baseConfig(), dir)

		expect(written).not.toContain(CI_WORKFLOW)
		expect(await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')).toBe(customized)
	})

	it('replaces a customized ci.yml only when the caller opts in', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig(), dir)
		await fs.writeFile(join(dir, WORKFLOW_PATH), '# hand-edited\n')

		const written = await generateGitHubActions(baseConfig(), dir, { overwrite: true })

		expect(written).toContain(CI_WORKFLOW)
		expect(await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')).toContain('CI/CD Pipeline')
	})

	it('rewrites an untouched ci.yml, so a preset change still lands', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(baseConfig(), dir)

		const written = await generateGitHubActions(baseConfig(), dir)

		expect(written).toContain(CI_WORKFLOW)
	})

	it('uses pnpm lint in lint job when linting tool is eslint', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(
			baseConfig({ linting: { tool: 'eslint', eslintConfig: 'base' } }),
			dir
		)

		const content = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')
		expect(content).toContain('pnpm lint')
	})
})

// #364: the generated workflow called `pnpm check`, `pnpm knip` and
// `pnpm coverage` on repos where no fix target had ever created those scripts,
// so every run died with ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL.
describe('generateGitHubActions script gating', () => {
	const config = baseConfig({
		testing: { framework: 'vitest' },
		bundler: 'tsup',
	})

	it('omits steps whose scripts the repo does not define', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(config, dir, {
			scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' },
		})
		const workflow = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')

		expect(workflow).toContain('run: pnpm typecheck')
		// No check/knip script → the whole lint job goes, rather than a job with
		// no steps.
		expect(workflow).not.toContain('run: pnpm check')
		expect(workflow).not.toContain('run: pnpm knip')
		expect(workflow).not.toMatch(/^ {2}lint:$/m)
		// No coverage script → run the tests that do exist, and drop the upload
		// since there'd be no lcov to send.
		expect(workflow).toContain('run: pnpm test')
		expect(workflow).not.toContain('codecov-action')
		// No build script → no build job.
		expect(workflow).not.toContain('run: pnpm build')
	})

	it('keeps every step when the scripts are there', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(config, dir, {
			scripts: {
				typecheck: 'tsc --noEmit',
				check: 'biome check .',
				knip: 'knip',
				coverage: 'vitest run --coverage',
				build: 'tsup',
				attw: 'attw --pack',
			},
		})
		const workflow = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')

		expect(workflow).toContain('run: pnpm check')
		expect(workflow).toContain('run: pnpm knip')
		expect(workflow).toContain('run: pnpm coverage')
		expect(workflow).toContain('codecov-action')
		expect(workflow).toContain('run: pnpm build')
		expect(workflow).toContain('run: pnpm attw')
	})

	it('assumes the full setup shape when no scripts are supplied', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(config, dir)
		const workflow = await fs.readFile(join(dir, WORKFLOW_PATH), 'utf-8')

		// setup writes these scripts as part of the same scaffold, so gating on a
		// package.json that doesn't exist yet would strip a working pipeline.
		expect(workflow).toContain('run: pnpm check')
		expect(workflow).toContain('run: pnpm knip')
		expect(workflow).toContain('run: pnpm coverage')
	})
})
