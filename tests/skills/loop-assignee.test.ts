import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'

/**
 * `@me` resolves to whichever token `gh` is running as, which the Pass 0
 * identity check now *requires* to be the agent account whenever one is
 * declared — so every `--add-assignee @me` handed work back to the machine that
 * had just given up on it (#606). The human is named via `HUMAN_USER` instead.
 */
const skills = ['ai-issue-loop', 'ai-workflow'].map((n) =>
	join(import.meta.dirname, `../../skills/${n}/SKILL.md`)
)

describe('ai loop skills never assign @me (#606)', () => {
	it.each(skills)('%s uses no @me as an assignee', (path) => {
		const offenders = fs
			.readFileSync(path, 'utf8')
			.split('\n')
			.filter((line) => /assignee\s+"?@me/.test(line))
		expect(offenders).toEqual([])
	})

	it('ai-issue-loop resolves HUMAN_USER from the repo owner, humans only', () => {
		const skill = fs.readFileSync(skills[0], 'utf8')
		expect(skill).toContain(
			`HUMAN_USER=$(gh api "repos/$OWNER_REPO" --jq 'if .owner.type == "User" then .owner.login else "" end')`
		)
		// Every handoff site guards on it, so an org repo assigns nobody: either
		// the `${HUMAN_USER:+…}` expansion, or an explicit `-n` test.
		const unguarded = skill
			.split('\n')
			.filter((l) => l.includes('--add-assignee "$HUMAN_USER"') && !l.includes('${HUMAN_USER:+'))
		expect(unguarded).toEqual(['  gh issue edit <N> --add-assignee "$HUMAN_USER"'])
		expect(skill).toContain('if [ -n "$HUMAN_USER" ] && [ "$(gh issue view <N>')
	})

	/**
	 * The `${VAR:+…}` guard keeps an *empty* name out of the flag, but says
	 * nothing about the command as a whole: a `gh … edit <N>` whose only flags
	 * are conditional collapses to zero flags when every one of them is empty,
	 * and gh exits non-zero on that. A trailing "# skip when both are empty"
	 * comment is not enforcement — the reader is an agent following prose.
	 */
	it('no gh edit snippet can collapse to zero flags', () => {
		const lines = fs.readFileSync(skills[0], 'utf8').split('\n')
		const bare = lines.filter((line, i) => {
			// Match anywhere on the line, not just at its start: these commands also
			// appear inside markdown table cells (`| … |`) and blockquoted prompts
			// (`> …`), where a start-anchored pattern would silently skip them.
			const at = /gh (pr|issue) edit <[NM]>/.exec(line)
			if (!at) return false
			// A `#` before the match means prose about the command, not the command.
			if (line.slice(0, at.index).includes('#')) return false
			let cmd = line.slice(at.index)
			const inlineEnd = cmd.indexOf('`')
			if (inlineEnd !== -1) cmd = cmd.slice(0, inlineEnd)
			// Join the snippet's continuation lines into one logical command.
			for (let j = i; cmd.trimEnd().endsWith('\\') && j + 1 < lines.length; j++) {
				cmd = `${cmd.trimEnd().slice(0, -1)} ${lines[j + 1].replace(/^[\s>|]*/, '').trim()}`
			}
			const withoutConditionals = cmd.replace(/\$\{[A-Z_]+:\+[^}]*\}/g, '')
			const hasUnconditionalFlag = /\s--[a-z-]+/.test(withoutConditionals)
			if (hasUnconditionalFlag) return false
			// Otherwise it must sit inside an `if [ -n … ]` guard.
			return !lines.slice(Math.max(0, i - 4), i).some((l) => /if \[ -n "\$[A-Z_]+"/.test(l))
		})
		expect(bare).toEqual([])
	})
})
