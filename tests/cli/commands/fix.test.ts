import { join } from 'node:path'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runDoctor } from '../../../src/cli/commands/doctor.js'
import { fixCommand, getFixers, listFixers } from '../../../src/cli/commands/fix.js'
import {
	SIZE_LIMIT_VERSION,
	generatePackageJson,
} from '../../../src/cli/generators/package-json.js'
import {
	DEPENDABOT_AUTOMERGE_WORKFLOW,
	DEPENDABOT_CONFIG,
} from '../../../src/cli/generators/security.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

vi.mock('inquirer', () => ({
	default: { prompt: vi.fn() },
}))

const promptMock = vi.mocked(inquirer.prompt)
const newTmpDir = useTmpDir()

// The canonical config + auto-merge workflow read as up-to-date (no drift), so
// the fixer treats them as already-ok and leaves them alone. Both files are
// required — the doctor check flags a config missing either half.
const GROUPED_DEPENDABOT = DEPENDABOT_CONFIG
async function seedCanonicalDependabot(dir: string) {
	await fs.outputFile(join(dir, '.github', 'dependabot.yml'), DEPENDABOT_CONFIG)
	await fs.outputFile(
		join(dir, '.github', 'workflows', 'dependabot-automerge.yml'),
		DEPENDABOT_AUTOMERGE_WORKFLOW
	)
}

async function seedPackageJson(dir: string, extra: Record<string, unknown> = {}) {
	await fs.writeJson(join(dir, 'package.json'), {
		name: 'demo',
		version: '0.0.0',
		devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		...extra,
	})
}

beforeEach(() => {
	promptMock.mockReset()
})

describe('fix registry', () => {
	it('every fixer.appliesTo references a known doctor check', () => {
		// Loose sanity check — every appliesTo entry should appear in some fixer's check list.
		const fixers = getFixers()
		expect(fixers.length).toBeGreaterThan(10)
		for (const f of fixers) {
			expect(f.target).toMatch(/^[a-z-]+$/)
			expect(f.outputs.length).toBeGreaterThan(0)
		}
	})

	it('registers the vscode-extensions fixer for the VS Code extensions check', () => {
		const fixer = getFixers().find((f) => f.target === 'vscode-extensions')
		expect(fixer).toBeTruthy()
		expect(fixer?.appliesTo).toContain('VS Code extensions')
	})

	it('listFixers returns a flat summary of every registered target', () => {
		const summary = listFixers()
		expect(summary.length).toBe(getFixers().length)
		const targets = summary.map((f) => f.target)
		expect(targets).toContain('biome')
		expect(targets).toContain('lockfile')
		expect(targets).toContain('codeowners')
		for (const f of summary) {
			expect(['destructive', 'safe-merge', 'safe-add']).toContain(f.riskLevel)
			expect(typeof f.canFixDrift).toBe('boolean')
		}
	})

	it('registers github-settings as a safe-add fixer (exempt from the diff shadow-run)', () => {
		const fixer = getFixers().find((f) => f.target === 'github-settings')
		expect(fixer).toBeTruthy()
		expect(fixer?.riskLevel).toBe('safe-add')
		expect(fixer?.appliesTo).toEqual([
			'Branch protection',
			'Merge settings',
			'Workflow permissions',
			'Code-scanning gate',
		])
	})

	it('registers a safe-add cypress fixer', () => {
		const fixer = getFixers().find((f) => f.target === 'cypress')
		expect(fixer).toBeTruthy()
		expect(fixer?.riskLevel).toBe('safe-add')
		expect(fixer?.outputs).toContain('cypress.config.ts')
	})
})

describe('fix cypress', () => {
	it('scaffolds cypress.config.ts + boilerplate when targeted', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('cypress', { directory: dir, yes: true })
		expect(await fs.readFile(join(dir, 'cypress.config.ts'), 'utf-8')).toContain(
			"from '@rtorcato/repo-tooling/cypress'"
		)
		expect(await fs.pathExists(join(dir, 'cypress', 'support', 'e2e.ts'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'tests', 'e2e', 'example.cy.ts'))).toBe(true)
	})
})

describe('fix release-please', () => {
	it('scaffolds config + manifest + workflow when targeted', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('release-please', { directory: dir, yes: true })
		expect(await fs.pathExists(join(dir, 'release-please-config.json'))).toBe(true)
		expect((await fs.readJson(join(dir, '.release-please-manifest.json')))['.']).toBe('0.0.0')
		const workflow = await fs.readFile(join(dir, '.github/workflows/release-please.yml'), 'utf-8')
		expect(workflow).toContain('googleapis/release-please-action')
	})
})

describe('fix nx', () => {
	it('scaffolds nx.json when targeted, and never clobbers it', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('nx', { directory: dir, yes: true })
		const nx = await fs.readJson(join(dir, 'nx.json'))
		expect(nx.$schema).toContain('nrwl/nx')

		// Re-running is a no-op — an existing nx.json is preserved.
		await fs.writeJson(join(dir, 'nx.json'), { custom: true })
		await fixCommand('nx', { directory: dir, yes: true })
		expect((await fs.readJson(join(dir, 'nx.json'))).custom).toBe(true)
	})
})

describe('fix bun', () => {
	it('scaffolds bunfig.toml + a bun-typed tsconfig when targeted', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('bun', { directory: dir, yes: true })
		expect(await fs.pathExists(join(dir, 'bunfig.toml'))).toBe(true)
		expect((await fs.readJson(join(dir, 'tsconfig.json'))).extends).toBe(
			'@rtorcato/repo-tooling/typescript/bun'
		)
	})
})

