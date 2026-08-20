import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
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
