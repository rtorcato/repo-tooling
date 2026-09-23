import path from 'node:path'
import chalk from 'chalk'
import { type GhExec, realGhExec } from '../../base/github-settings.js'
import { defaultWorktreeRoot, findLive } from './loop-guard.js'

/**
 * `repo-tooling loop reap` — the ai-issue-loop skill's Pass 2 stalled-agent
 * table, moved out of prose (#618). Nothing can time out an agent, so a label
 * that sat `STALE_MINUTES` past its last application (per the timeline) marks
 * a dead one:
 *
 * - **implementer** — issue `ai-wip`, no PR for `ai-<N>-*` → `block`.
 * - **reviewer** — PR `ai-reviewing-code|sec` with no matching `ai-ok-*` and
 *   no `ai-changes` → `drop-label` that claim, or `block` at ≥3 applications.
 * - **fixer** — PR `ai-fixing` still `ai-changes` → `drop-label`, or `block`.
 * - **orphan** — `ai-<N>-*` worktree whose issue is not `ai-wip` and has no
 *   open PR → `remove-worktree`.
 *
 * Read-only: it reports verdicts, the skill applies them — the label, assign
 * and comment of an `ai-blocked`, and the call on whether a stall was benign.
 * Exit `1` when a gh query failed, so the report is incomplete.
 */

/** Three ticks. Generous: a live agent must never be reaped out from under itself. */
export const STALE_MINUTES = 45
/** A claim applied this many times is not one more spawn away from working. */
export const MAX_APPLICATIONS = 3

export type StallKind = 'implementer' | 'reviewer' | 'fixer' | 'orphan'
export type ReapAction = 'block' | 'drop-label' | 'remove-worktree'

export interface ReapEntry {
	kind: StallKind
	issue: number | null
	pr: number | null
	/** The label that stalled; `null` for an orphan worktree. */
	label: string | null
	/** Minutes since `label` was last applied. */
	minutes: number | null
	/** How many times `label` has been applied. */
	applications: number | null
	action: ReapAction
	/** Worktree to remove, if any. */
	worktree: string | null
	reason: string
}

export interface LoopReapResult {
	root: string
	worktreeRoot: string
	staleMinutes: number
	stalled: ReapEntry[]
	errors: string[]
	exitCode: 0 | 1
}

export interface LoopReapOptions {
	root?: string
	worktreeRoot?: string
	json?: boolean
	/** Test seams. */
	gh?: GhExec
	now?: Date
}

interface Pr {
	number: number
	state: string
	headRefName: string
	labels: { name: string }[]
}

// ponytail: newest 200 PRs; an ai-wip issue's PR older than that reads as "no PR".
const PR_WINDOW = 200

/** `ai-<N>-slug`, or the legacy `worktree-ai-<N>-slug`. */
const issueOf = (name: string) => Number(name.match(/^(?:worktree-)?ai-(\d+)-/)?.[1]) || null

const REVIEW_CLAIMS: Record<string, string> = {
	'ai-reviewing-code': 'ai-ok-code',
	'ai-reviewing-sec': 'ai-ok-sec',
}