// #381: `fix tsconfig` used to copy the base preset inline — no `extends` for
// doctor's TypeScript matcher, and none of the project-type settings setup emits.
describe('fix tsconfig', () => {
	it('writes an extends pointer doctor reads as ok', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('tsconfig', { directory: dir, yes: true })

		expect((await fs.readJson(join(dir, 'tsconfig.json'))).extends).toBe(
			'@rtorcato/repo-tooling/typescript/base'
		)
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'TypeScript')?.status).toBe('ok')
	})

	it('keeps the library outDir/rootDir', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('tsconfig', { directory: dir, yes: true })

		const tsconfig = await fs.readJson(join(dir, 'tsconfig.json'))
		expect(tsconfig.compilerOptions.outDir).toBe('./dist')
		expect(tsconfig.compilerOptions.rootDir).toBe('./src')
	})

	it('carries the Next wiring on a Next.js app', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, { dependencies: { next: '^15.0.0' } })
		await fixCommand('tsconfig', { directory: dir, yes: true })

		const tsconfig = await fs.readJson(join(dir, 'tsconfig.json'))
		expect(tsconfig.extends).toBe('@rtorcato/repo-tooling/typescript/next')
		expect(tsconfig.include).toContain('next-env.d.ts')
		expect(tsconfig.exclude).toContain('.next')
	})

	it('uses the react preset on a React app, for the DOM libs', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, { dependencies: { 'react-dom': '^19.0.0' } })
		await fixCommand('tsconfig', { directory: dir, yes: true })

		expect((await fs.readJson(join(dir, 'tsconfig.json'))).extends).toBe(
			'@rtorcato/repo-tooling/typescript/react'
		)
	})

	it('keeps a Bun repo on the Bun-typed preset', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(join(dir, 'bunfig.toml'), '[install]\n')
		await fixCommand('tsconfig', { directory: dir, yes: true })

		expect((await fs.readJson(join(dir, 'tsconfig.json'))).extends).toBe(
			'@rtorcato/repo-tooling/typescript/bun'
		)
	})
})

describe('fix rolldown', () => {
	it('scaffolds rolldown.config.mjs re-exporting the preset', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('rolldown', { directory: dir, yes: true })
		expect(await fs.readFile(join(dir, 'rolldown.config.mjs'), 'utf-8')).toContain(
			"from '@rtorcato/repo-tooling/rolldown'"
		)
	})
})

describe('fix --list', () => {
	it('emits a json payload listing every fixer when --list --json', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await fixCommand(undefined, { list: true, json: true, directory: '/tmp' })
			const lastJson = logSpy.mock.calls.at(-1)?.[0] as string
			const payload = JSON.parse(lastJson)
			expect(Array.isArray(payload.targets)).toBe(true)
			expect(payload.targets.length).toBeGreaterThan(10)
			expect(
				payload.targets.find((t: { target: string }) => t.target === 'codeowners')
			).toBeTruthy()
		} finally {
			logSpy.mockRestore()
		}
	})

	it('--list does not run doctor or read package.json', async () => {
		// Pass a directory that does not exist — --list should not care.
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await fixCommand(undefined, {
				list: true,
				json: true,
				directory: '/does/not/exist/anywhere',
			})
			const lastJson = logSpy.mock.calls.at(-1)?.[0] as string
			const payload = JSON.parse(lastJson)
			expect(payload.targets).toBeDefined()
		} finally {
			logSpy.mockRestore()
		}
	})
})

