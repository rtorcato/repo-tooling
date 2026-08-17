import { spawn } from 'node:child_process'
import path from 'node:path'
import chalk from 'chalk'
import fs from 'fs-extra'
import type { CheckResult } from './types.js'

/**
 * Machine-checks the GitHub side of the repo-tooling standard — branch
 * protection, merge settings, workflow permissions — which doctor's
 * file-on-disk checks can't see (#137). Read-only. Shells out to `gh` via an
 * injectable seam (no octokit, zero deps, auth for free), modeled on
 * install.ts's resolve-never-reject style. The applying fixer is a follow-up
 * (#138); these checks only report.
 */

export interface GhResult {
	ok: boolean
	stdout: string
	stderr: string
	/** Process exit code, or null when gh never ran / timed out. */
	code: number | null
}

/** `stdin`, when given, is written to gh's stdin (for `--input -` bodies). */
export type GhExec = (args: string[], stdin?: string) => Promise<GhResult>

const GH_TIMEOUT_MS = 10_000

/**
 * Real `gh` runner — never rejects; a missing/failing gh resolves ok:false.
 * `cwd` scopes gh's repo resolution to the target dir so `-d/--directory` is
 * honored (gh otherwise resolves the remote from process.cwd()). Not annotated
 * `: GhExec` so the optional cwd stays callable; still assignable where GhExec
 * is expected.
 */
export const realGhExec = (args: string[], stdin?: string, cwd?: string): Promise<GhResult> =>
	new Promise((resolve) => {
		let settled = false
		const done = (r: GhResult) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			resolve(r)
		}
		// gh args are internal/derived from gh itself (never user free-text), so
		// shell:false + an args array keeps this injection-safe.
		const child = spawn('gh', args, {
			cwd,
			stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
		})
		let stdout = ''
		let stderr = ''
		const timer = setTimeout(() => {
			child.kill()
			done({ ok: false, stdout: '', stderr: 'gh timed out', code: null })
		}, GH_TIMEOUT_MS)
		child.stdout?.on('data', (d) => {
			stdout += d
		})
		child.stderr?.on('data', (d) => {
			stderr += d
		})
		child.on('close', (code) => done({ ok: code === 0, stdout, stderr, code }))
		child.on('error', (err) => done({ ok: false, stdout: '', stderr: String(err), code: null }))
		if (stdin !== undefined && child.stdin) {
			child.stdin.write(stdin)
			child.stdin.end()
		}
	})

/** The standard doctor checks these settings against. */
export const GITHUB_STANDARD = {
	// Required status contexts on the default branch (strict off — see below).
	requiredContexts: ['lint', 'typecheck', 'build', 'test'],
} as const

const CODE_SCANNING_CHECK = 'Code-scanning gate'
const CHECK_NAMES = [
	'Branch protection',
	'Merge settings',
	'Workflow permissions',
	CODE_SCANNING_CHECK,
] as const

// Recommended CodeQL alert thresholds — GitHub's UI defaults. This is the
// override surface: bump them here for a stricter/looser fleet-wide baseline.
// ponytail: module constants, not per-repo config, until a repo actually needs to differ.
const CODE_SCANNING_THRESHOLDS = {
	security_alerts_threshold: 'high_or_higher',
	alerts_threshold: 'errors',
} as const

const CODE_SCANNING_RULESET_NAME = 'code-scanning-main'

/** The branch ruleset POSTed to require code-scanning results before merge (#269). */
const CODE_SCANNING_RULESET_BODY = JSON.stringify({
	name: CODE_SCANNING_RULESET_NAME,
	target: 'branch',
	enforcement: 'active',
	// ~DEFAULT_BRANCH keeps this branch-name-agnostic across the fleet.
	conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
	rules: [
		{
			type: 'code_scanning',
			parameters: {
				code_scanning_tools: [{ tool: 'CodeQL', ...CODE_SCANNING_THRESHOLDS }],
			},
		},
	],
})

/** All three checks as an `ok` skip — keeps them out of next-steps and exit code. */
function skipAll(reason: string): CheckResult[] {
	return CHECK_NAMES.map((check) => ({ check, status: 'ok', detail: `skipped — ${reason}` }))
}

function skip(check: string, reason: string): CheckResult {
	return { check, status: 'ok', detail: `skipped — ${reason}` }
}

interface RepoInfo {
	nwo: string
	branch: string
	autoMerge: boolean
	squashMerge: boolean
	deleteOnMerge: boolean
	/** Squash must be the *only* method — see checkMergeSettings (#410). */
	mergeCommit: boolean
	rebaseMerge: boolean
	// The merge-setting booleans are only returned when the token has admin:read.
	// A read/write token (e.g. CI's default GITHUB_TOKEN) omits them entirely, so
	// we track visibility to skip the check rather than read `undefined` as "off".
	mergeVisible: boolean
}

