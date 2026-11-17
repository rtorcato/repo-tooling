import { join } from 'node:path'
import fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FixerAbort } from '../../../src/base/fixers.js'
import { fixCommand } from '../../../src/cli/commands/fix.js'
import { fixersForLanguage } from '../../../src/cli/commands/fixers-by-language.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

// #1020: a fixer that does not run must say why, or fail. Every fixer in the
// registry is driven through each skip path; a new one that skips silently
// fails here instead of in a downstream repo.

type Status = 'drift' | 'optional-missing'
let doctorStatus: Status = 'drift'
let doctorChecks: string[] = []

vi.mock('../../../src/cli/commands/doctor.js', () => ({
	runDoctor: vi.fn(async () =>
		doctorChecks.map((check) => ({ check, status: doctorStatus, detail: 'x' }))
	),
}))

const LANGUAGES: Record<string, string> = {
	js: 'package.json',
	swift: 'Package.swift',
	python: 'pyproject.toml',
	perl: 'cpanfile',
}

const newTmpDir = useTmpDir()
const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')

async function project(language: string): Promise<string> {
	const dir = newTmpDir()
	const marker = LANGUAGES[language] as string
	await fs.writeFile(
		join(dir, marker),
		marker === 'package.json' ? JSON.stringify({ name: 'demo', version: '0.0.0' }) : ''
	)
	return dir
}

afterEach(() => {
	vi.restoreAllMocks()
	if (original) Object.defineProperty(process.stdin, 'isTTY', original)
	else Reflect.deleteProperty(process.stdin, 'isTTY')
})

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {})
	Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
})

interface Action {
	target: string | null
	status: string
	reason?: string
}

async function runJson(dir: string): Promise<Action[]> {
	const log = vi.spyOn(console, 'log').mockImplementation(() => {})
	await fixCommand(undefined, { directory: dir, yes: true, json: true })
	return JSON.parse(log.mock.calls.at(-1)?.[0] as string).actions
}

describe.each(Object.keys(LANGUAGES))('%s fixers: every skip carries a reason', (language) => {
	const fixers = fixersForLanguage(language)
	const checks = [...new Set(fixers.flatMap((f) => f.appliesTo))]

	it('optional-missing and explicitOnly findings are skipped with a reason', async () => {
		doctorChecks = checks
		doctorStatus = 'optional-missing'
		const actions = await runJson(await project(language))
		const skipped = actions.filter((a) => a.status === 'skipped')
		expect(skipped.length).toBeGreaterThan(0)
		for (const a of skipped) expect(a.reason?.trim(), `${a.target} skipped silently`).toBeTruthy()
	})

	it('no TTY and no --yes: each drifting fixer prints why it skipped', async () => {
		doctorChecks = checks
		doctorStatus = 'drift'
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		await fixCommand(undefined, { directory: await project(language) })
		const lines = log.mock.calls.map((c) => String(c[0]))
		const bare = lines.filter((l) => /skipped\s*$/.test(l))
		expect(bare, 'a bare "skipped" gives no reason').toEqual([])
		expect(lines.some((l) => /skipped — .+/.test(l))).toBe(true)
	})

	it('a fixer that refuses is skipped with its message', async () => {
		const target = fixers.find((f) => !f.explicitOnly)
		if (!target) throw new Error('no non-explicit fixer')
		vi.spyOn(target, 'run').mockRejectedValue(new FixerAbort('some-code', 'refused on purpose'))
		doctorChecks = [target.appliesTo[0] as string]
		doctorStatus = 'drift'
		const actions = await runJson(await project(language))
		const a = actions.find((x) => x.target === target.target)
		expect(a).toMatchObject({ status: 'skipped', reason: expect.stringContaining('refused') })
	})
})
