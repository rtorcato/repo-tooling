import path from 'node:path'
import chalk from 'chalk'
import fs from 'fs-extra'
import { FixerAbort } from './fixers.js'
import { type GhExec, realGhExec } from './github-settings.js'
import type { CheckResult } from './types.js'

/**
 * Milestone hygiene (#397). `doctor` already audits GitHub-side state, and an
 * open milestone at 100% is the same class of drift: "open" stops meaning "in
 * flight", so the milestone list carries no signal.
 *
 * Milestones are the release unit (#741): one open milestone is what ships
 * next. `fix milestones` opens a rolling "next" milestone when none is open, and
 * the release-hygiene warnings below ride in `detail` — they never fail the run.
 * Milestones stay optional: a repo without any is `optional-missing`, which a
 * bulk `fix` skips.
 *
 * Where a workflow runs on the `milestone` event (the preset's release.yml),
 * closing one publishes (#833). There a finished, still-open milestone is the
 * intended "ready, waiting for the owner" state: `doctor` reports it ok, and
 * `fix milestones` refuses to close it.
 *
 * On the same `gh` seam as github-settings.ts. No repo probe is needed — `gh`
 * expands `{owner}/{repo}` from the remote itself.
 */

export const MILESTONES_CHECK = 'Milestones'
const CHECK = MILESTONES_CHECK

/** The title `fix` gives the rolling milestone it opens. */
export const NEXT_MILESTONE = 'next'

interface Milestone {
	number: number
	title: string
	state: string
	open_issues: number
	closed_issues: number
	due_on?: string | null
}

interface Issue {
	number: number
	title: string
	pull_request?: unknown
}

/** Chores, deps and docs ship with whatever comes next; only feat/fix want a milestone. */
const FEAT_OR_FIX = /^(feat|fix)(\([^)]*\))?!?:/i

/**
 * A milestone with no completion criterion can never close, so it is
 * structurally a label. Warned about, never fixed — the call is the
 * maintainer's.
 */
const CATCH_ALL_TITLE = /backlog|post-\d|someday/i

const skip = (reason: string): CheckResult => ({
	check: CHECK,
	status: 'ok',
	detail: `skipped — ${reason}`,
})

const NEXT_HINT = `Run \`npx @rtorcato/repo-tooling fix milestones\` to open a rolling "${NEXT_MILESTONE}" milestone`

/**
 * Any `on:` spelling that names the milestone event: block (`  milestone:`),
 * block list (`  - milestone`) or inline (`on: [push, milestone]`).
 *
 * ponytail: line regex, no YAML parser, and any milestone trigger counts, even
 * `types: [created]`. That fails closed: the worst case is a milestone left
 * open for the owner to close by hand.
 */
const MILESTONE_TRIGGER =
	/^[ \t]+milestone:|^[ \t]+-[ \t]*milestone[ \t]*$|^['"]?on['"]?:.*\bmilestone\b/m

/** The first workflow that runs on a milestone event, so closing one may publish; null if none. */
export async function milestoneReleaseWorkflow(dir: string): Promise<string | null> {
	const wfDir = path.join(dir, '.github', 'workflows')
	const files = (await fs.pathExists(wfDir)) ? (await fs.readdir(wfDir)).sort() : []
	for (const f of files) {
		if (!/\.ya?ml$/.test(f)) continue
		const live = (await fs.readFile(path.join(wfDir, f), 'utf8'))
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('#'))
			.join('\n')
		if (MILESTONE_TRIGGER.test(live)) return `.github/workflows/${f}`
	}
	return null
}

const titles = (ms: Milestone[]) => ms.map((m) => `"${m.title}"`).join(', ')

async function readMilestones(gh: GhExec): Promise<Milestone[] | null> {
	// `-X GET` is load-bearing: `-f`/`-F` without an explicit method make `gh`
	// switch to POST, which would hit the *create* milestone endpoint. With it,
	// the fields land in the query string and the path keeps gh's
	// {owner}/{repo} placeholders intact.
	return readList<Milestone>(gh, [
		'api',
		'-X',
		'GET',
		'repos/{owner}/{repo}/milestones',
		'-f',
		'state=all',
		'-F',
		'per_page=100',
	])
}

// ponytail: first page only (100). A repo with more unmilestoned issues than
// that has bigger problems than an undercount; paginate if one shows up.
async function readUnmilestonedIssues(gh: GhExec): Promise<Issue[] | null> {
	return readList<Issue>(gh, [
		'api',
		'-X',
		'GET',
		'repos/{owner}/{repo}/issues',
		'-f',
		'state=open',
		'-f',
		'milestone=none',
		'-F',
		'per_page=100',
	])
}

