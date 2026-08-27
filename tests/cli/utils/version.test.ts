import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { LOCKFILE_NAME, writeLockfile } from '../../../src/cli/utils/lockfile.js'
import { getToolVersion, isNewerVersion } from '../../../src/cli/utils/version.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const config: ProjectConfig = {
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
}

/** The newest tag reachable from HEAD, or null — a shallow or tagless clone. */
function latestTag(): string | null {
	try {
		const out = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		})
		return out.trim().replace(/^v/, '') || null
	} catch {
		return null
	}
}

const TAG = latestTag()

/**
 * The drift guard for #572. `--version` and the lockfile's `writtenBy` used to
 * read `package.json` directly while the skills stamp resolved the real number,
 * so the tool reported 3.11.0 in a tree that had shipped 3.31.1 — and stamped
 * that constant into every consuming repo's `.repo-tooling.json`.
 */
describe('getToolVersion is the only version this package reports', () => {
	it('is the version writeLockfile stamps into writtenBy', async () => {
		const dir = newTmpDir()
		await writeLockfile(dir, config)
		const lock = await fs.readJson(join(dir, LOCKFILE_NAME))
		expect(lock.record.writtenBy).toBe(`@rtorcato/repo-tooling@${await getToolVersion()}`)
	})

	// Skipped only where `git describe` has nothing to say. Everywhere else this
	// is the assertion that fails the moment the committed package.json falls
	// behind the tags again.
	it.skipIf(!TAG)('is never behind the newest git tag in a checkout', async () => {
		expect(isNewerVersion(String(TAG), await getToolVersion())).toBe(false)
	})
})
