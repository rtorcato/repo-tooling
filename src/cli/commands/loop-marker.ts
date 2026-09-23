import path from 'node:path'
import fs from 'fs-extra'
import { type GhExec, realGhExec } from '../../base/github-settings.js'
import { ghOut } from './loop-env.js'

/**
 * `repo-tooling loop comment` and `loop verdict` — the ai-issue-loop skill's
 * two hidden-marker protocols, moved out of prose-with-jq (#619):
 *
 * - **comment** upserts the one `<!-- ai-issue-loop:decision -->` comment on a
 *   PR (Pass 1), so a PR left over a weekend gets one edited comment, not one
 *   per tick.
 * - **verdict** reads a reviewer arm's `<!-- ai-issue-loop:verdict:… -->`
 *   marker back off the PR's reviews (Pass 3), so a reviewer that posted and
 *   died before labelling is adopted rather than re-spawned.
 *
 * Both gate on the loop's own login — anyone can comment on or review a public
 * PR, and a stranger's marker would otherwise own the slot or override a
 * genuine `CHANGES`. Login, not `author_association`, which wobbles with repo
 * ownership. Bodies travel to gh as JSON on stdin, never through a shell.
 */

export const DECISION_MARKER = '<!-- ai-issue-loop:decision -->'

export type Verdict = 'PASS' | 'PASS-NOTES' | 'CHANGES'

interface Target {
	ownerRepo: string
	me: string
	gh: GhExec
}

async function resolveTarget(
	dir: string | undefined,
	gh: GhExec | undefined
): Promise<Target | string> {
	const cwd = path.resolve(dir ?? process.cwd())
	const exec: GhExec = gh ?? ((args, stdin) => realGhExec(args, stdin, cwd))
	const ownerRepo = await ghOut(exec, [
		'repo',
		'view',
		'--json',
		'nameWithOwner',
		'--jq',
		'.nameWithOwner',
	])
	if (!ownerRepo) return 'could not resolve the GitHub repo from the working directory'
	const me = await ghOut(exec, ['api', 'user', '--jq', '.login'])
	if (!me) return 'could not resolve the gh login'
	return { ownerRepo, me, gh: exec }
}

/** The PR number goes into an API path — digits only. */
function prNumber(pr: string | number): number | null {
	const s = String(pr)
	return /^[1-9]\d*$/.test(s) ? Number(s) : null
}

/** `--paginate --slurp` yields one array per page; `--jq` would run per page. */
async function slurp<T>(gh: GhExec, route: string): Promise<T[] | null> {
	const r = await gh(['api', route, '--paginate', '--slurp'])
	if (!r.ok) return null
	try {
		return (JSON.parse(r.stdout) as T[][]).flat()
	} catch {
		return null
	}
}

interface GhItem {
	id: number
	user: { login: string } | null
	body: string | null
	commit_id?: string
}

export interface LoopCommentResult {
	pr: number | null
	action: 'created' | 'updated' | 'failed'
	commentId: number | null
	error?: string
}

export interface LoopCommentOptions {
	dir?: string
	/** Comment text, without the marker — it is prepended here. */
	text: string
	gh?: GhExec
}

export async function runLoopComment(
	pr: string | number,
	options: LoopCommentOptions
): Promise<LoopCommentResult> {
	const n = prNumber(pr)
	const fail = (error: string): LoopCommentResult => ({
		pr: n,
		action: 'failed',
		commentId: null,
		error,
	})
	if (n === null) return fail(`not a PR number: ${pr}`)
	const text = options.text.trim()
	if (!text) return fail('empty comment body')
	const target = await resolveTarget(options.dir, options.gh)
	if (typeof target === 'string') return fail(target)
	const { ownerRepo, me, gh } = target

	const comments = await slurp<GhItem>(gh, `repos/${ownerRepo}/issues/${n}/comments`)
	// A failed read must not fall through to "create" — that is the duplicate.
	if (comments === null) return fail('could not list PR comments')
	const existing = comments.find(
		(c) => c.user?.login === me && (c.body ?? '').startsWith(DECISION_MARKER)
	)
	const input = JSON.stringify({ body: `${DECISION_MARKER}\n${text}` })
	const r = existing
		? await gh(
				['api', '-X', 'PATCH', `repos/${ownerRepo}/issues/comments/${existing.id}`, '--input', '-'],
				input
			)
		: await gh(['api', `repos/${ownerRepo}/issues/${n}/comments`, '--input', '-'], input)
	if (!r.ok) return fail(r.stderr.trim() || 'gh api failed')
	let id: number | null = existing?.id ?? null
	try {
		id = (JSON.parse(r.stdout) as { id: number }).id ?? id
	} catch {}
	return { pr: n, action: existing ? 'updated' : 'created', commentId: id }
}

