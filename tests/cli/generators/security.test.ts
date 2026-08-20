import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	DEPENDABOT_AUTOMERGE_WORKFLOW,
	DEPENDABOT_CONFIG,
	dependabotIgnoreRules,
	findDependabotIgnoreRules,
	generateCodeQLWorkflow,
	generateDependabotConfig,
	generateSecurityConfigs,
} from '../../../src/cli/generators/security.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

describe('generateDependabotConfig', () => {
	it('writes .github/dependabot.yml with npm and github-actions ecosystems', async () => {
		const dir = newTmpDir()
		await generateDependabotConfig(dir)
		const filepath = join(dir, '.github', 'dependabot.yml')
		expect(await fs.pathExists(filepath)).toBe(true)
		const content = await fs.readFile(filepath, 'utf-8')
		expect(content).toMatch(/package-ecosystem: npm/)
		expect(content).toMatch(/package-ecosystem: github-actions/)
		expect(content).toMatch(/interval: monthly/)
		expect(content).toMatch(/open-pull-requests-limit: 5/)
		// `schedule.day` is weekly-only and must be a weekday name — invalid under
		// monthly, which already runs on the 1st. Guard against it regressing.
		expect(content).not.toMatch(/^\s*day:/m)
		// cooldown lets fresh releases settle so a same-day bump can't trip the
		// minimumReleaseAge supply-chain check in CI.
		expect(content).toMatch(/cooldown:\s*\n\s*default-days: 7/)
	})

	it('uses the canonical safe-tier + major-tier grouping', async () => {
		const dir = newTmpDir()
		await generateDependabotConfig(dir)
		const content = await fs.readFile(join(dir, '.github', 'dependabot.yml'), 'utf-8')
		expect(content).toMatch(/^\s*production-minor:/m)
		expect(content).toMatch(/^\s*dev-minor:/m)
		expect(content).toMatch(/^\s*major-updates:/m)
	})

	it('also scaffolds the auto-merge workflow and returns both paths', async () => {
		const dir = newTmpDir()
		const written = await generateDependabotConfig(dir)
		const workflow = join(dir, '.github', 'workflows', 'dependabot-automerge.yml')
		expect(await fs.pathExists(workflow)).toBe(true)
		const content = await fs.readFile(workflow, 'utf-8')
		expect(content).toMatch(/dependabot\/fetch-metadata/)
		expect(content).toMatch(/gh pr merge --auto --squash/)
		expect(written).toEqual([
			'.github/dependabot.yml',
			'.github/workflows/dependabot-automerge.yml',
		])
	})

	// #423: production bumps ship to consumers of a published package, so the
	// auto-merge gate is the dev-minor group *and* the semver type.
	it('gates auto-merge on the dev-minor group as well as the semver type', async () => {
		const dir = newTmpDir()
		await generateDependabotConfig(dir)
		const content = await fs.readFile(
			join(dir, '.github', 'workflows', 'dependabot-automerge.yml'),
			'utf-8'
		)
		expect(content).toMatch(/steps\.metadata\.outputs\.dependency-group == 'dev-minor' &&/)
		expect(content).toMatch(/update-type == 'version-update:semver-patch'/)
		expect(content).toMatch(/update-type == 'version-update:semver-minor'/)
		expect(content).not.toMatch(/'production-minor'/)
	})

	// The gate names a group that the paired dependabot.yml has to declare —
	// rename one without the other and auto-merge silently stops firing.
	it('gates on a group the paired dependabot.yml actually declares', async () => {
		const dir = newTmpDir()
		await generateDependabotConfig(dir)
		const config = await fs.readFile(join(dir, '.github', 'dependabot.yml'), 'utf-8')
		const workflow = await fs.readFile(
			join(dir, '.github', 'workflows', 'dependabot-automerge.yml'),
			'utf-8'
		)
		const group = workflow.match(/dependency-group == '([^']+)'/)?.[1]
		expect(group).toBeDefined()
		expect(config).toMatch(new RegExp(`^\\s*${group}:`, 'm'))
	})
})

