import { join } from 'node:path'
import fs from 'fs-extra'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixCommand, getFixers } from '../../../src/cli/commands/fix.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

// Doctor reports drift on branch protection, so github-settings is in play
// without a real repo or `gh`.
vi.mock('../../../src/cli/commands/doctor.js', () => ({
	runDoctor: vi.fn(async () => [
		{ check: 'Branch protection', status: 'drift', detail: 'requiredChecks differ' },
	]),
}))

const newTmpDir = useTmpDir()

describe('github-settings is explicitOnly (#866)', () => {
	const fixer = getFixers().find((f) => f.target === 'github-settings')
	if (!fixer) throw new Error('github-settings fixer not registered')
	const run = vi.spyOn(fixer, 'run').mockResolvedValue({ filesWritten: [] })
	const log = vi.spyOn(console, 'log').mockImplementation(() => {})
	vi.spyOn(console, 'error').mockImplementation(() => {})
	const lastPayload = () => JSON.parse(log.mock.calls.at(-1)?.[0] as string)

	afterEach(() => {
		run.mockClear()
		log.mockClear()
	})

	it('a bare `fix --yes` skips it', async () => {
		// A bare fix refuses an empty dir (#827), so give it a project.
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo', version: '0.0.0' })
		await fixCommand(undefined, { directory: dir, yes: true, json: true })
		expect(run).not.toHaveBeenCalled()
		const action = lastPayload().actions.find(
			(a: { target: string | null }) => a.target === 'github-settings'
		)
		expect(action).toMatchObject({ status: 'skipped' })
	})

	it('`fix github-settings` still applies it', async () => {
		await fixCommand('github-settings', { directory: newTmpDir(), yes: true, json: true })
		expect(run).toHaveBeenCalledTimes(1)
	})
})

describe('a named fixer with no TTY and no --yes fails (#1004)', () => {
	const fixer = getFixers().find((f) => f.target === 'github-settings')
	if (!fixer) throw new Error('github-settings fixer not registered')
	const run = vi.spyOn(fixer, 'run').mockResolvedValue({ filesWritten: [] })
	const err = vi.spyOn(console, 'error').mockImplementation(() => {})
	vi.spyOn(console, 'log').mockImplementation(() => {})
	const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
		throw new Error(`exit ${code}`)
	}) as never)
	const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')

	afterEach(() => {
		run.mockClear()
		err.mockClear()
		exit.mockClear()
		if (original) Object.defineProperty(process.stdin, 'isTTY', original)
		else Reflect.deleteProperty(process.stdin, 'isTTY')
	})

	it('exits 1 with the --yes hint and applies nothing', async () => {
		Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
		await expect(fixCommand('github-settings', { directory: newTmpDir() })).rejects.toThrow(
			'exit 1'
		)
		expect(run).not.toHaveBeenCalled()
		const printed = err.mock.calls.map((c) => String(c[0])).join('\n')
		expect(printed).toContain('github-settings needs confirmation: re-run with --yes')
	})

	it('applies with --yes', async () => {
		Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
		await fixCommand('github-settings', { directory: newTmpDir(), yes: true })
		expect(run).toHaveBeenCalledTimes(1)
	})
})
