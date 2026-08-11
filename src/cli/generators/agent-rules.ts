import path from 'node:path'
import fs from 'fs-extra'
import { copyPreset, getPackageRoot } from '../utils/copy-preset.js'
import { LEGACY_TOOL_NAME } from '../utils/lockfile.js'
import { installSkillsInstallDocs } from './skills-install.js'

/**
 * All agent rule files are generated from one source of truth — the shipped
 * Claude skill — so the guidance never drifts between agents. Only the
 * location and the frontmatter differ per agent.
 */
const SOURCE = 'tooling/claude/repo-tooling.md'
// The markers keep the pre-rename text on purpose: changing them would orphan
// every block already written and append a second one on the next fix.
export const BLOCK_START = '<!-- js-tooling:start -->'
export const BLOCK_END = '<!-- js-tooling:end -->'

/**
 * True when a managed block still names the pre-rename package or bin — a repo
 * scaffolded before the rename tells agents to run `js-tooling fix ai`, which
 * is not a runnable command (#393). Only the block *body* is inspected: the
 * markers carry the legacy name by design, so matching on the whole file would
 * report every repo as permanently stale.
 */
export function hasStaleAgentBlock(content: string): boolean {
	const start = content.indexOf(BLOCK_START)
	if (start === -1) return false
	const bodyStart = start + BLOCK_START.length
	const end = content.indexOf(BLOCK_END, bodyStart)
	return content.slice(bodyStart, end === -1 ? undefined : end).includes(LEGACY_TOOL_NAME)
}

export type AgentTarget = 'cursor' | 'copilot' | 'agents-md'

export const CLAUDE_SETTINGS_FILE = path.join('.claude', 'settings.json')
/**
 * Directories Claude Code symlinks from the main checkout into a fresh
 * worktree instead of leaving the agent to reinstall them (#396). An agent
 * working a per-issue worktree can typecheck immediately rather than paying a
 * full `pnpm install` first, on every issue.
 */
export const WORKTREE_SYMLINK_DIRS = ['node_modules'] as const

