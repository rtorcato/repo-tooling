import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'fs-extra'
import type { CheckResult } from './types.js'

/**
 * Catches a git identity that will produce commits nobody can link to an
 * account (#328). Git is silent about every one of these: with `user.email`
 * unset it invents `user@hostname` at commit time, and with a placeholder it
 * commits happily. That silence is how ~703 commits across 23 repos ended up
 * mis-attributed before anyone noticed (#327) — this repo worst among them at
 * 79 of 397.
 *
 * Detection rules are ported from `check_git_identity` in the dotfiles repo
 * (`lib/common.sh`). Its fourth rule — email sourced from a *tracked*
 * gitconfig — is deliberately not ported: that's a property of the dotfiles
 * symlink layout, not of an arbitrary repo.
 *
 * Never fails a run. See STATUS below.
 */

export type GitIdentityVerdict = 'ok' | 'unset' | 'placeholder' | 'generated'

/**
 * IANA-reserved domains that can never receive mail. This is what made #327
 * unrecoverable: an address at one of these can never be verified as a
 * secondary email, so the commits can never be re-linked without a history
 * rewrite.
 */
const PLACEHOLDER_DOMAINS = ['example.com', 'example.org', 'example.net', 'invalid', 'test']

/**
 * Suffixes of a machine-derived hostname. `.local` is mDNS (macOS default); the
 * rest are the conventional private-LAN suffixes a router hands out. `.matrix`
 * is one such router default rather than a registered TLD — it is here because
 * it produced real commits in the #327 set, alongside `.local`.
 */
const HOSTNAME_SUFFIXES = ['.local', '.matrix', '.localhost', '.lan', '.home', '.internal']

/** Pure so the rules are testable without a git repo or a spawn. */
export function classifyGitEmail(raw: string | null | undefined): GitIdentityVerdict {
	const email = (raw ?? '').trim().toLowerCase()
	if (email === '') return 'unset'

	// lastIndexOf: a quoted local part may legally contain '@'.
	const at = email.lastIndexOf('@')
	const domain = at === -1 ? '' : email.slice(at + 1)
	// No '@' at all, or nothing either side of it — not an address.
	if (domain === '' || at === 0) return 'generated'

	if (PLACEHOLDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
		return 'placeholder'
	}
	// A bare hostname has no dot at all (`richard@laptop`); the suffixes catch
	// the ones that do (`richard@Richards-Mini.matrix`).
	if (!domain.includes('.') || HOSTNAME_SUFFIXES.some((s) => domain.endsWith(s))) {
		return 'generated'
	}
	return 'ok'
}

const DETAIL: Record<Exclude<GitIdentityVerdict, 'ok'>, (email: string) => string> = {
	unset: () => 'git user.email is not set — git will invent one from the hostname at commit time',
	placeholder: (e) => `git user.email is a placeholder that can never receive mail: ${e}`,
	generated: (e) => `git user.email looks machine-derived, not a real address: ${e}`,
}

const HINT =
	'Commits made with this identity will not link to your forge account, and the address cannot be added as a verified secondary email to fix them retroactively (#327). Set a real one: `git config --global user.email you@yourdomain.com` — or per-repo, drop `--global`.'

const CHECK = 'Git identity'

/** Trimmed stdout, or null when git is missing / the key is unset. */
export type GitExec = (args: string[]) => Promise<string | null>

const GIT_TIMEOUT_MS = 5_000

/**
 * Git exports these to everything a hook runs, and they outrank `cwd`/`-C`: a
 * child spawned from a `pre-push` answers about the *hook's* repository, not
 * the directory it was handed. Harmless for a config read; not harmless for
 * `loop guard`, whose whole job is deciding whether one specific checkout has
 * gone bare (#519). Every caller here names its repo explicitly, so the
 * ambient one is never what was meant.
 */
const AMBIENT_REPO_VARS = [
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_COMMON_DIR',
	'GIT_OBJECT_DIRECTORY',
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_PREFIX',
	'GIT_NAMESPACE',
]

function repoScopedEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env }
	for (const key of AMBIENT_REPO_VARS) delete env[key]
	return env
}

/** Never rejects; a missing or failing git resolves to null. */
export const realGitExec = (args: string[], cwd?: string): Promise<string | null> =>
	new Promise((resolve) => {
		let settled = false
		const done = (v: string | null) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			resolve(v)
		}
		// Args are internal constants, never user free-text — shell:false keeps
		// this injection-safe.
		const child = spawn('git', args, {
			cwd,
			env: repoScopedEnv(),
			stdio: ['ignore', 'pipe', 'ignore'],
		})
		let stdout = ''
		const timer = setTimeout(() => {
			child.kill()
			done(null)
		}, GIT_TIMEOUT_MS)
		child.stdout?.on('data', (d) => {
			stdout += d
		})
		child.on('close', (code) => done(code === 0 ? stdout.trim() : null))
		child.on('error', () => done(null))
	})

/**
 * STATUS: a bad identity is never `drift` or `missing`, both of which exit 1.
 * The identity belongs to whoever is running doctor, not to the repo — failing
 * CI over the runner's git config would be noise the repo's author cannot fix
 * by changing the repo. `optional-missing` reports it in gray and leaves the
 * exit code alone.
 */
export async function checkGitIdentity(dir: string, exec?: GitExec): Promise<CheckResult> {
	// Cheap gate: no .git → no commits to mis-attribute, and no spawn.
	if (!(await fs.pathExists(path.join(dir, '.git')))) {
		return { check: CHECK, status: 'ok', detail: 'not a git repository' }
	}
	// On a runner the identity is the bot's, so there is nothing to warn about
	// and the warning would be permanent.
	if (process.env.CI) {
		return { check: CHECK, status: 'ok', detail: 'skipped on CI (identity is the runner’s)' }
	}

	const git: GitExec = exec ?? ((args) => realGitExec(args, dir))
	const email = await git(['config', '--get', 'user.email'])
	const verdict = classifyGitEmail(email)
	if (verdict === 'ok') {
		return { check: CHECK, status: 'ok', detail: `git user.email is ${email}` }
	}
	return {
		check: CHECK,
		status: 'optional-missing',
		detail: DETAIL[verdict](email ?? ''),
		hint: HINT,
	}
}