/**
 * One combined probe: proves gh is installed + authed + has a GitHub remote +
 * online, and carries identity, default branch, and the merge settings. Reads
 * the REST repo endpoint (gh resolves the `{owner}/{repo}` placeholder from the
 * remote) rather than `gh repo view --json` because auto-merge (`allow_auto_merge`)
 * is not a `gh repo view` field at all — requesting it fails the whole call.
 */
async function probeRepo(exec: GhExec): Promise<{ info: RepoInfo } | { skip: string }> {
	const r = await exec(['api', 'repos/{owner}/{repo}'])
	if (!r.ok) return { skip: probeFailureReason(r) }
	let d: Record<string, any>
	try {
		d = JSON.parse(r.stdout)
	} catch {
		return { skip: 'could not parse gh output' }
	}
	const nwo = typeof d.full_name === 'string' ? d.full_name : undefined
	if (!nwo) return { skip: 'no GitHub remote' }
	return {
		info: {
			nwo,
			branch: typeof d.default_branch === 'string' ? d.default_branch : 'main',
			autoMerge: d.allow_auto_merge === true,
			squashMerge: d.allow_squash_merge === true,
			deleteOnMerge: d.delete_branch_on_merge === true,
			mergeCommit: d.allow_merge_commit === true,
			rebaseMerge: d.allow_rebase_merge === true,
			mergeVisible: [
				'allow_auto_merge',
				'allow_squash_merge',
				'delete_branch_on_merge',
				'allow_merge_commit',
				'allow_rebase_merge',
			].every((k) => typeof d[k] === 'boolean'),
		},
	}
}

export async function checkGitHubSettings(dir: string, exec?: GhExec): Promise<CheckResult[]> {
	// Cheap gate first: no .git → never spawn (keeps tmp-dir doctor runs offline).
	if (!(await fs.pathExists(path.join(dir, '.git')))) return skipAll('not a git repository')

	// Bind gh's cwd to the target dir so its repo resolution honors `-d` (#218).
	const gh: GhExec = exec ?? ((args, stdin) => realGhExec(args, stdin, dir))
	const probe = await probeRepo(gh)
	if ('skip' in probe) return skipAll(probe.skip)
	const { info } = probe
	return [
		await checkBranchProtection(gh, info.nwo, info.branch),
		checkMergeSettings(info),
		await checkWorkflowPermissions(gh, info.nwo),
		await checkCodeScanningRuleset(gh, info.nwo, info.branch, dir),
	]
}

function probeFailureReason(probe: GhResult): string {
	if (probe.code === null) return 'gh not installed'
	if (/not logged|gh auth login|authentication/i.test(probe.stderr)) return 'gh not authenticated'
	return 'not a GitHub repo or gh unavailable'
}

async function checkBranchProtection(
	exec: GhExec,
	nwo: string,
	branch: string
): Promise<CheckResult> {
	const check = 'Branch protection'
	const r = await exec(['api', `repos/${nwo}/branches/${branch}/protection`])
	if (!r.ok) {
		if (/404|not found/i.test(r.stderr)) {
			return {
				check,
				status: 'optional-missing',
				detail: `${branch} is unprotected`,
				hint: `Protect ${branch}: require checks ${GITHUB_STANDARD.requiredContexts.join(', ')}, no force-push/deletions`,
			}
		}
		if (/403|forbidden/i.test(r.stderr)) return skip(check, 'token lacks admin access')
		return skip(check, 'could not read branch protection')
	}

	let p: Record<string, any>
	try {
		p = JSON.parse(r.stdout)
	} catch {
		return skip(check, 'could not parse protection response')
	}

	const deltas: string[] = []
	const contexts: string[] = p.required_status_checks?.contexts ?? []
	// A matrix job reports each leg as `test (node 22)`, `test (node 24)`, etc.
	// Treat any `<ctx> (...)` variant as satisfying the bare `<ctx>` requirement,
	// so matrix CIs aren't falsely flagged as missing the check.
	const isSatisfied = (c: string) => contexts.some((ctx) => ctx === c || ctx.startsWith(`${c} (`))
	const missing = GITHUB_STANDARD.requiredContexts.filter((c) => !isSatisfied(c))
	if (missing.length) deltas.push(`missing required checks: ${missing.join(', ')}`)
	if (p.required_status_checks?.strict === true)
		deltas.push('strict status checks on (should be off)')
	// enforce_admins must stay off so the App/RELEASE_TOKEN can bypass protection
	// to push semantic-release's version commit (see Release-token doctor check).
	if (p.enforce_admins?.enabled === true) deltas.push('enforce_admins on (blocks release bypass)')
	if (p.allow_force_pushes?.enabled === true) deltas.push('force pushes allowed')
	if (p.allow_deletions?.enabled === true) deltas.push('branch deletions allowed')
	// Required human review deadlocks solo Dependabot auto-merge.
	if (p.required_pull_request_reviews) deltas.push('required PR reviews on (deadlocks auto-merge)')

	if (deltas.length)
		return {
			check,
			status: 'drift',
			detail: deltas.join('; '),
			hint: `Align ${branch} protection with the standard`,
		}
	return { check, status: 'ok', detail: `${branch} protected per standard` }
}

