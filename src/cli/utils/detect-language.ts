import path from 'node:path'
import fs from 'fs-extra'

export type DetectedLanguage = 'js' | 'swift' | 'perl' | 'python' | 'unknown'

/**
 * Marker files that identify a repo's language, checked in order — first match
 * wins. One language per repo root; multi-language monorepos stay out of scope
 * (#139, reaffirmed in #317 — the audit is root-only, but says so via
 * `detectNestedLanguages`). A dir with no marker → 'unknown' (base checks only).
 */
const MARKERS: ReadonlyArray<[DetectedLanguage, readonly string[]]> = [
	['js', ['package.json']],
	['swift', ['Package.swift']],
	['perl', ['cpanfile', 'Makefile.PL', 'dist.ini']],
	['python', ['pyproject.toml', 'setup.py']],
]

export async function detectLanguage(dir: string): Promise<DetectedLanguage> {
	for (const [language, candidates] of MARKERS) {
		for (const candidate of candidates) {
			if (await fs.pathExists(path.join(dir, candidate))) return language
		}
	}
	return 'unknown'
}

/** Never worth descending into, and expensive when we do. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'target', 'vendor', '.build'])

/**
 * Sub-project dirs whose language marker disagrees with the root's, as
 * `{ dir, language }` sorted by dir. Depth-2 scan — enough for the shapes that
 * exist (`apps/docs`, `packages/*`, a top-level `docs/`) and cheap enough to run
 * on every doctor.
 *
 * Deliberately *not* driven by the workspace manifest: the case #317 is about is
 * a Swift or Perl root with a JS docs app, and such a repo has no
 * `pnpm-workspace.yaml` to read. Walking the tree finds it either way, and needs
 * no glob dependency.
 */
export async function detectNestedLanguages(
	dir: string,
	rootLanguage: DetectedLanguage
): Promise<Array<{ dir: string; language: DetectedLanguage }>> {
	const found: Array<{ dir: string; language: DetectedLanguage }> = []

	const scan = async (relative: string, depth: number): Promise<void> => {
		let entries: string[]
		try {
			entries = await fs.readdir(path.join(dir, relative))
		} catch {
			return // unreadable dir is the caller's problem, not the audit's
		}
		for (const entry of entries) {
			if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue
			const child = relative ? `${relative}/${entry}` : entry
			if (!(await fs.stat(path.join(dir, child)).catch(() => null))?.isDirectory()) continue
			const language = await detectLanguage(path.join(dir, child))
			if (language !== 'unknown' && language !== rootLanguage) {
				found.push({ dir: child, language })
				continue // a package's own subdirs belong to it, not to the root
			}
			if (depth > 1) await scan(child, depth - 1)
		}
	}

	await scan('', 2)
	return found.sort((a, b) => a.dir.localeCompare(b.dir))
}
