import path from 'node:path'
import fs from 'fs-extra'
import { type GhExec, realGhExec } from './github-settings.js'
import type { CheckResult } from './types.js'

/**
 * `aiLoop.agentUser` assignability (#530). The skills that consume the option
 * (`ai-issue-loop`, `ai-workflow`) verify it at runtime and *silently assign
 * nothing* on failure — by design, so a deleted bot account or a bot never
 * added as a collaborator degrades the loop with no visible symptom. This
 * check is where that failure becomes visible.
 *
 * Read-only, on the same `gh` seam as labels.ts and milestones.ts. Everything
 * derives from the consuming repo: the login from its lockfile, the repo from
 * its own remote via gh's `{owner}/{repo}` placeholders.
 */

const CHECK = 'AI loop agent'

/**
 * GitHub login shape: 1–39 chars, alphanumerics and single hyphens, no leading
 * or trailing hyphen. The injection boundary — the login is interpolated into
 * the API path below.
 */
const LOGIN = /^[a-zA-Z0-9](?:-?[a-zA-Z0-9]){0,38}$/

const skip = (reason: string): CheckResult => ({
	check: CHECK,
	status: 'ok',
	detail: `skipped — ${reason}`,
})

export async function checkAgentUser(
	dir: string,
	agentUser: string | undefined,
	exec?: GhExec
): Promise<CheckResult> {
	// Absent field ⇒ not applicable — the single-identity model is the default,
	// not a requirement (#521).
	if (!agentUser) {
		return {
			check: CHECK,
			status: 'ok',
			detail: 'not applicable — no rules.aiLoop.agentUser in .repo-tooling.json',
		}
	}
	if (!LOGIN.test(agentUser)) {
		return {
			check: CHECK,
			status: 'drift',
			detail: `rules.aiLoop.agentUser "${agentUser}" is not a valid GitHub login`,
			hint: 'Fix or remove rules.aiLoop.agentUser in .repo-tooling.json',
		}
	}
	// Cheap gate first: no .git → never spawn (keeps tmp-dir doctor runs offline).
	if (!(await fs.pathExists(path.join(dir, '.git')))) return skip('not a git repository')
	const gh: GhExec = exec ?? ((args, stdin) => realGhExec(args, stdin, dir))
	// 204 when the login can be assigned issues on this repo, 404 otherwise.
	const r = await gh(['api', `repos/{owner}/{repo}/assignees/${agentUser}`])
	if (r.ok) {
		return {
			check: CHECK,
			status: 'ok',
			detail: `rules.aiLoop.agentUser "${agentUser}" is an assignable collaborator`,
		}
	}
	if (/HTTP 404/.test(r.stderr)) {
		return {
			check: CHECK,
			status: 'drift',
			detail: `rules.aiLoop.agentUser "${agentUser}" is not an assignable collaborator — the loop skills will silently assign nothing`,
			hint: `Add the account as a collaborator (\`gh api -X PUT repos/{owner}/{repo}/collaborators/${agentUser}\`) or remove rules.aiLoop.agentUser from .repo-tooling.json`,
		}
	}
	// Offline, unauthenticated, or gh missing — not evidence of drift.
	return skip('could not verify assignability')
}
