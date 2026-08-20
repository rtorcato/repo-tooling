import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import {
	LEGACY_LOCKFILE_NAME,
	LOCKFILE_NAME,
	LOCKFILE_VERSION,
	readLockfile,
	recordAssetHash,
	updateLockfileConfig,
	writeLockfile,
} from '../../../src/cli/utils/lockfile.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		projectName: 'demo',
		projectType: 'library',
		typescript: { enabled: true, config: 'base' },
		linting: { tool: 'biome' },
		formatting: { tool: 'biome' },
		testing: { framework: 'vitest', environment: 'node' },
		gitHooks: true,
		commitLint: true,
		semanticRelease: true,
		securityAutomation: true,
		bundler: 'tsup',
		...overrides,
	}
}

describe('readLockfile', () => {
	it('returns null when the file is missing', async () => {
		const dir = newTmpDir()
		expect(await readLockfile(dir)).toBeNull()
	})

	it('returns null when the file is malformed JSON', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, LOCKFILE_NAME), '{ not valid json')
		expect(await readLockfile(dir)).toBeNull()
	})

	it('returns null when version or config is missing', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, LOCKFILE_NAME), { writtenBy: 'x' })
		expect(await readLockfile(dir)).toBeNull()
	})

	it('falls back to the pre-rename .js-tooling.json name (#272)', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, LEGACY_LOCKFILE_NAME), {
			version: LOCKFILE_VERSION,
			config: baseConfig({ language: 'js' }),
			writtenBy: 'old',
			writtenAt: '2024-01-01T00:00:00.000Z',
		})
		const lock = await readLockfile(dir)
		expect(lock?.config.projectName).toBe('demo')
	})

	it('migrates a v1 file, defaulting language to js', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, LOCKFILE_NAME), {
			version: 1,
			config: baseConfig(), // baseConfig predates the language field
			writtenBy: 'old',
			writtenAt: '2024-01-01T00:00:00.000Z',
		})

		const lock = await readLockfile(dir)
		expect(lock?.version).toBe(LOCKFILE_VERSION)
		expect(lock?.config.language).toBe('js')
		// Existing fields survive the migration untouched.
		expect(lock?.config.projectName).toBe('demo')
	})

	it('migrates a v2 file to v3 with no recorded asset hashes (#428)', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, LOCKFILE_NAME), {
			version: 2,
			config: baseConfig({ language: 'js' }),
			writtenBy: 'old',
			writtenAt: '2024-01-01T00:00:00.000Z',
		})

		const lock = await readLockfile(dir)
		expect(lock?.version).toBe(3)
		expect(lock?.assets).toEqual({})
		expect(lock?.config.projectName).toBe('demo')
	})
})

describe('writeLockfile', () => {
	it('writes a valid lockfile and round-trips through readLockfile', async () => {
		const dir = newTmpDir()
		const config = baseConfig()
		await writeLockfile(dir, config)

		const lock = await readLockfile(dir)
		expect(lock).not.toBeNull()
		expect(lock?.version).toBe(LOCKFILE_VERSION)
		expect(lock?.config.projectName).toBe('demo')
		expect(lock?.config.testing.framework).toBe('vitest')
		expect(lock?.writtenBy).toMatch(/@rtorcato\/repo-tooling@/)
		expect(lock?.writtenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
	})

	it('migrates a pre-rename repo: writes the new name and removes the legacy file (#272)', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, LEGACY_LOCKFILE_NAME), {
			version: LOCKFILE_VERSION,
			config: baseConfig({ language: 'js' }),
			writtenBy: 'old',
			writtenAt: '2024-01-01T00:00:00.000Z',
		})
		await writeLockfile(dir, baseConfig({ language: 'js' }))
		expect(await fs.pathExists(join(dir, LOCKFILE_NAME))).toBe(true)
		expect(await fs.pathExists(join(dir, LEGACY_LOCKFILE_NAME))).toBe(false)
	})

	it('refuses to write an invalid ProjectConfig', async () => {
		const dir = newTmpDir()
		const broken = { projectName: 'demo' } as unknown as ProjectConfig
		await expect(writeLockfile(dir, broken)).rejects.toThrow(/invalid lockfile/i)
	})
})

describe('updateLockfileConfig', () => {
	it('merges a patch into an existing lockfile', async () => {
		const dir = newTmpDir()
		await writeLockfile(dir, baseConfig())
		const updated = await updateLockfileConfig(dir, {
			testing: { framework: 'jest', environment: 'node' },
		})
		expect(updated).toBe(true)
		const lock = await readLockfile(dir)
		expect(lock?.config.testing.framework).toBe('jest')
		// Other fields preserved
		expect(lock?.config.linting.tool).toBe('biome')
		expect(lock?.config.gitHooks).toBe(true)
	})

	it('returns false when no lockfile exists', async () => {
		const dir = newTmpDir()
		const updated = await updateLockfileConfig(dir, { gitHooks: false })
		expect(updated).toBe(false)
	})

	it('leaves recorded asset hashes alone (#428)', async () => {
		const dir = newTmpDir()
		await writeLockfile(dir, baseConfig())
		await recordAssetHash(dir, 'oxlint', 'abc123')

		await updateLockfileConfig(dir, { gitHooks: false })

		const lock = await readLockfile(dir)
		expect(lock?.assets).toEqual({ oxlint: 'abc123' })
		expect(lock?.config.gitHooks).toBe(false)
	})
})

describe('recordAssetHash', () => {
	it('returns false without creating a lockfile when the repo has none', async () => {
		const dir = newTmpDir()
		expect(await recordAssetHash(dir, 'oxlint', 'abc123')).toBe(false)
		expect(await fs.pathExists(join(dir, LOCKFILE_NAME))).toBe(false)
	})
})