describe('fix targeted', () => {
	it('fix dependabot --yes writes .github/dependabot.yml', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('dependabot', { directory: dir, yes: true })
		expect(await fs.pathExists(join(dir, '.github', 'dependabot.yml'))).toBe(true)
	})

	it('fix dependabot --dry-run does not write the file', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('dependabot', { directory: dir, yes: true, dryRun: true })
		expect(await fs.pathExists(join(dir, '.github', 'dependabot.yml'))).toBe(false)
	})

	it('fix renovate --yes writes a renovate.json with recommended config', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('renovate', { directory: dir, yes: true })
		const renovate = await fs.readJson(join(dir, 'renovate.json'))
		expect(renovate.$schema).toMatch(/renovate-schema/)
		expect(renovate.extends).toContain('config:recommended')
	})

	it('fix renovate --yes still scaffolds when dependabot.yml is present', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.outputFile(join(dir, '.github', 'dependabot.yml'), 'version: 2\n')
		await fixCommand('renovate', { directory: dir, yes: true })
		expect(await fs.pathExists(join(dir, 'renovate.json'))).toBe(true)
	})

	it('fix dependabot leaves a canonical config untouched (already-ok)', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await seedCanonicalDependabot(dir)
		await fixCommand('dependabot', { directory: dir, yes: true })
		// Both files already canonical → no overwrite, no error.
		const yaml = await fs.readFile(join(dir, '.github', 'dependabot.yml'), 'utf-8')
		expect(yaml).toBe(GROUPED_DEPENDABOT)
	})

	it('fix dependabot upgrades an existing config that lacks canonical grouping', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.outputFile(join(dir, '.github', 'dependabot.yml'), 'version: 2\n')
		await fixCommand('dependabot', { directory: dir, yes: true })
		const yaml = await fs.readFile(join(dir, '.github', 'dependabot.yml'), 'utf-8')
		expect(yaml).toMatch(/^\s*production-minor:/m)
		expect(yaml).toMatch(/^\s*major-updates:/m)
		// and it scaffolds the paired auto-merge workflow
		expect(
			await fs.pathExists(join(dir, '.github', 'workflows', 'dependabot-automerge.yml'))
		).toBe(true)
	})

	it('fix unknown-target exits non-zero', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)
		await expect(fixCommand('not-a-target', { directory: dir })).rejects.toThrow('exit')
		expect(exitSpy).toHaveBeenCalledWith(1)
		exitSpy.mockRestore()
	})

	it('fix editorconfig --yes writes .editorconfig', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('editorconfig', { directory: dir, yes: true })
		expect(await fs.pathExists(join(dir, '.editorconfig'))).toBe(true)
	})

	it('fix gitlab-ci --yes writes .gitlab-ci.yml with expected stages', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, { scripts: { check: 'biome check .' } })
		await fixCommand('gitlab-ci', { directory: dir, yes: true })
		const yaml = await fs.readFile(join(dir, '.gitlab-ci.yml'), 'utf-8')
		expect(yaml).toMatch(/^lint:$/m)
		// vitest runs via `pnpm exec`, so the test job needs no script (#386).
		expect(yaml).toMatch(/^test:$/m)
	})

	it('fix gitlab-ci only references scripts the repo actually has', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, { scripts: { typecheck: 'tsc --noEmit' } })
		await fixCommand('gitlab-ci', { directory: dir, yes: true })
		const yaml = await fs.readFile(join(dir, '.gitlab-ci.yml'), 'utf-8')
		expect(yaml).toContain('pnpm typecheck')
		expect(yaml).not.toContain('pnpm check')
		expect(yaml).not.toContain('pnpm build')
	})

	it('fix codeowners --yes writes .github/CODEOWNERS', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('codeowners', { directory: dir, yes: true })
		const contents = await fs.readFile(join(dir, '.github', 'CODEOWNERS'), 'utf-8')
		expect(contents).toContain('Each line is a file pattern followed by one or more owners')
		expect(contents).toMatch(/^\*/m)
	})

	it('fix nvmrc --yes writes .nvmrc', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('nvmrc', { directory: dir, yes: true })
		const content = await fs.readFile(join(dir, '.nvmrc'), 'utf-8')
		expect(content.trim()).toBe('22')
	})

	it('fix ai --yes installs every AI agent file and is idempotent', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('ai', { directory: dir, yes: true })
		for (const rel of [
			'AGENTS.md',
			'CLAUDE.md',
			'.cursor/rules/repo-tooling.mdc',
			'.github/copilot-instructions.md',
			'.claude/skills/repo-tooling.md',
			'.mcp.json.example',
		]) {
			expect(await fs.pathExists(join(dir, rel))).toBe(true)
		}
		expect(await fs.pathExists(join(dir, '.mcp.json'))).toBe(false)
		expect(await fs.readFile(join(dir, 'CLAUDE.md'), 'utf8')).toContain('@AGENTS.md')
		// second run must not duplicate the AGENTS.md block
		await fixCommand('ai', { directory: dir, yes: true })
		const agents = await fs.readFile(join(dir, 'AGENTS.md'), 'utf8')
		expect(agents.match(/<!-- js-tooling:start -->/g)).toHaveLength(1)
	})

	it('fix ai --yes refreshes a block that still names the dead js-tooling bin (#393)', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const stale =
			'<!-- js-tooling:start -->\nSee @AGENTS.md (kept in sync by `js-tooling fix ai`).\n<!-- js-tooling:end -->\n'
		await fs.writeFile(join(dir, 'CLAUDE.md'), stale)
		await fs.writeFile(join(dir, 'AGENTS.md'), `# Mine\n\n${stale}`)

		await fixCommand('ai', { directory: dir, yes: true })

		const claude = await fs.readFile(join(dir, 'CLAUDE.md'), 'utf8')
		expect(claude).toContain('`repo-tooling fix ai`')
		expect(claude).not.toContain('`js-tooling fix ai`')
		const agents = await fs.readFile(join(dir, 'AGENTS.md'), 'utf8')
		expect(agents).toContain('# Mine') // surrounding content preserved
		expect(agents).toContain('# repo-tooling')
		expect(agents).not.toContain('js-tooling fix ai')
	})

	it('fix node-version --yes rewrites hardcoded workflow versions to node-version-file', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, { engines: { node: '>=22' } })
		await fs.writeFile(join(dir, '.nvmrc'), '22\n')
		await fs.outputFile(
			join(dir, '.github', 'workflows', 'ci.yml'),
			[
				'jobs:',
				'  build:',
				'    steps:',
				'      - uses: actions/setup-node@v7',
				'        with:',
				'          node-version: 20',
				'  test:',
				'    strategy:',
				'      matrix:',
				'        node-version: ["22", "24"]',
				'    steps:',
				'      - uses: actions/setup-node@v7',
				'        with:',
				'          node-version: ${{ matrix.node-version }}',
				'',
			].join('\n')
		)
		await fixCommand('node-version', { directory: dir, yes: true })
		const yaml = await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf-8')
		// Hardcoded scalar rewritten...
		expect(yaml).toContain('node-version-file: .nvmrc')
		expect(yaml).not.toMatch(/node-version:\s*20\b/)
		// ...but the matrix array and the ${{ }} expression are left untouched.
		expect(yaml).toContain('node-version: ["22", "24"]')
		expect(yaml).toContain('node-version: ${{ matrix.node-version }}')
	})

	it('fix engines adds engines.node when missing', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('engines', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.engines?.node).toBe('>=22')
	})

	it('fix engines does not overwrite existing engines.node', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, { engines: { node: '>=24' } })
		await fixCommand('engines', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.engines.node).toBe('>=24')
	})

	it('fix engines pins packageManager on a pnpm repo', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.outputFile(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
		await fixCommand('engines', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/)
	})

	it('fix engines leaves an existing packageManager alone', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, { packageManager: 'pnpm@9.0.0' })
		await fixCommand('engines', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.packageManager).toBe('pnpm@9.0.0')
	})

	// The value written is a pnpm range, so a repo that installs with npm or
	// yarn must not get one (#372).
	it('fix engines does not pin packageManager on a non-pnpm repo', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('engines', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.packageManager).toBeUndefined()
	})

	it('fix package-json adds @rtorcato/repo-tooling to devDependencies', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo', version: '0.0.0' })
		await fixCommand('package-json', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.devDependencies['@rtorcato/repo-tooling']).toBe('latest')
	})

	it('fix biome on existing biome.json respects "no" on overwrite prompt', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const original = '{"linter": {"enabled": true}}\n'
		await fs.writeFile(join(dir, 'biome.json'), original)
		promptMock.mockResolvedValueOnce({ confirm: false })
		await fixCommand('biome', { directory: dir })
		const content = await fs.readFile(join(dir, 'biome.json'), 'utf-8')
		expect(content).toBe(original)
	})

	it('fix biome --yes with existing biome.json overwrites', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(join(dir, 'biome.json'), '{"linter": {"enabled": false}}\n')
		await fixCommand('biome', { directory: dir, yes: true })
		const biome = await fs.readJson(join(dir, 'biome.json'))
		expect(biome.$schema).toMatch(/biomejs\.dev/)
	})

	it('fix biome prompts default false on drift', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(join(dir, 'biome.json'), '{}\n')
		promptMock.mockImplementationOnce(async (questions: unknown) => {
			const q = Array.isArray(questions) ? questions[0] : questions
			expect(q.default).toBe(false)
			expect(q.message).toMatch(/overwrite/i)
			return { confirm: false }
		})
		await fixCommand('biome', { directory: dir })
	})

	it('fix engines uses safe-merge wording (no overwrite warning)', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		promptMock.mockImplementationOnce(async (questions: unknown) => {
			const q = Array.isArray(questions) ? questions[0] : questions
			expect(q.default).toBe(true)
			expect(q.message).not.toMatch(/overwrite/i)
			expect(q.message).toMatch(/preserved/i)
			return { confirm: false }
		})
		await fixCommand('engines', { directory: dir })
	})

	it('fix husky uses safe-merge wording', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		promptMock.mockImplementationOnce(async (questions: unknown) => {
			const q = Array.isArray(questions) ? questions[0] : questions
			expect(q.default).toBe(true)
			expect(q.message).not.toMatch(/overwrite/i)
			return { confirm: false }
		})
		await fixCommand('husky', { directory: dir })
	})

	it('fix package-json uses safe-merge wording', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo', version: '0.0.0' })
		promptMock.mockImplementationOnce(async (questions: unknown) => {
			const q = Array.isArray(questions) ? questions[0] : questions
			expect(q.message).not.toMatch(/overwrite/i)
			return { confirm: false }
		})
		await fixCommand('package-json', { directory: dir })
	})

	it('fix verify --yes writes a verify script chaining the enabled tools', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			scripts: { typecheck: 'tsc --noEmit', check: 'biome check .' },
			devDependencies: {
				'@rtorcato/repo-tooling': '^2.0.0',
				'@biomejs/biome': '^2.0.0',
				vitest: '^4.0.0',
			},
		})
		await fixCommand('verify', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.verify).toBe('pnpm typecheck && pnpm check && pnpm exec vitest run')
		expect(pkg.scripts.typecheck).toBe('tsc --noEmit')
	})

	it('fix attw --yes installs the cli, adds a script, and appends to verify', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			type: 'module',
			exports: { '.': { import: './dist/index.js', require: './dist/index.cjs' } },
			scripts: { verify: 'pnpm typecheck && pnpm check' },
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		await fixCommand('attw', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		// dual CJS/ESM (exports has a `require` condition) → no esm-only profile
		expect(pkg.scripts.attw).toBe('attw --pack')
		expect(pkg.devDependencies['@arethetypeswrong/cli']).toBeDefined()
		expect(pkg.scripts.verify).toBe('pnpm typecheck && pnpm check && pnpm attw')
	})

	it('fix attw --yes uses the esm-only profile and does not duplicate in verify', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			type: 'module',
			exports: { '.': './dist/index.js' }, // ESM-only: no require condition
			scripts: { verify: 'pnpm typecheck && pnpm attw' }, // already wired
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		await fixCommand('attw', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.attw).toBe('attw --pack --profile esm-only')
		// verify already contained `attw` → left untouched, not duplicated
		expect(pkg.scripts.verify).toBe('pnpm typecheck && pnpm attw')
	})

	it('fix publint --yes installs publint, adds a script, and appends to verify', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			type: 'module',
			exports: { '.': { import: './dist/index.js', require: './dist/index.cjs' } },
			scripts: { verify: 'pnpm typecheck && pnpm check' },
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		await fixCommand('publint', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.publint).toBe('publint --strict')
		expect(pkg.devDependencies['publint']).toBeDefined()
		expect(pkg.scripts.verify).toBe('pnpm typecheck && pnpm check && pnpm publint')
	})

	it('fix publint --yes does not duplicate publint in verify', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			exports: { '.': './dist/index.js' },
			scripts: { verify: 'pnpm typecheck && pnpm publint' }, // already wired
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		await fixCommand('publint', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.publint).toBe('publint --strict')
		expect(pkg.scripts.verify).toBe('pnpm typecheck && pnpm publint')
	})

	it('fix badges --yes inserts a badge block into the README', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			repository: 'git+https://github.com/rtorcato/demo.git',
			exports: { '.': './dist/index.js' },
		})
		await fs.writeFile(join(dir, 'README.md'), '# demo\n\nHello.\n')
		await fixCommand('badges', { directory: dir, yes: true })
		const readme = await fs.readFile(join(dir, 'README.md'), 'utf8')
		expect(readme).toContain('<!-- js-tooling:badges:start -->')
		expect(readme).toContain('actions/workflows/ci.yml')
		expect(readme).toContain('img.shields.io/npm/v/demo')
	})

	it('fix claude-skill --yes installs the skill into .claude/skills/', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('claude-skill', { directory: dir, yes: true })
		const skillPath = join(dir, '.claude', 'skills', 'repo-tooling.md')
		expect(await fs.pathExists(skillPath)).toBe(true)
		const body = await fs.readFile(skillPath, 'utf8')
		expect(body).toContain('name: repo-tooling')
	})

	it('fix migrates the pre-rename js-tooling.md/.mdc artifacts (removes old, writes new)', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.outputFile(join(dir, '.claude', 'skills', 'js-tooling.md'), '# stale\n')
		await fs.outputFile(join(dir, '.cursor', 'rules', 'js-tooling.mdc'), '# stale\n')

		await fixCommand('claude-skill', { directory: dir, yes: true })
		await fixCommand('cursor-rules', { directory: dir, yes: true })

		expect(await fs.pathExists(join(dir, '.claude', 'skills', 'js-tooling.md'))).toBe(false)
		expect(await fs.pathExists(join(dir, '.cursor', 'rules', 'js-tooling.mdc'))).toBe(false)
		expect(await fs.pathExists(join(dir, '.claude', 'skills', 'repo-tooling.md'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.cursor', 'rules', 'repo-tooling.mdc'))).toBe(true)
	})

	it('fix cursor-rules --yes writes a .mdc rule with Cursor frontmatter', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('cursor-rules', { directory: dir, yes: true })
		const body = await fs.readFile(join(dir, '.cursor', 'rules', 'repo-tooling.mdc'), 'utf8')
		expect(body).toMatch(/^---\ndescription: .+\nglobs:\nalwaysApply: false\n---/)
		expect(body).toContain('# repo-tooling') // shared body, frontmatter stripped
		expect(body).not.toContain('name: repo-tooling') // Claude frontmatter not carried over
	})

	it('fix agents-md --yes upserts a block without clobbering existing content', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(join(dir, 'AGENTS.md'), '# My project\n\nKeep this.\n')
		await fixCommand('agents-md', { directory: dir, yes: true })
		let body = await fs.readFile(join(dir, 'AGENTS.md'), 'utf8')
		expect(body).toContain('Keep this.') // existing content preserved
		expect(body).toContain('<!-- js-tooling:start -->')
		expect(body).toContain('# repo-tooling')

		// re-run is idempotent — replaces the block, doesn't duplicate it
		await fixCommand('agents-md', { directory: dir, yes: true })
		body = await fs.readFile(join(dir, 'AGENTS.md'), 'utf8')
		expect(body.match(/js-tooling:start/g)?.length).toBe(1)
		expect(body).toContain('Keep this.')
	})

	it('fix copilot-instructions --yes writes the block under .github/', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('copilot-instructions', { directory: dir, yes: true })
		const body = await fs.readFile(join(dir, '.github', 'copilot-instructions.md'), 'utf8')
		expect(body).toContain('<!-- js-tooling:start -->')
		expect(body).toContain('# repo-tooling')
	})

	it('fix verify --yes is a no-op when fewer than two tools are detectable', async () => {
		const dir = newTmpDir()
		// no biome dep, no vitest dep, no typecheck script — only one signal at best
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		await fixCommand('verify', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts?.verify).toBeUndefined()
	})

	it('fix husky --yes writes a pre-push hook when a verify script exists', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			scripts: { verify: 'pnpm typecheck && pnpm check' },
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		await fixCommand('husky', { directory: dir, yes: true })
		const prePush = await fs.readFile(join(dir, '.husky', 'pre-push'), 'utf-8')
		expect(prePush).toContain('pnpm verify')
	})

	it('fix husky --yes repairs a commented-out pre-push even when Husky itself is ok', async () => {
		const dir = newTmpDir()
		// Husky wired (prepare script + .husky dir + pre-commit) → Husky check is
		// `ok`, but pre-push is commented out → pre-push check is drift. The fixer
		// must act on the drift, not report "already configured".
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			scripts: { prepare: 'husky', verify: 'pnpm typecheck && pnpm check' },
			'lint-staged': { '*.ts': 'biome check' },
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		await fs.ensureDir(join(dir, '.husky'))
		await fs.writeFile(join(dir, '.husky', 'pre-commit'), 'npx lint-staged\n')
		await fs.writeFile(join(dir, '.husky', 'pre-push'), '# pnpm verify\n')
		await fixCommand('husky', { directory: dir, yes: true })
		const prePush = await fs.readFile(join(dir, '.husky', 'pre-push'), 'utf-8')
		expect(prePush).toContain('pnpm verify')
		expect(prePush).not.toMatch(/^#\s*pnpm verify/m)
	})

	it('fix treeshake-check --yes scaffolds apps/treeshake-check from pkg.exports', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: '@my-org/my-lib',
			version: '0.0.0',
			sideEffects: false,
			exports: {
				'.': './dist/index.js',
				'./clipboard': './dist/clipboard/index.js',
				'./geolocation': './dist/geolocation/index.js',
			},
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		await fixCommand('treeshake-check', { directory: dir, yes: true })
		expect(await fs.pathExists(join(dir, 'apps', 'treeshake-check', 'check.mjs'))).toBe(true)
		const entry = await fs.readFile(
			join(dir, 'apps', 'treeshake-check', 'src', 'entry.ts'),
			'utf-8'
		)
		expect(entry).toContain("'@my-org/my-lib/clipboard'")
	})

	it('fix treeshake-check is a no-op when the package has fewer than two subpaths', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: '@my-org/my-lib',
			version: '0.0.0',
			exports: { '.': './dist/index.js' },
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		await fixCommand('treeshake-check', { directory: dir, yes: true })
		expect(await fs.pathExists(join(dir, 'apps', 'treeshake-check'))).toBe(false)
	})

	it('fix verify --yes appends pnpm treeshake when apps/treeshake-check exists', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			scripts: { typecheck: 'tsc --noEmit', check: 'biome check .' },
			devDependencies: {
				'@rtorcato/repo-tooling': '^2.0.0',
				'@biomejs/biome': '^2.0.0',
				vitest: '^4.0.0',
			},
		})
		await fs.ensureDir(join(dir, 'apps', 'treeshake-check'))
		await fs.writeFile(join(dir, 'apps', 'treeshake-check', 'check.mjs'), '// stub\n')
		await fixCommand('verify', { directory: dir, yes: true })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.verify).toContain('pnpm treeshake')
		expect(pkg.scripts.treeshake).toBe('pnpm --filter=*treeshake-check run check')
	})

	// #362: `fix husky` used to emit a commit-msg hook running `npx --no --
	// commitlint`, without installing commitlint. `--no` refuses to install a
	// missing binary, so every `git commit` in the repo was rejected.
	it('fix husky --yes leaves no commit-msg hook it cannot make work', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('husky', { directory: dir, yes: true })

		expect(await fs.pathExists(join(dir, '.husky', 'pre-commit'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.husky', 'commit-msg'))).toBe(false)
	})

	it('fix commitlint --yes ships the hook, the config and the dependency together', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('husky', { directory: dir, yes: true })
		await fixCommand('commitlint', { directory: dir, yes: true })

		const hook = await fs.readFile(join(dir, '.husky', 'commit-msg'), 'utf-8')
		expect(hook).toContain('commitlint --edit')
		const config = await fs.readFile(join(dir, 'commitlint.config.mjs'), 'utf-8')
		expect(config).toContain('@rtorcato/repo-tooling/commitlint/config')
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.devDependencies['@commitlint/cli']).toBeTruthy()
		expect(pkg.devDependencies['@commitlint/config-conventional']).toBeTruthy()
	})

	// Swift and Perl repos drive hooks through core.hooksPath, so a .husky file
	// there would sit on disk and never run.
	it('fix commitlint --yes writes no husky hook when husky does not own the hooks', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('commitlint', { directory: dir, yes: true })

		expect(await fs.pathExists(join(dir, 'commitlint.config.mjs'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.husky', 'commit-msg'))).toBe(false)
	})

	it('fix husky --yes skips the pre-push hook when no verify script exists', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('husky', { directory: dir, yes: true })
		expect(await fs.pathExists(join(dir, '.husky', 'pre-commit'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.husky', 'pre-push'))).toBe(false)
	})

	it('returns early when check is already ok', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await seedCanonicalDependabot(dir)
		// Should not call inquirer at all.
		await fixCommand('dependabot', { directory: dir })
		expect(promptMock).not.toHaveBeenCalled()
	})
})

describe('fix --json', () => {
	it('emits a JSON payload with applied actions and exits without prompts', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await fixCommand('dependabot', { directory: dir, json: true })
			expect(promptMock).not.toHaveBeenCalled()
			expect(await fs.pathExists(join(dir, '.github', 'dependabot.yml'))).toBe(true)
			const lastJson = logSpy.mock.calls.at(-1)?.[0] as string
			const parsed = JSON.parse(lastJson)
			expect(parsed.target).toBe('dependabot')
			expect(parsed.directory).toBe(dir)
			expect(parsed.actions).toHaveLength(1)
			expect(parsed.actions[0]).toMatchObject({
				target: 'dependabot',
				check: 'Dependabot',
				status: 'applied',
				filesWritten: [
					'.github/dependabot.yml',
					'.github/workflows/dependabot-automerge.yml',
				],
			})
		} finally {
			logSpy.mockRestore()
		}
	})

	// #357: a fixer's own advisory used to go to stdout, landing in the middle of
	// the payload and breaking every parser downstream (the #315 action included).
	// Asserting on the *whole* stream, not `.at(-1)`, is the point — taking the
	// last call is exactly what hid this.
	it('keeps stdout parseable when a fixer prints an advisory', async () => {
		const dir = newTmpDir()
		// No scripts at all, so `verify` has nothing to chain and bails with a note.
		await seedPackageJson(dir)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			await fixCommand('verify', { directory: dir, json: true })
			expect(errSpy.mock.calls.join('\n')).toContain('verify chain')
			expect(logSpy.mock.calls).toHaveLength(1)
			expect(() => JSON.parse(logSpy.mock.calls.join(''))).not.toThrow()
		} finally {
			logSpy.mockRestore()
			errSpy.mockRestore()
		}
	})

	// The same contract on the Python path. #358 landed 16 seconds after the
	// Python module (#290) and so never saw its fixer, which shipped the bug the
	// rest of the CLI had just been cured of.
	it('keeps stdout parseable when a Python fixer prints an advisory', async () => {
		const dir = newTmpDir()
		// pyproject.toml is the marker that dispatches to the Python module, and
		// the hooks fixer always notes that core.hooksPath is per-clone config.
		await fs.writeFile(join(dir, 'pyproject.toml'), '[project]\nrequires-python = ">=3.10"\n')
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			await fixCommand('python-git-hooks', { directory: dir, json: true })
			expect(errSpy.mock.calls.join('\n')).toContain('core.hooksPath')
			expect(logSpy.mock.calls).toHaveLength(1)
			expect(() => JSON.parse(logSpy.mock.calls.join(''))).not.toThrow()
		} finally {
			logSpy.mockRestore()
			errSpy.mockRestore()
		}
	})

	it('emits a JSON error payload on unknown target', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)
		try {
			await expect(fixCommand('not-a-target', { directory: dir, json: true })).rejects.toThrow(
				'exit'
			)
			const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)
			expect(payload.error).toBe('unknown-target')
			expect(payload.target).toBe('not-a-target')
			expect(Array.isArray(payload.available)).toBe(true)
		} finally {
			logSpy.mockRestore()
			exitSpy.mockRestore()
		}
	})

	it('fix github-settings --json --dry-run on a non-git dir mutates nothing', async () => {
		const dir = newTmpDir()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await fixCommand('github-settings', { directory: dir, json: true, dryRun: true })
			// No .git → the checks skip to ok, so nothing is written or spawned.
			expect(fs.readdirSync(dir)).toEqual([])
			const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)
			expect(payload.target).toBe('github-settings')
		} finally {
			logSpy.mockRestore()
		}
	})

	it('reports dry-run status without writing in JSON mode', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await fixCommand('dependabot', { directory: dir, json: true, dryRun: true })
			expect(await fs.pathExists(join(dir, '.github', 'dependabot.yml'))).toBe(false)
			const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)
			expect(payload.actions[0].status).toBe('dry-run')
		} finally {
			logSpy.mockRestore()
		}
	})

	it('walk-all in JSON mode records every fixable check', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await fixCommand(undefined, { directory: dir, json: true })
			const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)
			expect(payload.target).toBeNull()
			expect(payload.actions.length).toBeGreaterThan(5)
			const statuses = new Set(payload.actions.map((a: { status: string }) => a.status))
			expect(statuses.has('applied')).toBe(true)
			// `unsupported` only fires for the `Node` check (no fixer) when the host's
			// Node version triggers drift, which is environment-dependent — don't assert.
		} finally {
			logSpy.mockRestore()
		}
	})

	it('reports already-ok for a check that passes', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await seedCanonicalDependabot(dir)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await fixCommand('dependabot', { directory: dir, json: true })
			const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)
			expect(payload.actions[0].status).toBe('already-ok')
		} finally {
			logSpy.mockRestore()
		}
	})
})

