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
})
