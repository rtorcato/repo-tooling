/**
 * fs-extra with every file write, mkdir, chmod and delete guarded against committed
 * symlinks (#908).
 *
 * `setup` and `fix` write into a repo the user may have just cloned. A clone can
 * commit `.gitignore`, `.github/` or any other output as a symlink to a file
 * outside the checkout, and a plain `fs.writeFile` follows it, so running the
 * tool would write there with the user's permissions. Import this module's
 * default export in place of `fs-extra` and each write first checks that its
 * destination still resolves inside the write root.
 *
 * Symlinks that stay inside the root (`CLAUDE.md -> AGENTS.md`) are allowed.
 * Paths outside the root (the `fix --diff` temp copy, say) are not this
 * module's concern and pass through.
 */
import path from 'node:path'
import fs from 'fs-extra'
import { FixerAbort } from './fixer-abort.js'

let writeRoot: string | undefined

/**
 * Set the directory writes must stay inside. Returns the previous root so a
 * caller can restore it. Unset, the guard is a no-op: only the commands that
 * write into a user's repo opt in.
 */
// ponytail: module-level state, since 110 write sites have no root in scope.
// Thread a root through the generators if two roots ever need to be live at once.
export function setWriteRoot(dir: string | undefined): string | undefined {
	const previous = writeRoot
	writeRoot = dir === undefined ? undefined : path.resolve(dir)
	return previous
}

function isInside(root: string, target: string): boolean {
	const rel = path.relative(root, target)
	return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

/**
 * Throw a `FixerAbort` when `dest` sits under the write root but resolves outside
 * it, because the file itself or one of its parent directories is a symlink.
 */
// ponytail: check-then-write, so a symlink swapped in between the two still wins.
// Fine for a CLI the user runs by hand; open with O_NOFOLLOW per path segment if that changes.
export async function assertInsideWriteRoot(dest: string): Promise<void> {
	if (writeRoot === undefined) return
	const target = path.resolve(dest)
	if (!isInside(writeRoot, target)) return
	const realRoot = await fs.realpath(writeRoot).catch(() => null)
	if (realRoot === null) return

	// realpath the longest prefix that exists; the rest can't be a symlink yet.
	// lstat sees a dangling link, which realpath can't resolve: that refuses too.
	let existing = target
	const rest: string[] = []
	while (!(await fs.lstat(existing).catch(() => null))) {
		rest.unshift(path.basename(existing))
		existing = path.dirname(existing)
	}
	const real = await fs.realpath(existing).catch(() => null)
	if (real !== null && isInside(realRoot, path.join(real, ...rest))) return

	const rel = path.relative(writeRoot, target)
	throw new FixerAbort(
		'symlink-outside-repo',
		`${rel} resolves outside ${writeRoot} through a symlink — not writing through it`,
		'Replace the symlink with a real file or directory, then re-run'
	)
}

function guarded<F extends (...args: never[]) => Promise<unknown>>(fn: F, destIndex = 0): F {
	return (async (...args: Parameters<F>) => {
		await assertInsideWriteRoot(String(args[destIndex]))
		return fn(...args)
	}) as F
}

export default {
	...fs,
	appendFile: guarded(fs.appendFile),
	// chmod follows a symlinked hook out of the repo even when nothing is written (#911).
	chmod: guarded(fs.chmod),
	copy: guarded(fs.copy, 1),
	ensureDir: guarded(fs.ensureDir),
	outputFile: guarded(fs.outputFile),
	outputJson: guarded(fs.outputJson),
	// A parent symlinked outside would point the delete there too.
	remove: guarded(fs.remove),
	writeFile: guarded(fs.writeFile),
	writeJson: guarded(fs.writeJson),
} as typeof fs