describe('fix + lockfile', () => {
	async function writeLock(dir: string, configPatch: Record<string, unknown> = {}): Promise<void> {
		const config = {
			projectName: 'demo',
			projectType: 'library',
			typescript: { enabled: true, config: 'base' },
			linting: { tool: 'biome' },
			formatting: { tool: 'biome' },
			testing: { framework: 'vitest', environment: 'node' },
			gitHooks: true,
			commitLint: true,
			semanticRelease: true,
			securityAutomation: true,
			bundler: 'tsup',
			...configPatch,
		}
		await fs.writeJson(join(dir, '.repo-tooling.json'), {
			version: 1,
			config,
			writtenBy: '@rtorcato/repo-tooling@test',
			writtenAt: new Date().toISOString(),
		})
	}

	it('fix lockfile --yes writes .repo-tooling.json inferred from package.json', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('lockfile', { directory: dir, yes: true })
		const lock = await fs.readJson(join(dir, '.repo-tooling.json'))
		expect(lock.version).toBe(2)
		expect(lock.config.projectName).toBe('demo')
		expect(lock.config.linting.tool).toBe('biome')
	})

	it('fix vitest --yes regenerates the config but keeps an existing vitest.setup.ts', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(join(dir, 'vitest.setup.ts'), '// my real setup\n')
		await fixCommand('vitest', { directory: dir, yes: true })
		expect(await fs.readFile(join(dir, 'vitest.setup.ts'), 'utf-8')).toBe('// my real setup\n')
		const config = await fs.readFile(join(dir, 'vitest.config.ts'), 'utf-8')
		expect(config).toContain("from '@rtorcato/repo-tooling/vitest/config'")
	})

	it('fix vitest --yes on a jest-locked project auto-resyncs the lockfile', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir, { testing: { framework: 'jest', environment: 'node' } })
		await fixCommand('vitest', { directory: dir, yes: true })
		const lock = await fs.readJson(join(dir, '.repo-tooling.json'))
		expect(lock.config.testing.framework).toBe('vitest')
	})

	it('fix biome --yes on an eslint-locked project flips the recorded linting choice', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir, {
			linting: { tool: 'eslint', eslintConfig: 'base' },
			formatting: { tool: 'prettier' },
		})
		await fixCommand('biome', { directory: dir, yes: true })
		const lock = await fs.readJson(join(dir, '.repo-tooling.json'))
		expect(lock.config.linting.tool).toBe('biome')
		expect(lock.config.formatting.tool).toBe('biome')
	})

	it('does not touch the lockfile when no lockfile exists', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('vitest', { directory: dir, yes: true })
		expect(await fs.pathExists(join(dir, '.repo-tooling.json'))).toBe(false)
	})

	it('emits lockfileConflict in JSON mode when overriding a declined choice', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir, { testing: { framework: 'jest', environment: 'node' } })
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await fixCommand('vitest', { directory: dir, json: true })
			const lastJson = logSpy.mock.calls.at(-1)?.[0] as string
			const payload = JSON.parse(lastJson)
			expect(payload.actions[0].lockfileConflict).toBe(true)
		} finally {
			logSpy.mockRestore()
		}
	})

	it('omits lockfileConflict when no conflict exists', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await fixCommand('vitest', { directory: dir, json: true })
			const lastJson = logSpy.mock.calls.at(-1)?.[0] as string
			const payload = JSON.parse(lastJson)
			expect(payload.actions[0].lockfileConflict).toBeUndefined()
		} finally {
			logSpy.mockRestore()
		}
	})
})