function asObject(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

/** Parsed `.claude/settings.json`, or null when absent, malformed, or not an object. */
export async function readClaudeSettings(
	targetDir: string
): Promise<Record<string, unknown> | null> {
	try {
		return asObject(await fs.readJson(path.join(targetDir, CLAUDE_SETTINGS_FILE)))
	} catch {
		return null
	}
}

/** The `worktree.symlinkDirectories` entries already recorded, ignoring junk. */
export function worktreeSymlinkDirs(settings: Record<string, unknown> | null): string[] {
	const dirs = asObject(settings?.worktree)?.symlinkDirectories
	return Array.isArray(dirs) ? dirs.filter((d): d is string => typeof d === 'string') : []
}

/**
 * Upsert `worktree.symlinkDirectories` into `.claude/settings.json`. Repos
 * already keep `hooks` and `permissions` in that file, so only the one key is
 * merged and everything else survives — the same contract the AGENTS.md and
 * copilot-instructions blocks give.
 *
 * Returns the written path, or null when there is nothing to write: a repo with
 * no package.json has no node_modules to symlink (Swift, Python, Perl), and a
 * file that doesn't parse is left for a human rather than clobbered.
 */
export async function installClaudeSettings(targetDir: string): Promise<string | null> {
	if (!(await fs.pathExists(path.join(targetDir, 'package.json')))) return null
	const file = path.join(targetDir, CLAUDE_SETTINGS_FILE)
	const exists = await fs.pathExists(file)
	const settings = exists ? await readClaudeSettings(targetDir) : {}
	if (!settings) return null
	const existing = worktreeSymlinkDirs(settings)
	const symlinkDirectories = [
		...existing,
		...WORKTREE_SYMLINK_DIRS.filter((d) => !existing.includes(d)),
	]
	const worktree = { ...asObject(settings.worktree), symlinkDirectories }
	await fs.outputJson(file, { ...settings, worktree }, { spaces: 2 })
	return CLAUDE_SETTINGS_FILE
}

interface Skill {
	description: string
	body: string
}

/** Read the shipped skill and split its frontmatter from the markdown body. */
async function readSkill(): Promise<Skill> {
	const raw = await fs.readFile(path.join(getPackageRoot(), SOURCE), 'utf8')
	const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
	if (!match) return { description: '', body: raw.trim() }
	const description = ((match[1] ?? '').match(/^description:\s*(.+)$/m)?.[1] ?? '').trim()
	return { description, body: (match[2] ?? '').trim() }
}

/**
 * Upsert a delimited js-tooling block into a file that may already hold the
 * consumer's own content (AGENTS.md, copilot-instructions). Replaces an
 * existing block, appends if the file exists without one, creates otherwise.
 * Never clobbers surrounding content.
 */
export async function upsertBlock(
	filePath: string,
	body: string,
	markers: { start: string; end: string } = { start: BLOCK_START, end: BLOCK_END }
): Promise<void> {
	const { start: startMarker, end: endMarker } = markers
	const block = `${startMarker}\n${body}\n${endMarker}`
	if (await fs.pathExists(filePath)) {
		const existing = await fs.readFile(filePath, 'utf8')
		const start = existing.indexOf(startMarker)
		const end = existing.indexOf(endMarker)
		if (start !== -1 && end !== -1) {
			const next = existing.slice(0, start) + block + existing.slice(end + endMarker.length)
			await fs.writeFile(filePath, next)
			return
		}
		await fs.writeFile(filePath, `${existing.trimEnd()}\n\n${block}\n`)
		return
	}
	await fs.ensureDir(path.dirname(filePath))
	await fs.writeFile(filePath, `${block}\n`)
}

/**
 * Write CLAUDE.md as a thin pointer to AGENTS.md rather than duplicating the
 * guidance — Claude Code reads both, and `@AGENTS.md` keeps a single source of
 * truth. Merge-safe: only the delimited block is touched.
 */
export async function installClaudeMd(targetDir: string): Promise<string> {
	const rel = 'CLAUDE.md'
	const body =
		'See @AGENTS.md for project and agent guidance (kept in sync by `repo-tooling fix ai`).'
	await upsertBlock(path.join(targetDir, rel), body)
	return rel
}

/**
 * Umbrella: install every AI agent file in one pass — AGENTS.md, the CLAUDE.md
 * pointer, Cursor + Copilot rules, the Claude skill, and the commented MCP
 * template. All are merge-safe or `.example`, so re-running is idempotent.
 * Returns the written paths (relative to targetDir).
 */
export async function installAiSetup(targetDir: string): Promise<string[]> {
	const written: string[] = []
	written.push(await installAgentRules(targetDir, 'agents-md'))
	written.push(await installClaudeMd(targetDir))
	written.push(await installAgentRules(targetDir, 'cursor'))
	written.push(await installAgentRules(targetDir, 'copilot'))
	written.push((await copyPreset('claude-skill', targetDir)).target)
	written.push((await copyPreset('mcp-example', targetDir)).target)
	// Only for repos that have node_modules to symlink — see installClaudeSettings.
	const claudeSettings = await installClaudeSettings(targetDir)
	if (claudeSettings) written.push(claudeSettings)
	// If this repo ships its own skills (skills/<name>/SKILL.md), document their
	// one-command `npx skills add` install in README.md. No-op for repos without.
	const skillsDoc = await installSkillsInstallDocs(targetDir)
	if (skillsDoc) written.push(skillsDoc)
	return written
}

/** Install the repo-tooling rules for one agent. Returns the written path (relative). */
export async function installAgentRules(targetDir: string, agent: AgentTarget): Promise<string> {
	const { description, body } = await readSkill()
	switch (agent) {
		case 'cursor': {
			const rel = path.join('.cursor', 'rules', 'repo-tooling.mdc')
			const file = path.join(targetDir, rel)
			const frontmatter = `---\ndescription: ${description}\nglobs:\nalwaysApply: false\n---\n\n`
			await fs.ensureDir(path.dirname(file))
			await fs.writeFile(file, `${frontmatter}${body}\n`)
			// Remove the pre-rename rule so a re-run migrates it instead of leaving both.
			await fs.remove(path.join(targetDir, '.cursor', 'rules', 'js-tooling.mdc'))
			return rel
		}
		case 'copilot': {
			const rel = path.join('.github', 'copilot-instructions.md')
			await upsertBlock(path.join(targetDir, rel), body)
			return rel
		}
		case 'agents-md': {
			const rel = 'AGENTS.md'
			await upsertBlock(path.join(targetDir, rel), body)
			return rel
		}
	}
}
