import { describe, expect, it } from 'vitest'
import { getFixers } from '../../../src/cli/commands/fix.js'
import { lockfilePatchForTarget } from '../../../src/cli/commands/fix-targets.js'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { validateProjectConfig } from '../../../src/cli/commands/setup-presets.js'
import type { Lockfile } from '../../../src/cli/utils/lockfile.js'

// A config that has chosen nothing, so every target returns its patch.
const bare: ProjectConfig = {
	projectName: 'x',
	projectType: 'library',
	typescript: { enabled: false, config: 'base' },
	linting: { tool: 'none' },
	formatting: { tool: 'none' },
	testing: { framework: 'none' },
	gitHooks: false,
	commitLint: false,
	semanticRelease: false,
	securityAutomation: false,
	bundler: 'none',
}

describe('lockfilePatchForTarget', () => {
	// #660: `docs-site` returned `{ docsSite: true }` before CONFIG_SCHEMA knew the
	// key, so writeLockfile refused the patched config after every file was written.
	it.each(getFixers().map((f) => f.target))('%s patches only schema-known keys', (target) => {
		const lock = { version: 4, record: { config: bare } } as unknown as Lockfile
		const patch = lockfilePatchForTarget(target, lock)
		expect(validateProjectConfig({ ...bare, ...patch }).errors).toEqual([])
	})
})