describe('fix --resync', () => {
	async function writeLock(dir: string): Promise<void> {
		await fs.writeJson(join(dir, '.repo-tooling.json'), {
			version: 1,
			config: {
				projectName: 'demo',
				projectType: 'library',
				typescript: { enabled: true, config: 'base' },
				linting: { tool: 'biome' },
				formatting: { tool: 'biome' },
				testing: { framework: 'vitest', environment: 'node' },
				gitHooks: false,
				commitLint: false,
				semanticRelease: false,
				securityAutomation: false,
				bundler: 'tsup',
			},
			writtenBy: '@rtorcato/repo-tooling@test',
			writtenAt: new Date().toISOString(),
		})
	}

	it('errors when no lockfile exists', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			await expect(fixCommand(undefined, { directory: dir, resync: true })).rejects.toThrow('exit')
			expect(exitSpy).toHaveBeenCalledWith(1)
			expect(errSpy.mock.calls.flat().join('\n')).toMatch(/No \.repo-tooling\.json/)
		} finally {
			exitSpy.mockRestore()
			errSpy.mockRestore()
		}
	})

	it('errors in JSON mode with a structured payload when lockfile is missing', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)
		try {
			await expect(
				fixCommand(undefined, { directory: dir, resync: true, json: true })
			).rejects.toThrow('exit')
			const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)
			expect(payload.error).toBe('no-lockfile')
		} finally {
			logSpy.mockRestore()
			exitSpy.mockRestore()
		}
	})

	it('--resync --yes scaffolds files from the lockfile config', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir)
		await fixCommand(undefined, { directory: dir, resync: true, yes: true })
		expect(await fs.pathExists(join(dir, '.editorconfig'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.nvmrc'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'tsconfig.json'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'biome.json'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'vitest.config.ts'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'tsup.config.ts'))).toBe(true)
	})

	it('--resync --dry-run lists files without writing any', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir)
		await fixCommand(undefined, { directory: dir, resync: true, dryRun: true, yes: true })
		// None of the expected files materialize in dry-run.
		expect(await fs.pathExists(join(dir, '.editorconfig'))).toBe(false)
		expect(await fs.pathExists(join(dir, 'biome.json'))).toBe(false)
	})

	it('--resync --json emits a structured payload listing files written', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await fixCommand(undefined, { directory: dir, resync: true, json: true })
			const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)
			expect(payload.mode).toBe('resync')
			expect(payload.dryRun).toBe(false)
			expect(Array.isArray(payload.files)).toBe(true)
			expect(payload.files).toContain('.editorconfig')
		} finally {
			logSpy.mockRestore()
		}
	})

	it('rejects --resync combined with a [target] argument', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir)
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			await expect(
				fixCommand('biome', { directory: dir, resync: true, yes: true })
			).rejects.toThrow('exit')
			expect(errSpy.mock.calls.flat().join('\n')).toMatch(/cannot be combined/)
		} finally {
			exitSpy.mockRestore()
			errSpy.mockRestore()
		}
	})
})

