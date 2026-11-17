import fs from 'fs-extra'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CheckResult } from '../../../src/base/types.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const { doctorCommand, doctorExitCode, ghLogin, skippedReport } = await import(
	'../../../src/cli/commands/doctor.js'
)

const newTmpDir = useTmpDir()

const adminSkip: CheckResult = {
	check: 'Workflow permissions',
	status: 'skipped',
	detail: 'token lacks admin access',
}

describe('doctor skipped checks (#1005)', () => {
	afterEach(() => {
		process.exitCode = 0
	})

	it('names who doctor ran as and lists the skipped checks', () => {
		const r = skippedReport([adminSkip, { check: 'X', status: 'ok', detail: '' }], 'rtorcato-bot')
		expect(r.line).toBe(
			'1 check could not run as rtorcato-bot (needs admin): Workflow permissions — re-run as a repo admin'
		)
		expect(r.skipped).toEqual([
			{ check: 'Workflow permissions', reason: 'token lacks admin access' },
		])
	})

	it('has no line when nothing was skipped', () => {
		expect(skippedReport([{ check: 'X', status: 'ok', detail: '' }], null).line).toBeNull()
	})

	it('reads the login from a mocked non-admin gh', async () => {
		const exec = async () => ({ ok: true, stdout: 'rtorcato-bot\n', stderr: '', code: 0 })
		expect(await ghLogin(exec)).toBe('rtorcato-bot')
		expect(await ghLogin(async () => ({ ok: false, stdout: '', stderr: 'x', code: 1 }))).toBeNull()
	})

	async function run(strict: boolean) {
		const dir = newTmpDir()
		await fs.ensureDir(join(dir, '.git'))
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo', version: '0.0.0' })
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await doctorCommand({ directory: dir, offline: true, json: true, strict })
			return JSON.parse(String(log.mock.calls[0]?.[0]))
		} finally {
			log.mockRestore()
		}
	}

	it('--json carries ranAs and skipped[]', async () => {
		const out = await run(false)
		expect(out).toHaveProperty('ranAs', null)
		expect(out.skipped.length).toBeGreaterThan(0)
	})

	it('--strict turns a skipped check into a non-zero exit', async () => {
		const clean = { ok: 5, drift: 0, missing: 0, optionalMissing: 0, declared: 0, skipped: 1 }
		expect(doctorExitCode(clean, false)).toBe(0)
		expect(doctorExitCode(clean, true)).toBe(1)
		expect(doctorExitCode({ ...clean, skipped: 0 }, true)).toBe(0)
		await run(true)
		expect(process.exitCode).toBe(1)
	})
})
