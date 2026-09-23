import path from 'node:path'
import chalk from 'chalk'
import { type GitExec, realGitExec } from '../../base/git-identity.js'
import { type GhExec, realGhExec, releaseGated } from '../../base/github-settings.js'
import { type CleanupEntry, runLoopCleanup } from './loop-cleanup.js'
import { type LoopEnv, resolveLoopEnv } from './loop-env.js'
import { type InstallExec, type RebuildOutcome, runLoopGuard } from './loop-guard.js'
import { runLoopVerdict, type Verdict } from './loop-marker.js'
import { labelApplications, MAX_APPLICATIONS, type ReapEntry, runLoopReap } from './loop-reap.js'

/**
 * `repo-tooling loop tick` — one ai-issue-loop tick's mechanics as one work
 * list (#620). It composes `loop env`, `loop guard`, `loop cleanup`,
 * `loop reap` and `loop verdict` with the Pass 1 merge-state and CI reads, the
 * Pass 0 PR-adoption query, the Pass 2 `ai-suggested` decay and the Pass 4
 * eligibility query, and says what to do. The skill applies it: every label,
 * assignee, comment, merge and agent spawn stays the agent's call.
 *
 * It writes no GitHub state. Its only local writes are the ones the helpers it
 * composes already make — `loop guard`'s bare repair and gated `node_modules`
 * rebuild, and `loop cleanup`'s removal of worktrees whose PR landed or closed.
 *
 * Exit non-zero only to halt the tick: `loop guard`'s own code (`1`/`2`), or `1`
 * when the checkout or its GitHub repo cannot be resolved. A failed gh read is
 * not a halt — the lists it feeds are left empty, it lands in `errors`, and the
 * summary leads with `⚠error`.
 */

/** Issues in flight at once. */
export const MAX_IN_FLIGHT = 6
/** `ai-suggested` issues untouched this long are closed. */
export const DECAY_DAYS = 30

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
/** Merge states that name something to fix; any other non-CLEAN state waits. */
const SEND_BACK_STATES = new Set(['BEHIND', 'DIRTY', 'BLOCKED'])

type Arm = 'code' | 'sec'
const ARMS: Arm[] = ['code', 'sec']

export interface Handoff {
	pr: number
	issue: number | null
	notes: boolean
	/** The gated-repo arm: both reviews passed, no `ai-notes`, CLEAN, and `release` gates the publish. */
	autoMerge: boolean
}

export interface SendBack {
	pr: number
	issue: number | null
	/** `ci-red`, or the `mergeStateStatus` that blocks the handoff. */
	reason: 'ci-red' | 'BEHIND' | 'DIRTY' | 'BLOCKED'
	/** Failing required checks, for the comment. */
	failing: { name: string; link: string }[]
}

export interface FixRound {
	pr: number
	issue: number | null
	worktree: string | null
	/** `ai-changes` applications so far. */
	applications: number
	/** `block` at the round cap, or when there is no worktree to fix in. */
	action: 'spawn' | 'block'
	reason: string
}

export interface LoopTickResult {
	env: LoopEnv
	/** Why the tick must stop, or null. Nothing below is populated when set. */
	halt: string | null
	idle: boolean
	releaseGated: boolean
	/** Pass 0 — agent-opened PRs with no loop label: add `ai-review`. */
	adopt: number[]
	/** Pass 1 — auto-merge armed before both reviews passed: disarm first. */
	disarm: number[]
	handoffs: Handoff[]
	sendBacks: SendBack[]
	/** Pass 1 — `merge-ready` that no longer holds (not CLEAN, or `ai-changes`). */
	stripMergeReady: number[]
	/** Pass 1 — flag only, never send back. */
	dependabotCiRed: number[]
	/** Pass 1 — legacy: assign the human. */
	dependabotChanges: number[]
	/** Pass 2 — worktrees removed; relabel each `issue`. */
	cleaned: CleanupEntry[]
	/** Pass 2 — `loop reap`'s verdicts, to apply. */
	stalled: ReapEntry[]
	/** Pass 2 — `ai-suggested` issues to close. */
	decay: number[]
	/** Pass 3 — a posted verdict to adopt instead of re-spawning. */
	verdicts: { pr: number; arm: Arm; verdict: Verdict }[]
	reviewsToSpawn: { pr: number; issue: number | null; arm: Arm }[]
	fixRounds: FixRound[]
	/** Pass 4 — free slots, and every eligible issue in queue order. */
	slots: number
	pickups: { number: number; title: string; body: string }[]
	rebuild: RebuildOutcome
	summary: string
	errors: string[]
	exitCode: 0 | 1 | 2
}

