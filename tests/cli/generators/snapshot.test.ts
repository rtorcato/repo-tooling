import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { generateGitHubActions } from '../../../src/cli/generators/github-actions.js'
import { generatePackageJson } from '../../../src/cli/generators/package-json.js'
import { generateVitestConfig } from '../../../src/cli/generators/testing.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

// A representative library config. Snapshots lock the exact file contents these
// generators produce, so any unintended change to generator output shows up as
// a failing snapshot in review rather than slipping through unnoticed.
function libConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		projectName: 'snapshot-lib',
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

describe('generator output snapshots', () => {
	it('package.json (library)', async () => {
		const dir = newTmpDir()
		await generatePackageJson(libConfig(), dir)
		const content = await fs.readFile(join(dir, 'package.json'), 'utf-8')
		expect(content).toMatchSnapshot()
	})

	it('.github/workflows/ci.yml (library)', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(libConfig(), dir)
		const content = await fs.readFile(join(dir, '.github/workflows/ci.yml'), 'utf-8')
		expect(content).toMatchSnapshot()
	})

	it('.github/workflows/release.yml (library)', async () => {
		const dir = newTmpDir()
		await generateGitHubActions(libConfig(), dir)
		const content = await fs.readFile(join(dir, '.github/workflows/release.yml'), 'utf-8')
		expect(content).toMatchSnapshot()
	})

	it('vitest.config.ts (node library)', async () => {
		const dir = newTmpDir()
		await generateVitestConfig(libConfig(), dir)
		const content = await fs.readFile(join(dir, 'vitest.config.ts'), 'utf-8')
		expect(content).toMatchSnapshot()
	})
})
