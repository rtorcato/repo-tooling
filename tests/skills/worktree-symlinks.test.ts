import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { useTmpDir } from '../helpers/tmp-dir.js'

/**
 * The ai-issue-loop's Pass 4 symlink snippet is executable prose: the
 * orchestrator runs it verbatim in *its* shell, which on macOS is zsh. zsh does
 * not word-split an unquoted `$DIRS`, so `for d in $DIRS` linked nothing and
 * failed silently (#585). Run the block the skill actually ships, under zsh.
 */
const skill = join(import.meta.dirname, '../../skills/ai-issue-loop/SKILL.md')
const newTmpDir = useTmpDir()

/** The one fenced bash block that reads `worktree.symlinkDirectories`. */
function linkingSnippet(): string {
	const blocks = fs.readFileSync(skill, 'utf8').match(/```bash\n([\s\S]*?)```/g) ?? []
	const match = blocks.filter((b) => b.includes('symlinkDirectories[]?'))
	expect(match).toHaveLength(1)
	return match[0].slice('```bash\n'.length, -'```'.length)
}

const have = (bin: string) => spawnSync('command', ['-v', bin], { shell: true }).status === 0

describe.skipIf(!have('zsh') || !have('jq'))('ai-issue-loop Pass 4 symlinks (#585)', () => {
	it('links every entry under zsh, and asserts when one is missing', () => {
		const root = newTmpDir()
		const wtRoot = join(root, 'wt')
		fs.outputJsonSync(join(root, '.claude/settings.json'), {
			worktree: { symlinkDirectories: ['node_modules', 'apps/docs/node_modules', 'gone'] },
		})
		fs.ensureDirSync(join(root, 'node_modules'))
		fs.ensureDirSync(join(root, 'apps/docs/node_modules'))
		fs.ensureDirSync(join(wtRoot, 'slug'))

		const { stdout, stderr, status } = spawnSync(
			'zsh',
			[
				'-c',
				`ROOT=${JSON.stringify(root)}; WT_ROOT=${JSON.stringify(wtRoot)}; SLUG=slug\n${linkingSnippet()}`,
			],
			{ encoding: 'utf8' }
		)

		expect({ status, stderr }).toEqual({ status: 0, stderr: '' })
		expect(fs.lstatSync(join(wtRoot, 'slug/node_modules')).isSymbolicLink()).toBe(true)
		expect(fs.lstatSync(join(wtRoot, 'slug/apps/docs/node_modules')).isSymbolicLink()).toBe(true)
		// `gone` has no directory in the main checkout, so it links nothing and the
		// assertion must stay quiet about it.
		expect(fs.existsSync(join(wtRoot, 'slug/gone'))).toBe(false)
		expect(stdout).not.toContain('FATAL')
	})
})
