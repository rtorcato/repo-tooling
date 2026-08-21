import path from 'node:path'
import fs from 'fs-extra'
import packageJson from '../../../package.json' with { type: 'json' }
import { validateProjectConfig } from '../commands/setup-presets.js'
import type { ProjectConfig } from '../commands/setup.js'

export const LOCKFILE_NAME = '.repo-tooling.json'
// Package and bin name used before the js-tooling→repo-tooling rename (#272).
// The bin no longer exists and the package is 404 on the registry, so any
// generated file still naming it is stale (#393).
export const LEGACY_TOOL_NAME = 'js-tooling'
// Lockfile name from the same era. Repos set up on an older version still have
// it: readLockfile falls back to it, and writeLockfile migrates to the new name
// (removing the old file) on the next write.
export const LEGACY_LOCKFILE_NAME = `.${LEGACY_TOOL_NAME}.json`
// v2 added ProjectConfig.language (multi-language seam, #140). v1 files are
// migrated to v2 on read, defaulting language to 'js'.
// v3 added `assets` — the pristine hash of each copied preset (#428). Older
// files carry no hashes, which reads as "not tracked", never as drift.
export const LOCKFILE_VERSION = 3
const LOCKFILE_SCHEMA_URL = 'https://rtorcato.github.io/repo-tooling/schemas/lockfile.json'

export interface Lockfile {
	$schema?: string
	version: number
	config: ProjectConfig
	/**
	 * Preset name → sha256 of the asset's *pristine* content at copy time (#428).
	 * Lets doctor tell a deliberate local fork (`modified` — file differs from
	 * this hash) from a copy the package has since moved past (`stale` — file
	 * still matches this hash, but the shipped asset doesn't). A preset with no
	 * entry here is simply untracked; absence is not evidence of drift.
	 */
	assets?: Record<string, string>
	/**
	 * Settings for the `ai-issue-loop` skills (#524). Repo-scoped on purpose: the
	 * agent account is a collaborator on *this* repo, so a machine-wide env var
	 * would be both the wrong granularity and invisible — committed here it
	 * travels with the repo and survives a new laptop.
	 */
	aiLoop?: {
		/**
		 * Login that in-flight work is assigned to, so `assignee` says whose turn
		 * it is. Must be an assignable collaborator; the skills verify that at
		 * runtime and assign nothing if it is not.
		 */
		agentUser?: string
	}
	writtenBy: string
	writtenAt: string
}

/**
 * Upgrade an older lockfile in-memory. Only touches files older than the
 * current version, so a newer-than-supported file is left as-is for
 * checkLockfile to flag. The file is rewritten to v3 next time it's saved.
 */
function migrate(lock: Lockfile): Lockfile {
	if (lock.version >= LOCKFILE_VERSION) return lock
	return {
		...lock,
		version: LOCKFILE_VERSION,
		config: { language: 'js', ...lock.config },
		assets: lock.assets ?? {},
	}
}

export async function readLockfile(dir: string): Promise<Lockfile | null> {
	let filepath = path.join(dir, LOCKFILE_NAME)
	if (!(await fs.pathExists(filepath))) {
		// Fall back to the pre-rename name so existing repos keep working (#272).
		const legacy = path.join(dir, LEGACY_LOCKFILE_NAME)
		if (!(await fs.pathExists(legacy))) return null
		filepath = legacy
	}
	try {
		const raw = (await fs.readJson(filepath)) as unknown
		if (typeof raw !== 'object' || raw === null) return null
		const obj = raw as Record<string, unknown>
		if (typeof obj.version !== 'number') return null
		if (typeof obj.config !== 'object' || obj.config === null) return null
		return migrate(obj as unknown as Lockfile)
	} catch {
		return null
	}
}

/**
 * @param assets Recorded asset hashes to write. Omit to carry the existing
 *   file's hashes forward — every caller that only means to update `config`
 *   would otherwise silently drop them.
 */
export async function writeLockfile(
	dir: string,
	config: ProjectConfig,
	assets?: Record<string, string>
): Promise<string> {
	const { valid, errors } = validateProjectConfig(config)
	if (!valid) {
		throw new Error(`Refusing to write invalid lockfile:\n  - ${errors.join('\n  - ')}`)
	}
	// One read, because everything not rebuilt from `config` has to be carried
	// forward explicitly — this object is constructed from scratch, so any key
	// not named here is dropped by the next `fix lockfile`.
	const existing = await readLockfile(dir)
	const carried = assets ?? existing?.assets
	const filepath = path.join(dir, LOCKFILE_NAME)
	const lockfile: Lockfile = {
		$schema: LOCKFILE_SCHEMA_URL,
		version: LOCKFILE_VERSION,
		config,
		...(carried && Object.keys(carried).length > 0 ? { assets: carried } : {}),
		...(existing?.aiLoop ? { aiLoop: existing.aiLoop } : {}),
		writtenBy: `@rtorcato/repo-tooling@${packageJson.version}`,
		writtenAt: new Date().toISOString(),
	}
	await fs.writeJson(filepath, lockfile, { spaces: 2 })
	// Migrate a pre-rename repo to the new name: now that the canonical file is
	// written, drop the stale legacy lockfile so there's only one (#272).
	const legacy = path.join(dir, LEGACY_LOCKFILE_NAME)
	if (await fs.pathExists(legacy)) await fs.remove(legacy)
	return filepath
}

/**
 * Patch a subset of a lockfile's config in place, preserving everything else.
 * Returns true when the file was rewritten, false when no lockfile exists.
 */
export async function updateLockfileConfig(
	dir: string,
	patch: Partial<ProjectConfig>
): Promise<boolean> {
	const existing = await readLockfile(dir)
	if (!existing) return false
	const merged: ProjectConfig = { ...existing.config, ...patch }
	await writeLockfile(dir, merged)
	return true
}

/**
 * Record the pristine hash of a just-copied preset (#428). Returns false when
 * the repo has no lockfile — four family repos don't, and creating one as a
 * side effect of `copy` would be a surprise. Those repos keep reporting the
 * asset as untracked, which is the honest answer.
 */
export async function recordAssetHash(dir: string, preset: string, hash: string): Promise<boolean> {
	const existing = await readLockfile(dir)
	if (!existing) return false
	await writeLockfile(dir, existing.config, { ...existing.assets, [preset]: hash })
	return true
}
