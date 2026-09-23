import path from 'node:path'
import chalk from 'chalk'
import { type GitExec, realGitExec } from '../../base/git-identity.js'
import { type GhExec, realGhExec } from '../../base/github-settings.js'
import { defaultWorktreeRoot, findLive } from './loop-guard.js'

/**
 * `repo-tooling loop cleanup` — the ai-issue-loop skill's Pass 2 worktree
 * cleanup, moved out of prose (#617). For each `ai-*` worktree in either root
 * (the sibling `<root>-worktrees` and the legacy `<root>/.claude/worktrees`):
 *
 * - **closed-unmerged PR** → remove; the work was abandoned deliberately.
 * - **merged PR** → remove only once its `(#<PR>)` squash subject is on
 *   `origin/main`. A squash-merged branch always looks unmerged — its SHAs
 *   never land — so the subject is the only proof, and `--force` would
 *   otherwise delete unlanded work just as happily.
 * - **open PR, or none** → keep. Stall reaping stays in the skill.
 *
 * Issue relabelling stays in the skill too; each entry carries its `issue` so
 * the caller can do it. `removed` is what `loop guard --removed` wants.
 *
 * Exit `1` only when a removal was attempted and failed.
 */

export type CleanupAction = 'removed' | 'kept' | 'remove-failed'

export interface CleanupEntry {
	path: string
	issue: number | null
	branch: string | null
	pr: number | null
	prState: string | null
	action: CleanupAction
	reason: string
}

export interface LoopCleanupResult {
	root: string
	worktreeRoot: string
	/** Any worktree removed — pass `--removed` to `loop guard`. */
	removed: boolean
	worktrees: CleanupEntry[]
	exitCode: 0 | 1
}

export interface LoopCleanupOptions {
	root?: string
	worktreeRoot?: string
	json?: boolean
	/** Test seams. */
	git?: GitExec
	gh?: GhExec
}

/** How far back to look for the squash subject. */
const SQUASH_WINDOW = 200

async function findPr(
	gh: GhExec,
	heads: string[]
): Promise<{ number: number; state: string } | null> {
	for (const head of heads) {
		const r = await gh(['pr', 'list', '--head', head, '--state', 'all', '--json', 'number,state'])
		if (!r.ok) continue
		const [pr] = JSON.parse(r.stdout || '[]') as { number: number; state: string }[]
		if (pr) return pr
	}
	return null
}

export async function runLoopCleanup(options: LoopCleanupOptions = {}): Promise<LoopCleanupResult> {
	const root = path.resolve(options.root ?? process.cwd())
	const worktreeRoot = options.worktreeRoot
		? path.resolve(options.worktreeRoot)
		: defaultWorktreeRoot(root)
	// Fetch and `worktree remove` outlast the 5s probe timeout on a real repo.
	const git: GitExec = options.git ?? ((args) => realGitExec(args, root, 120_000))
	const gh: GhExec = options.gh ?? ((args, stdin) => realGhExec(args, stdin, root))

	const dirs = await findLive([worktreeRoot, path.join(root, '.claude', 'worktrees')])
	let subjects: string[] | null = null
	const worktrees: CleanupEntry[] = []

	for (const dir of dirs) {
		const slug = path.basename(dir)
		const issue = Number(slug.match(/^ai-(\d+)-/)?.[1]) || null
		// `worktree-` is the prefix EnterWorktree once gave branches — legacy.
		const heads = [slug, `worktree-${slug}`]
		const branch =
			(await git(['branch', '--list', ...heads, '--format=%(refname:short)']))
				?.split('\n')[0]
				?.trim() || null
		const pr = await findPr(gh, heads)
		const entry: CleanupEntry = {
			path: dir,
			issue,
			branch,
			pr: pr?.number ?? null,
			prState: pr?.state ?? null,
			action: 'kept',
			reason: '',
		}
		worktrees.push(entry)

		if (!pr || pr.state === 'OPEN') {
			entry.reason = pr ? 'PR still open' : 'no PR'
			continue
		}
		if (pr.state === 'MERGED') {
			if (subjects === null) {
				// Best-effort: a failed fetch leaves origin/main stale, which can
				// only keep a worktree, never remove one wrongly.
				await git(['fetch', '--prune', 'origin'])
				const log = await git(['log', 'origin/main', `-n${SQUASH_WINDOW}`, '--format=%s'])
				subjects = log ? log.split('\n') : []
			}
			if (!subjects.some((s) => s.trimEnd().endsWith(`(#${pr.number})`))) {
				entry.reason = `squash for #${pr.number} not on origin/main`
				continue
			}
		}
		if ((await git(['worktree', 'remove', '--force', dir])) === null) {
			entry.action = 'remove-failed'
			entry.reason = 'git worktree remove failed'
			continue
		}
		if (branch) await git(['branch', '-D', branch])
		entry.action = 'removed'
		entry.reason = pr.state === 'MERGED' ? `#${pr.number} landed on main` : `#${pr.number} closed`
	}

	return {
		root,
		worktreeRoot,
		removed: worktrees.some((w) => w.action === 'removed'),
		worktrees,
		exitCode: worktrees.some((w) => w.action === 'remove-failed') ? 1 : 0,
	}
}

export async function loopCleanupCommand(options: {
	root?: string
	worktreeRoot?: string
	json?: boolean
}): Promise<void> {
	const result = await runLoopCleanup(options)
	if (options.json) {
		console.log(JSON.stringify(result, null, 2))
	} else {
		console.log()
		if (result.worktrees.length === 0) console.log(chalk.gray('  no ai-* worktrees'))
		for (const w of result.worktrees) {
			const line = `${w.action.padEnd(13)} ${path.basename(w.path)} — ${w.reason}`
			console.log(`  ${w.action === 'remove-failed' ? chalk.yellow(line) : chalk.gray(line)}`)
		}
		console.log()
	}
	process.exitCode = result.exitCode
}
