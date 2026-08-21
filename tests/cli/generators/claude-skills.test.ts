import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	claudeSkillStatus,
	HASH_KEY,
	installClaudeSkill,
	isNewerVersion,
	readShippedSkill,
	readSkillVersion,
	resolveSkillsDir,
	SHIPPED_SKILL,
	skillDiffCommand,
	stampSkill,
	stampSkillVersion,
	stripSkillStamps,
	VERSION_KEY,
} from '../../../src/cli/generators/claude-skills.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function skillFile(skillsDir: string): string {
	return join(skillsDir, SHIPPED_SKILL, 'SKILL.md')
}

/**
 * What an older release left behind: its own content, stamped with its own
 * version and its own pristine hash. The `stale but unmodified` case.
 */
async function installedByOlderRelease(skillsDir: string, body: string): Promise<void> {
	await fs.outputFile(
		skillFile(skillsDir),
		stampSkill(`---\nname: ai-issue-loop\n---\n\n${body}\n`, '0.0.1')
	)
}

describe('resolveSkillsDir', () => {
	it('prefers an explicit dir over the user one', async () => {
		const home = newTmpDir()
		await fs.ensureDir(join(home, '.claude', 'skills'))
		expect(await resolveSkillsDir('/tmp/elsewhere', home)).toEqual({
			dir: '/tmp/elsewhere',
			source: 'explicit',
		})
	})

	it('falls back to ~/.claude/skills when it exists', async () => {
		const home = newTmpDir()
		await fs.ensureDir(join(home, '.claude', 'skills'))
		expect(await resolveSkillsDir(undefined, home)).toEqual({
			dir: join(home, '.claude', 'skills'),
			source: 'user',
		})
	})

	it('resolves to nothing rather than creating ~/.claude uninvited', async () => {
		expect(await resolveSkillsDir(undefined, newTmpDir())).toEqual({ dir: null, source: 'none' })
	})
})

describe('version stamping', () => {
	it('appends the stamp after a multi-line description block', () => {
		const stamped = stampSkillVersion(
			'---\nname: x\ndescription: |\n  one\n  two\n---\n\nBody\n',
			'1.2.3'
		)
		expect(stamped).toBe(
			`---\nname: x\ndescription: |\n  one\n  two\n${VERSION_KEY}: 1.2.3\n---\n\nBody\n`
		)
		expect(readSkillVersion(stamped)).toBe('1.2.3')
	})

	it('replaces an existing stamp instead of stacking a second one', () => {
		const once = stampSkillVersion('---\nname: x\n---\n\nBody\n', '1.0.0')
		const twice = stampSkillVersion(once, '2.0.0')
		expect(readSkillVersion(twice)).toBe('2.0.0')
		expect(twice.match(new RegExp(`^${VERSION_KEY}:`, 'gm'))).toHaveLength(1)
	})

	it('reads null from a copy that predates the stamp', () => {
		expect(readSkillVersion('---\nname: x\n---\n\nBody\n')).toBeNull()
	})

	it('compares versions numerically', () => {
		expect(isNewerVersion('3.10.0', '3.9.9')).toBe(true)
		expect(isNewerVersion('3.9.2', '3.9.2')).toBe(false)
		expect(isNewerVersion('3.9.1', '3.9.2')).toBe(false)
		expect(isNewerVersion('4.0.0', '3.99.99')).toBe(true)
	})
})

