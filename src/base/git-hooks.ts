/**
 * Committed git hooks for languages that can't use Husky (#309).
 *
 * Husky is an npm package, so a repo whose toolchain has no node can't use it.
 * The node-free equivalent is a committed hooks directory that git is pointed at
 * with `core.hooksPath` — identical mechanics whatever the language; only the
 * hook bodies differ. Swift and Python both land here rather than each carrying
 * their own copy of the write-then-chmod-then-git-config dance.
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import fs from 'fs-extra'

/** The hook bodies a language module supplies. Both are `#!/bin/sh` scripts. */
export interface HookScripts {
	preCommit: string
	prePush: string
}

/** Best-effort `git config` — a missing git or a non-repo dir is not a failure. */
function gitConfig(cwd: string, key: string, value: string): Promise<boolean> {
	return new Promise((resolve) => {
		execFile('git', ['-C', cwd, 'config', key, value], (err) => resolve(!err))
	})
}

/**
 * Writes both hooks and points git at them. Returns the files written —
 * `core.hooksPath` is per-clone local config, not a file, so it's reported
 * separately rather than pretending to be a repo change.
 */
export async function installGitHooks(
	targetDir: string,
	hooksDirName: string,
	scripts: HookScripts
): Promise<{ filesWritten: string[]; hooksPathSet: boolean }> {
	const hooksDir = path.join(targetDir, hooksDirName)
	await fs.ensureDir(hooksDir)

	const filesWritten: string[] = []
	for (const [name, content] of [
		['pre-commit', scripts.preCommit],
		['pre-push', scripts.prePush],
	] as const) {
		const hookPath = path.join(hooksDir, name)
		await fs.writeFile(hookPath, content)
		await fs.chmod(hookPath, 0o755)
		filesWritten.push(`${hooksDirName}/${name}`)
	}

	// Guard on .git: `fix --diff` shadow-runs fixers in a temp copy that excludes
	// .git, and that copy can land inside another repo — an unguarded `git config`
	// there would rewrite the *parent* repo's hooksPath during a mere preview.
	const isRepo = await fs.pathExists(path.join(targetDir, '.git'))
	const hooksPathSet = isRepo ? await gitConfig(targetDir, 'core.hooksPath', hooksDirName) : false

	return { filesWritten, hooksPathSet }
}
