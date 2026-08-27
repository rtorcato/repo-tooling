import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { runDoctor } from '../../../src/cli/commands/doctor.js'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { checkCopiedAssets, classifyCopiedAssets } from '../../../src/cli/utils/copied-assets.js'
import { copyPreset, hashFile } from '../../../src/cli/utils/copy-preset.js'
import { readLockfile, recordAssetHash, writeLockfile } from '../../../src/cli/utils/lockfile.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const CONFIG: ProjectConfig = {
	projectName: 'demo',
	projectType: 'library',
	language: 'js',
	typescript: { enabled: true, config: 'base' },
	linting: { tool: 'biome' },
	formatting: { tool: 'biome' },
	testing: { framework: 'vitest', environment: 'node' },
	gitHooks: true,
	commitLint: true,
	semanticRelease: true,
	securityAutomation: true,
	bundler: 'tsup',
}

/** A repo with a lockfile, so `copy` has somewhere to record hashes. */
async function seedRepo(): Promise<string> {
	const dir = newTmpDir()
	await fs.writeJson(join(dir, 'package.json'), { name: 'demo', version: '0.0.0' })
	await writeLockfile(dir, CONFIG)
	return dir
}

const stateOf = (statuses: { preset: string; state: string }[], preset: string) =>
	statuses.find((s) => s.preset === preset)?.state

describe('classifyCopiedAssets', () => {
	it('reports ok for an asset copied and left alone', async () => {
		const dir = await seedRepo()
		await copyPreset('oxlint', dir)

		// The hash landed in the lockfile rather than nowhere.
		const lock = await readLockfile(dir)
		expect(lock?.record.assets?.oxlint).toMatch(/^[0-9a-f]{64}$/)

		expect(stateOf(await classifyCopiedAssets(dir), 'oxlint')).toBe('ok')
	})

	it('reports modified when the copy was edited afterwards', async () => {
		const dir = await seedRepo()
		await copyPreset('oxlint', dir)
		await fs.appendFile(join(dir, '.oxlintrc.json'), '\n// local fork\n')

		expect(stateOf(await classifyCopiedAssets(dir), 'oxlint')).toBe('modified')
	})

	it('reports stale when the file still matches the record but the package has moved on', async () => {
		const dir = await seedRepo()
		// An older generation of the asset: untouched since it was copied (the
		// record matches it byte for byte), but not what the package ships now.
		const target = join(dir, '.oxlintrc.json')
		await fs.writeFile(target, '{ "rules": {} }\n')
		const hash = await hashFile(target)
		await recordAssetHash(dir, 'oxlint', hash as string)

		expect(stateOf(await classifyCopiedAssets(dir), 'oxlint')).toBe('stale')
	})

	it('reports unknown for a copy made before hashes were recorded', async () => {
		const dir = await seedRepo()
		await copyPreset('oxlint', dir)
		// Strip the record, leaving the pre-#428 shape: the file is there, its
		// provenance isn't.
		const lock = await readLockfile(dir)
		await writeLockfile(dir, lock?.record.config as ProjectConfig, {})

		expect(stateOf(await classifyCopiedAssets(dir), 'oxlint')).toBe('unknown')
	})

	it('reports unknown when the repo has no lockfile at all', async () => {
		const dir = newTmpDir()
		await copyPreset('oxlint', dir)
		// `copy` did not conjure a lockfile just to have somewhere to write.
		expect(await readLockfile(dir)).toBeNull()

		expect(stateOf(await classifyCopiedAssets(dir), 'oxlint')).toBe('unknown')
	})

	it('ignores presets that were never copied here', async () => {
		const dir = await seedRepo()
		await copyPreset('oxlint', dir)
		const presets = (await classifyCopiedAssets(dir)).map((s) => s.preset)
		expect(presets).toContain('oxlint')
		expect(presets).not.toContain('perltidy')
	})
})

describe('checkCopiedAssets', () => {
	it('is drift only for stale assets, and names the fix', async () => {
		const dir = await seedRepo()
		const target = join(dir, '.oxlintrc.json')
		await fs.writeFile(target, '{ "rules": {} }\n')
		await recordAssetHash(dir, 'oxlint', (await hashFile(target)) as string)

		const result = await checkCopiedAssets(dir)
		expect(result.status).toBe('drift')
		expect(result.detail).toMatch(/1 stale: oxlint/)
		expect(result.hint).toMatch(/fix copied-assets/)
	})

	it('stays ok for a deliberate local fork, and says so', async () => {
		const dir = await seedRepo()
		await copyPreset('oxlint', dir)
		await fs.appendFile(join(dir, '.oxlintrc.json'), '\n// local fork\n')

		const result = await checkCopiedAssets(dir)
		expect(result.status).toBe('ok')
		expect(result.detail).toMatch(/locally modified: oxlint/)
	})

	it('never fails a build over an untracked copy', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo', version: '0.0.0' })
		await copyPreset('oxlint', dir)

		const result = await checkCopiedAssets(dir)
		expect(result.status).toBe('ok')
		expect(result.detail).toMatch(/1 untracked: oxlint/)
	})

	it('is optional-missing in a repo with no copied presets', async () => {
		const dir = newTmpDir()
		expect((await checkCopiedAssets(dir)).status).toBe('optional-missing')
	})

	it('is surfaced by doctor', async () => {
		const dir = await seedRepo()
		await copyPreset('oxlint', dir)
		const result = (await runDoctor(dir)).find((r) => r.check === 'Copied assets')
		expect(result?.status).toBe('ok')
	})
})