describe('installClaudeSkill', () => {
	it('installs, stamps the shipped version, and is idempotent', async () => {
		const skillsDir = newTmpDir()
		const first = await installClaudeSkill(skillsDir)
		expect(first.status).toBe('installed')
		// A plain install is not "via symlink" even though macOS resolves /var → /private/var.
		expect(first.viaSymlink).toBe(false)
		expect(first.realFile).toBe(skillFile(skillsDir))

		const content = await fs.readFile(skillFile(skillsDir), 'utf8')
		expect(readSkillVersion(content)).toBe(first.shippedVersion)
		expect(content).toContain('# ai-issue-loop')

		expect((await installClaudeSkill(skillsDir)).status).toBe('up-to-date')
	})

	it('refuses to downgrade a copy installed by a newer release', async () => {
		const skillsDir = newTmpDir()
		await fs.outputFile(
			skillFile(skillsDir),
			stampSkillVersion('---\nname: ai-issue-loop\n---\n\nfrom the future\n', '999.0.0')
		)
		const result = await installClaudeSkill(skillsDir)
		expect(result.status).toBe('declined-downgrade')
		expect(await fs.readFile(skillFile(skillsDir), 'utf8')).toContain('from the future')
	})

	it('updates a stale copy that is still verbatim what an older release shipped', async () => {
		const skillsDir = newTmpDir()
		await installedByOlderRelease(skillsDir, 'the 0.0.1 body')

		const result = await installClaudeSkill(skillsDir)

		expect(result.status).toBe('updated')
		expect(result.contentState).toBe('pristine')
		expect(result.installedVersion).toBe('0.0.1')
		expect(await fs.readFile(skillFile(skillsDir), 'utf8')).toContain('# ai-issue-loop')
	})

	// #480: the version stamp alone cannot see this. The fork was *older* than
	// what we ship, so the downgrade guard waves it through and 121 lines of
	// somebody's work vanish with no warning.
	it('refuses to overwrite a copy whose content has diverged since it was installed', async () => {
		const skillsDir = newTmpDir()
		await installedByOlderRelease(skillsDir, 'the 0.0.1 body')
		const forked = `${await fs.readFile(skillFile(skillsDir), 'utf8')}\n## a section only the fork has\n`
		await fs.outputFile(skillFile(skillsDir), forked)

		const result = await installClaudeSkill(skillsDir)

		expect(result.status).toBe('declined-fork')
		expect(result.contentState).toBe('modified')
		expect(await fs.readFile(skillFile(skillsDir), 'utf8')).toBe(forked)
		// Actionable: the refusal can name the shipped file to diff against.
		expect(result.shippedFile).toBe((await readShippedSkill()).file)
	})

	it('refuses an unstamped copy rather than guessing it is merely stale', async () => {
		const skillsDir = newTmpDir()
		await fs.outputFile(skillFile(skillsDir), '---\nname: ai-issue-loop\n---\n\nold\n')

		const result = await installClaudeSkill(skillsDir)

		expect(result.status).toBe('declined-fork')
		expect(result.contentState).toBe('unknown')
		expect(result.installedVersion).toBeNull()
		expect(await fs.readFile(skillFile(skillsDir), 'utf8')).toContain('old')
	})

	it('overwrites a fork when explicitly forced', async () => {
		const skillsDir = newTmpDir()
		await fs.outputFile(skillFile(skillsDir), '---\nname: ai-issue-loop\n---\n\nold\n')

		const result = await installClaudeSkill(skillsDir, SHIPPED_SKILL, { force: true })

		expect(result.status).toBe('updated')
		expect(await fs.readFile(skillFile(skillsDir), 'utf8')).toContain('# ai-issue-loop')
	})

	// An unstamped copy of exactly what we ship is not a fork — it just predates
	// the hash. Refusing it would make `--force-skills` a routine step.
	it('stamps an unstamped copy that already matches the shipped content', async () => {
		const skillsDir = newTmpDir()
		const { content } = await readShippedSkill()
		await fs.outputFile(skillFile(skillsDir), content)

		const result = await installClaudeSkill(skillsDir)

		expect(result.status).toBe('updated')
		expect(result.contentState).toBe('pristine')
	})

	it('records a hash that survives a round trip through the stamps', async () => {
		const skillsDir = newTmpDir()
		await installClaudeSkill(skillsDir)
		const written = await fs.readFile(skillFile(skillsDir), 'utf8')

		expect(written).toContain(`${HASH_KEY}: `)
		expect(stripSkillStamps(written)).toBe((await readShippedSkill()).content)
	})

	// The failure mode the feature exists to prevent: stow symlinks at file level,
	// so an atomic-rename write would replace the link with a real file and orphan
	// the dotfiles copy, silently. The write must land *through* the link.
	it('writes through a symlink instead of replacing it', async () => {
		const skillsDir = newTmpDir()
		const dotfiles = join(newTmpDir(), 'SKILL.md')
		await fs.outputFile(dotfiles, stampSkill('---\nname: ai-issue-loop\n---\n\nold\n', '0.0.1'))
		await fs.ensureDir(join(skillsDir, SHIPPED_SKILL))
		await fs.symlink(dotfiles, skillFile(skillsDir))

		const result = await installClaudeSkill(skillsDir)

		expect(result.status).toBe('updated')
		expect(result.viaSymlink).toBe(true)
		expect((await fs.lstat(skillFile(skillsDir))).isSymbolicLink()).toBe(true)
		expect(await fs.realpath(result.realFile)).toBe(await fs.realpath(dotfiles))
		expect(await fs.readFile(dotfiles, 'utf8')).toContain('# ai-issue-loop')
	})
})

