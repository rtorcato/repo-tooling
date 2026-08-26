import { spawn } from 'node:child_process'
import path from 'node:path'
import chalk from 'chalk'
import fs from 'fs-extra'
import { type GitExec, realGitExec } from '../../base/git-identity.js'

/**
 * `repo-tooling loop guard` — the two most dangerous mechanics of the
 * ai-issue-loop skill, moved out of prose-with-shell into code a test can hold
 * (#519). Prose drifts and nothing fails when it does; PR #500 (a
 * `0 additions, 67703 deletions` commit) happened in exactly that gap.
 *
 * 1. **Bare-checkout detection and repair.** The main checkout has gone
 *    `core.bare = true` on its own, repeatedly. A bare main checkout wipes a
 *    worktree's index while every file sits untouched on disk, and the next
 *    commit faithfully records the whole repository as deleted.
 * 2. **`node_modules` rebuild gating.** Removing a worktree can destroy the
 *    main checkout's `node_modules/.bin`, because a pnpm run from inside a
 *    worktree anchors the main checkout's shims at the worktree path.
 *
 * Exit codes — the loop's shell snippets are one line each and branch on these:
 *
 * | Code | Meaning | What the caller does |
 * |---|---|---|
 * | `0` | Root is a usable work tree — healthy, or repaired in place. | Continue the tick. |
 * | `1` | Repair was attempted and failed; the root is still bare. | **Halt the tick.** |
 * | `2` | Root is not a repairable main checkout (genuinely bare, a linked worktree, or not a repo). | **Halt the tick**; needs a human. |
 *
 * A deferred or failed `node_modules` rebuild never changes the exit code — it
 * cannot corrupt a commit, so it is reported, not fatal. Read `rebuild` from
 * `--json` (or the printed line) and carry it into the tick's report.
 */

/** What the `--is-inside-work-tree` / `.git` pair says about a root. */
export type RootState =
	| 'work-tree'
	| 'wrongly-bare'
	| 'genuinely-bare'
	| 'linked-worktree'
	| 'not-a-repo'

export type GitEntry = 'directory' | 'file' | 'absent'

/**
 * The invariant table from the skill, verified on git 2.55.0:
 *
 * | repo state | `--is-inside-work-tree` | `.git` |
 * |---|---|---|
 * | healthy checkout | `true`, exit 0 | directory |
 * | **wrongly bare** | `false`, **exit 0** | directory |
 * | genuinely bare | `false`, exit 0 | absent |
 * | linked worktree | `true`, exit 0 | file |
 *
 * Two things it encodes. **Stdout, not the exit code** — `rev-parse
 * --is-inside-work-tree` exits `0` either way and only *prints* the answer, so
 * an exit-code probe is dead code (`insideWorkTree` is `null` only when git
 * itself failed, i.e. there is no repo here). And **`.git` must be a directory
 * before repairing** — a genuinely bare repo prints `false` too, and nothing
 * else separates the two. This ships to consumers' machines, where "repairing"
 * someone's real bare clone is the damage rather than the fix.
 */
export function classifyRoot(insideWorkTree: string | null, gitEntry: GitEntry): RootState {
	if (insideWorkTree === null) return 'not-a-repo'
	if (insideWorkTree.trim() === 'true') return 'work-tree'
	if (gitEntry === 'directory') return 'wrongly-bare'
	// A linked worktree's `.git` is a file; its main checkout is where a repair
	// belongs, and that is not the path we were handed.
	if (gitEntry === 'file') return 'linked-worktree'
	return 'genuinely-bare'
}

export type BareVerdict = 'healthy' | 'repaired' | 'repair-failed' | 'unrepairable'

export type RebuildOutcome =
	| 'not-requested'
	| 'skipped-no-lockfile'
	| 'skipped-root-unusable'
	| 'deferred'
	| 'rebuilt'
	| 'rebuild-failed'

export interface LoopGuardResult {
	root: string
	worktreeRoot: string
	state: RootState
	bare: BareVerdict
	rebuild: RebuildOutcome
	/** Absolute paths of `ai-*` worktrees still on disk. */
	live: string[]
	exitCode: 0 | 1 | 2
	/** Human-readable lines, in the order they happened. */
	messages: string[]
}

export interface LoopGuardOptions {
	root?: string
	worktreeRoot?: string
	/** A worktree was removed this tick — the `$REMOVED` condition. */
	removed?: boolean
	json?: boolean
	/** Test seams. */
	git?: GitExec
	install?: InstallExec
}

/** Runs the rebuild in `cwd`; resolves false rather than throwing. */
export type InstallExec = (cwd: string) => Promise<boolean>

/**
 * `--frozen-lockfile` forbids re-resolution, so neither `pnpm-lock.yaml` nor a
 * `pnpm-workspace.yaml` carve-out moves as a side effect of a cleanup.
 * `--config.confirmModulesPurge=false` gets past
 * `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` — which is why a bare `pnpm
 * install` cannot repair this.
 */
export const REBUILD_ARGS = [
	'install',
	'--frozen-lockfile',
	'--config.confirmModulesPurge=false',
] as const

const realInstall: InstallExec = (cwd) =>
	new Promise((resolve) => {
		// stdout stays clean for the `--json` payload; pnpm's diagnostics are
		// still visible on stderr.
		const child = spawn('pnpm', [...REBUILD_ARGS], {
			cwd,
			stdio: ['ignore', 'ignore', 'inherit'],
		})
		child.on('close', (code) => resolve(code === 0))
		child.on('error', () => resolve(false))
	})

