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
			version: 3,
			config: baseConfig({ language: 'js' }),
			writtenBy: 'old',
			writtenAt: '2024-01-01T00:00:00.000Z',
		})
		const lock = await readLockfile(dir)
		expect(lock?.record.config.projectName).toBe('demo')
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
		// The on-disk version is preserved so doctor can flag it as older (#531).
		expect(lock?.version).toBe(1)
		expect(lock?.record.config.language).toBe('js')
		// Existing fields survive the migration untouched.
		expect(lock?.record.config.projectName).toBe('demo')
	})

	it('migrates a v2 file in memory with no recorded asset hashes (#428)', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, LOCKFILE_NAME), {
			version: 2,
			config: baseConfig({ language: 'js' }),
			writtenBy: 'old',
			writtenAt: '2024-01-01T00:00:00.000Z',
		})

		const lock = await readLockfile(dir)
		// The on-disk version is preserved so doctor can flag it as older (#531).
		expect(lock?.version).toBe(2)
		expect(lock?.record.assets).toEqual({})
		expect(lock?.record.config.projectName).toBe('demo')
	})

	// #559: v4 split the file into record (tool-written) and rules (human-written).
	it('migrates a flat v3 file into the record/rules subtrees, field for field', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, LOCKFILE_NAME), {
			version: 3,
			config: baseConfig({ language: 'js' }),
			assets: { biome: 'abc123' },
			aiLoop: { agentUser: 'some-bot' },
			requiredSkills: ['ai-issue-loop'],
			mcp: { recommended: [{ name: 's', importance: 'critical', why: 'because' }] },
			exceptions: { TypeScript: 'reason' },
			writtenBy: 'old',
			writtenAt: '2024-01-01T00:00:00.000Z',
		})

		const lock = await readLockfile(dir)
		// The on-disk version is preserved so doctor can flag it as older (#531).
		expect(lock?.version).toBe(3)
		expect(lock?.record.config.projectName).toBe('demo')
		expect(lock?.record.assets).toEqual({ biome: 'abc123' })
		expect(lock?.record.writtenBy).toBe('old')
		expect(lock?.record.writtenAt).toBe('2024-01-01T00:00:00.000Z')
		expect(lock?.rules).toEqual({
			aiLoop: { agentUser: 'some-bot' },
			requiredSkills: ['ai-issue-loop'],
			mcp: { recommended: [{ name: 's', importance: 'critical', why: 'because' }] },
			exceptions: { TypeScript: 'reason' },
		})
	})

	it('omits rules entirely when a v3 file set none of its fields', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, LOCKFILE_NAME), {
			version: 3,
			config: baseConfig({ language: 'js' }),
			writtenBy: 'old',
			writtenAt: '2024-01-01T00:00:00.000Z',
		})
		const lock = await readLockfile(dir)
		expect(lock?.rules).toBeUndefined()
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
		expect(lock?.record.config.projectName).toBe('demo')
		expect(lock?.record.config.testing.framework).toBe('vitest')
		expect(lock?.record.writtenBy).toMatch(/@rtorcato\/repo-tooling@/)
		expect(lock?.record.writtenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
	})

	it('migrates a pre-rename repo: writes the new name and removes the legacy file (#272)', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, LEGACY_LOCKFILE_NAME), {
			version: 3,
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
		expect(lock?.record.config.testing.framework).toBe('jest')
		// Other fields preserved
		expect(lock?.record.config.linting.tool).toBe('biome')
		expect(lock?.record.config.gitHooks).toBe(true)
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
		expect(lock?.record.assets).toEqual({ oxlint: 'abc123' })
		expect(lock?.record.config.gitHooks).toBe(false)
	})
})

describe('recordAssetHash', () => {
	it('returns false without creating a lockfile when the repo has none', async () => {
		const dir = newTmpDir()
		expect(await recordAssetHash(dir, 'oxlint', 'abc123')).toBe(false)
		expect(await fs.pathExists(join(dir, LOCKFILE_NAME))).toBe(false)
	})
})

// #524: writeLockfile rebuilds the object from scratch, so any key it does not
// name is silently dropped — the same trap the `assets` carry-forward exists for.
// Since #559 every hand-edited field lives under `rules`, carried verbatim.
describe('rules survive a rewrite', () => {
	it('carries rules forward when only config is rewritten', async () => {
		const dir = newTmpDir()
		await writeLockfile(dir, baseConfig())
		const file = join(dir, '.repo-tooling.json')
		const lock = await fs.readJson(file)
		const mcp = { recommended: [{ name: 's', importance: 'critical', why: 'because' }] }
		const rules = { aiLoop: { agentUser: 'some-bot' }, requiredSkills: ['ai-issue-loop'], mcp }
		await fs.writeJson(file, { ...lock, rules }, { spaces: 2 })

		await writeLockfile(dir, { ...baseConfig(), projectName: 'renamed' })

		const after = await fs.readJson(file)
		expect(after.rules).toEqual(rules)
		expect(after.record.config.projectName).toBe('renamed')
	})

	it('omits the key entirely when nothing set it', async () => {
		const dir = newTmpDir()
		await writeLockfile(dir, baseConfig())
		expect(await fs.readJson(join(dir, '.repo-tooling.json'))).not.toHaveProperty('rules')
	})

	// #559: rewriting a flat v3 file migrates it on disk — the hand-edited fields
	// land under `rules`, nothing is lost, and the file is v4 from then on.
	it('nests flat v3 hand-edited fields under rules on the next write', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, '.repo-tooling.json'), {
			version: 3,
			config: baseConfig({ language: 'js' }),
			aiLoop: { agentUser: 'some-bot' },
			exceptions: { TypeScript: 'reason' },
			writtenBy: 'old',
			writtenAt: '2024-01-01T00:00:00.000Z',
		})

		await writeLockfile(dir, baseConfig({ language: 'js' }))

		const after = await fs.readJson(join(dir, '.repo-tooling.json'))
		expect(after.version).toBe(LOCKFILE_VERSION)
		expect(after.rules).toEqual({
			aiLoop: { agentUser: 'some-bot' },
			exceptions: { TypeScript: 'reason' },
		})
		expect(after).not.toHaveProperty('aiLoop')
		expect(after).not.toHaveProperty('config')
	})
})