export interface LoopTickOptions {
	root?: string
	json?: boolean
	/** Test seams. */
	git?: GitExec
	gh?: GhExec
	install?: InstallExec
	env?: NodeJS.ProcessEnv
	now?: Date
}

interface Pr {
	number: number
	headRefName: string
	labels: { name: string }[]
	autoMergeRequest: unknown
	author: { login: string } | null
	body: string | null
	statusCheckRollup?: { conclusion?: string | null }[] | null
}

interface RestIssue {
	number: number
	title: string
	body: string | null
	pull_request?: unknown
	labels: { name: string }[]
	author_association: string
}

const issueOf = (head: string) => Number(head.match(/^(?:worktree-)?ai-(\d+)-/)?.[1]) || null

function empty(env: LoopEnv): LoopTickResult {
	return {
		env,
		halt: null,
		idle: false,
		releaseGated: false,
		adopt: [],
		disarm: [],
		handoffs: [],
		sendBacks: [],
		stripMergeReady: [],
		dependabotCiRed: [],
		dependabotChanges: [],
		cleaned: [],
		stalled: [],
		decay: [],
		verdicts: [],
		reviewsToSpawn: [],
		fixRounds: [],
		slots: 0,
		pickups: [],
		rebuild: 'not-requested',
		summary: '',
		errors: [],
		exitCode: 0,
	}
}

