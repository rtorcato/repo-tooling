import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { checkRecommendedMcp, checkRequiredSkills } from '../../src/base/checks.js'
import { readShippedSkill, stampSkill } from '../../src/cli/generators/claude-skills.js'
import type { McpRecommendation } from '../../src/cli/utils/lockfile.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

/** Write `content` where `claudeSkillStatus(name, dir)` will look for it. */
async function install(dir: string, name: string, content: string): Promise<void> {
	await fs.outputFile(join(dir, name, 'SKILL.md'), content)
}

describe('checkRequiredSkills (#533)', () => {
	it('reports a skill that is not installed, without ever failing the exit code', async () => {
		const r = await checkRequiredSkills(['ai-issue-loop', 'ai-workflow'], newTmpDir())
		// The whole point of the severity rule: a contributor with no Claude
		// installed must not fail this repo's doctor.
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toContain('not installed: ai-issue-loop, ai-workflow')
		expect(r.hint).toContain('fix claude-skills')
	})

	it('is ok when the installed copy is what this package ships', async () => {
		const dir = newTmpDir()
		const shipped = await readShippedSkill('ai-issue-loop')
		await install(dir, 'ai-issue-loop', stampSkill(shipped.content, shipped.version))

		const r = await checkRequiredSkills(['ai-issue-loop'], dir)
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('ai-issue-loop')
	})

	// The failure this check exists for: an older copy runs to completion without
	// complaint, so nothing but a version comparison ever notices.
	it('reports a stale copy — pristine content, older stamp', async () => {
		const dir = newTmpDir()
		const shipped = await readShippedSkill('ai-issue-loop')
		await install(dir, 'ai-issue-loop', stampSkill(shipped.content, '0.0.1'))

		const r = await checkRequiredSkills(['ai-issue-loop'], dir)
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toContain('ai-issue-loop is stale')
		expect(r.detail).toContain('0.0.1')
		expect(r.detail).toContain(shipped.version)
	})

	// Mirrors the assets model (#428): content matching no shipped version is
	// somebody's fork, and `fix claude-skills` refuses it without --force-skills.
	it('reports a copy whose hash matches no shipped version as modified', async () => {
		const dir = newTmpDir()
		const shipped = await readShippedSkill('ai-issue-loop')
		await install(
			dir,
			'ai-issue-loop',
			`${stampSkill(shipped.content, shipped.version)}\nlocal edit\n`
		)

		const r = await checkRequiredSkills(['ai-issue-loop'], dir)
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toContain('matches no version this package has shipped')
		expect(r.hint).toContain('--force-skills')
	})

	it('names a skill this package does not ship instead of throwing on the missing asset', async () => {
		const r = await checkRequiredSkills(['ai-issue-loop', 'not-a-skill'], newTmpDir())
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toContain('not-a-skill')
		expect(r.hint).toContain('ai-issue-loop')
	})
})

describe('checkRecommendedMcp (#534)', () => {
	const pencil: McpRecommendation = {
		name: 'some-server',
		importance: 'important',
		why: 'edits the design files under design/',
	}

	it('quotes importance and why for a server .mcp.json does not declare', async () => {
		const r = await checkRecommendedMcp(newTmpDir(), [pencil])
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toContain('some-server (important) — edits the design files under design/')
		// Advisory: the hint must not point at a fixer, because there isn't one.
		expect(r.hint).toContain('by hand')
		expect(r.hint).not.toContain('fix ')
	})

	it('is ok once .mcp.json declares every recommended server', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, '.mcp.json'), {
			mcpServers: { 'some-server': { command: 'whatever' } },
		})

		const r = await checkRecommendedMcp(dir, [pencil])
		expect(r.status).toBe('ok')
	})

	it('reports only the servers that are absent', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, '.mcp.json'), { mcpServers: { 'some-server': {} } })

		const r = await checkRecommendedMcp(dir, [
			pencil,
			{ name: 'other-server', importance: 'critical', why: 'runs the thing' },
		])
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toContain('other-server (critical)')
		expect(r.detail).not.toContain('some-server')
	})

	it('treats a malformed .mcp.json as declaring nothing rather than erroring', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.mcp.json'), '{ not json')

		const r = await checkRecommendedMcp(dir, [pencil])
		expect(r.status).toBe('optional-missing')
	})
})
