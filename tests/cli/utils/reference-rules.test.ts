import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it, vi } from 'vitest'
import { buildPresetConfig } from '../../../src/cli/commands/setup-presets.js'
import type { GhExec, GhResult } from '../../../src/base/github-settings.js'
import {
	compareRulesWithReference,
	fetchReferenceLockfile,
} from '../../../src/cli/utils/reference-rules.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const gh = (r: Partial<GhResult>): GhExec =>
	vi.fn(async () => ({ ok: true, stdout: '', stderr: '', code: 0, ...r }))

/** gh returning a file body verbatim, the way `Accept: raw` does. */
const serving = (body: unknown) =>
	gh({ stdout: typeof body === 'string' ? body : JSON.stringify(body) })

const REFERENCE_LOCKFILE = {
	$schema: 'https://rtorcato.github.io/repo-tooling/schemas/lockfile.json',
	version: 4,
	record: {
		config: buildPresetConfig('library', 'reference-repo'),
		assets: { biome: 'a'.repeat(64) },
		writtenBy: '@rtorcato/repo-tooling@1.2.3',
		writtenAt: '2026-01-01T00:00:00.000Z',
	},
	rules: {
		aiLoop: { agentUser: 'some-bot' },
		requiredSkills: ['ai-issue-loop'],
	},
}

async function repoWith(lockfile: unknown): Promise<string> {
	const dir = newTmpDir()
	await fs.writeJson(join(dir, '.repo-tooling.json'), lockfile)
	return dir
}

describe('fetchReferenceLockfile', () => {
	it('rejects a reference that is not owner/repo before it reaches an API path', async () => {
		const exec = gh({})
		for (const bad of ['evil/../../repos', 'owner/repo/extra', 'owner', '../../etc', 'a b/c']) {
			const r = await fetchReferenceLockfile(bad, exec)
			expect(r.ok, bad).toBe(false)
			expect(r.ok === false && r.reason).toContain('not an owner/repo reference')
		}
		expect(exec).not.toHaveBeenCalled()
	})

	it('reports a missing reference file plainly', async () => {
		const r = await fetchReferenceLockfile(
			'someone/theirs',
			gh({ ok: false, stderr: 'gh: Not Found (HTTP 404)', code: 1 })
		)
		expect(r.ok).toBe(false)
		expect(r.ok === false && r.reason).toContain('has no .repo-tooling.json')
	})

	it('reports a gh failure without claiming the file is missing', async () => {
		const r = await fetchReferenceLockfile(
			'someone/theirs',
			gh({ ok: false, stderr: 'gh: could not resolve host', code: 1 })
		)
		expect(r.ok).toBe(false)
		expect(r.ok === false && r.reason).toContain('could not read someone/theirs')
	})

	it('reports malformed JSON instead of crashing', async () => {
		const r = await fetchReferenceLockfile('someone/theirs', serving('{ not json'))
		expect(r.ok).toBe(false)
		expect(r.ok === false && r.reason).toContain('not valid JSON')
	})

	it('rejects well-formed JSON that is not a lockfile', async () => {
		const r = await fetchReferenceLockfile('someone/theirs', serving({ hello: 'world' }))
		expect(r.ok).toBe(false)
		expect(r.ok === false && r.reason).toContain('not a recognisable lockfile')
	})

	it('rejects a lockfile that fails the published schema', async () => {
		const r = await fetchReferenceLockfile(
			'someone/theirs',
			serving({ ...REFERENCE_LOCKFILE, strayKey: 'surprise' })
		)
		expect(r.ok).toBe(false)
		expect(r.ok === false && r.reason).toContain('fails the published schema')
	})

	it('rejects a reference file too large to be a lockfile', async () => {
		const r = await fetchReferenceLockfile('someone/theirs', serving('x'.repeat(128 * 1024 + 1)))
		expect(r.ok).toBe(false)
		expect(r.ok === false && r.reason).toContain('larger than')
	})

	it('accepts a valid reference and asks gh for the raw file', async () => {
		const exec = serving(REFERENCE_LOCKFILE)
		const r = await fetchReferenceLockfile('someone/theirs', exec)
		expect(r.ok).toBe(true)
		expect(r.ok === true && r.lockfile.record.config.projectName).toBe('reference-repo')
		expect(exec).toHaveBeenCalledWith([
			'api',
			'repos/someone/theirs/contents/.repo-tooling.json',
			'-H',
			'Accept: application/vnd.github.raw',
		])
	})

	// An older reference is flat on disk; validating before migrating would reject
	// it for a reason that says nothing about its rules.
	it('migrates an older flat reference before validating it', async () => {
		const r = await fetchReferenceLockfile(
			'someone/theirs',
			serving({
				version: 3,
				config: buildPresetConfig('library', 'old-repo'),
				aiLoop: { agentUser: 'some-bot' },
				writtenBy: '@rtorcato/repo-tooling@1.0.0',
				writtenAt: '2025-01-01T00:00:00.000Z',
			})
		)
		expect(r.ok).toBe(true)
		expect(r.ok === true && r.lockfile.rules?.aiLoop?.agentUser).toBe('some-bot')
	})
})