/**
 * Squash is required *and exclusive* (#410). Leaving merge-commit or rebase
 * enabled only makes them available on the merge button, and one mis-click puts
 * every intermediate branch commit on the default branch: semantic-release then
 * reads subjects nobody reviewed (a stray `fix:` inside a docs PR cuts a
 * release), and `ai-issue-loop`'s Pass 2 stops finding the `(#N)` squash subject
 * it uses to confirm work landed, so worktrees leak. Observed on `js-common`
 * #204, whose CONTRIBUTING already said squash-only — the rule existed, nothing
 * enforced it.
 */
function checkMergeSettings(info: RepoInfo): CheckResult {
	const check = 'Merge settings'
	// The token can't see the merge-setting fields (no admin:read) — skip rather
	// than misreport the absent booleans as "disabled" (a false-positive drift).
	if (!info.mergeVisible) return skip(check, 'token lacks admin:read for merge settings')
	const deltas: string[] = []
	if (!info.autoMerge) deltas.push('auto-merge disabled')
	if (!info.squashMerge) deltas.push('squash-merge disabled')
	if (!info.deleteOnMerge) deltas.push('delete-branch-on-merge disabled')
	if (info.mergeCommit) deltas.push('merge commits allowed (squash only)')
	if (info.rebaseMerge) deltas.push('rebase merging allowed (squash only)')
	if (deltas.length)
		return {
			check,
			status: 'drift',
			detail: deltas.join('; '),
			hint: 'Enable auto-merge and delete-branch-on-merge, and make squash the only merge method',
		}
	return { check, status: 'ok', detail: 'squash-only, auto-merge and delete-on-merge on' }
}

async function checkWorkflowPermissions(exec: GhExec, nwo: string): Promise<CheckResult> {
	const check = 'Workflow permissions'
	const r = await exec(['api', `repos/${nwo}/actions/permissions/workflow`])
	if (!r.ok) {
		if (/403|forbidden/i.test(r.stderr)) return skip(check, 'token lacks admin access')
		return skip(check, 'could not read workflow permissions')
	}
	let p: Record<string, any>
	try {
		p = JSON.parse(r.stdout)
	} catch {
		return skip(check, 'could not parse permissions response')
	}
	const deltas: string[] = []
	if (p.default_workflow_permissions !== 'read')
		deltas.push(`default permissions '${p.default_workflow_permissions}' (should be read)`)
	if (p.can_approve_pull_request_reviews === true)
		deltas.push('workflows can approve PRs (should be off)')
	if (deltas.length)
		return {
			check,
			status: 'drift',
			detail: deltas.join('; '),
			hint: 'Set default workflow permissions to read-only and disable workflow PR approvals',
		}
	return { check, status: 'ok', detail: 'read-only default, no workflow PR approvals' }
}

/**
 * True when CodeQL/code-scanning is enabled for the repo. Covers both ways it
 * ships: an advanced-setup workflow on disk (what `fix codeql` scaffolds) or
 * GitHub's default setup (no file — ask the code-scanning API). Mirrors doctor's
 * on-disk CodeQL check; kept inline to avoid a doctor↔settings import cycle.
 */
async function codeqlEnabled(gh: GhExec, nwo: string, dir: string): Promise<boolean> {
	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (await fs.pathExists(workflowsDir)) {
		try {
			for (const f of await fs.readdir(workflowsDir)) {
				if (!/\.ya?ml$/.test(f)) continue
				const content = await fs.readFile(path.join(workflowsDir, f), 'utf-8')
				if (/github\/codeql-action/.test(content)) return true
			}
		} catch {
			// fall through to the API probe
		}
	}
	// Default setup leaves no workflow file — the API is the only signal.
	const r = await gh(['api', `repos/${nwo}/code-scanning/default-setup`])
	if (!r.ok) return false
	try {
		return (JSON.parse(r.stdout) as { state?: string }).state === 'configured'
	} catch {
		return false
	}
}

