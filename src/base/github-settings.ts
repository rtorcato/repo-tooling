import { spawn } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import chalk from 'chalk'
import fs from 'fs-extra'
import { RELEASE_WORKFLOW_HEADER } from './ci.js'
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
export const realGhExec = (
	args: string[],
	stdin?: string,
	cwd?: string,
	env?: NodeJS.ProcessEnv
): Promise<GhResult> =>
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
			env: env && { ...process.env, ...env },
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
export const RELEASE_GATE_CHECK = 'Release gate'
export const RELEASE_ENV_CHECK = 'Release environment'
export const RELEASE_SECRETS_CHECK = 'Release secrets'
const SECURITY_UPDATES_CHECK = 'Security updates'
export const GITHUB_SETTINGS_CHECKS = [
	'Branch protection',
	'Merge settings',
	'Workflow permissions',
	SECURITY_UPDATES_CHECK,
	CODE_SCANNING_CHECK,
	RELEASE_GATE_CHECK,
	RELEASE_ENV_CHECK,
	RELEASE_SECRETS_CHECK,
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
	return GITHUB_SETTINGS_CHECKS.map((check) => ({
		check,
		status: 'ok',
		detail: `skipped — ${reason}`,
	}))
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
		await checkSecurityUpdates(gh, info.nwo),
		await checkCodeScanningRuleset(gh, info.nwo, info.branch, dir),
		...(await checkReleaseGate(gh, info.nwo, dir)),
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
 * release), and repo-ai's `ai-loop` cleanup stops finding the `(#N)` squash subject
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
 * Dependabot vulnerability alerts and automated security fixes (#692). A
 * `dependabot.yml` only schedules version bumps; these two repo toggles are what
 * surface and patch advisories, and both default off on a new repo. Neither
 * endpoint has a body worth reading for alerts: 204 is on, 404 is off.
 */
async function readSecurityUpdates(
	exec: GhExec,
	nwo: string
): Promise<{ alerts: boolean; fixes: boolean } | { skip: string }> {
	const enabled = async (endpoint: string): Promise<boolean | { skip: string }> => {
		const r = await exec(['api', `repos/${nwo}/${endpoint}`])
		if (!r.ok) {
			if (/404|not found/i.test(r.stderr)) return false
			if (/403|forbidden/i.test(r.stderr)) return { skip: 'token lacks admin access' }
			return { skip: `could not read ${endpoint}` }
		}
		if (endpoint === 'vulnerability-alerts') return true
		try {
			return JSON.parse(r.stdout).enabled === true
		} catch {
			return { skip: `could not parse ${endpoint} response` }
		}
	}
	const alerts = await enabled('vulnerability-alerts')
	if (typeof alerts !== 'boolean') return alerts
	const fixes = await enabled('automated-security-fixes')
	if (typeof fixes !== 'boolean') return fixes
	return { alerts, fixes }
}

async function checkSecurityUpdates(exec: GhExec, nwo: string): Promise<CheckResult> {
	const check = SECURITY_UPDATES_CHECK
	const s = await readSecurityUpdates(exec, nwo)
	if ('skip' in s) return skip(check, s.skip)
	const deltas: string[] = []
	if (!s.alerts) deltas.push('vulnerability alerts disabled')
	if (!s.fixes) deltas.push('automated security fixes disabled')
	// optional-missing, not drift: doctor promotes it when the lock records
	// securityAutomation: true, and demotes it when the lock records false.
	if (deltas.length)
		return {
			check,
			status: 'optional-missing',
			detail: deltas.join('; '),
			hint: 'Run `npx @rtorcato/repo-tooling fix github-settings` to enable Dependabot alerts and security updates',
		}
	return { check, status: 'ok', detail: 'vulnerability alerts and automated security fixes on' }
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

/** Release config filenames semantic-release picks up that we can import. */
const RELEASE_CONFIG_FILES = ['release.config.mjs', 'release.config.js'] as const

/** How to stop the GH013 collision, wherever it is reported. */
const GIT_PLUGIN_REMEDY =
	'Drop `@semantic-release/git` and `@semantic-release/changelog` from the release config (rtorcato/repo-tooling#417) — the shipped `semantic-release/github` preset already has, so a bare re-export of it is enough. Do NOT add a bypass actor to the ruleset: it exempts the one commit nobody reviews'

/**
 * Does the repo's release config still resolve `@semantic-release/git`?
 *
 * That plugin pushes the release commit straight to the default branch, which a
 * `code_scanning` ruleset rejects with GH013 — a commit created seconds earlier
 * can never carry CodeQL results (#417). The two are individually correct and
 * jointly unwinnable, and the failure is silent, because a merge that produces
 * no release goes green either way.
 *
 * The config is imported rather than grepped, because every cheaper signal is
 * wrong on a config we ship or recommend: a bare re-export names no plugin at
 * all; a pinned older repo-tooling re-exports a preset that *does* have it; the
 * current preset mentions it in a comment explaining its absence; and the
 * documented way to drop it lists the name in a filter. Only the resolved
 * `plugins` array distinguishes those. Importing config is what semantic-release
 * itself does with this file.
 *
 * `false` on anything unreadable — a false negative is a missed warning, a false
 * positive is a wrong one.
 */
export async function releaseUsesGitPlugin(dir: string): Promise<boolean> {
	for (const name of RELEASE_CONFIG_FILES) {
		const file = path.join(dir, name)
		if (!(await fs.pathExists(file))) continue
		try {
			const mod = await import(pathToFileURL(file).href)
			const plugins: unknown = mod.default?.plugins
			if (!Array.isArray(plugins)) return false
			return plugins.some((p) => (Array.isArray(p) ? p[0] : p) === '@semantic-release/git')
		} catch {
			return false
		}
	}
	return false
}

/**
 * The #269 gap: CodeQL results are advisory by default — a High alert still
 * merges unless a branch ruleset requires the code-scanning check. Only
 * meaningful where CodeQL is actually on, so it no-ops otherwise.
 *
 * It also reports the #419 collision: a gate that is correctly in place is still
 * drift when the release config pushes to the branch it guards.
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
	const gitPlugin = await releaseUsesGitPlugin(dir)
	if (found === 'yes') {
		if (gitPlugin) {
			return {
				check,
				status: 'drift',
				detail: `active ruleset requires code-scanning on ${branch}, but the release config still uses \`@semantic-release/git\` — its push to ${branch} will be rejected with GH013, and the release fails silently`,
				hint: GIT_PLUGIN_REMEDY,
			}
		}
		return { check, status: 'ok', detail: `active ruleset requires code-scanning on ${branch}` }
	}
	return {
		check,
		status: 'drift',
		detail: `CodeQL is on but no active ruleset requires code-scanning on ${branch} (High alerts stay advisory)`,
		hint: gitPlugin
			? `Run \`npx @rtorcato/repo-tooling fix github-settings\` to add a code_scanning branch ruleset that blocks merge on High+ CodeQL alerts. That ruleset will reject this repo's release commit with GH013 while the config uses \`@semantic-release/git\`. ${GIT_PLUGIN_REMEDY}`
			: 'Run `npx @rtorcato/repo-tooling fix github-settings` to add a code_scanning branch ruleset that blocks merge on High+ CodeQL alerts',
	}
}

// --- Release environment gate (#429) --------------------------------------

/** The environment name the standard reserves for the publish gate. */
const RELEASE_ENVIRONMENT = 'release'

/**
 * What a job has to run for a merge to the default branch to reach a registry.
 * `semantic-release` counts on its own — the shipped preset publishes with it.
 */
const PUBLISH_COMMAND = /semantic-release|changesets\/action|(?:npm|pnpm|yarn)\s+publish/

const GATE_HINT =
	'Run `npx @rtorcato/repo-tooling fix release-environment` to create the `release` environment with required reviewers (you) and add `environment: release` to the publishing job — a merge to the default branch then leaves the run `waiting` instead of publishing'

const ENV_HINT =
	'Add `environment: release` to the publishing job, or delete the environment — whichever was meant. An environment nothing references still lists under Settings → Environments as though it gates something'

const unquote = (s: string) => s.replace(/^['"]|['"]$/g, '')

/**
 * A workflow's `jobs:` blocks, keyed by job id.
 *
 * Hand-split rather than parsed: this package ships no YAML dependency, and the
 * only question asked of the result is whether *one particular job* carries an
 * `environment:` key. A whole-file grep would answer that wrong on any repo with
 * a `github-pages` deploy job — which is the exact false negative this check
 * exists to avoid. Jobs sit one indent level under `jobs:` and their keys one
 * level below that, which holds for every workflow Actions accepts.
 */
export function workflowJobs(yaml: string): Map<string, string> {
	const lines = yaml.split('\n')
	const jobs = new Map<string, string>()
	for (const { id, start, end } of jobSpans(lines)) {
		jobs.set(id, lines.slice(start + 1, end).join('\n'))
	}
	return jobs
}

const indentOf = (l: string) => l.length - l.trimStart().length
const isBlankOrComment = (l: string | undefined) => /^\s*(#.*)?$/.test(l ?? '')

/** Each job's line range in `lines`: `start` is its header line, `end` is exclusive. */
function jobSpans(lines: string[]): { id: string; start: number; end: number }[] {
	const spans: { id: string; start: number; end: number }[] = []
	const start = lines.findIndex((l) => /^jobs:\s*$/.test(l))
	if (start === -1) return spans

	// The block runs until the next top-level key. A column-0 comment is not one —
	// it ends nothing, so skipping it keeps a stray comment between `jobs:` and its
	// first job from truncating the block and hiding every job below it.
	let end = lines.length
	for (let i = start + 1; i < lines.length; i++) {
		const l = lines[i] ?? ''
		if (!isBlankOrComment(l) && indentOf(l) === 0) {
			end = i
			break
		}
	}
	const first = lines.slice(start + 1, end).find((l) => !isBlankOrComment(l))
	if (first === undefined) return spans
	const jobIndent = indentOf(first)

	for (let i = start + 1; i < end; i++) {
		const line = lines[i] ?? ''
		const header =
			line.trim() !== '' && indentOf(line) === jobIndent
				? /^([\w.-]+):/.exec(line.trim())?.[1]
				: undefined
		if (!header) continue
		const prev = spans.at(-1)
		if (prev) prev.end = i
		spans.push({ id: header, start: i, end })
	}
	return spans
}

/**
 * `yaml` with job `id` cut out and every other line left byte-for-byte (#761),
 * apart from the `needs:` entries that named it and the `workflow_dispatch` /
 * `milestone` triggers only it referred to. Blank and comment lines trailing the
 * job stay — they usually introduce the next job.
 *
 * ponytail: line surgery like `workflowJobs`, no YAML parser. A flow-style
 * `on: [push, workflow_dispatch]` keeps its entries; only block-form triggers
 * are pruned.
 */
export function removeWorkflowJob(yaml: string, id: string): string {
	let lines = yaml.split('\n')
	const span = jobSpans(lines).find((s) => s.id === id)
	if (!span) return yaml
	let end = span.end
	while (end > span.start + 1 && isBlankOrComment(lines[end - 1])) end--
	const removed = withoutComments(lines.slice(span.start, end).join('\n'))
	lines.splice(span.start, end - span.start)
	// Don't leave a double blank where the job sat between two blank lines.
	if (lines[span.start - 1]?.trim() === '' && lines[span.start]?.trim() === '') {
		lines.splice(span.start, 1)
	}

	const named = (s: string) => unquote(s.trim()) === id
	// The block-form `needs:` we are inside, if any: its key's indent, its index
	// in `out`, and whether an item was dropped / kept — a key whose every item
	// named the job goes too, or Actions sees a bare `needs:` (#763).
	let block: { indent: number; at: number; dropped: boolean; kept: boolean } | null = null
	const out: string[] = []
	const closeBlock = () => {
		if (block?.dropped && !block.kept) out.splice(block.at, 1)
		block = null
	}
	for (const line of lines) {
		if (block && line.trim() !== '' && indentOf(line) <= block.indent) closeBlock()
		if (/^\s*needs:\s*$/.test(line)) {
			block = { indent: indentOf(line), at: out.length, dropped: false, kept: false }
		}
		const item = block ? /^\s*-\s*(\S+)\s*$/.exec(line) : null
		if (block && item) {
			if (named(item[1] ?? '')) {
				block.dropped = true
				continue
			}
			block.kept = true
		}
		const scalar = /^\s*needs:\s*([^\s[]\S*)\s*$/.exec(line)
		if (scalar && named(scalar[1] ?? '')) continue
		const flow = /^(\s*needs:\s*)\[(.*)\]\s*$/.exec(line)
		const all = flow ? (flow[2] ?? '').split(',').map((s) => s.trim()) : []
		const keep = all.filter((s) => !named(s))
		if (!flow || keep.length === all.length) out.push(line)
		else if (keep.length) out.push(`${flow[1]}[${keep.join(', ')}]`)
	}
	closeBlock()
	lines = out

	for (const event of ['workflow_dispatch', 'milestone']) {
		if (!removed.includes(event)) continue
		const rest = [...workflowJobs(lines.join('\n')).values()]
		if (rest.some((body) => withoutComments(body).includes(event))) continue
		lines = removeTrigger(lines, event)
	}
	return lines.join('\n')
}

/** Drops a block-form `on:` trigger and anything nested under it. */
function removeTrigger(lines: string[], event: string): string[] {
	const on = lines.findIndex((l) => /^['"]?on['"]?:\s*$/.test(l))
	if (on === -1) return lines
	for (let i = on + 1; i < lines.length; i++) {
		const l = lines[i] ?? ''
		if (!isBlankOrComment(l) && indentOf(l) === 0) break
		if (!new RegExp(`^\\s+${event}:`).test(l)) continue
		let j = i + 1
		while (j < lines.length && (lines[j]?.trim() === '' || indentOf(lines[j] ?? '') > indentOf(l)))
			j++
		// A blank line that separated the trigger block from what follows stays.
		while (j > i + 1 && lines[j - 1]?.trim() === '') j--
		return [...lines.slice(0, i), ...lines.slice(j)]
	}
	return lines
}

/**
 * The environment a job runs in, in either form Actions accepts: the scalar
 * `environment: release`, or a block whose `name:` names it. Null when the job
 * declares none.
 */
export function jobEnvironment(body: string): string | null {
	const inline = /^[ \t]*environment:[ \t]*(\S+)[ \t]*$/m.exec(body)
	if (inline?.[1]) return unquote(inline[1])
	const at = body.search(/^[ \t]*environment:[ \t]*$/m)
	if (at === -1) return null
	// Step names are list items (`- name:`), so the first bare `name:` after the
	// block opener is the environment's.
	const name = /^[ \t]*name:[ \t]*(\S+)/m.exec(body.slice(at))?.[1]
	return name ? unquote(name) : null
}

/**
 * A job body with whole-line comments dropped. Same reasoning as
 * `hookHasUncommented` in base/checks.ts: a `#` line runs nothing, so matching
 * it is a false positive. Observed on this repo's own ci.yml, where a `varcheck`
 * job carrying `# npm publish uses OIDC trusted publishing` was reported as the
 * publishing job. Comments are stripped rather than pattern-tested because
 * `jobEnvironment` needs the same treatment — a commented-out `environment:`
 * would otherwise read as a live gate, the exact inversion of this check.
 */
function withoutComments(body: string): string {
	return body
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('#'))
		.join('\n')
}

/**
 * The id of a publishing job a push can fire, or null (#740). A workflow on
 * `push` whose publishing job is not gated to `workflow_dispatch` / `milestone`
 * queues a release per merge, each stale once the next merge lands.
 *
 * ponytail: text heuristic over the job body, not an expression evaluator. A
 * gate spelled some other way reads as push-triggered; good enough for drift.
 */
export function pushReleaseJob(yaml: string): string | null {
	if (!/^[ \t]*push:/m.test(yaml)) return null
	for (const [job, raw] of workflowJobs(yaml)) {
		const body = withoutComments(raw)
		if (!PUBLISH_COMMAND.test(body)) continue
		const onDemand = /event_name == '(?:workflow_dispatch|milestone)'/.test(body)
		if (!onDemand || /event_name == 'push'/.test(body)) return job
	}
	return null
}

/**
 * The id of the first job that runs semantic-release, or null (#775). Only
 * such a job moves to release.yml: one publishing with `changesets/action` or
 * Release Please is the repo's own release flow, and is left where it is. A
 * `uses:` or `name:` that merely mentions it does not count.
 */
export function semanticReleaseJob(yaml: string): string | null {
	for (const [job, raw] of workflowJobs(yaml)) {
		const lines = withoutComments(raw).split('\n')
		if (lines.some((l) => !/^\s*(?:-\s+)?(?:uses|name):/.test(l) && /semantic-release/.test(l)))
			return job
	}
	return null
}

/** The line after the block that the key on `lines[at]` opens (its deeper-indented lines). */
function blockEnd(lines: string[], at: number): number {
	const indent = indentOf(lines[at] ?? '')
	let end = at + 1
	while (
		end < lines.length &&
		(isBlankOrComment(lines[end]) || indentOf(lines[end] ?? '') > indent)
	)
		end++
	// Blank and comment lines trailing the block introduce what follows.
	while (end > at + 1 && isBlankOrComment(lines[end - 1])) end--
	return end
}

/** The `[start, end)` of each list item under the `steps:` key on `lines[at]`. */
function stepRanges(lines: string[], at: number): [number, number][] {
	const end = blockEnd(lines, at)
	const first = lines.slice(at + 1, end).find((l) => !isBlankOrComment(l))
	if (first === undefined) return []
	const item = indentOf(first)
	const starts: number[] = []
	for (let i = at + 1; i < end; i++) {
		const l = lines[i] ?? ''
		if (indentOf(l) === item && l.trim().startsWith('-')) starts.push(i)
	}
	return starts.map((s, n) => {
		let e = starts[n + 1] ?? end
		while (e > s + 1 && isBlankOrComment(lines[e - 1])) e--
		return [s, e]
	})
}

/** A step's label: its `name:`, else its `uses:`, else the first line of its `run:`. */
function stepLabel(text: string): string {
	for (const key of ['name', 'uses', 'run']) {
		const v = new RegExp(`^\\s*(?:-\\s+)?${key}:[ \\t]*(.*)$`, 'm').exec(text)?.[1]?.trim()
		if (v && !/^[|>][-+]?$/.test(v)) return unquote(v)
	}
	return '(unnamed step)'
}

const DISPATCHED_REF =
	"${{ github.event_name == 'workflow_dispatch' && github.ref || github.event.repository.default_branch }}"

/** The template release job's grants, for a ci.yml that declares none at all. */
const DEFAULT_PERMISSIONS = ['contents: write', 'issues: write', 'pull-requests: write']

/**
 * `release.yml` holding job `id` of `ci` as is (#775) — its steps, names,
 * `env:`, `environment:`, comments and indent style — under the standard
 * release header, with only what cannot survive outside ci.yml rewritten:
 *
 * - its `needs:` and job-level `if:` go; the triggers replace both;
 * - an `actions/cache` step keyed on `needs.*` becomes a `pnpm install`;
 * - the checkout releases the dispatched branch's tip, with full history;
 * - it gets ci.yml's top-level `permissions:` when it has none, plus
 *   `id-token: write` for OIDC publishing.
 *
 * `needs` lists what still reads `needs.` afterwards — a step's label, or the
 * job id for a job-level key. Non-empty means the move cannot work.
 *
 * ponytail: line surgery like `removeWorkflowJob`, no YAML parser. A `read-all`
 * permissions scalar is kept as written, without `id-token: write`.
 */
export function migrateReleaseJob(
	ci: string,
	id: string
): { release: string; needs: string[] } | null {
	const all = ci.split('\n')
	const span = jobSpans(all).find((s) => s.id === id)
	if (!span) return null
	let end = span.end
	while (end > span.start + 1 && isBlankOrComment(all[end - 1])) end--
	const lines = all.slice(span.start, end)
	const keyIndent = indentOf(lines.slice(1).find((l) => !isBlankOrComment(l)) ?? '')
	const pad = (n: number) => ' '.repeat(n)
	const keyAt = (key: string) =>
		lines.findIndex((l, i) => i > 0 && indentOf(l) === keyIndent && l.trim().startsWith(`${key}:`))

	for (const key of ['needs', 'if']) {
		const at = keyAt(key)
		if (at !== -1) lines.splice(at, blockEnd(lines, at) - at)
	}

	if (keyAt('permissions') === -1) {
		const top = all.findIndex((l) => /^permissions:/.test(l))
		const block =
			top === -1
				? ['permissions:', ...DEFAULT_PERMISSIONS.map((p) => `  ${p}`)]
				: all.slice(top, blockEnd(all, top))
		const steps = keyAt('steps')
		lines.splice(
			steps === -1 ? lines.length : steps,
			0,
			...block.map((l) => (l.trim() ? pad(keyIndent) + l : l))
		)
	}
	const perm = keyAt('permissions')
	const inline = (lines[perm] ?? '').replace(/^\s*permissions:\s*/, '').trim()
	if (inline === '') {
		const permEnd = blockEnd(lines, perm)
		const child = lines.slice(perm + 1, permEnd).find((l) => !isBlankOrComment(l))
		const at = lines.findIndex((l, i) => i > perm && i < permEnd && /^\s*id-token:/.test(l))
		const line = `${pad(child ? indentOf(child) : keyIndent + 2)}id-token: write`
		if (at === -1) lines.splice(permEnd, 0, line)
		else lines[at] = line
	} else if (inline.startsWith('{')) {
		const flow = /id-token:/.test(inline)
			? inline.replace(/id-token:\s*\w+/, 'id-token: write')
			: inline.replace(/\s*\}$/, (_, i) => `${i > 1 ? ', ' : ' '}id-token: write }`)
		lines[perm] = `${pad(keyIndent)}permissions: ${flow}`
	}

	const steps = keyAt('steps')
	// Back to front, so a rewrite never shifts a range still to come.
	for (const [start, stop] of steps === -1 ? [] : stepRanges(lines, steps).reverse()) {
		const text = withoutComments(lines.slice(start, stop).join('\n'))
		const dash = /^\s*-\s+/.exec(lines[start] ?? '')?.[0] ?? `${pad(keyIndent + 2)}- `
		const inner = dash.length
		if (/uses:\s*['"]?actions\/cache(?:\/restore)?@/.test(text) && /needs\./.test(text)) {
			lines.splice(
				start,
				stop - start,
				`${dash}name: 📦 Install dependencies`,
				`${pad(inner)}run: pnpm install --frozen-lockfile`
			)
		} else if (/uses:\s*['"]?actions\/checkout@/.test(text)) {
			const w = lines.findIndex(
				(l, i) => i > start && i < stop && indentOf(l) === inner && /^with:\s*$/.test(l.trim())
			)
			if (w === -1) {
				lines.splice(
					stop,
					0,
					`${pad(inner)}with:`,
					`${pad(inner + 2)}ref: ${DISPATCHED_REF}`,
					`${pad(inner + 2)}fetch-depth: 0`
				)
				continue
			}
			const withEnd = blockEnd(lines, w)
			const child = lines.slice(w + 1, withEnd).find((l) => !isBlankOrComment(l))
			const c = child ? indentOf(child) : inner + 2
			const has = (key: string) =>
				lines.findIndex(
					(l, i) => i > w && i < withEnd && indentOf(l) === c && l.trim().startsWith(`${key}:`)
				)
			if (has('fetch-depth') === -1) lines.splice(withEnd, 0, `${pad(c)}fetch-depth: 0`)
			const ref = has('ref')
			if (ref === -1) lines.splice(w + 1, 0, `${pad(c)}ref: ${DISPATCHED_REF}`)
			else lines.splice(ref, blockEnd(lines, ref) - ref, `${pad(c)}ref: ${DISPATCHED_REF}`)
		}
	}

	const needs: string[] = []
	const ranges = steps === -1 ? [] : stepRanges(lines, keyAt('steps'))
	const inStep = (i: number) => ranges.some(([s, e]) => i >= s && i < e)
	if (/needs\./.test(withoutComments(lines.filter((_, i) => !inStep(i)).join('\n')))) {
		needs.push(id)
	}
	for (const [s, e] of ranges) {
		const text = withoutComments(lines.slice(s, e).join('\n'))
		if (/needs\./.test(text)) needs.push(stepLabel(text))
	}
	return { release: `${RELEASE_WORKFLOW_HEADER}${lines.join('\n')}\n`, needs }
}

/** The id of the first job in this workflow that publishes, or null. */
export function publishingJob(yaml: string): string | null {
	for (const [job, raw] of workflowJobs(yaml)) {
		if (PUBLISH_COMMAND.test(withoutComments(raw))) return job
	}
	return null
}

/** `private: true` — nothing reaches a registry, so no gate is owed. */
async function isPrivatePackage(dir: string): Promise<boolean> {
	try {
		const pkg = await fs.readJson(path.join(dir, 'package.json'))
		return pkg?.private === true
	} catch {
		return false
	}
}

interface PublishJob {
	file: string
	job: string
	/** The `environment:` the job declares, or null. */
	environment: string | null
	/** `secrets.NAME` the job references, GITHUB_TOKEN excluded. */
	secrets: string[]
}

/**
 * The first workflow job that runs a publish command, or null if none does.
 *
 * `'skip'` when the directory exists but can't be read — a permission error or a
 * broken symlink must not read as "nothing publishes", which would report the
 * gate as `ok` on a repo whose workflows were never inspected. Same shape as
 * `readEnvironments`: absent is an answer, unreadable is not.
 */
async function findPublishJob(dir: string): Promise<PublishJob | null | 'skip'> {
	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (!(await fs.pathExists(workflowsDir))) return null
	try {
		for (const f of (await fs.readdir(workflowsDir)).sort()) {
			if (!/\.ya?ml$/.test(f)) continue
			const content = await fs.readFile(path.join(workflowsDir, f), 'utf-8')
			if (!PUBLISH_COMMAND.test(content)) continue
			for (const [job, raw] of workflowJobs(content)) {
				const body = withoutComments(raw)
				if (PUBLISH_COMMAND.test(body)) {
					const secrets = new Set(
						[...body.matchAll(/secrets\.([A-Za-z_]\w*)/g)].map((m) => m[1] as string)
					)
					secrets.delete('GITHUB_TOKEN')
					return { file: f, job, environment: jobEnvironment(body), secrets: [...secrets] }
				}
			}
		}
	} catch {
		return 'skip'
	}
	return null
}

/** Environment name → whether it carries a `required_reviewers` protection rule. */
type Environments = Map<string, boolean>

async function readEnvironments(gh: GhExec, nwo: string): Promise<Environments | 'skip'> {
	const r = await gh(['api', `repos/${nwo}/environments`])
	// A repo with no environments can answer 404 — that's "none", not unreadable.
	if (!r.ok) return /404|not found/i.test(r.stderr) ? new Map() : 'skip'
	try {
		const parsed = JSON.parse(r.stdout) as {
			environments?: Array<{ name?: string; protection_rules?: Array<{ type?: string }> }>
		}
		const envs: Environments = new Map()
		for (const e of parsed.environments ?? []) {
			if (typeof e.name !== 'string') continue
			envs.set(
				e.name,
				(e.protection_rules ?? []).some((p) => p.type === 'required_reviewers')
			)
		}
		return envs
	} catch {
		return 'skip'
	}
}

/**
 * The gap between merging the default branch and publishing to npm (#429). On
 * the shipped semantic-release preset those are one event: nothing stands
 * between a squash-merge and a new version on the registry.
 *
 * Two checks, because they fail differently and want different answers:
 *
 * - **Release gate** — the publishing job runs behind no environment at all, or
 *   behind one that isn't really a gate (absent, or with no required reviewers).
 * - **Release environment** — the repo *has* a `release` environment and no job
 *   references it. That's the failure mode worth catching: an unreferenced
 *   environment gates nothing while reading as a gate in the GitHub UI.
 *
 * The two never both fire on one repo. "No `environment:` and no `release`
 * environment" is the gate check's; "no `environment:` but a `release`
 * environment exists" is the environment check's, and the gate check defers.
 *
 * A repo that publishes nothing is `ok` — not applicable, not drift. The fixer
 * is `fix release-environment` (`applyReleaseEnvironment` below), which uses
 * the authenticated user as the required reviewer.
 */
async function checkReleaseGate(
	gh: GhExec,
	nwo: string,
	dir: string
): Promise<[CheckResult, CheckResult, CheckResult]> {
	const publish = (await isPrivatePackage(dir)) ? null : await findPublishJob(dir)
	if (publish === 'skip') {
		const reason = 'could not read .github/workflows'
		return [
			skip(RELEASE_GATE_CHECK, reason),
			skip(RELEASE_ENV_CHECK, reason),
			skip(RELEASE_SECRETS_CHECK, reason),
		]
	}
	if (!publish) {
		const detail = 'not applicable — no workflow job publishes to a registry'
		return [
			{ check: RELEASE_GATE_CHECK, status: 'ok', detail },
			{ check: RELEASE_ENV_CHECK, status: 'ok', detail },
			{ check: RELEASE_SECRETS_CHECK, status: 'ok', detail },
		]
	}

	const secrets = await checkReleaseSecrets(gh, nwo, publish)
	const envs = await readEnvironments(gh, nwo)
	if (envs === 'skip') {
		const reason = 'could not read environments'
		return [skip(RELEASE_GATE_CHECK, reason), skip(RELEASE_ENV_CHECK, reason), secrets]
	}

	const named = publish.environment
	const where = `${publish.file} \`${publish.job}\``
	const hasRelease = envs.has(RELEASE_ENVIRONMENT)

	let gate: CheckResult
	if (named === null) {
		gate = hasRelease
			? {
					check: RELEASE_GATE_CHECK,
					status: 'ok',
					detail: `${where} declares no environment — reported by the ${RELEASE_ENV_CHECK} check`,
				}
			: {
					check: RELEASE_GATE_CHECK,
					status: 'drift',
					detail: `${where} publishes with no \`environment:\` and the repo has no \`${RELEASE_ENVIRONMENT}\` environment — anything that lands on the default branch publishes`,
					hint: GATE_HINT,
				}
	} else if (!envs.has(named)) {
		gate = {
			check: RELEASE_GATE_CHECK,
			status: 'drift',
			detail: `${where} names the \`${named}\` environment, which the repo does not have — Actions creates it unprotected on first run, so the publish is never held`,
			hint: GATE_HINT,
		}
	} else if (!envs.get(named)) {
		gate = {
			check: RELEASE_GATE_CHECK,
			status: 'drift',
			detail: `the \`${named}\` environment has no required_reviewers — ${where} passes straight through it`,
			hint: GATE_HINT,
		}
	} else {
		gate = {
			check: RELEASE_GATE_CHECK,
			status: 'ok',
			detail: `${where} runs behind the \`${named}\` environment (required reviewers)`,
		}
	}

	let environment: CheckResult
	if (!hasRelease) {
		environment = {
			check: RELEASE_ENV_CHECK,
			status: 'ok',
			detail: `no \`${RELEASE_ENVIRONMENT}\` environment — nothing to reference`,
		}
	} else if (named === RELEASE_ENVIRONMENT) {
		environment = {
			check: RELEASE_ENV_CHECK,
			status: 'ok',
			detail: `${where} references the \`${RELEASE_ENVIRONMENT}\` environment`,
		}
	} else {
		environment = {
			check: RELEASE_ENV_CHECK,
			status: 'drift',
			detail: named
				? `the repo has a \`${RELEASE_ENVIRONMENT}\` environment but ${where} runs in \`${named}\` — \`${RELEASE_ENVIRONMENT}\` gates nothing while still reading as a gate in the GitHub UI`
				: `the repo has a \`${RELEASE_ENVIRONMENT}\` environment but ${where} references no environment — it gates nothing while still reading as a gate in the GitHub UI`,
			hint: ENV_HINT,
		}
	}

	return [gate, environment, secrets]
}

/**
 * Secret names at one scope. Null when unreadable; `'not-found'` on a 404,
 * which only means "absent" once another call has proved admin access.
 */
async function readSecretNames(
	gh: GhExec,
	endpoint: string
): Promise<Set<string> | 'not-found' | null> {
	const r = await gh(['api', `${endpoint}?per_page=100`])
	if (!r.ok) return /404|not found/i.test(r.stderr) ? 'not-found' : null
	try {
		const d = JSON.parse(r.stdout) as { secrets?: Array<{ name?: string }> }
		return new Set((d.secrets ?? []).flatMap((s) => (s.name ? [s.name] : [])))
	} catch {
		return null
	}
}

/**
 * Secrets the publishing job reads belong on the `release` environment, not at
 * repo level (#754). A repo secret is readable by every job in every workflow,
 * so an admin PAT stored there walks around the required reviewer — the one
 * human-only step in a release.
 *
 * Listing secrets needs admin; without it the result is `optional-missing`,
 * which never moves the exit code, so CI's GITHUB_TOKEN can't fail on it. No
 * fixer: secret values can't be read back, so moving one is manual.
 */
async function checkReleaseSecrets(
	gh: GhExec,
	nwo: string,
	publish: PublishJob
): Promise<CheckResult> {
	const check = RELEASE_SECRETS_CHECK
	const where = `${publish.file} \`${publish.job}\``
	if (publish.secrets.length === 0) {
		return { check, status: 'ok', detail: `${where} references no secrets` }
	}
	const unverified: CheckResult = {
		check,
		status: 'optional-missing',
		detail: 'could not verify — listing secrets needs admin access',
	}
	// A non-admin can get a 404 here, so only a real listing proves access.
	const repo = await readSecretNames(gh, `repos/${nwo}/actions/secrets`)
	if (!(repo instanceof Set)) return unverified
	const listed = await readSecretNames(
		gh,
		`repos/${nwo}/environments/${RELEASE_ENVIRONMENT}/secrets`
	)
	if (listed === null) return unverified
	// Access is proved above, so a 404 means no `release` environment: holds nothing.
	const env = listed === 'not-found' ? new Set<string>() : listed

	const exposed = publish.secrets.filter((n) => repo.has(n) && !env.has(n))
	if (exposed.length === 0) {
		return {
			check,
			status: 'ok',
			detail: `no secret ${where} reads is a repo secret outside \`${RELEASE_ENVIRONMENT}\``,
		}
	}
	const names = exposed.join(', ')
	const commands = exposed
		.map((n) => `gh secret set ${n} --env ${RELEASE_ENVIRONMENT} && gh secret delete ${n}`)
		.join('; ')
	return {
		check,
		status: 'drift',
		detail: `${names} (read by ${where}) is a repo secret — every job in every workflow can read it, so the \`${RELEASE_ENVIRONMENT}\` environment's required reviewer does not guard it`,
		hint: `Move ${names} to the \`${RELEASE_ENVIRONMENT}\` environment by hand (secret values can't be read back): Settings → Environments → ${RELEASE_ENVIRONMENT} → Environment secrets → Add secret with the value, then delete it under Settings → Secrets and variables → Actions → Repository secrets. Or: ${commands}`,
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
	/** Dependabot vulnerability alerts off (#692). */
	alerts?: boolean
	/** Automated security fixes off (#692). */
	securityFixes?: boolean
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
	// naming the rule that was removed. Known downstream case: @rtorcato/repo-ai's
	// ai-loop pipeline works around it with approval labels precisely because of this.
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
	// Alerts first: GitHub refuses security fixes on a repo with alerts off.
	if (state.alerts)
		commands.push({
			label: 'vulnerability alerts',
			args: ['api', '-X', 'PUT', `repos/${state.nwo}/vulnerability-alerts`],
		})
	if (state.securityFixes)
		commands.push({
			label: 'automated security fixes',
			args: ['api', '-X', 'PUT', `repos/${state.nwo}/automated-security-fixes`],
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
	const sec = await readSecurityUpdates(gh, info.nwo)
	const commands = buildGhApplyCommands({
		nwo: info.nwo,
		branch: info.branch,
		merge: checkMergeSettings(info).status === 'drift',
		protection: bp.status === 'optional-missing' || bp.status === 'drift',
		workflow: wp.status === 'drift',
		alerts: !('skip' in sec) && !sec.alerts,
		securityFixes: !('skip' in sec) && !sec.fixes,
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
	// covers the default branch. Asked directly rather than via the check's
	// status, because that status is also `drift` when the gate is already
	// installed and merely collides with the release config (#419) — keying the
	// POST off it would file a duplicate ruleset.
	const codeql = await codeqlEnabled(gh, info.nwo, dir)
	const ruleset = codeql ? await hasCodeScanningRuleset(gh, info.nwo, info.branch) : 'skip'
	if (ruleset === 'no') {
		const label = `code-scanning ruleset on ${info.branch}`
		const r = await gh(
			['api', '-X', 'POST', `repos/${info.nwo}/rulesets`, '--input', '-'],
			CODE_SCANNING_RULESET_BODY
		)
		if (r.ok) applied.push(label)
		else
			console.error(chalk.yellow(`   could not apply ${label}: ${r.stderr.trim() || 'gh error'}`))
	}

	// #419: the gate is right and the release config is wrong, so say so instead
	// of quietly installing the half that breaks the next release. Warned on
	// `yes` too — that repo is already broken, it just hasn't released yet.
	if (ruleset !== 'skip' && (await releaseUsesGitPlugin(dir))) {
		console.error(
			chalk.yellow(
				`   warning: code-scanning is enforced on ${info.branch}, but the release config still uses \`@semantic-release/git\`.\n` +
					`   Its push to ${info.branch} will be rejected with GH013 and the release will fail silently.\n` +
					`   ${GIT_PLUGIN_REMEDY}.`
			)
		)
	}

	if (applied.length === 0) console.error(chalk.gray('   already configured — nothing to apply'))
	return applied
}

// --- Release environment scaffolding (#429) --------------------------------

/**
 * Insert `environment: <env>` as the first key of job `jobId`. Line-based, same
 * reasoning as `workflowJobs`: this package ships no YAML dependency, and jobs
 * sit one indent level under `jobs:` with their keys one level below. Returns
 * null when the job cannot be found. The caller only reaches this when
 * `jobEnvironment()` was null, so it never doubles an existing key.
 */
export function addJobEnvironment(yaml: string, jobId: string, env: string): string | null {
	const lines = yaml.split('\n')
	const start = lines.findIndex((l) => /^jobs:\s*$/.test(l))
	if (start === -1) return null
	const indentOf = (l: string) => l.length - l.trimStart().length

	// The job headers' indent — from the first real line after `jobs:`, exactly
	// as workflowJobs derives it, so the two agree on what counts as a header.
	let jobIndent = -1
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i] ?? ''
		if (line.trim() === '' || line.trimStart().startsWith('#')) continue
		if (indentOf(line) === 0) return null
		jobIndent = indentOf(line)
		break
	}
	if (jobIndent === -1) return null

	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i] ?? ''
		if (line.trim() === '' || line.trimStart().startsWith('#')) continue
		if (indentOf(line) === 0) return null // left the jobs block
		if (indentOf(line) !== jobIndent || !line.trim().startsWith(`${jobId}:`)) continue
		// Key indent = the job's first real line, so the insert matches whatever
		// indentation the file already uses.
		for (let j = i + 1; j < lines.length; j++) {
			const next = lines[j] ?? ''
			if (next.trim() === '' || next.trimStart().startsWith('#')) continue
			lines.splice(j, 0, `${' '.repeat(indentOf(next))}environment: ${env}`)
			return lines.join('\n')
		}
		return null
	}
	return null
}

/**
 * Scaffold the release environment gate — the fixer half of #429 (the checks
 * shipped with #449). Two writes, each skipped when already in place:
 *
 * 1. `PUT /repos/{nwo}/environments/release` with the **authenticated user** as
 *    the required reviewer. On a solo-maintained repo they are the only human
 *    there is; add or swap reviewers afterwards under Settings → Environments.
 *    An environment that already carries a `required_reviewers` rule is never
 *    touched — whoever set it up made a richer decision than this default.
 * 2. `environment: release` on the publishing job, so the merge leaves the run
 *    `waiting` instead of publishing.
 *
 * A job already behind some *other* environment is a warning, not a rename —
 * this fixer scaffolds the standard, it does not migrate a custom setup.
 */
export async function applyReleaseEnvironment(dir: string, exec?: GhExec): Promise<string[]> {
	if (!(await fs.pathExists(path.join(dir, '.git')))) {
		console.error(chalk.gray('   skipped — not a git repository'))
		return []
	}
	const gh: GhExec = exec ?? ((args, stdin) => realGhExec(args, stdin, dir))
	const probe = await probeRepo(gh)
	if ('skip' in probe) {
		console.error(chalk.gray(`   skipped — ${probe.skip}`))
		return []
	}
	const nwo = probe.info.nwo

	const publish = (await isPrivatePackage(dir)) ? null : await findPublishJob(dir)
	if (publish === 'skip') {
		console.error(chalk.yellow('   skipped — could not read .github/workflows'))
		return []
	}
	if (!publish) {
		console.error(chalk.gray('   skipped — no workflow job publishes to a registry'))
		return []
	}
	if (publish.environment !== null && publish.environment !== RELEASE_ENVIRONMENT) {
		console.error(
			chalk.yellow(
				`   skipped — ${publish.file} \`${publish.job}\` already runs behind \`${publish.environment}\`; not renaming it`
			)
		)
		return []
	}

	const envs = await readEnvironments(gh, nwo)
	if (envs === 'skip') {
		console.error(chalk.yellow('   skipped — could not read environments'))
		return []
	}

	const applied: string[] = []
	if (envs.get(RELEASE_ENVIRONMENT) !== true) {
		const user = await gh(['api', 'user', '--jq', '.id'])
		const id = user.ok ? Number.parseInt(user.stdout.trim(), 10) : Number.NaN
		if (Number.isNaN(id)) {
			console.error(
				chalk.yellow(
					`   could not resolve the authenticated user for required_reviewers: ${user.stderr.trim() || 'gh error'}`
				)
			)
			return applied
		}
		const label = `\`${RELEASE_ENVIRONMENT}\` environment with the authenticated user as required reviewer`
		const r = await gh(
			['api', '-X', 'PUT', `repos/${nwo}/environments/${RELEASE_ENVIRONMENT}`, '--input', '-'],
			JSON.stringify({ reviewers: [{ type: 'User', id }] })
		)
		if (r.ok) applied.push(label)
		else {
			console.error(chalk.yellow(`   could not apply ${label}: ${r.stderr.trim() || 'gh error'}`))
			return applied
		}
	}

	if (publish.environment === null) {
		const file = path.join(dir, '.github', 'workflows', publish.file)
		const updated = addJobEnvironment(
			await fs.readFile(file, 'utf-8'),
			publish.job,
			RELEASE_ENVIRONMENT
		)
		if (updated === null) {
			console.error(
				chalk.yellow(
					`   could not add \`environment:\` to ${publish.file} \`${publish.job}\` — add it by hand`
				)
			)
		} else {
			await fs.writeFile(file, updated)
			applied.push(`environment: ${RELEASE_ENVIRONMENT} on ${publish.file} \`${publish.job}\``)
		}
	}

	if (applied.length === 0) console.error(chalk.gray('   already configured — nothing to apply'))
	return applied
}
