import fs from 'fs-extra'
import path from 'node:path'
import type { ProjectConfig } from '../commands/setup.js'

export async function generateTestingConfigs(config: ProjectConfig, targetDir: string) {
	if (config.testing.framework === 'vitest') {
		await generateVitestConfig(config, targetDir)
	} else if (config.testing.framework === 'jest') {
		await generateJestConfig(config, targetDir)
	} else if (config.testing.framework === 'playwright') {
		await generatePlaywrightConfig(targetDir)
	} else if (config.testing.framework === 'cypress') {
		await generateCypressConfig(targetDir)
	}
}

export async function generateVitestConfig(config: ProjectConfig, targetDir: string) {
	const vitestConfigPath = path.join(targetDir, 'vitest.config.ts')

	// Vite reads `jsx` from tsconfig, and the next preset sets it to "preserve" so
	// Next's own compiler handles the transform. Vitest has no such compiler, so
	// .tsx tests fail to parse ("Unexpected token <") unless we opt back in here.
	// `oxc` (not `esbuild`) is the Vite 8 spelling — vitest ^4 resolves Vite 8,
	// and Vite 8 silently ignores the old `esbuild` key.
	const jsxOverride =
		config.projectType === 'nextjs-app'
			? `    // tsconfig sets jsx: "preserve" for Next's compiler; vitest needs a
    // transform of its own or .tsx tests won't parse.
    oxc: { jsx: { runtime: 'automatic' } },
`
			: ''

	// Layered on the shipped preset rather than hand-rolled: the preset owns
	// globals, the shared excludes and the v8/lcov coverage reporters, so preset
	// improvements reach consumers — and doctor's `Vitest` check (which looks for
	// this import) can actually pass after `fix vitest` (#387).
	const vitestConfig = `import base from '@rtorcato/repo-tooling/vitest/config'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
  base,
  defineConfig({
${jsxOverride}    test: {
      environment: '${config.testing.environment === 'browser' ? 'jsdom' : 'node'}',
      setupFiles: ['./vitest.setup.ts']
    }
  })
)
`

	await fs.writeFile(vitestConfigPath, vitestConfig)

	// Create setup file
	const setupPath = path.join(targetDir, 'vitest.setup.ts')
	const setupContent = `// Vitest setup file
// Add global test setup here
`
	await fs.writeFile(setupPath, setupContent)
}

async function generateJestConfig(config: ProjectConfig, targetDir: string) {
	const jestConfigPath = path.join(targetDir, 'jest.config.mjs')

	const environment = config.testing.environment === 'browser' ? 'browser' : 'node'

	const jestConfig = `export { default } from '@rtorcato/repo-tooling/jest-presets/${environment}/jest-preset'
`

	await fs.writeFile(jestConfigPath, jestConfig)
}

export async function generatePlaywrightConfig(targetDir: string) {
	const playwrightConfigPath = path.join(targetDir, 'playwright.config.ts')
	const playwrightConfig = `export { default } from '@rtorcato/repo-tooling/playwright'
`
	await fs.writeFile(playwrightConfigPath, playwrightConfig)
}

const CYPRESS_EXAMPLE_SPEC = `describe('example', () => {
  it('loads the app', () => {
    cy.visit('/')
  })
})
`

/**
 * Scaffolds cypress.config.ts (a re-export of the shipped preset) plus the
 * tests/e2e + cypress/support boilerplate. The config re-export is regenerated
 * every run (idempotent); boilerplate/specs are only created when absent, so
 * real tests are never clobbered. Returns the relative paths written.
 */
export async function generateCypressConfig(targetDir: string): Promise<string[]> {
	const written: string[] = []
	await fs.writeFile(
		path.join(targetDir, 'cypress.config.ts'),
		`export { default } from '@rtorcato/repo-tooling/cypress'\n`
	)
	written.push('cypress.config.ts')

	const boilerplate: Array<[string, string]> = [
		['cypress/support/e2e.ts', `import './commands'\n`],
		[
			'cypress/support/commands.ts',
			`// Add custom commands via Cypress.Commands.add(...).\nexport {}\n`,
		],
		['tests/e2e/example.cy.ts', CYPRESS_EXAMPLE_SPEC],
	]
	for (const [rel, content] of boilerplate) {
		const filePath = path.join(targetDir, rel)
		if (await fs.pathExists(filePath)) continue
		await fs.ensureDir(path.dirname(filePath))
		await fs.writeFile(filePath, content)
		written.push(rel)
	}
	return written
}
