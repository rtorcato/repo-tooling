import fs from 'fs-extra'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTmpDir } from '../../helpers/tmp-dir.js'

// Every `gh` spawn is recorded and never actually run — this is the guard for
// #755: a check that calls `gh` without being declared `remote: true` in
// doctor's REMOTE_CHECKS still spawns it under --offline, and fails here.
const ghCalls: string[][] = []
vi.mock('node:child_process', async (importOriginal) => {
	const real = await importOriginal<typeof import('node:child_process')>()
	const spawn = ((cmd: string, args: string[], opts: object) => {
		if (cmd !== 'gh') return real.spawn(cmd, args, opts)
		ghCalls.push(args)
		// A command that can't exist: gh resolves `ok: false` without the network.
		return real.spawn('repo-tooling-test-no-such-gh', args, opts)
	}) as typeof real.spawn
	return { ...real, spawn }
})

const { runDoctor } = await import('../../../src/cli/commands/doctor.js')

const newTmpDir = useTmpDir()

/** A git repo whose CI references a secret, so every remote check reaches `gh`. */
async function seedRepo(dir: string) {
	await fs.ensureDir(join(dir, '.git'))
	await fs.writeJson(join(dir, 'package.json'), { name: 'demo', version: '0.0.0' })
	await fs.outputFile(
		join(dir, '.github', 'workflows', 'ci.yml'),
		'jobs:\n  a:\n    steps:\n      - run: echo ${{ secrets.SOME_TOKEN }}\n'
	)
}

describe('doctor --offline (#755)', () => {
	beforeEach(() => {
		ghCalls.length = 0
	})

	it('online, the remote checks call gh (proves the stub sees them)', async () => {
		const dir = newTmpDir()
		await seedRepo(dir)
		await runDoctor(dir)
		expect(ghCalls.length).toBeGreaterThan(0)
	})

	it('offline, nothing calls gh and the remote checks report skipped', async () => {
		const dir = newTmpDir()
		await seedRepo(dir)
		const results = await runDoctor(dir, { offline: true })
		expect(ghCalls).toEqual([])
		const skipped = results.filter((r) => r.status === 'skipped').map((r) => r.check)
		expect(skipped).toEqual(
			expect.arrayContaining(['Milestones', 'Repository secrets', 'Branch protection'])
		)
		for (const r of results.filter((r) => r.status === 'skipped')) {
			expect(r.detail).toMatch(/^offline/)
		}
	})
})
