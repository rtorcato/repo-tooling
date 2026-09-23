/**
 * `fix ai-loop-identity` (#638): point this checkout's Claude sessions at a gh
 * profile signed in as `rules.aiLoop.agentUser`, so `loop guard` stops halting
 * on `identity: mismatch`. `.repo-tooling.json` (committed) says *who* the agent
 * is; the profile path is machine-specific, so it lands in the gitignored,
 * per-checkout `.claude/settings.local.json`.
 */
import path from 'node:path'
import fs from 'fs-extra'
import { configuredAgentUser } from '../cli/commands/loop-guard.js'
import { LOGIN } from './agent-user.js'
import { FixerAbort } from './fixers.js'
import { type GhResult, realGhExec } from './github-settings.js'

export const SETTINGS_LOCAL = '.claude/settings.local.json'

export type GhEnvExec = (args: string[], env: NodeJS.ProcessEnv) => Promise<GhResult>

/** The profile dir the fixer looks in when `--gh-config-dir` is not given. */
export function defaultGhConfigDir(agentUser: string, home: string): string {
	return path.join(home, '.config', `gh-${agentUser}`)
}

/**
 * Returns the files written. Writes nothing — and aborts with the `gh auth
 * login` command as the hint — unless the profile really is the agent account.
 */
export async function setupAgentIdentity(
	targetDir: string,
	opts: { ghConfigDir?: string; home: string; gh?: GhEnvExec }
): Promise<string[]> {
	const agentUser = await configuredAgentUser(targetDir)
	if (!agentUser) {
		console.error('   nothing to do — no rules.aiLoop.agentUser in .repo-tooling.json')
		return []
	}
	// The login comes from a committed file and becomes a path segment below.
	if (!LOGIN.test(agentUser)) {
		throw new FixerAbort(
			'invalid-agent-user',
			`rules.aiLoop.agentUser "${agentUser}" is not a valid GitHub login`,
			'Fix or remove rules.aiLoop.agentUser in .repo-tooling.json'
		)
	}
	const dir = path.resolve(opts.ghConfigDir ?? defaultGhConfigDir(agentUser, opts.home))
	const gh = opts.gh ?? ((args, env) => realGhExec(args, undefined, targetDir, env))
	const login = (await fs.pathExists(dir))
		? await gh(['api', 'user', '--jq', '.login'], { GH_CONFIG_DIR: dir }).then((r) =>
				r.ok ? r.stdout.trim() : ''
			)
		: ''
	// GitHub logins are case-insensitive, so a case difference is one account.
	if (login.toLowerCase() !== agentUser.toLowerCase()) {
		throw new FixerAbort(
			'agent-identity-unavailable',
			`${dir} is ${login ? `signed in as ${login}, not ${agentUser}` : `not signed in to gh as ${agentUser}`} — nothing written`,
			`Sign in once, in a browser logged in as ${agentUser}, then re-run:\n   GH_CONFIG_DIR=${dir} gh auth login --hostname github.com --web --scopes repo`
		)
	}

	const written: string[] = []
	const settingsPath = path.join(targetDir, SETTINGS_LOCAL)
	let settings: Record<string, unknown> = {}
	if (await fs.pathExists(settingsPath)) {
		try {
			settings = await fs.readJson(settingsPath)
		} catch {
			throw new FixerAbort(
				'settings-local-unparseable',
				`${SETTINGS_LOCAL} is not valid JSON — not overwriting it`,
				`Fix the file by hand, or add "env": {"GH_CONFIG_DIR": "${dir}"} to it yourself`
			)
		}
	}
	const env = (settings.env ?? {}) as Record<string, unknown>
	if (env.GH_CONFIG_DIR !== dir) {
		await fs.outputJson(
			settingsPath,
			{ ...settings, env: { ...env, GH_CONFIG_DIR: dir } },
			{ spaces: 2 }
		)
		written.push(SETTINGS_LOCAL)
	}
	if (await ensureIgnored(targetDir)) written.push('.gitignore')
	return written
}

// ponytail: exact-line match on the usual spellings; a glob that happens to
// cover the file gets a redundant (harmless) line. `git check-ignore` if that bites.
const IGNORE_LINES = new Set([
	SETTINGS_LOCAL,
	`/${SETTINGS_LOCAL}`,
	'.claude',
	'.claude/',
	'/.claude',
	'/.claude/',
])

async function ensureIgnored(targetDir: string): Promise<boolean> {
	const file = path.join(targetDir, '.gitignore')
	const existing = (await fs.pathExists(file)) ? await fs.readFile(file, 'utf-8') : ''
	if (existing.split('\n').some((l) => IGNORE_LINES.has(l.trim()))) return false
	const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
	await fs.writeFile(file, `${existing}${separator}${SETTINGS_LOCAL}\n`)
	return true
}