/** True when a ruleset's ref_name conditions cover the default branch. */
function rulesetTargetsBranch(
	conditions: Record<string, any> | undefined,
	branch: string
): boolean {
	const include: string[] = conditions?.ref_name?.include ?? []
	return include.some(
		(ref) => ref === '~DEFAULT_BRANCH' || ref === '~ALL' || ref === `refs/heads/${branch}`
	)
}

/**
 * Does an active branch ruleset enforce a code_scanning rule on the default
 * branch? The list endpoint omits rules/conditions, so active branch rulesets
 * are fetched by id to inspect them. 'skip' on any read failure (self-skips like
 * the other checks).
 */
async function hasCodeScanningRuleset(
	gh: GhExec,
	nwo: string,
	branch: string
): Promise<'yes' | 'no' | 'skip'> {
	const list = await gh(['api', `repos/${nwo}/rulesets`])
	if (!list.ok) return 'skip'
	let rulesets: Array<{ id?: number; target?: string; enforcement?: string }>
	try {
		rulesets = JSON.parse(list.stdout)
	} catch {
		return 'skip'
	}
	if (!Array.isArray(rulesets)) return 'skip'
	const active = rulesets.filter(
		(r) => r.target === 'branch' && r.enforcement === 'active' && typeof r.id === 'number'
	)
	for (const rs of active) {
		const detail = await gh(['api', `repos/${nwo}/rulesets/${rs.id}`])
		if (!detail.ok) continue
		let full: { rules?: Array<{ type?: string }>; conditions?: Record<string, any> }
		try {
			full = JSON.parse(detail.stdout)
		} catch {
			continue
		}
		const enforcesCodeScanning = (full.rules ?? []).some((r) => r.type === 'code_scanning')
		if (enforcesCodeScanning && rulesetTargetsBranch(full.conditions, branch)) return 'yes'
	}
	return 'no'
}

/**
 * The #269 gap: CodeQL results are advisory by default — a High alert still
 * merges unless a branch ruleset requires the code-scanning check. Only
 * meaningful where CodeQL is actually on, so it no-ops otherwise.
 */
async function checkCodeScanningRuleset(
	gh: GhExec,
	nwo: string,
	branch: string,
	dir: string
): Promise<CheckResult> {
	const check = CODE_SCANNING_CHECK
	if (!(await codeqlEnabled(gh, nwo, dir))) {
		return { check, status: 'ok', detail: 'CodeQL not enabled — no code-scanning gate needed' }
	}
	const found = await hasCodeScanningRuleset(gh, nwo, branch)
	if (found === 'skip') return skip(check, 'could not read rulesets')
	if (found === 'yes') {
		return { check, status: 'ok', detail: `active ruleset requires code-scanning on ${branch}` }
	}
	return {
		check,
		status: 'drift',
		detail: `CodeQL is on but no active ruleset requires code-scanning on ${branch} (High alerts stay advisory)`,
		hint: 'Run `npx @rtorcato/repo-tooling fix github-settings` to add a code_scanning branch ruleset that blocks merge on High+ CodeQL alerts',
	}
}

// --- Fixer side (#138): apply the standard via gh api ---------------------

/** Which of the three settings deviate from the standard and so need applying. */
export interface GhApplyState {
	nwo: string
	branch: string
	merge: boolean
	protection: boolean
	workflow: boolean
}

/** A single `gh api` mutation plus the human label reported once it succeeds. */
export interface GhCommand {
	label: string
	args: string[]
	/** JSON body piped to gh stdin (branch protection uses `--input -`). */
	stdin?: string
}

/** The branch-protection body PUT to the API — mirrors the doctor standard. */
const PROTECTION_BODY = JSON.stringify({
	required_status_checks: { strict: false, contexts: GITHUB_STANDARD.requiredContexts },
	// enforce_admins off so the App/RELEASE_TOKEN can bypass to push release commits.
	enforce_admins: false,
	// Required human review would deadlock solo Dependabot auto-merge.
	//
	// Note this is *applied*, not merely tolerated: checkBranchProtection reports
	// any required_pull_request_reviews as drift, so `fix github-settings` PUTs it
	// back to null. A repo that deliberately requires approvals will have that
	// silently reverted by the next unrelated fix run, with nothing in the output
	// naming the rule that was removed. Known downstream case: the ai-issue-loop
	// pipeline works around it with approval labels precisely because of this.
	// Loosen the standard here first if a repo ever genuinely needs review gating.
	required_pull_request_reviews: null,
	restrictions: null,
	allow_force_pushes: false,
	allow_deletions: false,
})