async function gitEntryKind(root: string): Promise<GitEntry> {
	// lstat, not stat: the file/directory distinction is the whole discriminator.
	try {
		const stat = await fs.lstat(path.join(root, '.git'))
		return stat.isDirectory() ? 'directory' : 'file'
	} catch {
		return 'absent'
	}
}

/** `ai-*` directories one level down, in either place worktrees are kept. */
async function findLive(dirs: string[]): Promise<string[]> {
	const live: string[] = []
	for (const dir of dirs) {
		// A missing worktree root is the normal case, not an error.
		const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
		for (const entry of entries) {
			if (entry.isDirectory() && entry.name.startsWith('ai-')) live.push(path.join(dir, entry.name))
		}
	}
	return live
}

/** The sibling layout the skill uses: `<parent>/<name>-worktrees`. */
export function defaultWorktreeRoot(root: string): string {
	return path.join(path.dirname(root), `${path.basename(root)}-worktrees`)
}

const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

const UNUSABLE: Record<Exclude<RootState, 'work-tree' | 'wrongly-bare'>, string> = {
	'genuinely-bare':
		'main checkout is a genuinely bare repository (.git absent) — refusing to flip core.bare on a real bare clone',
	'linked-worktree':
		'--root points at a linked worktree (.git is a file), not the main checkout — repair belongs on the main checkout',
	'not-a-repo': 'not a git repository',
}

/**
 * One tick's worth of guarding, as data. The command wrapper prints it and
 * sets the exit code; tests call this directly.
 */
export async function runLoopGuard(options: LoopGuardOptions = {}): Promise<LoopGuardResult> {
	const root = path.resolve(options.root ?? process.cwd())
	const worktreeRoot = options.worktreeRoot
		? path.resolve(options.worktreeRoot)
		: defaultWorktreeRoot(root)
	const git: GitExec = options.git ?? ((args) => realGitExec(args, root))
	const install = options.install ?? realInstall
	const messages: string[] = []

	const state = classifyRoot(
		await git(['rev-parse', '--is-inside-work-tree']),
		await gitEntryKind(root)
	)

	let bare: BareVerdict = 'healthy'
	let exitCode: 0 | 1 | 2 = 0
	if (state === 'wrongly-bare') {
		messages.push(`⚠ main checkout bare at ${stamp()} — repairing`)
		// Writes $ROOT/.git/config, which a restrictive sandbox refuses with
		// `error: could not lock config file .git/config`. Aborting beats
		// reporting a healthy repo while it stays broken.
		if ((await git(['config', 'core.bare', 'false'])) === null) {
			bare = 'repair-failed'
			exitCode = 1
			messages.push('⚠ repair FAILED — main checkout still bare')
		} else {
			bare = 'repaired'
			messages.push('main checkout repaired — core.bare is false')
		}
	} else if (state !== 'work-tree') {
		bare = 'unrepairable'
		exitCode = 2
		messages.push(`⚠ ${UNUSABLE[state]}`)
	} else {
		messages.push('main checkout is a work tree')
	}

	const live = await findLive([worktreeRoot, path.join(root, '.claude', 'worktrees')])
	const rebuild = await decideRebuild({ root, removed: options.removed === true, exitCode, live })

	let outcome = rebuild
	if (rebuild === 'deferred') {
		messages.push(`rebuild deferred — ${live.length} worktree(s) still live`)
	} else if (rebuild === 'rebuilt') {
		messages.push('rebuilding the main checkout’s node_modules')
		if (!(await install(root))) {
			outcome = 'rebuild-failed'
			// Not fatal: a broken .bin cannot corrupt a commit the way a bare
			// checkout does. Loud, though — a silent skip is the breakage this
			// guard exists to end.
			messages.push('⚠ node_modules rebuild FAILED — main checkout may be unbuildable')
		} else {
			messages.push('node_modules rebuilt')
		}
	}

	return { root, worktreeRoot, state, bare, rebuild: outcome, live, exitCode, messages }
}

/**
 * The three load-bearing conditions, kept separate from the run so a test can
 * assert them without a pnpm install:
 *
 * - **`removed`** — set by every removal path, merged-PR cleanup *and* stall
 *   reaping. A reaped worktree needs this most: its agent died mid-command.
 * - **`pnpm-lock.yaml`** — non-pnpm repos skip the whole thing.
 * - **no live worktrees** — the rebuild *purges* the shared modules dir, which
 *   would be yanked out from under any agent still running in a surviving
 *   worktree. Deferring costs a broken main checkout until the last worktree
 *   clears; not deferring costs a live implementer run.
 */
export async function decideRebuild(input: {
	root: string
	removed: boolean
	exitCode: number
	live: string[]
}): Promise<RebuildOutcome> {
	if (!input.removed) return 'not-requested'
	// Nothing runs against a root we are about to halt the tick over.
	if (input.exitCode !== 0) return 'skipped-root-unusable'
	if (!(await fs.pathExists(path.join(input.root, 'pnpm-lock.yaml')))) return 'skipped-no-lockfile'
	return input.live.length > 0 ? 'deferred' : 'rebuilt'
}

export async function loopGuardCommand(options: {
	root?: string
	worktreeRoot?: string
	removed?: boolean
	json?: boolean
}): Promise<void> {
	const result = await runLoopGuard(options)
	if (options.json) {
		console.log(JSON.stringify(result, null, 2))
	} else {
		console.log()
		for (const line of result.messages) {
			console.log(`  ${line.startsWith('⚠') ? chalk.yellow(line) : chalk.gray(line)}`)
		}
		console.log()
	}
	process.exitCode = result.exitCode
}
