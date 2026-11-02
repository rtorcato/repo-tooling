import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it, vi } from 'vitest'
import type { GhExec, GhResult } from '../../../src/base/github-settings.js'
import { buildPresetConfig } from '../../../src/cli/commands/setup-presets.js'
import { runDoctor } from '../../../src/cli/commands/doctor.js'
import { readEffectiveLockfile } from '../../../src/cli/utils/extends.js'
import { readLockfile, writeLockfile } from '../../../src/cli/utils/lockfile.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const gh = (r: Partial<GhResult>): GhExec =>
	vi.fn(async () => ({ ok: true, stdout: '', stderr: '', code: 0, ...r }))

const BASE = {
	rules: {
		dependabot: { onPr: 'label', label: 'from-base' },
		github: { autoMerge: true, requiredChecks: ['ci'] },
		exceptions: { Milestones: 'base reason' },
	},
}

async function repoWith(extendsValue: unknown, rules?: unknown): Promise<string> {
	const dir = newTmpDir()
	await writeLockfile(dir, buildPresetConfig('library', 'consumer'))
	const file = join(dir, '.repo-tooling.json')
	const lock = await fs.readJson(file)
	await fs.writeJson(file, { ...lock, extends: extendsValue, ...(rules ? { rules } : {}) })
	return dir
}