// #493: the hint is built to be pasted into a shell, and both paths are
// user-influenced — `--skills-dir` is an argument (#490) and `realFile` is
// wherever a symlink points. Unquoted, a path carrying `"` or `$(...)` yields a
// line that does something other than a diff.
describe('skillDiffCommand', () => {
	const SHIPPED = '/pkg/skills/ai-issue-loop/SKILL.md'

	/**
	 * Run the emitted command through a real shell with `diff` swapped for a
	 * printf that echoes its argv, and return what `diff` would have received.
	 * A path the shell splits, expands or executes fails to come back intact.
	 */
	function shellArgv(command: string): string[] {
		const out = execFileSync('sh', ['-c', command.replace(/^diff /, "printf '%s\\n' ")], {
			encoding: 'utf8',
		})
		return out.split('\n').slice(0, -1)
	}

	it('is a pasteable diff for ordinary paths', () => {
		const realFile = '/home/me/.claude/skills/ai-issue-loop/SKILL.md'
		expect(skillDiffCommand({ realFile, shippedFile: SHIPPED })).toBe(
			`diff '${realFile}' '${SHIPPED}'`
		)
		expect(shellArgv(skillDiffCommand({ realFile, shippedFile: SHIPPED }))).toEqual([
			realFile,
			SHIPPED,
		])
	})

	it.each([
		['a space', '/tmp/my skills/ai-issue-loop/SKILL.md'],
		['a double quote', '/tmp/we"rd/SKILL.md'],
		['a single quote', "/tmp/it's/SKILL.md"],
		['a command substitution', '/tmp/$(echo pwned)/SKILL.md'],
		['backticks and a variable', '/tmp/`echo pwned`$HOME/SKILL.md'],
		['a command separator', '/tmp/x; echo pwned/SKILL.md'],
	])('hands %s to diff untouched', (_what, realFile) => {
		expect(shellArgv(skillDiffCommand({ realFile, shippedFile: SHIPPED }))).toEqual([
			realFile,
			SHIPPED,
		])
	})

	it('escapes the shipped path too', () => {
		const shippedFile = "/pkg/o'dd/SKILL.md"
		expect(shellArgv(skillDiffCommand({ realFile: '/tmp/a/SKILL.md', shippedFile }))).toEqual([
			'/tmp/a/SKILL.md',
			shippedFile,
		])
	})
})

describe('claudeSkillStatus', () => {
	it('reports not installed for an empty skills dir', async () => {
		const status = await claudeSkillStatus(SHIPPED_SKILL, newTmpDir())
		expect(status.installed).toBe(false)
		expect(status.needsInstall).toBe(true)
	})

	it('reports ok once the shipped version is installed', async () => {
		const skillsDir = newTmpDir()
		await installClaudeSkill(skillsDir)
		const status = await claudeSkillStatus(SHIPPED_SKILL, skillsDir)
		expect(status.installed).toBe(true)
		expect(status.needsInstall).toBe(false)
		expect(status.contentState).toBe('pristine')
		expect(status.installedVersion).toBe(status.shippedVersion)
	})

	it('flags an out-of-date but unmodified copy as needing an install', async () => {
		const skillsDir = newTmpDir()
		await installedByOlderRelease(skillsDir, 'the 0.0.1 body')
		const status = await claudeSkillStatus(SHIPPED_SKILL, skillsDir)
		expect(status.contentState).toBe('pristine')
		expect(status.needsInstall).toBe(true)
	})

	// Never "needs install": the fix would refuse, so nagging about it is noise.
	it('does not ask for an install it knows will be declined', async () => {
		const skillsDir = newTmpDir()
		await installedByOlderRelease(skillsDir, 'the 0.0.1 body')
		await fs.appendFile(skillFile(skillsDir), '\nlocal edit\n')
		const status = await claudeSkillStatus(SHIPPED_SKILL, skillsDir)
		expect(status.contentState).toBe('modified')
		expect(status.needsInstall).toBe(false)
	})
})