export async function runLoopReap(options: LoopReapOptions = {}): Promise<LoopReapResult> {
	const root = path.resolve(options.root ?? process.cwd())
	const worktreeRoot = options.worktreeRoot
		? path.resolve(options.worktreeRoot)
		: defaultWorktreeRoot(root)
	const gh: GhExec = options.gh ?? ((args, stdin) => realGhExec(args, stdin, root))
	const now = (options.now ?? new Date()).getTime()
	const errors: string[] = []
	const stalled: ReapEntry[] = []

	const list = async <T>(args: string[]): Promise<T[] | null> => {
		const r = await gh(args)
		if (!r.ok) {
			errors.push(`gh ${args.slice(0, 2).join(' ')} failed: ${r.stderr.trim()}`)
			return null
		}
		return JSON.parse(r.stdout || '[]') as T[]
	}

	/** Every application of `label` on issue/PR `n`, oldest first. */
	const applications = async (n: number, label: string): Promise<number[] | null> => {
		const r = await gh([
			'api',
			`repos/{owner}/{repo}/issues/${n}/timeline`,
			'--paginate',
			'--jq',
			'.[] | select(.event=="labeled") | [.label.name, .created_at] | @tsv',
		])
		if (!r.ok) {
			errors.push(`timeline for #${n} failed: ${r.stderr.trim()}`)
			return null
		}
		return r.stdout
			.split('\n')
			.map((line) => line.split('\t'))
			.filter(([name]) => name === label)
			.map(([, at]) => Date.parse(at as string))
			.sort((a, b) => a - b)
	}

	/** Age and count of `label` on `n`, or null when it is not stale yet (or unknown). */
	const stale = async (n: number, label: string) => {
		const times = await applications(n, label)
		const last = times?.at(-1)
		if (last === undefined) return null
		const minutes = Math.floor((now - last) / 60_000)
		return minutes >= STALE_MINUTES ? { minutes, applications: times?.length ?? 0 } : null
	}

	const wip = await list<{ number: number }>([
		'issue',
		'list',
		'--label',
		'ai-wip',
		'--state',
		'open',
		'--limit',
		'100',
		'--json',
		'number',
	])
	const prs = await list<Pr>([
		'pr',
		'list',
		'--state',
		'all',
		'--limit',
		String(PR_WINDOW),
		'--json',
		'number,state,headRefName,labels',
	])
	const dirs = await findLive([worktreeRoot, path.join(root, '.claude', 'worktrees')])
	const worktreeOf = (issue: number) =>
		dirs.find((d) => issueOf(path.basename(d)) === issue) ?? null

	// Without both lists a "no PR" or "not ai-wip" verdict would be a guess.
	if (wip && prs) {
		const wipSet = new Set(wip.map((i) => i.number))
		const prIssues = (state?: string) =>
			new Set(prs.filter((p) => !state || p.state === state).map((p) => issueOf(p.headRefName)))
		const anyPr = prIssues()
		const openPr = prIssues('OPEN')

		for (const issue of wipSet) {
			if (anyPr.has(issue)) continue
			const s = await stale(issue, 'ai-wip')
			if (!s) continue
			stalled.push({
				kind: 'implementer',
				issue,
				pr: null,
				label: 'ai-wip',
				...s,
				action: 'block',
				worktree: worktreeOf(issue),
				reason: `ai-wip for ${s.minutes}min and no PR`,
			})
		}

		for (const pr of prs.filter((p) => p.state === 'OPEN')) {
			const labels = new Set(pr.labels.map((l) => l.name))
			const issue = issueOf(pr.headRefName)
			const claims: { kind: StallKind; claim: string }[] = Object.entries(REVIEW_CLAIMS)
				.filter(([claim, ok]) => labels.has(claim) && !labels.has(ok) && !labels.has('ai-changes'))
				.map(([claim]) => ({ kind: 'reviewer', claim }))
			if (labels.has('ai-fixing') && labels.has('ai-changes'))
				claims.push({ kind: 'fixer', claim: 'ai-fixing' })
			for (const { kind, claim } of claims) {
				const s = await stale(pr.number, claim)
				if (!s) continue
				const block = s.applications >= MAX_APPLICATIONS
				stalled.push({
					kind,
					issue,
					pr: pr.number,
					label: claim,
					...s,
					action: block ? 'block' : 'drop-label',
					worktree: null,
					reason: `${claim} for ${s.minutes}min, applied ${s.applications}×`,
				})
			}
		}

		for (const dir of dirs) {
			const issue = issueOf(path.basename(dir))
			if (issue === null || wipSet.has(issue) || openPr.has(issue)) continue
			stalled.push({
				kind: 'orphan',
				issue,
				pr: null,
				label: null,
				minutes: null,
				applications: null,
				action: 'remove-worktree',
				worktree: dir,
				reason: 'issue not ai-wip and no open PR',
			})
		}
	}

	return {
		root,
		worktreeRoot,
		staleMinutes: STALE_MINUTES,
		stalled,
		errors,
		exitCode: errors.length > 0 ? 1 : 0,
	}
}

export async function loopReapCommand(options: {
	root?: string
	worktreeRoot?: string
	json?: boolean
}): Promise<void> {
	const result = await runLoopReap(options)
	if (options.json) {
		console.log(JSON.stringify(result, null, 2))
	} else {
		console.log()
		if (result.stalled.length === 0) console.log(chalk.gray('  nothing stalled'))
		for (const s of result.stalled) {
			const target = s.pr ? `PR #${s.pr}` : `#${s.issue}`
			console.log(`  ${chalk.yellow(s.action.padEnd(15))} ${target} (${s.kind}) — ${s.reason}`)
		}
		for (const e of result.errors) console.log(`  ${chalk.red(e)}`)
		console.log()
	}
	process.exitCode = result.exitCode
}
