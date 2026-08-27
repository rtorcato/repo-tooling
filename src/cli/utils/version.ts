/**
 * The one answer to "what version of this package is running" (#572).
 *
 * There were two. `--version` and the lockfile's `writtenBy` read the imported
 * `package.json` directly; the Claude-skills stamp went through
 * `resolveShippedVersion`, which corrects for the drift documented below. A
 * single `doctor` run could report both — the skills check saying 3.31.0 while
 * `writtenBy` in the same run said 3.11.0. Everything now calls
 * `getToolVersion()`.
 */

import path from 'node:path'
import fs from 'fs-extra'
import packageJson from '../../../package.json' with { type: 'json' }
import { realGitExec } from '../../base/git-identity.js'
import { getPackageRoot } from './copy-preset.js'

/** Injectable git runner — never rejects; a missing or failing git is null. */
export type GitExec = (args: string[], cwd?: string) => Promise<string | null>

function versionParts(version: string): number[] {
	return version.split('.').map((n) => Number.parseInt(n, 10) || 0)
}

/** True when `a` is a strictly higher version than `b`. Prerelease tags are ignored. */
export function isNewerVersion(a: string, b: string): boolean {
	const [left, right] = [versionParts(a), versionParts(b)]
	for (let i = 0; i < 3; i++) {
		const [x, y] = [left[i] ?? 0, right[i] ?? 0]
		if (x !== y) return x > y
	}
	return false
}

/**
 * The version to report, given what `package.json` claims.
 *
 * In a published tarball that field is authoritative — `@semantic-release/npm`
 * rewrites it before packing. In a *git checkout* it is not: this repo runs
 * semantic-release without `@semantic-release/git` (#417), so nothing ever
 * writes the released version back and the field sits at whatever it was last
 * hand-set to. Observed 2026-08-22: `package.json` 3.11.0 against npm 3.21.1,
 * ten minor versions of drift.
 *
 * That mattered first because the stamp feeds the skills downgrade guard: a
 * skill installed from npm could not be updated from a local checkout, and the
 * refusal claimed the installed copy was "newer" when only its *label* was.
 *
 * So when the package root is a git checkout, take the nearest tag as well and
 * keep whichever is higher. Monotonic on purpose — this can only ever raise the
 * answer, so a tagless, shallow, or git-less environment keeps today's
 * behaviour rather than silently reporting something lower.
 */
export async function resolveShippedVersion(
	root: string,
	pkgVersion: string,
	git: GitExec = realGitExec
): Promise<string> {
	if (!(await fs.pathExists(path.join(root, '.git')))) return pkgVersion
	const described = await git(['describe', '--tags', '--abbrev=0'], root)
	const tag = described?.trim().replace(/^v/, '')
	if (!tag || !/^\d+\.\d+/.test(tag)) return pkgVersion
	return isNewerVersion(tag, pkgVersion) ? tag : pkgVersion
}

let cached: Promise<string> | undefined

/**
 * This package's version, for `--version`, `writtenBy`, and the skill stamps.
 *
 * Memoized: in a checkout `resolveShippedVersion` spawns `git describe`, and
 * nothing about the answer changes mid-process. An npm install has no `.git`
 * under the package root, so that path costs one `pathExists` and no subprocess.
 */
export function getToolVersion(): Promise<string> {
	cached ??= resolveShippedVersion(getPackageRoot(), String(packageJson.version))
	return cached
}