describe('readEffectiveLockfile', () => {
	it('is plain readLockfile without extends', async () => {
		const dir = newTmpDir()
		await writeLockfile(dir, buildPresetConfig('library', 'consumer'))
		const { lock, report } = await readEffectiveLockfile(dir)
		expect(report).toBeNull()
		expect(lock).toEqual(await readLockfile(dir))
	})

	it('merges a relative base under the repo rules, and the repo wins', async () => {
		const dir = await repoWith('./base.json', {
			dependabot: { label: 'mine' },
			github: { requiredChecks: ['own-ci'] },
		})
		await fs.writeJson(join(dir, 'base.json'), BASE)
		const { lock, report } = await readEffectiveLockfile(dir)
		expect(lock?.rules?.dependabot).toEqual({ onPr: 'label', label: 'mine' })
		// arrays are replaced whole, never concatenated
		expect(lock?.rules?.github).toEqual({ autoMerge: true, requiredChecks: ['own-ci'] })
		expect(lock?.rules?.exceptions).toEqual({ Milestones: 'base reason' })
		expect(report?.status).toBe('ok')
		expect(report?.inherited.sort()).toEqual(
			['dependabot.onPr', 'exceptions.Milestones', 'github.autoMerge'].sort()
		)
	})

	it('leaves the repo file untouched: a rewrite never copies the base in', async () => {
		const dir = await repoWith('./base.json')
		await fs.writeJson(join(dir, 'base.json'), BASE)
		await writeLockfile(dir, buildPresetConfig('library', 'consumer'))
		const onDisk = await fs.readJson(join(dir, '.repo-tooling.json'))
		expect(onDisk.extends).toBe('./base.json')
		expect(onDisk.rules.dependabot).toBeUndefined()
	})

	it('reads a base from github: with the ref, over gh', async () => {
		const dir = await repoWith('github:acme/standards/shared/base.json#v2')
		const exec = gh({ stdout: JSON.stringify(BASE) })
		const { lock, report } = await readEffectiveLockfile(dir, { exec })
		expect(report?.status).toBe('ok')
		expect(lock?.rules?.dependabot?.label).toBe('from-base')
		expect(exec).toHaveBeenCalledWith([
			'api',
			'repos/acme/standards/contents/shared/base.json?ref=v2',
			'-H',
			'Accept: application/vnd.github.raw',
		])
	})

	it('does not fetch a github: base under --offline', async () => {
		const dir = await repoWith('github:acme/standards/base.json')
		const exec = gh({})
		const { lock, report } = await readEffectiveLockfile(dir, { offline: true, exec })
		expect(report?.status).toBe('skipped')
		expect(lock?.rules?.dependabot).toBeUndefined()
		expect(exec).not.toHaveBeenCalled()
	})

	it('resolves an npm package path from the repo', async () => {
		const dir = await repoWith('@acme/standards/base.json')
		await fs.outputJson(join(dir, 'node_modules/@acme/standards/base.json'), BASE)
		await fs.outputJson(join(dir, 'node_modules/@acme/standards/package.json'), {
			name: '@acme/standards',
			version: '1.0.0',
		})
		const { report } = await readEffectiveLockfile(dir)
		expect(report?.status).toBe('ok')
	})

	describe('reports drift, never silence', () => {
		it.each([
			['a missing file', './nope.json', undefined, 'cannot read'],
			['a spec of no known kind', '/etc/passwd', undefined, 'not a relative path'],
			['a .. segment in a github path', 'github:a/b/../c.json', undefined, 'not github:'],
			['an owner/repo with a slash', 'github:a/b/c/../../x.json', undefined, 'not github:'],
			['invalid JSON', './bad.json', '{nope', 'not valid JSON'],
			['a base with no rules', './bad.json', '{"x":1}', 'no "rules" object'],
			['a nested extends', './bad.json', '{"extends":"./x.json","rules":{}}', 'own "extends"'],
			['rules failing the schema', './bad.json', '{"rules":{"nope":1}}', 'published schema'],
		])('%s', async (_name, spec, body, message) => {
			const dir = await repoWith(spec, { dependabot: { onPr: 'automerge' } })
			if (body !== undefined) await fs.writeFile(join(dir, 'bad.json'), body)
			const exec = gh({})
			const { lock, report } = await readEffectiveLockfile(dir, { exec })
			expect(report?.status).toBe('drift')
			expect(report?.detail).toContain(message)
			// only the repo's own rules apply
			expect(lock?.rules).toEqual({ dependabot: { onPr: 'automerge' } })
			expect(exec).not.toHaveBeenCalled()
		})

		it('a github: base gh cannot read', async () => {
			const dir = await repoWith('github:acme/standards/base.json')
			const exec = gh({ ok: false, stderr: 'gh: Not Found (HTTP 404)', code: 1 })
			const { report } = await readEffectiveLockfile(dir, { exec })
			expect(report?.status).toBe('drift')
			expect(report?.detail).toContain('has no base.json')
		})
	})

	it('ignores __proto__ keys in an untrusted base', async () => {
		const dir = await repoWith('./base.json', { exceptions: { Milestones: 'mine' } })
		await fs.writeFile(
			join(dir, 'base.json'),
			'{"rules":{"exceptions":{"__proto__":"x","Other":"y"}}}'
		)
		const { lock } = await readEffectiveLockfile(dir)
		expect(lock?.rules?.exceptions?.Other).toBe('y')
		expect(({} as Record<string, unknown>).polluted).toBeUndefined()
	})
})

describe('doctor', () => {
	it('adds an Extends row, and applies the base exceptions', async () => {
		const dir = await repoWith('./base.json')
		await fs.writeJson(join(dir, 'base.json'), { rules: { exceptions: { Nonsense: 'why' } } })
		const results = await runDoctor(dir, { offline: true })
		expect(results[0]).toMatchObject({ check: 'Extends', status: 'ok' })
		// the base's exception reached applyExceptions: it names a check this run does not know
		expect(results.some((r) => r.check === 'Declared exceptions' && r.status === 'drift')).toBe(
			true
		)
	})

	it('flags an unreadable base as drift', async () => {
		const dir = await repoWith('./missing.json')
		const results = await runDoctor(dir, { offline: true })
		expect(results[0]).toMatchObject({ check: 'Extends', status: 'drift' })
		expect(results[0]?.hint).toBeTruthy()
	})

	it('has no Extends row without extends', async () => {
		const dir = newTmpDir()
		await writeLockfile(dir, buildPresetConfig('library', 'consumer'))
		expect((await runDoctor(dir, { offline: true })).some((r) => r.check === 'Extends')).toBe(false)
	})
})
