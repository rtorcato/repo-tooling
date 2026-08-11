import path from 'node:path'
import chalk from 'chalk'
import fs from 'fs-extra'
import { type GhExec, realGhExec } from './github-settings.js'
import type { CheckResult } from './types.js'

/**
 * Milestone hygiene (#397). `doctor` already audits GitHub-side state, and an
 * open milestone at 100% is the same class of drift: "open" stops meaning "in
 * flight", so the milestone list carries no signal.
 *
 * Read-only, on the same `gh` seam as github-settings.ts. No repo probe is
 * needed — `gh` expands `{owner}/{repo}` from the remote itself.
 */

const CHECK = 'Milestones'

interface Milestone {
	number: number
	title: string
	state: string
	open_issues: number
	closed_issues: number
}

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

const titles = (ms: Milestone[]) => ms.map((m) => `"${m.title}"`).join(', ')

async function readMilestones(gh: GhExec): Promise<Milestone[] | null> {
	// `-X GET` is load-bearing: `-f`/`-F` without an explicit method make `gh`
	// switch to POST, which would hit the *create* milestone endpoint. With it,
	// the fields land in the query string and the path keeps gh's
	// {owner}/{repo} placeholders intact.
	const r = await gh([
		'api',
		'-X',
		'GET',
		'repos/{owner}/{repo}/milestones',
		'-f',
		'state=all',
		'-F',
		'per_page=100',
	])
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
		// permanent 0% that can never move.
		empty: open.filter((m) => m.open_issues === 0 && m.closed_issues === 0),
		catchAll: open.filter((m) => CATCH_ALL_TITLE.test(m.title)),
	}
}

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
	// Using no milestones at all is a legitimate choice, not drift.
	if (milestones.length === 0) return skip('repo uses no milestones')

	const { complete, empty, catchAll } = classify(milestones)
	const deltas: string[] = []
	if (complete.length) deltas.push(`100% complete but still open: ${titles(complete)}`)
	if (empty.length) deltas.push(`no issues, so a permanent 0%: ${titles(empty)}`)
	const note = catchAllNote(catchAll)

	if (deltas.length)
		return {
			check: CHECK,
			status: 'drift',
			detail: deltas.join('; ') + note,
			hint: 'Run `npx @rtorcato/repo-tooling fix milestones` to close the 100%-complete ones. Empty milestones are left alone — file their issues or delete them by hand',
		}
	return {
		check: CHECK,
		status: 'ok',
		detail: `${milestones.length} milestone(s); none complete-but-open or empty${note}`,
	}
}

/**
 * Closes every open milestone that is 100% complete. Deliberately the only
 * mutation: deleting an empty milestone or creating a missing one would destroy
 * or invent planning intent. Idempotent — a clean repo is a no-op.
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
	return closed
}