export async function runLoopTick(options: LoopTickOptions = {}): Promise<LoopTickResult> {
	const dir = path.resolve(options.root ?? process.cwd())
	const env = await resolveLoopEnv({ dir, git: options.git, gh: options.gh, env: options.env })
	const result = empty(env)
	if (!env.root || !env.ownerRepo) {
		result.halt = env.warnings.join('; ') || 'could not resolve the checkout'
		result.exitCode = 1
		return result
	}
	const { root, ownerRepo } = env
	const git: GitExec = options.git ?? ((args) => realGitExec(args, root, 120_000))
	const gh: GhExec = options.gh ?? ((args, stdin) => realGhExec(args, stdin, root))
	const now = (options.now ?? new Date()).getTime()
	const errors = result.errors
	const seams = { root, git: options.git, gh: options.gh }

	const guard = await runLoopGuard({ ...seams, install: options.install })
	if (guard.exitCode !== 0) {
		result.halt = guard.messages.filter((m) => m.startsWith('⚠')).join('; ') || 'loop guard failed'
		result.exitCode = guard.exitCode
		return result
	}

	// Best-effort: Pass 4 branches worktrees off origin/main.
	await git(['fetch', '--prune', 'origin'])

	const cleanup = await runLoopCleanup(seams)
	result.cleaned = cleanup.worktrees.filter((w) => w.action === 'removed')
	for (const w of cleanup.worktrees.filter((w) => w.action === 'remove-failed'))
		errors.push(`could not remove ${w.path}`)
	let live = guard.live
	if (cleanup.removed) {
		const again = await runLoopGuard({ ...seams, install: options.install, removed: true })
		if (again.exitCode !== 0) {
			result.halt =
				again.messages.filter((m) => m.startsWith('⚠')).join('; ') || 'loop guard failed'
			result.exitCode = again.exitCode
			return result
		}
		result.rebuild = again.rebuild
		live = again.live
	}

	const reap = await runLoopReap({ root, gh: options.gh, now: options.now })
	result.stalled = reap.stalled
	errors.push(...reap.errors)

	const json = async <T>(args: string[]): Promise<T | null> => {
		const r = await gh(args)
		if (r.ok) {
			try {
				return JSON.parse(r.stdout || 'null') as T
			} catch {}
		}
		errors.push(`gh ${args.slice(0, 3).join(' ')} failed: ${r.stderr.trim()}`)
		return null
	}

	const prs = await json<Pr[]>([
		'pr',
		'list',
		'--state',
		'open',
		'--limit',
		'100',
		'--json',
		'number,headRefName,labels,autoMergeRequest,author,body,statusCheckRollup',
	])
	const wip = await json<{ number: number }[]>([
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
	result.releaseGated = await releaseGated(gh, ownerRepo, root)

	for (const pr of prs ?? []) {
		const labels = new Set(pr.labels.map((l) => l.name))
		const has = (l: string) => labels.has(l)
		const issue = issueOf(pr.headRefName)

		if (pr.headRefName.startsWith('dependabot/')) {
			const red = (pr.statusCheckRollup ?? []).some((c) => c.conclusion === 'FAILURE')
			if (pr.autoMergeRequest && red) result.dependabotCiRed.push(pr.number)
			if (has('ai-changes')) result.dependabotChanges.push(pr.number)
			continue
		}

		const loopPr = has('merge-ready') || [...labels].some((l) => l.startsWith('ai-'))
		if (!loopPr) {
			// The 🤖 header is the discriminator: every agent is the owner's login.
			const mine = pr.author?.login.toLowerCase() === env.me.toLowerCase()
			if (env.me && mine && (pr.body ?? '').startsWith('🤖 ')) result.adopt.push(pr.number)
			continue
		}

		const passed = (has('ai-ok-code') && has('ai-ok-sec')) || has('merge-ready')
		if (pr.autoMergeRequest && !passed) result.disarm.push(pr.number)
		const claimed = has('ai-reviewing-code') || has('ai-reviewing-sec')

		// CI red is a send-back, except mid-review or when one is already out.
		if (!claimed && !has('ai-changes')) {
			const r = await gh([
				'pr',
				'checks',
				String(pr.number),
				'--required',
				'--json',
				'name,state,link',
			])
			// Exits non-zero whenever a check fails or is pending; stdout is still the answer.
			let checks: { name: string; state: string; link: string }[] = []
			try {
				checks = JSON.parse(r.stdout || '[]')
			} catch {}
			const failing = checks
				.filter((c) => c.state === 'FAILURE')
				.map(({ name, link }) => ({ name, link }))
			if (failing.length > 0) {
				result.sendBacks.push({ pr: pr.number, issue, reason: 'ci-red', failing })
				continue
			}
		}

		if (has('ai-changes')) {
			if (has('merge-ready')) result.stripMergeReady.push(pr.number)
		} else if (passed) {
			const view = await json<{ mergeStateStatus: string }>([
				'pr',
				'view',
				String(pr.number),
				'--json',
				'mergeStateStatus',
			])
			const s = view?.mergeStateStatus ?? 'UNKNOWN'
			if (s === 'CLEAN') {
				const notes = has('ai-notes')
				result.handoffs.push({
					pr: pr.number,
					issue,
					notes,
					autoMerge: result.releaseGated && !notes,
				})
			} else if (SEND_BACK_STATES.has(s)) {
				result.sendBacks.push({
					pr: pr.number,
					issue,
					reason: s as SendBack['reason'],
					failing: [],
				})
			} else if (s !== 'UNKNOWN' && has('merge-ready')) {
				result.stripMergeReady.push(pr.number)
			}
			continue
		}

		if (has('ai-review') && !has('ai-changes')) {
			const spawn: Arm[] = []
			let changes = false
			for (const arm of ARMS) {
				if (has(`ai-ok-${arm}`) || has(`ai-reviewing-${arm}`)) continue
				const v = await runLoopVerdict(pr.number, { dir: root, arm, gh: options.gh })
				if (v.error) errors.push(`verdict ${arm} on #${pr.number}: ${v.error}`)
				else if (v.verdict) {
					result.verdicts.push({ pr: pr.number, arm, verdict: v.verdict })
					changes ||= v.verdict === 'CHANGES'
				} else spawn.push(arm)
			}
			// A CHANGES about to be applied sends the PR back; a review now is wasted.
			if (!changes)
				for (const arm of spawn) result.reviewsToSpawn.push({ pr: pr.number, issue, arm })
		}

		if (has('ai-changes') && !has('ai-fixing')) {
			const times = await labelApplications(gh, pr.number, 'ai-changes')
			if (typeof times === 'string') {
				errors.push(times)
				continue
			}
			const slug = pr.headRefName.replace(/^worktree-/, '')
			const worktree = live.find((d) => path.basename(d) === slug) ?? null
			const atCap = times.length >= MAX_APPLICATIONS
			result.fixRounds.push({
				pr: pr.number,
				issue,
				worktree,
				applications: times.length,
				action: atCap || !worktree ? 'block' : 'spawn',
				reason: atCap
					? `ai-changes applied ${times.length}× — round cap reached`
					: worktree
						? `round ${times.length}`
						: 'no worktree to fix in',
			})
		}
	}

	const suggested = await json<{ number: number; updatedAt: string; labels: { name: string }[] }[]>(
		[
			'issue',
			'list',
			'--label',
			'ai-suggested',
			'--state',
			'open',
			'--limit',
			'100',
			'--json',
			'number,updatedAt,labels',
		]
	)
	const cutoff = now - DECAY_DAYS * 86_400_000
	result.decay = (suggested ?? [])
		// A promoted suggestion keeps its label; closing a queued one is unrecoverable.
		.filter((i) => !i.labels.some((l) => ['ai-ready', 'ai-wip', 'holding'].includes(l.name)))
		.filter((i) => Date.parse(i.updatedAt) < cutoff)
		.map((i) => i.number)

	// ponytail: first 100 ai-ready issues; paginate if a queue ever outgrows that.
	const queue = await json<RestIssue[]>([
		'api',
		`repos/${ownerRepo}/issues?labels=ai-ready&state=open&per_page=100`,
	])
	result.pickups = (queue ?? [])
		.filter((i) => !i.pull_request)
		.filter((i) => !i.labels.some((l) => ['ai-wip', 'ai-blocked', 'holding'].includes(l.name)))
		// The label is the hard gate; association is the backstop.
		.filter((i) => TRUSTED.has(i.author_association))
		.map(({ number, title, body }) => ({ number, title, body: body ?? '' }))

	// Slots count what is still in flight once this tick's cleanup and reaping land.
	const freed = new Set([
		...result.cleaned.map((w) => w.issue),
		...result.stalled.filter((s) => s.kind === 'implementer').map((s) => s.issue),
	])
	const inFlight = (wip ?? []).filter((i) => !freed.has(i.number)).length
	result.slots = wip ? Math.max(0, MAX_IN_FLIGHT - inFlight) : 0

	const loopPrs = (prs ?? []).filter(
		(p) =>
			!p.headRefName.startsWith('dependabot/') &&
			p.labels.some((l) => l.name === 'merge-ready' || l.name.startsWith('ai-'))
	)
	result.idle =
		errors.length === 0 &&
		loopPrs.length === 0 &&
		live.length === 0 &&
		[result.adopt, result.pickups, result.stalled, result.decay, result.dependabotCiRed].every(
			(l) => l.length === 0
		)
	result.summary = summarize(result, inFlight, loopPrs.length)
	return result
}

/** `⚠` segments first, so a truncated phone banner still leads with the stall. */
export function summarize(r: LoopTickResult, inFlight: number, loopPrs: number): string {
	if (r.idle) return 'idle'
	const blocked =
		r.stalled.filter((s) => s.action === 'block').length +
		r.fixRounds.filter((f) => f.action === 'block').length
	const ciRed = r.sendBacks.filter((s) => s.reason === 'ci-red').length + r.dependabotCiRed.length
	const wip = inFlight + Math.min(r.slots, r.pickups.length)
	const ready = r.handoffs.length
	const segments: [number | boolean, string][] = [
		[r.errors.length > 0, '⚠error'],
		[blocked, `⚠${blocked}blocked`],
		[ciRed, `⚠${ciRed}ci-red`],
		[r.rebuild === 'deferred' || r.rebuild === 'rebuild-failed', '⚠rebuild'],
		[wip, `${wip}wip`],
		[loopPrs - ready, `${loopPrs - ready}rev`],
		[ready, `${ready}ready`],
	]
	return (
		segments
			.filter(([n]) => n)
			.map(([, s]) => s)
			.join('·') || 'idle'
	)
}

export async function loopTickCommand(options: { root?: string; json?: boolean }): Promise<void> {
	const result = await runLoopTick(options)
	if (options.json) {
		console.log(JSON.stringify(result, null, 2))
	} else if (result.halt) {
		console.error(chalk.red(`✖ halt: ${result.halt}`))
	} else {
		console.log(result.summary)
		for (const e of result.errors) console.log(`  ${chalk.yellow(e)}`)
	}
	process.exitCode = result.exitCode
}
