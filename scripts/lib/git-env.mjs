/**
 * Git exports these to every child of a hook, and they outrank `cwd` and `-C`.
 * So anything spawning `git` from inside a `pre-commit`/`pre-push` answers about
 * the *hook's* repository rather than the directory it was handed — a
 * `git init` in a temp dir writes to the real `.git`, leaving stray commits, a
 * registered worktree pointing into `$TMPDIR`, and a main checkout flipped to
 * `core.bare = true`. That is the corruption behind #500 and #519.
 *
 * CI has no hook environment, so this only ever fires on a developer's machine,
 * which is the worst place for it: the damage lands in a real working tree and
 * nothing in the test output mentions git.
 *
 * Nothing in this repo's scripts or tests wants git's ambient repo — every call
 * site names its target via `cwd` or `-C`.
 *
 * Kept in step with `AMBIENT_REPO_VARS` in `src/base/git-identity.ts`, which is
 * the shipped copy for the CLI's own `spawn`. Two copies because that one is
 * TypeScript compiled into `dist/` for consumers, while this one is loaded
 * directly by `.mjs` scripts that run before any build.
 */
/**
 * This is `git rev-parse --local-env-vars` verbatim — git's own answer to
 * "which variables bind a process to one specific repository", and what
 * githooks(1) tells you to clear before touching a different one. Do not curate
 * it by hand: an earlier version of this list was assembled from the vars that
 * looked repository-ish and missed the `GIT_CONFIG*` family, two of which are
 * exported by the maintainer's own shell.
 *
 * `GIT_CONFIG` and `GIT_CONFIG_COUNT` matter most here. They redirect where
 * `git config` reads *and writes* regardless of `-C` or cwd — and `git config`
 * is the exact operation behind the original corruption (`core.bare false` in
 * src/cli/commands/loop-guard.ts, `git -C <cwd> config` in
 * src/base/git-hooks.ts). `GIT_CONFIG_PARAMETERS` is how git hands `-c` down to
 * child processes, so it is routinely present in a hook chain.
 *
 * A test asserts this covers everything the installed git reports, so a future
 * git that adds a variable fails loudly instead of silently reopening the hole.
 */
export const AMBIENT_GIT_REPO_VARS = [
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_CONFIG',
	'GIT_CONFIG_PARAMETERS',
	'GIT_CONFIG_COUNT',
	'GIT_OBJECT_DIRECTORY',
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_IMPLICIT_WORK_TREE',
	'GIT_GRAFT_FILE',
	'GIT_INDEX_FILE',
	'GIT_NO_REPLACE_OBJECTS',
	'GIT_REPLACE_REF_BASE',
	'GIT_PREFIX',
	'GIT_SHALLOW_FILE',
	'GIT_COMMON_DIR',
	// Not in git's local-env list: it scopes which refs are visible rather than
	// which repository is used. Cleared anyway — a namespace inherited from a
	// hook would hide refs from a command that meant to see all of them.
	'GIT_NAMESPACE',
]

/**
 * Delete them from this process, so every child inherits a clean environment.
 * Call once at module top, before anything spawns git.
 */
export function stripAmbientGitEnv(env = process.env) {
	for (const key of AMBIENT_GIT_REPO_VARS) delete env[key]
	return env
}
