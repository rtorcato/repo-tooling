import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { copyPreset } from '../../src/cli/utils/copy-preset.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const execFileAsync = promisify(execFile)
const newTmpDir = useTmpDir()

/** A repo laid out the way the asset expects: scoped name + matching skills dir. */
async function seedSkillRepo(name: string, skillDir: string): Promise<string> {
	const dir = newTmpDir()
	await fs.writeJson(join(dir, 'package.json'), { name, version: '0.0.0' })
	await fs.outputFile(
		join(dir, `skills/${skillDir}/SKILL.md`),
		'---\nname: demo\ndescription: a demo skill\n---\n\n# Demo\n\nBody text.\n'
	)
	await copyPreset('claude-sync-agents', dir)
	return dir
}

const runSync = (dir: string, ...args: string[]) =>
	execFileAsync(process.execPath, [join(dir, 'scripts/sync-agents.mjs'), ...args])

describe('copy claude-sync-agents', () => {
	it('lands at scripts/sync-agents.mjs', async () => {
		const dir = await seedSkillRepo('@rtorcato/js-common', 'js-common')
		expect(await fs.pathExists(join(dir, 'scripts/sync-agents.mjs'))).toBe(true)
	})

	it('derives the skill path from a scoped package name and strips frontmatter', async () => {
		const dir = await seedSkillRepo('@rtorcato/js-common', 'js-common')
		await runSync(dir)
		const agents = await fs.readFile(join(dir, 'AGENTS.md'), 'utf-8')
		expect(agents).toBe(
			'<!-- Generated from skills/js-common/SKILL.md by scripts/sync-agents.mjs — do not edit by hand; run `pnpm sync:agents`. -->\n\n# Demo\n\nBody text.\n'
		)
	})

	it('derives the skill path from an unscoped package name too', async () => {
		// api-common publishes unscoped; the same copied file must work there.
		const dir = await seedSkillRepo('api-common', 'api-common')
		await runSync(dir)
		expect(await fs.readFile(join(dir, 'AGENTS.md'), 'utf-8')).toContain(
			'Generated from skills/api-common/SKILL.md'
		)
	})

	it('--check passes when in sync and exits 1 when stale', async () => {
		const dir = await seedSkillRepo('@rtorcato/js-common', 'js-common')
		await runSync(dir)
		await expect(runSync(dir, '--check')).resolves.toBeTruthy()

		await fs.appendFile(join(dir, 'AGENTS.md'), 'hand-edited\n')
		await expect(runSync(dir, '--check')).rejects.toMatchObject({ code: 1 })
	})
})