export interface LoopVerdictResult {
	pr: number | null
	arm: string
	head: string | null
	/** Null when that arm has no marker on the current head — spawn it. */
	verdict: Verdict | null
	error?: string
}

export interface LoopVerdictOptions {
	dir?: string
	arm: string
	gh?: GhExec
}

export async function runLoopVerdict(
	pr: string | number,
	options: LoopVerdictOptions
): Promise<LoopVerdictResult> {
	const n = prNumber(pr)
	const { arm } = options
	const fail = (error: string): LoopVerdictResult => ({
		pr: n,
		arm,
		head: null,
		verdict: null,
		error,
	})
	if (n === null) return fail(`not a PR number: ${pr}`)
	if (arm !== 'code' && arm !== 'sec') return fail(`--arm must be code or sec, got ${arm}`)
	const target = await resolveTarget(options.dir, options.gh)
	if (typeof target === 'string') return fail(target)
	const { ownerRepo, me, gh } = target

	const head = await ghOut(gh, [
		'pr',
		'view',
		String(n),
		'-R',
		ownerRepo,
		'--json',
		'headRefOid',
		'--jq',
		'.headRefOid',
	])
	if (!head) return fail('could not resolve the PR head commit')
	// `issues/<N>/comments` would never see these — `gh pr review --comment`
	// creates a review.
	const reviews = await slurp<GhItem>(gh, `repos/${ownerRepo}/pulls/${n}/reviews`)
	if (reviews === null) return { ...fail('could not list PR reviews'), head }

	const marker = new RegExp(`<!-- ai-issue-loop:verdict:${arm}:(PASS-NOTES|PASS|CHANGES) -->`)
	let verdict: Verdict | null = null
	for (const r of reviews) {
		// The head gate: a verdict expires with the diff it read.
		if (r.user?.login !== me || r.commit_id !== head) continue
		const m = (r.body ?? '').match(marker)
		if (m) verdict = m[1] as Verdict
	}
	return { pr: n, arm, head, verdict }
}

export async function loopCommentCommand(
	pr: string,
	options: { dir?: string; bodyFile: string; json?: boolean }
): Promise<void> {
	let text: string
	try {
		text = fs.readFileSync(options.bodyFile === '-' ? 0 : options.bodyFile, 'utf8')
	} catch (err) {
		console.error(`✖ cannot read ${options.bodyFile}: ${(err as Error).message}`)
		process.exitCode = 1
		return
	}
	const result = await runLoopComment(pr, { dir: options.dir, text })
	if (options.json) console.log(JSON.stringify(result, null, 2))
	else if (result.error) console.error(`✖ ${result.error}`)
	else console.log(`${result.action} comment ${result.commentId} on #${result.pr}`)
	process.exitCode = result.action === 'failed' ? 1 : 0
}

export async function loopVerdictCommand(
	pr: string,
	options: { dir?: string; arm: string; json?: boolean }
): Promise<void> {
	const result = await runLoopVerdict(pr, options)
	if (options.json) console.log(JSON.stringify(result, null, 2))
	else if (result.error) console.error(`✖ ${result.error}`)
	// Empty line for "none", so `VERDICT=$(… loop verdict …)` needs no null check.
	else console.log(result.verdict ?? '')
	process.exitCode = result.error ? 1 : 0
}