describe('compareRulesWithReference', () => {
	it('reports identical rules even when the record halves differ', async () => {
		// Same config and rules; different asset hashes and stamps — which is the
		// normal state of any two repos, and must not read as a difference.
		const dir = await repoWith({
			...REFERENCE_LOCKFILE,
			record: {
				...REFERENCE_LOCKFILE.record,
				assets: { biome: 'b'.repeat(64) },
				writtenBy: '@rtorcato/repo-tooling@9.9.9',
				writtenAt: '2026-06-06T00:00:00.000Z',
			},
		})
		const comparison = await compareRulesWithReference(
			dir,
			'someone/theirs',
			serving(REFERENCE_LOCKFILE)
		)
		expect(comparison.compared).toBe(true)
		expect(comparison.differences).toEqual([])
	})

	it('names every rules-side field that differs, and only those', async () => {
		const dir = await repoWith({
			...REFERENCE_LOCKFILE,
			record: {
				...REFERENCE_LOCKFILE.record,
				config: { ...REFERENCE_LOCKFILE.record.config, bundler: 'esbuild' },
			},
			rules: { aiLoop: { agentUser: 'some-bot' }, requiredSkills: ['ai-workflow'] },
		})
		const comparison = await compareRulesWithReference(
			dir,
			'someone/theirs',
			serving(REFERENCE_LOCKFILE)
		)
		expect(comparison.differences).toEqual([
			{ path: 'config.bundler', local: 'esbuild', reference: 'tsup' },
			{ path: 'requiredSkills', local: ['ai-workflow'], reference: ['ai-issue-loop'] },
		])
	})

	it('treats a repo with no lockfile as absent on every path, not as an error', async () => {
		const comparison = await compareRulesWithReference(
			newTmpDir(),
			'someone/theirs',
			serving(REFERENCE_LOCKFILE)
		)
		expect(comparison.compared).toBe(true)
		expect(comparison.differences?.length).toBeGreaterThan(0)
		expect(comparison.differences?.every((d) => d.local === undefined)).toBe(true)
		expect(comparison.differences?.map((d) => d.path)).toContain('aiLoop.agentUser')
	})

	it('carries the reason forward when the reference cannot be read', async () => {
		const comparison = await compareRulesWithReference(
			newTmpDir(),
			'someone/theirs',
			gh({ ok: false, stderr: 'gh: Not Found (HTTP 404)', code: 1 })
		)
		expect(comparison.compared).toBe(false)
		expect(comparison.reason).toContain('has no .repo-tooling.json')
		expect(comparison.differences).toBeUndefined()
	})
})