// #458: `dependency-type: development` is Dependabot's classification, not a
// safety property — a package in both devDependencies and peerDependencies is
// filed as development and lands in dev-minor, while peerDependencies are part
// of what a published package hands its consumers. This repo had 32 such
// packages and 13 rode a single "dev-only" group PR.
//
// The gate is shell, so the test runs the shell. A string assertion would pass
// on a script that never sets `safe` at all.
describe('the auto-merge consumer-facing gate', () => {
	/** The `run:` body of the `id: gate` step, dedented to a runnable script. */
	function gateScript(): string {
		const step = DEPENDABOT_AUTOMERGE_WORKFLOW.split(/^ {6}- name: Check whether/m)[1]
		const body = step?.match(/ {8}run: \|\n([\s\S]*?)\n(?= {6}(?:#|-))/)?.[1]
		if (!body) throw new Error('could not extract the gate script from the workflow')
		return body
			.split('\n')
			.map((l) => l.replace(/^ {10}/, ''))
			.join('\n')
	}

	/**
	 * Run the gate against a throwaway git repo. `git ls-files` only sees tracked
	 * files, so the manifests have to be added — which is also the real behaviour
	 * we depend on.
	 */
	async function runGate(
		manifests: Record<string, unknown>,
		names: string
	): Promise<'true' | 'false'> {
		const dir = newTmpDir()
		for (const [file, json] of Object.entries(manifests)) {
			await fs.outputJson(join(dir, file), json)
		}
		const out = join(dir, 'gh-output')
		await fs.writeFile(out, '')
		await fs.writeFile(join(dir, 'gate.sh'), gateScript())

		const { execFile } = await import('node:child_process')
		const { promisify } = await import('node:util')
		const run = promisify(execFile)
		await run('git', ['init', '-q'], { cwd: dir })
		await run('git', ['add', '-A'], { cwd: dir })
		await run('bash', ['gate.sh'], {
			cwd: dir,
			env: { ...process.env, NAMES: names, GITHUB_OUTPUT: out },
		})
		const written = await fs.readFile(out, 'utf-8')
		return written.trim().endsWith('safe=true') ? 'true' : 'false'
	}

	const MANIFEST = {
		'package.json': {
			name: 'published',
			devDependencies: { knip: '^5.0.0', typescript: '^5.0.0' },
			peerDependencies: { typescript: '^5.0.0' },
			dependencies: { chalk: '^5.0.0' },
		},
	}

	it('passes a bump that reaches no consumer', async () => {
		expect(await runGate(MANIFEST, 'knip')).toBe('true')
	})

	// The whole point: `typescript` is a devDependency *and* a peerDependency, so
	// Dependabot files it under dev-minor. It still ships.
	it('stands down when a bumped package is a peerDependency', async () => {
		expect(await runGate(MANIFEST, 'knip,typescript')).toBe('false')
	})

	it('stands down on a runtime dependency', async () => {
		expect(await runGate(MANIFEST, 'chalk')).toBe('false')
	})

	// A private workspace publishes nothing, so its deps reach nobody — flagging
	// them would train the reader to ignore the gate.
	it('ignores the manifests of private workspaces', async () => {
		const withDocs = {
			...MANIFEST,
			'apps/docs/package.json': { name: 'docs', private: true, dependencies: { react: '^19.0.0' } },
		}
		expect(await runGate(withDocs, 'react')).toBe('true')
	})

	it('reads workspace manifests that do publish', async () => {
		const withPkg = {
			...MANIFEST,
			'packages/ui/package.json': { name: 'ui', peerDependencies: { react: '^19.0.0' } },
		}
		expect(await runGate(withPkg, 'react')).toBe('false')
	})

	// Nothing to check means nothing was verified. Failing open here would be the
	// #423 hole reopened, quietly.
	it('fails closed when no dependency names are reported', async () => {
		expect(await runGate(MANIFEST, '')).toBe('false')
	})
})

describe('dependabotIgnoreRules', () => {
	// The rule that went missing in rtorcato/browser-common (#422) — apps/docs is
	// pinned to TypeScript ~5.6.3 by hand, and regenerating deleted the pin.
	const BROWSER_COMMON = `version: 2
updates:
  - package-ecosystem: npm
    directory: /
    ignore:
      # apps/docs is deliberately pinned to TypeScript ~5.6.3 — TS 7 removed
      # \`baseUrl\`, so a TS major is a migration to do by hand.
      - dependency-name: typescript
        update-types:
          - version-update:semver-major
    groups:
      major-updates:
        update-types:
          - major
`

	it('names each ignored dependency', () => {
		expect(dependabotIgnoreRules(BROWSER_COMMON)).toEqual(['typescript'])
	})

	it('does not count an entry’s own update-types list as extra rules', () => {
		// `- version-update:semver-major` is a list item too, just a deeper one.
		expect(dependabotIgnoreRules(BROWSER_COMMON)).toHaveLength(1)
	})

	it('finds rules under every ecosystem block, quoted or not', () => {
		const content = `updates:
  - package-ecosystem: npm
    ignore:
      - dependency-name: "eslint"
      - dependency-name: 'react'
        versions: ['>=19']
  - package-ecosystem: github-actions
    ignore:
      - dependency-name: actions/checkout
`
		expect(dependabotIgnoreRules(content)).toEqual(['eslint', 'react', 'actions/checkout'])
	})

	it('still reports a rule whose dependency-name it cannot read', () => {
		const content = `    ignore:
      - versions:
          - 4.x
`
		expect(dependabotIgnoreRules(content)).toEqual(['<unnamed rule>'])
	})

	it('finds nothing in the canonical config, an empty list, or a comment', () => {
		expect(dependabotIgnoreRules(DEPENDABOT_CONFIG)).toEqual([])
		expect(dependabotIgnoreRules('    ignore: []\n')).toEqual([])
		expect(dependabotIgnoreRules('    # ignore:\n    #  - dependency-name: x\n')).toEqual([])
	})
})

describe('findDependabotIgnoreRules', () => {
	it('returns null when the repo has no config, and when the config has no rules', async () => {
		const dir = newTmpDir()
		expect(await findDependabotIgnoreRules(dir)).toBeNull()
		await generateDependabotConfig(dir)
		expect(await findDependabotIgnoreRules(dir)).toBeNull()
	})

	it('reports the .yaml spelling too', async () => {
		const dir = newTmpDir()
		await fs.outputFile(
			join(dir, '.github', 'dependabot.yaml'),
			'updates:\n  - package-ecosystem: npm\n    ignore:\n      - dependency-name: typescript\n'
		)
		expect(await findDependabotIgnoreRules(dir)).toEqual({
			file: '.github/dependabot.yaml',
			rules: ['typescript'],
		})
	})
})

describe('generateCodeQLWorkflow', () => {
	it('writes .github/workflows/codeql.yml referencing codeql-action', async () => {
		const dir = newTmpDir()
		await generateCodeQLWorkflow(dir)
		const filepath = join(dir, '.github', 'workflows', 'codeql.yml')
		expect(await fs.pathExists(filepath)).toBe(true)
		const content = await fs.readFile(filepath, 'utf-8')
		expect(content).toMatch(/github\/codeql-action\/init/)
		expect(content).toMatch(/github\/codeql-action\/analyze/)
		expect(content).toMatch(/javascript-typescript/)
	})
})

describe('generateSecurityConfigs', () => {
	it('writes both dependabot and codeql configs', async () => {
		const dir = newTmpDir()
		await generateSecurityConfigs(dir)
		expect(await fs.pathExists(join(dir, '.github', 'dependabot.yml'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.github', 'workflows', 'codeql.yml'))).toBe(true)
	})
})
