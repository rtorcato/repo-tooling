import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RELEASE_WORKFLOW_HEADER, renderGitHubWorkflow } from '../../src/base/ci.js'
import { checkGitHubActions } from '../../src/base/checks.js'
import { FixerAbort } from '../../src/base/fixers.js'
import { migrateReleaseJob, workflowJobs } from '../../src/base/github-settings.js'
import { buildPresetConfig } from '../../src/cli/commands/setup-presets.js'
import { generateGitHubActions } from '../../src/cli/generators/github-actions.js'
import { githubJobs, renderReleaseWorkflow } from '../../src/languages/js/ci.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

// Release jobs from earlier generator versions, each drifted its own way (#775).
const fixture = (name: string) =>
	fs.readFileSync(
		join(import.meta.dirname, '../fixtures/release-migration', `${name}.yml`),
		'utf-8'
	)

const DISPATCHED_REF =
	"ref: ${{ github.event_name == 'workflow_dispatch' && github.ref || github.event.repository.default_branch }}"

// The job's own steps — `in-flight`'s check is the header's (#790).
const stepNames = (yaml: string) =>
	[...(yaml.split('\n  release:\n')[1] ?? yaml).matchAll(/^\s*- name:\s*(.+)$/gm)].map((m) =>
		m[1]?.trim()
	)

/**
 * ponytail: the package ships no YAML parser, so "parses" is the structure the
 * line-based readers rely on: the standard header, exactly one job, spaces only.
 */
function expectWellFormedRelease(release: string, job: string) {
	expect(release.startsWith(RELEASE_WORKFLOW_HEADER)).toBe(true)
	expect([...workflowJobs(release).keys()]).toEqual(['in-flight', job])
	expect(release).not.toMatch(/\t/)
	// The gate on `in-flight` (#790) is the only `needs` it keeps.
	expect(workflowJobs(release).get(job)).toMatch(
		/^( +)needs: in-flight\n\1# Supersede .*\n\1concurrency:\n\1 {2}group: release\n\1 {2}cancel-in-progress: \$\{\{ needs\.in-flight\.outputs\.publishing != 'true' \}\}\n/m
	)
	const own = release.replace('needs: in-flight', '').replace('needs.in-flight.', '')
	expect(own).not.toContain('needs.')
	expect(own).not.toMatch(/^\s*needs:/m)
}

const migrate = (name: string) => {
	const r = migrateReleaseJob(fixture(name), 'release')
	if (!r) throw new Error(`no release job in ${name}`)
	return r
}