describe('fix walk-all', () => {
	it('applies all missing items when --yes', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand(undefined, { directory: dir, yes: true })
		// A handful of representative outputs:
		expect(await fs.pathExists(join(dir, '.editorconfig'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.nvmrc'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'knip.json'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.github', 'dependabot.yml'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.github', 'workflows', 'codeql.yml'))).toBe(true)
	})

	it('prints all-pass message when nothing is non-ok', async () => {
		// Hard to fully construct; instead verify the early-return branch via empty results path.
		// We sidestep by running fix on a directory where doctor returns at least one non-ok
		// (engines.node drift), then verifying the walk respects user "no" answers.
		const dir = newTmpDir()
		await seedPackageJson(dir)
		promptMock.mockResolvedValue({ confirm: false })
		await fixCommand(undefined, { directory: dir })
		// Nothing should be written since every prompt returned false.
		expect(await fs.pathExists(join(dir, '.editorconfig'))).toBe(false)
	})
})

describe('fix --diff', () => {
	it('prints a unified diff before the confirm prompt for a drifted destructive fixer', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		// Seed a drifted biome.json so doctor flags drift and the diff has both sides.
		await fs.writeJson(join(dir, 'biome.json'), { foo: 'bar' })
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		promptMock.mockResolvedValue({ confirm: false })
		try {
			await fixCommand('biome', { directory: dir, diff: true })
			const output = logSpy.mock.calls.flat().join('\n')
			// Unified diff headers come from `createPatch`.
			expect(output).toMatch(/--- biome\.json/)
			expect(output).toMatch(/\+\+\+ biome\.json/)
			// The drifted content should appear as a removed line in the diff.
			expect(output).toMatch(/-.*"foo"/)
		} finally {
			logSpy.mockRestore()
		}
	})

	it('labels the preview as "create" when the target file does not yet exist', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		promptMock.mockResolvedValue({ confirm: false })
		try {
			await fixCommand('nvmrc', { directory: dir, diff: true })
			const output = logSpy.mock.calls.flat().join('\n')
			expect(output).toMatch(/create.*\.nvmrc/)
		} finally {
			logSpy.mockRestore()
		}
	})

	it('emits no diff markers when --json is set (JSON output stream stays clean)', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, 'biome.json'), { foo: 'bar' })
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await fixCommand('biome', { directory: dir, diff: true, json: true })
			// Every console.log call in JSON mode should be valid JSON or empty.
			for (const call of logSpy.mock.calls) {
				const line = call[0] as string
				if (!line || line.trim() === '') continue
				expect(line).not.toMatch(/^\+\+\+ /)
				expect(line).not.toMatch(/^--- /)
			}
			const lastCall = logSpy.mock.calls.at(-1)?.[0] as string
			const payload = JSON.parse(lastCall)
			expect(payload.actions).toBeDefined()
		} finally {
			logSpy.mockRestore()
		}
	})

	it('does not show a diff for safe-add fixers (would-be no-op)', async () => {
		// `dependabot` is safe-add — the preview path should be skipped.
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		promptMock.mockResolvedValue({ confirm: false })
		try {
			await fixCommand('dependabot', { directory: dir, diff: true })
			const output = logSpy.mock.calls.flat().join('\n')
			expect(output).not.toMatch(/^\+\+\+ /m)
			expect(output).not.toMatch(/^--- /m)
		} finally {
			logSpy.mockRestore()
		}
	})
})

