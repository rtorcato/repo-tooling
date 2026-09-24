import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { getFixers } from '../../src/cli/commands/fix.js'
import { selfRepoRefusal } from '../../src/cli/self-repo.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()
const ALLOW = { REPO_TOOLING_ALLOW_SELF: '1' }

async function selfRepo(): Promise<string> {
	const dir = newTmpDir()
	await fs.writeJson(join(dir, 'package.json'), { name: '@rtorcato/repo-tooling' })
	return dir
}

describe('selfRepoRefusal (#673)', () => {
	it('marks exactly the self-contained fixers selfSafe', () => {
		const safe = getFixers()
			.filter((f) => f.selfSafe)
			.map((f) => f.target)
			.sort()
		expect(safe).toEqual([
			'brand',
			'codeowners',
			'codeql',
			'community-health',
			'editorconfig',
			'lockfile',
			'nvmrc',
			'vscode-extensions',
		])
	})

	it('allows a selfSafe target in the self repo with the env set', async () => {
		const directory = await selfRepo()
		expect(await selfRepoRefusal('fix', 'editorconfig', { directory }, ALLOW)).toBeNull()
		expect(await selfRepoRefusal('fix', 'lockfile', { directory }, ALLOW)).toBeNull()
	})

	it('refuses a non-selfSafe target and names it', async () => {
		const directory = await selfRepo()
		const refusal = await selfRepoRefusal('fix', 'biome', { directory }, ALLOW)
		expect(refusal).toContain('fix biome')
		expect(refusal).toContain('not self-safe')
		expect(await selfRepoRefusal('fix', 'docs-site', { directory }, ALLOW)).toContain(
			'fix docs-site'
		)
	})

	it('keeps refusing a bare fix and setup even with the env set', async () => {
		const directory = await selfRepo()
		expect(await selfRepoRefusal('fix', undefined, { directory }, ALLOW)).toContain('bare `fix`')
		expect(await selfRepoRefusal('setup', undefined, { directory }, ALLOW)).not.toBeNull()
		expect(await selfRepoRefusal('doctor', undefined, { directory }, ALLOW)).toBeNull()
	})

	it('refuses everything but fix --list without the env', async () => {
		const directory = await selfRepo()
		for (const [command, target] of [
			['fix', 'editorconfig'],
			['fix', 'lockfile'],
			['fix', 'biome'],
			['fix', undefined],
			['doctor', undefined],
			['setup', undefined],
		] as const) {
			expect(await selfRepoRefusal(command, target, { directory }, {})).not.toBeNull()
		}
		expect(await selfRepoRefusal('fix', undefined, { directory, list: true }, {})).toBeNull()
	})

	it('never refuses outside the self repo', async () => {
		const directory = newTmpDir()
		await fs.writeJson(join(directory, 'package.json'), { name: 'consumer' })
		expect(await selfRepoRefusal('fix', 'biome', { directory }, {})).toBeNull()
		expect(await selfRepoRefusal('setup', undefined, { directory }, {})).toBeNull()
	})
})