describe('migrateReleaseJob (#775)', () => {
	it('keeps custom steps and a beta release, copying the workflow permissions', () => {
		const { release, needs } = migrate('custom-steps-beta')
		expect(needs).toEqual([])
		expectWellFormedRelease(release, 'release')
		const before = stepNames(fixture('custom-steps-beta').split('  release:')[1] ?? '')
		expect(stepNames(release)).toEqual(
			before.map((n) => (n === '📦 Restore dependencies cache' ? '📦 Install dependencies' : n))
		)
		expect(release).toContain('        run: pnpm install --frozen-lockfile\n')
		expect(release).toContain(`          ${DISPATCHED_REF}\n          fetch-depth: 0\n`)
		expect(release).toContain('token: ${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}')
		expect(release).toContain(
			'    permissions:\n      contents: write\n      issues: write\n      pull-requests: write\n      actions: write\n      id-token: write\n'
		)
		expect(release).toContain('    environment: release\n')
		expect(release).toContain('      # Docs follow the published version.\n')
		expect(release).toContain('        if: failure()\n')
		// The job-level `if:` that held it to main/beta is gone; the dispatch ref decides.
		expect(release).not.toContain("refs/heads/beta'")
	})

	it('re-indents a four-space job under the header and drops its own concurrency (#790)', () => {
		const ci =
			'on:\n  workflow_dispatch:\njobs:\n    release:\n        concurrency: deploy\n        environment: release\n        runs-on: ubuntu-latest\n        steps:\n            - run: |\n                  npx semantic-release\n'
		const r = migrateReleaseJob(ci, 'release')
		if (!r) throw new Error('no release job')
		expect(r.needs).toEqual([])
		expectWellFormedRelease(r.release, 'release')
		expect(r.release).not.toContain('concurrency: deploy')
		expect(r.release).toContain('  release:\n      needs: in-flight\n')
		expect(r.release).toContain('      environment: release\n      runs-on: ubuntu-latest\n')
		expect(r.release).toContain(
			'      steps:\n          - run: |\n                npx semantic-release\n'
		)
	})

	it('migrates unnamed steps and a multi-line `if:`', () => {
		const { release, needs } = migrate('unnamed-steps-multiline-if')
		expect(needs).toEqual([])
		expectWellFormedRelease(release, 'release')
		expect(release).not.toContain('always()')
		expect(release).not.toContain('actions/cache')
		expect(release).toContain(
			`      - uses: actions/checkout@v4\n        with:\n          ${DISPATCHED_REF}\n          fetch-depth: 0\n`
		)
		// Its own permissions stay, with OIDC raised to write.
		expect(release).toContain('    permissions:\n      contents: write\n      id-token: write\n')
		expect(release).toContain('      - run: npx semantic-release\n')
	})

	it('migrates renamed template steps', () => {
		const { release, needs } = migrate('renamed-template-steps')
		expect(needs).toEqual([])
		expectWellFormedRelease(release, 'release')
		expect(stepNames(release)).toEqual([
			'Check out',
			'📦 Setup Node.js',
			'📦 Setup pnpm',
			'📦 Install dependencies',
			'🔧 Configure Git',
			'🚀 Run semantic-release',
		])
		// No permissions anywhere in ci.yml: the template's grants, plus OIDC.
		expect(release).toContain('    permissions:\n      contents: write\n')
		expect(release).toContain('      id-token: write\n    steps:\n')
	})

	it('names each step that still reads `needs.`', () => {
		expect(migrate('unresolvable-needs').needs).toEqual(['📝 Stamp the build'])
	})
})

describe('fix github-actions on the old layouts (#775)', () => {
	const newTmpDir = useTmpDir()
	const lib = () => buildPresetConfig('library', 'x')
	const ciPath = (dir: string) => join(dir, '.github/workflows/ci.yml')
	const releasePath = (dir: string) => join(dir, '.github/workflows/release.yml')
	const seed = async (name: string) => {
		const dir = newTmpDir()
		await fs.outputFile(ciPath(dir), fixture(name))
		return dir
	}

	for (const name of [
		'custom-steps-beta',
		'unnamed-steps-multiline-if',
		'renamed-template-steps',
	]) {
		it(`moves ${name} as is`, async () => {
			const dir = await seed(name)
			await generateGitHubActions(lib(), dir)
			expect(await fs.readFile(releasePath(dir), 'utf-8')).toBe(migrate(name).release)
			expect(await fs.readFile(ciPath(dir), 'utf-8')).not.toContain('semantic-release')
		})
	}

	it('leaves a Changesets release alone, and doctor reports no drift for it', async () => {
		const dir = await seed('changesets')
		expect(await generateGitHubActions(lib(), dir, { overwrite: true })).not.toContain(
			'.github/workflows/ci.yml'
		)
		expect(await fs.readFile(ciPath(dir), 'utf-8')).toBe(fixture('changesets'))
		expect(await fs.pathExists(releasePath(dir))).toBe(false)

		const preset = renderGitHubWorkflow(githubJobs(lib()))
		const r = await checkGitHubActions(dir, preset, renderReleaseWorkflow(lib()) ?? '')
		expect(r.detail).not.toContain('publishes from CI')
	})

	it('refuses an unresolvable `needs.` and writes nothing', async () => {
		const dir = await seed('unresolvable-needs')
		const err = await generateGitHubActions(lib(), dir).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(FixerAbort)
		expect((err as FixerAbort).code).toBe('release-job-needs')
		expect((err as FixerAbort).message).toContain('📝 Stamp the build')
		expect(await fs.readFile(ciPath(dir), 'utf-8')).toBe(fixture('unresolvable-needs'))
		expect(await fs.pathExists(releasePath(dir))).toBe(false)
	})
})