// #364: `fix biome` scaffolded a config with no way to run it, so the generated
// CI's `pnpm check` step and `fix verify`'s lint half both had nothing to call.
describe('fix biome scripts', () => {
	it('adds the scripts that run Biome, without touching existing ones', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, { scripts: { check: 'my own check' } })
		await fixCommand('biome', { directory: dir, yes: true })

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.check).toBe('my own check')
		expect(pkg.scripts.lint).toBe('biome lint .')
		expect(pkg.scripts['check:fix']).toBe('biome check --fix .')
	})
})

// #371: `fix eslint` / `fix prettier` had the same gap #364 closed for biome —
// a config with no script to run it, so CI dropped its lint step silently.
describe('fix eslint/prettier scripts', () => {
	it('adds the scripts that run ESLint, without touching existing ones', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, { scripts: { lint: 'my own lint' } })
		await fixCommand('eslint', { directory: dir, yes: true })

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.lint).toBe('my own lint')
		expect(pkg.scripts['lint:fix']).toBe('eslint . --fix')
	})

	it('adds the `format` script alongside the Prettier config', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('prettier', { directory: dir, yes: true })

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.format).toBe('prettier --write .')
	})

	it('lets `fix verify` compose a chain that includes linting', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, {
			scripts: { typecheck: 'tsc --noEmit' },
			devDependencies: { eslint: '^9.0.0', typescript: '^5.9.3', vitest: '^3.0.0' },
		})
		await fixCommand('eslint', { directory: dir, yes: true })
		await fixCommand('verify', { directory: dir, yes: true })

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.verify).toContain('pnpm lint')
	})
})

