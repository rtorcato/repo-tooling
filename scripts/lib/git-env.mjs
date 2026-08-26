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
export const AMBIENT_GIT_REPO_VARS = [
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_COMMON_DIR',
	'GIT_OBJECT_DIRECTORY',
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_PREFIX',
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
