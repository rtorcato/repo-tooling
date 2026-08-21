import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	buildSkillsInstallBody,
	installSkillsInstallDocs,
} from '../../../src/cli/generators/skills-install.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

async function scaffoldSkill(dir: string, name: string): Promise<void> {
	await fs.ensureDir(join(dir, 'skills', name))
	await fs.writeFile(join(dir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
}

/**
 * Run one emitted command line through a real shell with `npx` swapped for a
 * printf that echoes its argv, and return what `npx` would have received. A
 * name the shell splits, expands or executes fails to come back intact.
 */
function shellArgv(command: string): string[] {
	const out = execFileSync('sh', ['-c', command.replace(/^npx /, "printf '%s\\n' ")], {
		encoding: 'utf8',
	})
	return out.split('\n').slice(0, -1)
}

/** The command lines inside the ```bash fence. */
function commandLines(body: string): string[] {
	return body.split('\n').filter((line) => line.startsWith('npx skills add '))
}

describe('buildSkillsInstallBody', () => {
	it('emits one npx skills add command per skill, singular vs plural heading', () => {
		expect(buildSkillsInstallBody('rtorcato', 'browser-common', ['browser-common'])).toContain(
			"npx skills add https://github.com/rtorcato/browser-common --skill 'browser-common'"
		)
		const multi = buildSkillsInstallBody('rtorcato', 'js-tooling', ['js-tooling', 'npm-publish'])
		expect(multi).toContain('## Install the skills')
		expect(multi).toContain("--skill 'js-tooling'")
		expect(multi).toContain("--skill 'npm-publish'")
	})

	it('returns empty for no skills', () => {
		expect(buildSkillsInstallBody('rtorcato', 'x', [])).toBe('')
	})

	// #498: the skill name is an unconstrained directory basename, and this line
	// is committed to a README that other people paste from.
	it.each([
		['a command separator', 'x; echo pwned'],
		['a space', 'my skill'],
		['a command substitution', '$(echo pwned)'],
		['backticks and a variable', '`echo pwned`$HOME'],
		['a double quote', 'we"rd'],
		['a single quote', "it's"],
	])('hands %s to npx as one literal argument', (_what, skill) => {
		const [command, ...rest] = commandLines(buildSkillsInstallBody('rtorcato', 'x', [skill]))
		expect(rest).toEqual([])
		expect(shellArgv(command as string)).toEqual([
			'skills',
			'add',
			'https://github.com/rtorcato/x',
			'--skill',
			skill,
		])
	})

	// A name may carry backticks and a newline, putting arbitrary text at the
	// start of a line inside the block. A 3-backtick fence would end there.
	it('opens a fence the skill name cannot close', () => {
		const lines = buildSkillsInstallBody('rtorcato', 'x', ['a\n```bash\nrm -rf /']).split('\n')
		const open = lines.indexOf('````bash')
		expect(open).toBeGreaterThan(-1)
		expect(lines.at(-1)).toBe('````')
		expect(lines.slice(open + 1, -1)).toContain('```bash')
	})
})

describe('installSkillsInstallDocs', () => {
	it('no-ops when the repo ships no skills', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'x',
			repository: 'github:rtorcato/x',
		})
		expect(await installSkillsInstallDocs(dir)).toBeNull()
		expect(await fs.pathExists(join(dir, 'README.md'))).toBe(false)
	})

	it('no-ops when package.json has no GitHub repository', async () => {
		const dir = newTmpDir()
		await scaffoldSkill(dir, 'browser-common')
		await fs.writeJson(join(dir, 'package.json'), { name: 'browser-common' })
		expect(await installSkillsInstallDocs(dir)).toBeNull()
	})

	it('upserts a merge-safe block into README, idempotently', async () => {
		const dir = newTmpDir()
		await scaffoldSkill(dir, 'browser-common')
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'browser-common',
			repository: 'git+https://github.com/rtorcato/browser-common.git',
		})
		await fs.writeFile(join(dir, 'README.md'), '# browser-common\n\nMy notes.\n')

		expect(await installSkillsInstallDocs(dir)).toBe('README.md')
		await installSkillsInstallDocs(dir) // run twice

		const readme = await fs.readFile(join(dir, 'README.md'), 'utf8')
		expect(readme).toContain('# browser-common')
		expect(readme).toContain('My notes.')
		expect(readme).toContain(
			"npx skills add https://github.com/rtorcato/browser-common --skill 'browser-common'"
		)
		expect(readme.match(/<!-- js-tooling:skills:start -->/g)).toHaveLength(1)
	})
})
