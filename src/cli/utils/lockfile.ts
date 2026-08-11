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
export const LOCKFILE_VERSION = 2
const LOCKFILE_SCHEMA_URL = 'https://rtorcato.github.io/repo-tooling/schemas/lockfile.json'

export interface Lockfile {
	$schema?: string
	version: number
	config: ProjectConfig
	writtenBy: string
	writtenAt: string
}

/**
 * Upgrade an older lockfile in-memory. Only touches files older than the
 * current version, so a newer-than-supported file is left as-is for
 * checkLockfile to flag. The file is rewritten to v2 next time it's saved.
 */
function migrate(lock: Lockfile): Lockfile {
	if (lock.version >= LOCKFILE_VERSION) return lock
	return {
		...lock,
		version: LOCKFILE_VERSION,
		config: { language: 'js', ...lock.config },
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

export async function writeLockfile(dir: string, config: ProjectConfig): Promise<string> {
	const { valid, errors } = validateProjectConfig(config)
	if (!valid) {
		throw new Error(`Refusing to write invalid lockfile:\n  - ${errors.join('\n  - ')}`)
	}
	const filepath = path.join(dir, LOCKFILE_NAME)
	const lockfile: Lockfile = {
		$schema: LOCKFILE_SCHEMA_URL,
		version: LOCKFILE_VERSION,
		config,
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
