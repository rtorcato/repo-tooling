import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	installAiSetup,
	installClaudeMd,
	installClaudeSettings,
} from '../../../src/cli/generators/agent-rules.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const AI_FILES = [
	'AGENTS.md',
	'CLAUDE.md',
	'.cursor/rules/repo-tooling.mdc',
	'.github/copilot-instructions.md',
	'.claude/skills/repo-tooling.md',
	'.mcp.json.example',
]

describe('installAiSetup', () => {
	it('writes every AI agent file and returns their paths', async () => {
		const dir = newTmpDir()
		const written = await installAiSetup(dir)
		expect(written).toEqual(AI_FILES)
		for (const rel of AI_FILES) {
			expect(await fs.pathExists(join(dir, rel))).toBe(true)
		}
	})

	it('adds .claude/settings.json for a repo that has node_modules to symlink', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo' })
		expect(await installAiSetup(dir)).toEqual([...AI_FILES, join('.claude', 'settings.json')])
	})

	it('makes CLAUDE.md a pointer to AGENTS.md, not a duplicate', async () => {
		const dir = newTmpDir()
		await installAiSetup(dir)
		const claude = await fs.readFile(join(dir, 'CLAUDE.md'), 'utf8')
		expect(claude).toContain('@AGENTS.md')
		expect(claude).toContain('<!-- js-tooling:start -->')
	})

	it('ships the MCP template as .example and never an active .mcp.json', async () => {
		const dir = newTmpDir()
		await installAiSetup(dir)
		expect(await fs.pathExists(join(dir, '.mcp.json.example'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.mcp.json'))).toBe(false)
		// The active file must be strict JSON, so the template keeps servers empty.
		const example = await fs.readFile(join(dir, '.mcp.json.example'), 'utf8')
		expect(example).toContain('"mcpServers": {}')
	})

	it('preserves existing user content and is idempotent (single block)', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'AGENTS.md'), '# My project rules\n\nKeep these.\n')
		await installAiSetup(dir)
		await installAiSetup(dir) // run twice
		const agents = await fs.readFile(join(dir, 'AGENTS.md'), 'utf8')
		expect(agents).toContain('# My project rules')
		expect(agents).toContain('Keep these.')
		// exactly one delimited block, not duplicated by the second run
		expect(agents.match(/<!-- js-tooling:start -->/g)).toHaveLength(1)
	})
})

describe('installClaudeSettings', () => {
	const settingsPath = (dir: string) => join(dir, '.claude', 'settings.json')

	it('scaffolds .claude/settings.json with the worktree symlink entry', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo' })
		expect(await installClaudeSettings(dir)).toBe(join('.claude', 'settings.json'))
		expect(await fs.readJson(settingsPath(dir))).toEqual({
			worktree: { symlinkDirectories: ['node_modules'] },
		})
	})

	it('upserts — existing keys survive and re-running does not duplicate entries', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo' })
		await fs.outputJson(settingsPath(dir), {
			hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
			worktree: { symlinkDirectories: ['.venv'], copyFiles: ['.env'] },
		})
		await installClaudeSettings(dir)
		await installClaudeSettings(dir)
		expect(await fs.readJson(settingsPath(dir))).toEqual({
			hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
			worktree: { symlinkDirectories: ['.venv', 'node_modules'], copyFiles: ['.env'] },
		})
	})

	it('skips a repo with no package.json — nothing to symlink (swift-library)', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), '// swift-tools-version:5.9\n')
		expect(await installClaudeSettings(dir)).toBeNull()
		expect(await fs.pathExists(settingsPath(dir))).toBe(false)
		// …and the umbrella leaves it out too.
		expect(await installAiSetup(dir)).not.toContain(join('.claude', 'settings.json'))
	})

	it('adds nested workspace node_modules derived from pnpm-workspace.yaml', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo' })
		await fs.writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
		await fs.ensureDir(join(dir, 'apps', 'docs', 'node_modules'))
		// A workspace with no node_modules of its own is skipped, not listed.
		await fs.ensureDir(join(dir, 'apps', 'web'))
		await installClaudeSettings(dir)
		expect(await fs.readJson(settingsPath(dir))).toEqual({
			worktree: { symlinkDirectories: ['node_modules', 'apps/docs/node_modules'] },
		})
	})

	it('derives them from package.json workspaces too, without duplicating', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo', workspaces: ['packages/*'] })
		await fs.ensureDir(join(dir, 'packages', 'core', 'node_modules'))
		await installClaudeSettings(dir)
		await installClaudeSettings(dir)
		expect(await fs.readJson(settingsPath(dir))).toEqual({
			worktree: { symlinkDirectories: ['node_modules', 'packages/core/node_modules'] },
		})
	})

	it('never writes a path outside the repo, however the workspace glob is spelled', async () => {
		const root = newTmpDir()
		const dir = join(root, 'repo')
		// A sibling of the repo, with the node_modules a traversal glob would match.
		await fs.ensureDir(join(root, 'shared-lib', 'node_modules'))
		await fs.ensureDir(join(dir, 'packages', 'core', 'node_modules'))
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			workspaces: ['../shared-lib', 'packages/*'],
		})
		await fs.writeFile(
			join(dir, 'pnpm-workspace.yaml'),
			`packages:\n  - '${join(root, 'shared-lib')}'\n`
		)
		await installClaudeSettings(dir)
		expect(await fs.readJson(settingsPath(dir))).toEqual({
			worktree: { symlinkDirectories: ['node_modules', 'packages/core/node_modules'] },
		})
	})

	it('refuses to clobber a settings.json that does not parse', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo' })
		await fs.outputFile(settingsPath(dir), '{ not json')
		expect(await installClaudeSettings(dir)).toBeNull()
		expect(await fs.readFile(settingsPath(dir), 'utf8')).toBe('{ not json')
	})
})

describe('installClaudeMd', () => {
	it('does not clobber an existing CLAUDE.md, only upserts the block', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'CLAUDE.md'), '# Existing\n\nUser notes.\n')
		await installClaudeMd(dir)
		const claude = await fs.readFile(join(dir, 'CLAUDE.md'), 'utf8')
		expect(claude).toContain('# Existing')
		expect(claude).toContain('User notes.')
		expect(claude).toContain('@AGENTS.md')
	})
})
