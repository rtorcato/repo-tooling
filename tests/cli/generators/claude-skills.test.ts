import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	claudeSkillStatus,
	installClaudeSkill,
	isNewerVersion,
	readSkillVersion,
	resolveSkillsDir,
	SHIPPED_SKILL,
	stampSkillVersion,
	VERSION_KEY,
} from '../../../src/cli/generators/claude-skills.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function skillFile(skillsDir: string): string {
	return join(skillsDir, SHIPPED_SKILL, 'SKILL.md')
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

	it('adopts an unstamped copy', async () => {
		const skillsDir = newTmpDir()
		await fs.outputFile(skillFile(skillsDir), '---\nname: ai-issue-loop\n---\n\nold\n')
		const result = await installClaudeSkill(skillsDir)
		expect(result.status).toBe('updated')
		expect(result.installedVersion).toBeNull()
	})

	// The failure mode the feature exists to prevent: stow symlinks at file level,
	// so an atomic-rename write would replace the link with a real file and orphan
	// the dotfiles copy, silently. The write must land *through* the link.
	it('writes through a symlink instead of replacing it', async () => {
		const skillsDir = newTmpDir()
		const dotfiles = join(newTmpDir(), 'SKILL.md')
		await fs.outputFile(dotfiles, '---\nname: ai-issue-loop\n---\n\nold\n')
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
		expect(status.installedVersion).toBe(status.shippedVersion)
	})
})
