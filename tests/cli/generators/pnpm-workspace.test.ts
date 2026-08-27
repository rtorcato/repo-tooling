import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { checkPnpmWorkspace } from '../../../src/languages/js/checks.js'
import {
	ensurePnpmSettings,
	familyGlob,
	missingPnpmSettings,
	upsertPnpmSettings,
} from '../../../src/cli/generators/pnpm-workspace.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

/** Stand-in for a consuming repo that is not the author's. */
const ACME = familyGlob('@acme/widgets')

describe('familyGlob', () => {
	it('derives the scope from the consuming package name', () => {
		expect(familyGlob('@acme/widgets')).toBe('@acme/*')
		expect(familyGlob('@rtorcato/js-common')).toBe('@rtorcato/*')
	})

	// This is a public CLI: writing one organisation's scope into a stranger's
	// config would loosen a supply-chain guard for packages they never chose.
	it('never invents a scope', () => {
		expect(familyGlob('lodash')).toBeNull()
		expect(familyGlob('')).toBeNull()
		expect(familyGlob(undefined)).toBeNull()
		expect(familyGlob(null)).toBeNull()
		expect(familyGlob(42)).toBeNull()
		// A lone '@' with no slash is not a scope.
		expect(familyGlob('@nope')).toBeNull()
	})

	// The name is preserved verbatim from any pre-existing package.json and is
	// never validated as an npm name on the way here, so a crafted '@*/x' would
	// otherwise write the glob '@*/*' and exempt every scoped package from the
	// minimumReleaseAge delay rather than just this repo's own scope.
	it('writes no exemption for a name carrying glob metacharacters', () => {
		for (const name of ['@*/x', '@!(a)/x', '@ac me/x', '@[a-z]/x', '@.acme/x']) {
			expect(familyGlob(name)).toBeNull()
			expect(upsertPnpmSettings('', false, familyGlob(name))).not.toContain(
				'minimumReleaseAgeExclude'
			)
		}
	})
})

describe('upsertPnpmSettings', () => {
	it('writes every managed setting into an empty file', () => {
		const yaml = upsertPnpmSettings('', true, ACME)
		expect(yaml).toContain('verifyDepsBeforeRun: false')
		expect(yaml).toContain("- '@acme/*'")
		expect(yaml).toContain('esbuild: true')
		expect(missingPnpmSettings(yaml, true, ACME)).toEqual([])
	})

	// An unscoped package has no family to infer, so the release-age exemption
	// is not managed at all rather than guessed at.
	it('omits the release-age exemption entirely for an unscoped package', () => {
		const yaml = upsertPnpmSettings('', true, null)
		expect(yaml).toContain('verifyDepsBeforeRun: false')
		expect(yaml).toContain('esbuild: true')
		expect(yaml).not.toContain('minimumReleaseAgeExclude')
		expect(missingPnpmSettings(yaml, true, null)).toEqual([])
	})

	// The whole point of #314's "merge, don't overwrite" note: the file also
	// carries the repo's own globs and hand-vetted build approvals.
	it('keeps existing keys and merges into the lists already there', () => {
		const before = `packages:
  - 'apps/*'

allowBuilds:
  core-js: false
  esbuild: true

minimumReleaseAgeExclude:
  - tinyglobby
`
		const after = upsertPnpmSettings(before, true, ACME)
		expect(after).toContain("- 'apps/*'")
		expect(after).toContain('core-js: false')
		expect(after).toContain('- tinyglobby')
		expect(after).toContain("- '@acme/*'")
		// esbuild was already approved, so allowBuilds is left exactly as found.
		expect(after.match(/esbuild: true/g)).toHaveLength(1)
	})

	it('respects an explicit verifyDepsBeforeRun rather than resetting it', () => {
		const after = upsertPnpmSettings('verifyDepsBeforeRun: true\n', false, ACME)
		expect(after).toContain('verifyDepsBeforeRun: true')
		expect(after).not.toContain('verifyDepsBeforeRun: false')
	})

	it('leaves allowBuilds alone when no bundler needs esbuild', () => {
		expect(upsertPnpmSettings('', false, ACME)).not.toContain('allowBuilds')
	})

	it('is idempotent', () => {
		const once = upsertPnpmSettings('', true, ACME)
		expect(upsertPnpmSettings(once, true, ACME)).toBe(once)
	})
})

describe('checkPnpmWorkspace', () => {
	it('stays quiet on a repo that does not use pnpm', async () => {
		const dir = newTmpDir()
		expect((await checkPnpmWorkspace(dir, {})).status).toBe('ok')
	})

	it('flags an existing workspace file that is missing the settings', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
		const pkg = { name: '@acme/widgets' }
		const before = await checkPnpmWorkspace(dir, pkg)
		expect(before.status).toBe('drift')
		expect(before.detail).toContain('@acme/*')

		await ensurePnpmSettings(dir, false, ACME)
		expect((await checkPnpmWorkspace(dir, pkg)).status).toBe('ok')
	})

	// The regression this guards: doctor used to report a stranger's repo as
	// drifted for not carrying the author's own scope.
	it('never asks an unrelated repo for someone else’s scope', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
		const r = await checkPnpmWorkspace(dir, { name: '@acme/widgets' })
		expect(r.detail).not.toContain('@rtorcato')

		// And an unscoped package is never asked for the setting at all.
		const plain = await checkPnpmWorkspace(dir, { name: 'widgets' })
		expect(plain.detail).not.toContain('minimumReleaseAgeExclude')
	})

	// A pnpm repo with no workspace file hasn't drifted — it never opted in — so
	// this is a gray suggestion, not a CI-failing finding.
	it('only suggests the file when a pnpm repo has none', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
		expect((await checkPnpmWorkspace(dir, {})).status).toBe('optional-missing')
	})
})
