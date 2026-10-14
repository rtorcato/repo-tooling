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

/** Where an existing config can sit — the same candidates doctor's Vitest check reads. */
const VITEST_CONFIGS = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs']

/** Blank out strings and comments (same length) so brackets inside them can't count. */
function maskStringsAndComments(src: string): string {
	return src.replace(
		/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
		(m) => (m[0] === '/' ? ' '.repeat(m.length) : m[0] + ' '.repeat(m.length - 2) + m[0])
	)
}

/** Index just past the bracket that closes the one at `open`, or -1. */
function closingIndex(mask: string, open: number): number {
	let depth = 0
	for (let i = open; i < mask.length; i++) {
		if ('{[('.includes(mask.charAt(i))) depth++
		else if ('}])'.includes(mask.charAt(i)) && --depth === 0) return i + 1
	}
	return -1
}

/**
 * The array literals a repo's own config sets for `test.include`, `test.exclude`
 * and `test.setupFiles`, as source text. These say which files are tests at all,
 * which the preset can't know: rewriting the config without them collected
 * workerd suites and Playwright specs on cf-common, and compiled tests under
 * `dist/` on db-common (#874). Only direct keys of `test` count, so a
 * `coverage.include` is left alone.
 *
 * ponytail: a text scan, not a TS parser. A key whose value isn't an array
 * literal (a variable, a spread of an import) is dropped as before; a parser
 * would be the upgrade if that turns up.
 */
export function extractVitestTestOptions(src: string): Record<string, string> {
	const mask = maskStringsAndComments(src)
	const at = mask.search(/\btest\s*:\s*\{/)
	if (at < 0) return {}
	const found: Record<string, string> = {}
	const key = /(include|exclude|setupFiles)\s*:\s*\[/y
	for (let i = mask.indexOf('{', at) + 1, depth = 1; i < mask.length && depth > 0; i++) {
		if (depth === 1 && /[\s{,]/.test(mask.charAt(i - 1))) {
			key.lastIndex = i
			const m = key.exec(mask)
			if (m) {
				const from = i + m[0].length - 1
				const to = closingIndex(mask, from)
				if (to < 0) break
				found[m[1] as string] = src.slice(from, to)
				i = to - 1
				continue
			}
		}
		if ('{[('.includes(mask.charAt(i))) depth++
		else if ('}])'.includes(mask.charAt(i))) depth--
	}
	// The preset's exclude already starts from configDefaults.exclude, and the
	// generated file doesn't import configDefaults, so the spread can't stay.
	if (found.exclude) {
		const rest = found.exclude.replace(/\.\.\.\s*configDefaults\.exclude\s*,?\s*/, '')
		if (/^\[\s*\]$/.test(rest)) delete found.exclude
		else found.exclude = rest
	}
	return found
}

async function readVitestTestOptions(targetDir: string): Promise<Record<string, string>> {
	for (const name of VITEST_CONFIGS) {
		const file = path.join(targetDir, name)
		if (await fs.pathExists(file)) return extractVitestTestOptions(await fs.readFile(file, 'utf-8'))
	}
	return {}
}

export async function generateVitestConfig(config: ProjectConfig, targetDir: string) {
	const vitestConfigPath = path.join(targetDir, 'vitest.config.ts')
	const kept = await readVitestTestOptions(targetDir)

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
${kept.include ? `      include: ${kept.include},\n` : ''}${kept.exclude ? `      exclude: ${kept.exclude},\n` : ''}      setupFiles: ${kept.setupFiles ?? "['./vitest.setup.ts']"}
    }
  })
)
`

	await fs.writeFile(vitestConfigPath, vitestConfig)

	// The repo's own setupFiles point somewhere else; an empty one here is clutter.
	if (kept.setupFiles) return

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
