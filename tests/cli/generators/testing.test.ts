import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { generateTestingConfigs } from '../../../src/cli/generators/testing.js'
import { FILE_CHECKS } from '../../../src/languages/js/checks.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		projectName: 'demo',
		projectType: 'library',
		typescript: { enabled: true, config: 'base' },
		linting: { tool: 'none' },
		formatting: { tool: 'none' },
		testing: { framework: 'none' },
		gitHooks: false,
		commitLint: false,
		semanticRelease: false,
		bundler: 'none',
		...overrides,
	}
}

describe('generateTestingConfigs', () => {
	it('writes vitest config + setup file with node environment by default', async () => {
		const dir = newTmpDir()
		await generateTestingConfigs(baseConfig({ testing: { framework: 'vitest' } }), dir)

		const vitestConfig = await fs.readFile(join(dir, 'vitest.config.ts'), 'utf-8')
		expect(vitestConfig).toContain("environment: 'node'")
		expect(await fs.pathExists(join(dir, 'vitest.setup.ts'))).toBe(true)
	})

	it('writes a vitest config that satisfies the doctor Vitest check', async () => {
		const dir = newTmpDir()
		await generateTestingConfigs(baseConfig({ testing: { framework: 'vitest' } }), dir)

		const vitestConfig = await fs.readFile(join(dir, 'vitest.config.ts'), 'utf-8')
		const matcher = FILE_CHECKS.find((c) => c.check === 'Vitest')?.matcher as RegExp
		expect(matcher).toBeDefined()
		expect(vitestConfig).toMatch(matcher)
		// …and the check still has teeth: an unrelated config must not match.
		expect('export default {}\n').not.toMatch(matcher)
	})

	it('keeps the Next.js jsx transform override on top of the preset', async () => {
		const dir = newTmpDir()
		await generateTestingConfigs(
			baseConfig({ projectType: 'nextjs-app', testing: { framework: 'vitest' } }),
			dir
		)

		const vitestConfig = await fs.readFile(join(dir, 'vitest.config.ts'), 'utf-8')
		expect(vitestConfig).toContain("oxc: { jsx: { runtime: 'automatic' } }")
		expect(vitestConfig).toContain('mergeConfig(')
	})

	it('uses jsdom environment when browser is requested', async () => {
		const dir = newTmpDir()
		await generateTestingConfigs(
			baseConfig({ testing: { framework: 'vitest', environment: 'browser' } }),
			dir
		)

		const vitestConfig = await fs.readFile(join(dir, 'vitest.config.ts'), 'utf-8')
		expect(vitestConfig).toContain("environment: 'jsdom'")
	})

	it('writes a jest config that re-exports the matching preset', async () => {
		const dir = newTmpDir()
		await generateTestingConfigs(
			baseConfig({ testing: { framework: 'jest', environment: 'browser' } }),
			dir
		)

		const jestConfig = await fs.readFile(join(dir, 'jest.config.mjs'), 'utf-8')
		expect(jestConfig).toContain('@rtorcato/repo-tooling/jest-presets/browser/jest-preset')
	})

	it('writes a playwright config that re-exports our preset', async () => {
		const dir = newTmpDir()
		await generateTestingConfigs(baseConfig({ testing: { framework: 'playwright' } }), dir)

		const playwrightConfig = await fs.readFile(join(dir, 'playwright.config.ts'), 'utf-8')
		expect(playwrightConfig).toContain("from '@rtorcato/repo-tooling/playwright'")
	})

	it('the shipped playwright preset references defineConfig and devices', async () => {
		const presetPath = join(process.cwd(), 'tooling/playwright/playwright.config.mjs')
		const preset = await fs.readFile(presetPath, 'utf-8')
		expect(preset).toMatch(/from '@playwright\/test'/)
		expect(preset).toMatch(/\bdefineConfig\b/)
		expect(preset).toMatch(/\bdevices\b/)
	})

	it('writes a cypress config re-export plus tests/e2e + support boilerplate', async () => {
		const dir = newTmpDir()
		await generateTestingConfigs(baseConfig({ testing: { framework: 'cypress' } }), dir)

		const cypressConfig = await fs.readFile(join(dir, 'cypress.config.ts'), 'utf-8')
		expect(cypressConfig).toContain("from '@rtorcato/repo-tooling/cypress'")
		expect(await fs.pathExists(join(dir, 'cypress/support/e2e.ts'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'cypress/support/commands.ts'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'tests/e2e/example.cy.ts'))).toBe(true)
	})

	it('does not clobber an existing cypress spec', async () => {
		const dir = newTmpDir()
		await fs.outputFile(join(dir, 'tests/e2e/example.cy.ts'), '// my real spec\n')
		await generateTestingConfigs(baseConfig({ testing: { framework: 'cypress' } }), dir)
		expect(await fs.readFile(join(dir, 'tests/e2e/example.cy.ts'), 'utf-8')).toBe(
			'// my real spec\n'
		)
	})

	it('the shipped cypress preset references cypress defineConfig', async () => {
		const preset = await fs.readFile(
			join(process.cwd(), 'tooling/cypress/cypress.config.mjs'),
			'utf-8'
		)
		expect(preset).toMatch(/from 'cypress'/)
		expect(preset).toMatch(/\bdefineConfig\b/)
	})

	it('writes nothing when framework is none', async () => {
		const dir = newTmpDir()
		await generateTestingConfigs(baseConfig({ testing: { framework: 'none' } }), dir)

		const entries = await fs.readdir(dir)
		expect(entries).toEqual([])
	})
})