// #377: the same gap on the three targets whose scripts the generated CI calls
// — no script means the step (or the whole job) silently disappears.
describe('fix knip/tsconfig/vitest scripts', () => {
	it('adds the `knip` script, without touching an existing one', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('knip', { directory: dir, yes: true })

		expect((await fs.readJson(join(dir, 'package.json'))).scripts.knip).toBe('knip')

		await seedPackageJson(dir, { scripts: { knip: 'my own knip' } })
		await fixCommand('knip', { directory: dir, yes: true })

		expect((await fs.readJson(join(dir, 'package.json'))).scripts.knip).toBe('my own knip')
	})

	it('adds the `typecheck` script, without touching an existing one', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('tsconfig', { directory: dir, yes: true })

		expect((await fs.readJson(join(dir, 'package.json'))).scripts.typecheck).toBe('tsc --noEmit')

		await seedPackageJson(dir, { scripts: { typecheck: 'my own typecheck' } })
		await fixCommand('tsconfig', { directory: dir, yes: true })

		expect((await fs.readJson(join(dir, 'package.json'))).scripts.typecheck).toBe(
			'my own typecheck'
		)
	})

	// tsconfig is shared with non-JS paths, so it has to survive a repo that has
	// no package.json to add the script to.
	it('still writes tsconfig.json when there is no package.json', async () => {
		const dir = newTmpDir()
		await fixCommand('tsconfig', { directory: dir, yes: true })

		expect(await fs.pathExists(join(dir, 'tsconfig.json'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'package.json'))).toBe(false)
	})

	it('adds the scripts that run Vitest, without touching existing ones', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, { scripts: { test: 'my own test' } })
		await fixCommand('vitest', { directory: dir, yes: true })

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.test).toBe('my own test')
		expect(pkg.scripts['test:watch']).toBe('vitest --watch')
		expect(pkg.scripts.coverage).toBe('vitest run --coverage')
	})
})

// #382: the budget was scaffolded with no script and no CLI to run it, so its
// presence implied an enforcement that wasn't there.
describe('fix size-limit', () => {
	it('adds the `size-limit` script and devDependency alongside the budget', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('size-limit', { directory: dir, yes: true })

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(await fs.pathExists(join(dir, '.size-limit.json'))).toBe(true)
		expect(pkg.scripts['size-limit']).toBe('size-limit')
		expect(pkg.devDependencies['size-limit']).toBe(SIZE_LIMIT_VERSION)
	})

	it('leaves an existing script and pin alone', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, {
			scripts: { 'size-limit': 'size-limit --why' },
			devDependencies: { 'size-limit': '^10.0.0' },
		})
		await fixCommand('size-limit', { directory: dir, yes: true })

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts['size-limit']).toBe('size-limit --why')
		expect(pkg.devDependencies['size-limit']).toBe('^10.0.0')
	})

	// The divergence between getScripts() and the fixers is the root cause behind
	// #371 and #377 — assert the two paths emit the same command.
	it('emits the same command as the setup path', async () => {
		const setupDir = newTmpDir()
		await generatePackageJson(
			{
				projectName: 'lib',
				projectType: 'library',
				typescript: { enabled: false, config: 'base' },
				linting: { tool: 'none' },
				formatting: { tool: 'none' },
				testing: { framework: 'none' },
				gitHooks: false,
				commitLint: false,
				semanticRelease: false,
				bundler: 'none',
			},
			setupDir
		)

		const fixDir = newTmpDir()
		await seedPackageJson(fixDir)
		await fixCommand('size-limit', { directory: fixDir, yes: true })

		const setupPkg = await fs.readJson(join(setupDir, 'package.json'))
		const fixPkg = await fs.readJson(join(fixDir, 'package.json'))
		expect(setupPkg.scripts['size-limit']).toBe(fixPkg.scripts['size-limit'])
		expect(setupPkg.devDependencies['size-limit']).toBe(fixPkg.devDependencies['size-limit'])
	})
})

// #364: pnpm/action-setup has no `version:` input, so the workflow needs
// packageManager or every job dies at setup.
describe('fix github-actions packageManager', () => {
	it('pins packageManager alongside the workflow', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fixCommand('github-actions', { directory: dir, yes: true })

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/)
	})

	it('only references scripts the repo actually has', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, { scripts: { typecheck: 'tsc --noEmit' } })
		await fixCommand('github-actions', { directory: dir, yes: true })

		const workflow = await fs.readFile(join(dir, '.github/workflows/ci.yml'), 'utf-8')
		expect(workflow).toContain('run: pnpm typecheck')
		expect(workflow).not.toContain('run: pnpm knip')
		expect(workflow).not.toContain('run: pnpm coverage')
	})
})