/** Pure: the exact `gh api` invocations for whatever deviates ([] when compliant). */
export function buildGhApplyCommands(state: GhApplyState): GhCommand[] {
	const commands: GhCommand[] = []
	if (state.merge)
		commands.push({
			label: 'merge settings (squash-only, auto-merge, delete-on-merge)',
			args: [
				'api',
				'-X',
				'PATCH',
				`repos/${state.nwo}`,
				'-F',
				'allow_auto_merge=true',
				'-F',
				'allow_squash_merge=true',
				'-F',
				'delete_branch_on_merge=true',
				'-F',
				'allow_merge_commit=false',
				'-F',
				'allow_rebase_merge=false',
			],
		})
	if (state.protection)
		commands.push({
			label: `branch protection on ${state.branch}`,
			args: [
				'api',
				'-X',
				'PUT',
				`repos/${state.nwo}/branches/${state.branch}/protection`,
				'--input',
				'-',
			],
			stdin: PROTECTION_BODY,
		})
	if (state.workflow)
		commands.push({
			label: 'workflow permissions (read-only)',
			args: [
				'api',
				'-X',
				'PUT',
				`repos/${state.nwo}/actions/permissions/workflow`,
				'-f',
				'default_workflow_permissions=read',
				'-F',
				'can_approve_pull_request_reviews=false',
			],
		})
	return commands
}

/**
 * Re-reads GitHub state and applies only the deltas via `gh api` (idempotent —
 * a compliant repo is a no-op). Returns human labels for what changed, or `[]`
 * on skip (no gh/auth/remote, or already compliant), logging the reason. Mirrors
 * the "no package.json found — skipping" fixer pattern. Read-only unless a delta
 * exists, so re-runs (walk-all hits it up to 3×) are safe.
 *
 * Reached from the `github-settings` fixer, so its advisories go to
 * `console.error` for the same reason the fixers' do (#357): stdout carries the
 * `--json` payload. #358 fixed the fixer files but not this one — it isn't a
 * fixer file, it's just called by one.
 */
export async function applyGithubSettings(dir: string, exec?: GhExec): Promise<string[]> {
	if (!(await fs.pathExists(path.join(dir, '.git')))) {
		console.error(chalk.gray('   skipped — not a git repository'))
		return []
	}
	// Bind gh's cwd to the target dir so its repo resolution honors `-d` (#218).
	const gh: GhExec = exec ?? ((args, stdin) => realGhExec(args, stdin, dir))
	const probe = await probeRepo(gh)
	if ('skip' in probe) {
		console.error(chalk.gray(`   skipped — ${probe.skip}`))
		return []
	}
	const { info } = probe

	// Re-read via the same checks so the delta logic stays single-sourced. A 403
	// (no admin) reports `ok` → treated as "nothing to apply", never a failed PUT.
	const bp = await checkBranchProtection(gh, info.nwo, info.branch)
	const wp = await checkWorkflowPermissions(gh, info.nwo)
	const commands = buildGhApplyCommands({
		nwo: info.nwo,
		branch: info.branch,
		merge: checkMergeSettings(info).status === 'drift',
		protection: bp.status === 'optional-missing' || bp.status === 'drift',
		workflow: wp.status === 'drift',
	})

	const applied: string[] = []
	for (const cmd of commands) {
		const r = await gh(cmd.args, cmd.stdin)
		if (r.ok) applied.push(cmd.label)
		else
			console.error(
				chalk.yellow(`   could not apply ${cmd.label}: ${r.stderr.trim() || 'gh error'}`)
			)
	}

	// Code-scanning ruleset (#269): POST only when CodeQL is on and no active gate
	// covers the default branch — the check re-read keeps this idempotent.
	const cs = await checkCodeScanningRuleset(gh, info.nwo, info.branch, dir)
	if (cs.status === 'drift') {
		const label = `code-scanning ruleset on ${info.branch}`
		const r = await gh(
			['api', '-X', 'POST', `repos/${info.nwo}/rulesets`, '--input', '-'],
			CODE_SCANNING_RULESET_BODY
		)
		if (r.ok) applied.push(label)
		else
			console.error(chalk.yellow(`   could not apply ${label}: ${r.stderr.trim() || 'gh error'}`))
	}

	if (applied.length === 0) console.error(chalk.gray('   already configured — nothing to apply'))
	return applied
}
