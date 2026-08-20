import { readFileSync } from 'node:fs'
import path, { join } from 'node:path'
import fs from 'fs-extra'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GhExec, GhResult } from '../../src/base/github-settings.js'
import { applyLoopLabels, checkLoopLabels, LOOP_LABELS } from '../../src/base/labels.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function gitRepo(): string {
	const dir = newTmpDir()
	fs.ensureDirSync(join(dir, '.git'))
	return dir
}

const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '', code: 0 })

const spec = (name: string) => {
	const found = LOOP_LABELS.find((l) => l.name === name)
	if (!found) throw new Error(`no spec for ${name}`)
	return found
}

/** A label exactly as the spec wants it, with optional overrides. */
const label = (name: string, over: Partial<Record<string, unknown>> = {}) => ({
	...spec(name),
	...over,
})

/** Serves `gh label list`; edits/creates succeed unless `write` says otherwise. */
function fakeGh(labels: unknown[], write?: GhResult): GhExec {
	return vi.fn(async (args: string[]) => {
		if (args[1] === 'list') return ok(JSON.stringify(labels))
		if (args[1] === 'edit' || args[1] === 'create') return write ?? ok('')
		return { ok: false, stdout: '', stderr: `unexpected ${args.join(' ')}`, code: 1 }
	})
}

/** Every label at spec — the baseline a drift case deviates from. */
const allCorrect = () => LOOP_LABELS.map((l) => ({ ...l }))

describe('checkLoopLabels', () => {
	it('never spawns gh outside a git repo', async () => {
		const exec = fakeGh([])
		expect((await checkLoopLabels(newTmpDir(), exec)).detail).toContain('not a git repository')
		expect(exec).not.toHaveBeenCalled()
	})

	it('is not applicable on a repo with none of the labels — that is opting out', async () => {
		const r = await checkLoopLabels(gitRepo(), fakeGh([{ name: 'bug', color: 'd73a4a' }]))
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('not applicable')
	})

	it('is still not applicable with a single stray label', async () => {
		const r = await checkLoopLabels(gitRepo(), fakeGh([label('ai-ready')]))
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('not applicable')
	})

	it('is ok when every label matches spec', async () => {
		const r = await checkLoopLabels(gitRepo(), fakeGh(allCorrect()))
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('match spec')
	})

	it('treats an uppercase hex as a match, not drift', async () => {
		const labels = allCorrect().map((l) => ({ ...l, color: l.color.toUpperCase() }))
		expect((await checkLoopLabels(gitRepo(), fakeGh(labels))).status).toBe('ok')
	})

	it('ignores a leading # on the reported colour', async () => {
		const labels = allCorrect().map((l) => ({ ...l, color: `#${l.color}` }))
		expect((await checkLoopLabels(gitRepo(), fakeGh(labels))).status).toBe('ok')
	})

	it('flags the #446 drift: ai-ready wearing ai-blocked’s red', async () => {
		const labels = allCorrect().map((l) => (l.name === 'ai-ready' ? { ...l, color: 'B60205' } : l))
		const r = await checkLoopLabels(gitRepo(), fakeGh(labels))
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('`ai-ready` is #b60205, should be #0e8a16')
	})

	it('flags a drifted description', async () => {
		const labels = allCorrect().map((l) =>
			l.name === 'ai-ready' ? { ...l, description: 'Approved for AI-agent execution' } : l
		)
		const r = await checkLoopLabels(gitRepo(), fakeGh(labels))
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('wrong description')
	})

	it('flags a missing label once the repo is clearly running the loop', async () => {
		const labels = allCorrect().filter((l) => l.name !== 'ai-notes')
		const r = await checkLoopLabels(gitRepo(), fakeGh(labels))
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('missing: `ai-notes`')
	})

	it('self-skips when the label read fails', async () => {
		const exec: GhExec = async () => ({ ok: false, stdout: '', stderr: 'gh error', code: 1 })
		const r = await checkLoopLabels(gitRepo(), exec)
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('could not read labels')
	})
})

describe('applyLoopLabels', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	it('repairs with `gh label edit`, never `create` — create no-ops on an existing label', async () => {
		const labels = allCorrect().map((l) => (l.name === 'ai-ready' ? { ...l, color: 'B60205' } : l))
		const exec = fakeGh(labels)
		expect(await applyLoopLabels(gitRepo(), exec)).toEqual(['repaired label "ai-ready"'])
		expect(exec).toHaveBeenCalledWith([
			'label',
			'edit',
			'ai-ready',
			'--color',
			'0e8a16',
			'--description',
			'Eligible for an AI agent to implement',
		])
		const wrote = vi.mocked(exec).mock.calls.filter((c) => c[0][1] === 'create')
		expect(wrote).toEqual([])
	})

	it('does not touch a label whose only difference is hex case', async () => {
		const labels = allCorrect().map((l) => ({ ...l, color: l.color.toUpperCase() }))
		const exec = fakeGh(labels)
		expect(await applyLoopLabels(gitRepo(), exec)).toEqual([])
		expect(vi.mocked(exec).mock.calls.every((c) => c[0][1] === 'list')).toBe(true)
	})

	it('creates a missing label on a repo already running the loop', async () => {
		const exec = fakeGh(allCorrect().filter((l) => l.name !== 'ai-notes'))
		expect(await applyLoopLabels(gitRepo(), exec)).toEqual(['created label "ai-notes"'])
	})

	it('writes nothing to a repo that does not use the loop', async () => {
		const exec = fakeGh([{ name: 'bug', color: 'd73a4a', description: '' }])
		expect(await applyLoopLabels(gitRepo(), exec)).toEqual([])
		expect(vi.mocked(exec).mock.calls.every((c) => c[0][1] === 'list')).toBe(true)
	})

	it('is a no-op outside a git repo', async () => {
		const exec = fakeGh([])
		expect(await applyLoopLabels(newTmpDir(), exec)).toEqual([])
		expect(exec).not.toHaveBeenCalled()
	})

	it('reports a failed edit without claiming it applied', async () => {
		const labels = allCorrect().map((l) => (l.name === 'ai-ready' ? { ...l, color: 'ffffff' } : l))
		const exec = fakeGh(labels, { ok: false, stdout: '', stderr: 'HTTP 403', code: 1 })
		expect(await applyLoopLabels(gitRepo(), exec)).toEqual([])
	})
})

/**
 * The single-source-of-truth guard. The skill's bootstrap block is the only
 * other copy of this table, and it is the copy that drifted (#446) — so it is
 * asserted against LOOP_LABELS rather than trusted.
 */
describe('skills/ai-issue-loop/SKILL.md bootstrap block', () => {
	const skill = readFileSync(
		path.resolve(import.meta.dirname, '../../skills/ai-issue-loop/SKILL.md'),
		'utf8'
	)
	const LINE = /^gh label create\s+(\S+)\s+-c\s+'#([0-9a-fA-F]{6})'\s+-d\s+'(.*)'$/gm

	it('matches LOOP_LABELS exactly', () => {
		const fromSkill = [...skill.matchAll(LINE)].map(([, name, color, description]) => ({
			name,
			color: color?.toLowerCase(),
			description,
		}))
		expect(fromSkill).toEqual(LOOP_LABELS.map((l) => ({ ...l })))
	})
})