async function readList<T>(gh: GhExec, args: string[]): Promise<T[] | null> {
	const r = await gh(args)
	if (!r.ok) return null
	try {
		const parsed = JSON.parse(r.stdout)
		return Array.isArray(parsed) ? parsed : null
	} catch {
		return null
	}
}

function classify(milestones: Milestone[]) {
	const open = milestones.filter((m) => m.state === 'open')
	return {
		// The number guard is the injection boundary: it is interpolated into the
		// PATCH path by the fixer below.
		complete: open.filter(
			(m) => m.open_issues === 0 && m.closed_issues > 0 && Number.isInteger(m.number)
		),
		// GitHub renders the bar as closed/total, so an empty milestone is a
		// permanent 0% that can never move. The sole open milestone is exempt: that
		// is the rolling "next" one, waiting for its first issue.
		empty: open.length > 1 ? open.filter((m) => m.open_issues === 0 && m.closed_issues === 0) : [],
		catchAll: open.filter((m) => CATCH_ALL_TITLE.test(m.title)),
	}
}

/**
 * Release-hygiene warnings (#741). Notes in `detail`, never drift: each is a
 * planning call `fix` cannot make.
 */
function releaseWarnings(milestones: Milestone[], unmilestoned: Issue[], now: number): string[] {
	const open = milestones.filter((m) => m.state === 'open')
	const overdue = open.filter((m) => m.due_on && Date.parse(m.due_on) < now)
	const closedWithOpen = milestones.filter((m) => m.state === 'closed' && m.open_issues > 0)
	const undated = open.filter((m) => !m.due_on)
	const featFix = unmilestoned.filter((i) => !i.pull_request && FEAT_OR_FIX.test(i.title))

	const w: string[] = []
	if (featFix.length)
		w.push(
			`${featFix.length} open feat/fix issue(s) with no milestone: ${featFix
				.slice(0, 5)
				.map((i) => `#${i.number}`)
				.join(', ')}${featFix.length > 5 ? ', …' : ''}`
		)
	if (overdue.length) w.push(`past due: ${titles(overdue)}`)
	if (closedWithOpen.length) w.push(`closed with open issues: ${titles(closedWithOpen)}`)
	if (undated.length > 1)
		w.push(`${undated.length} open milestones have no due date, so which ships next is unclear`)
	return w
}

const warningNote = (w: string[]) => (w.length ? ` — warning: ${w.join('; ')}` : '')

/**
 * The catch-all warning rides in `detail` rather than being its own finding:
 * `fix` deliberately can't resolve it (converting a milestone to a label is a
 * planning decision), and a permanently-unfixable drift row would nag forever.
 */
const catchAllNote = (catchAll: Milestone[]) =>
	catchAll.length === 0
		? ''
		: ` — note: ${titles(catchAll)} has no completion criterion so it can never close; that is a label, not a milestone`

export async function checkMilestones(dir: string, exec?: GhExec): Promise<CheckResult> {
	// Cheap gate first: no .git → never spawn (keeps tmp-dir doctor runs offline).
	if (!(await fs.pathExists(path.join(dir, '.git')))) return skip('not a git repository')
	const gh: GhExec = exec ?? ((args, stdin) => realGhExec(args, stdin, dir))
	const milestones = await readMilestones(gh)
	if (!milestones) return skip('could not read milestones')
	// Using no milestones at all is a legitimate choice, not drift — but it is
	// one `fix milestones` can set up, so surface it the way optional tools are.
	if (milestones.length === 0)
		return {
			check: CHECK,
			status: 'optional-missing',
			detail: 'repo uses no milestones',
			hint: NEXT_HINT,
		}

	const { complete, empty, catchAll } = classify(milestones)
	// Closing publishes here, so a finished milestone is waiting for its release,
	// not drift (#833).
	const releaseWorkflow = complete.length ? await milestoneReleaseWorkflow(dir) : null
	const deltas: string[] = []
	if (complete.length && !releaseWorkflow)
		deltas.push(`100% complete but still open: ${titles(complete)}`)
	if (empty.length) deltas.push(`no issues, so a permanent 0%: ${titles(empty)}`)
	// An unreadable issue list only costs the one warning that needs it.
	const unmilestoned = (await readUnmilestonedIssues(gh)) ?? []
	const ready = releaseWorkflow
		? ` — ready to ship: ${titles(complete)}; closing it publishes (${releaseWorkflow} runs on milestone close), so that is the owner's call`
		: ''
	const note =
		ready +
		catchAllNote(catchAll) +
		warningNote(releaseWarnings(milestones, unmilestoned, Date.now()))

	if (deltas.length)
		return {
			check: CHECK,
			status: 'drift',
			detail: deltas.join('; ') + note,
			hint: releaseWorkflow
				? 'Empty milestones are left alone by `fix` — file their issues or delete them by hand'
				: 'Run `npx @rtorcato/repo-tooling fix milestones` to close the 100%-complete ones (and open a "next" one if none is left). Empty milestones are left alone — file their issues or delete them by hand',
		}
	if (!milestones.some((m) => m.state === 'open'))
		return {
			check: CHECK,
			status: 'optional-missing',
			detail: `no open milestone, so nothing marks what ships next${note}`,
			hint: NEXT_HINT,
		}
	return {
		check: CHECK,
		status: 'ok',
		detail: `${milestones.length} milestone(s); ${releaseWorkflow ? 'none empty' : 'none complete-but-open or empty'}${note}`,
	}
}

/**
 * Closes every open milestone that is 100% complete, then — if that leaves none
 * open — opens the rolling "next" one, so closing a release rolls the window
 * forward. Never deletes: an empty milestone is planning intent. Idempotent — a
 * clean repo is a no-op. Refuses to close anything when a workflow runs on
 * milestone close, since that would publish a release (#833).
 *
 * Advisories go to `console.error`; stdout carries the `--json` payload (#357).
 */
export async function closeCompletedMilestones(dir: string, exec?: GhExec): Promise<string[]> {
	if (!(await fs.pathExists(path.join(dir, '.git')))) {
		console.error(chalk.gray('   skipped — not a git repository'))
		return []
	}
	const gh: GhExec = exec ?? ((args, stdin) => realGhExec(args, stdin, dir))
	const milestones = await readMilestones(gh)
	if (!milestones) {
		console.error(chalk.gray('   skipped — could not read milestones'))
		return []
	}

	const { complete, empty } = classify(milestones)
	const releaseWorkflow = complete.length ? await milestoneReleaseWorkflow(dir) : null
	if (releaseWorkflow)
		throw new FixerAbort(
			'milestone-close-publishes',
			`refusing to close ${titles(complete)} — ${releaseWorkflow} runs on milestone close, so closing publishes a release`,
			'close the milestone on GitHub yourself when you mean to ship it'
		)
	const closed: string[] = []
	for (const m of complete) {
		const r = await gh([
			'api',
			'-X',
			'PATCH',
			`repos/{owner}/{repo}/milestones/${m.number}`,
			'-f',
			'state=closed',
		])
		if (r.ok) closed.push(`closed milestone "${m.title}"`)
		else
			console.error(
				chalk.yellow(`   could not close "${m.title}": ${r.stderr.trim() || 'gh error'}`)
			)
	}
	if (empty.length)
		console.error(
			chalk.gray(
				`   left ${empty.length} empty milestone(s) alone — file their issues or delete them by hand`
			)
		)
	if (closed.length === 0) console.error(chalk.gray('   no 100%-complete open milestones to close'))

	const stillOpen = milestones.filter((m) => m.state === 'open').length - closed.length
	if (stillOpen === 0) {
		const created = await openNextMilestone(gh, milestones)
		if (created) closed.push(created)
	}
	return closed
}

async function openNextMilestone(gh: GhExec, milestones: Milestone[]): Promise<string | null> {
	// Titles are unique across open and closed milestones, so a POST would 422.
	// Reopening the old one would pull a shipped release's issues back in.
	if (milestones.some((m) => m.title === NEXT_MILESTONE)) {
		console.error(
			chalk.yellow(
				`   a closed milestone is already titled "${NEXT_MILESTONE}" — rename it to the version it shipped as, then re-run`
			)
		)
		return null
	}
	const r = await gh([
		'api',
		'-X',
		'POST',
		'repos/{owner}/{repo}/milestones',
		'-f',
		`title=${NEXT_MILESTONE}`,
	])
	if (r.ok) return `opened milestone "${NEXT_MILESTONE}"`
	console.error(
		chalk.yellow(`   could not open "${NEXT_MILESTONE}": ${r.stderr.trim() || 'gh error'}`)
	)
	return null
}
