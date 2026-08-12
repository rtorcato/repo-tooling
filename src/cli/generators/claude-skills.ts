/**
 * User-global agent skills (#404). Every other generator writes inside the repo;
 * this one writes to `~/.claude/skills/<name>/SKILL.md`, which is shared by every
 * project on the machine. That difference drives all three rules below — the
 * version stamp, the symlink handling, and the fixer's opt-in `explicitOnly`.
 */

import os from 'node:os'
import path from 'node:path'
import fs from 'fs-extra'
import { getPackageRoot } from '../utils/copy-preset.js'

/** Skills this package owns the content of and keeps up to date. */
export const SHIPPED_SKILL = 'ai-issue-loop'

/**
 * Stamped into the installed copy's frontmatter so a second repo pinned to an
 * older release can tell it would be a downgrade and skip. Without it two repos
 * on different versions overwrite each other's skill on every `fix`, and neither
 * is wrong to do so.
 */
export const VERSION_KEY = 'repo-tooling-version'

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/

export type SkillsDirSource = 'explicit' | 'user' | 'none'

export interface SkillsDirResolution {
	/** Null when nothing could be resolved — the caller has to ask. */
	dir: string | null
	source: SkillsDirSource
}

/**
 * Where to install. `explicit` is `--skills-dir`; otherwise the user-level
 * `~/.claude/skills` when it already exists. A machine with neither resolves to
 * null rather than creating `~/.claude` uninvited.
 *
 * There is deliberately no separate "symlinked" case: a stow-managed
 * `SKILL.md` symlink lives *inside* that same directory, and writing through it
 * is what `installClaudeSkill` already does. See its note.
 */
export async function resolveSkillsDir(
	explicit?: string,
	home: string = os.homedir()
): Promise<SkillsDirResolution> {
	if (explicit) return { dir: path.resolve(explicit), source: 'explicit' }
	const userDir = path.join(home, '.claude', 'skills')
	if (await fs.pathExists(userDir)) return { dir: userDir, source: 'user' }
	return { dir: null, source: 'none' }
}

/** The version recorded in an installed copy, or null if it predates the stamp. */
export function readSkillVersion(content: string): string | null {
	return content.match(new RegExp(`^${VERSION_KEY}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? null
}

/**
 * Replace (or add) the version line in the frontmatter. Appending it last is
 * safe even after a multi-line `description: |` block: an unindented key ends
 * the block scalar, which is exactly what this line is.
 */
export function stampSkillVersion(content: string, version: string): string {
	const stamp = `${VERSION_KEY}: ${version}`
	const match = content.match(FRONTMATTER)
	if (!match) return `---\n${stamp}\n---\n\n${content}`
	const fields = (match[1] ?? '')
		.split('\n')
		.filter((line) => !line.startsWith(`${VERSION_KEY}:`))
		.join('\n')
	return `---\n${fields}\n${stamp}\n---\n${content.slice(match[0].length)}`
}

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

export interface ShippedSkill {
	content: string
	version: string
}

/** The skill source and the package version that will be stamped into it. */
export async function readShippedSkill(name: string = SHIPPED_SKILL): Promise<ShippedSkill> {
	const root = getPackageRoot()
	const content = await fs.readFile(path.join(root, 'skills', name, 'SKILL.md'), 'utf8')
	const pkg = await fs.readJson(path.join(root, 'package.json'))
	return { content, version: String(pkg.version) }
}

export type SkillInstallStatus = 'installed' | 'updated' | 'up-to-date' | 'declined-downgrade'

export interface SkillInstallResult {
	name: string
	status: SkillInstallStatus
	/** The nominal path — `<skillsDir>/<name>/SKILL.md`. */
	file: string
	/**
	 * Where the bytes actually landed. Only meaningfully different from `file`
	 * when `viaSymlink` — resolving a path also expands unrelated links on the way
	 * (macOS `/var` → `/private/var`), so this alone is not the symlink signal.
	 */
	realFile: string
	/** True when `file` is a symlink — a stow-managed copy living in dotfiles. */
	viaSymlink: boolean
	installedVersion: string | null
	shippedVersion: string
}

/** Whether `file` is itself a symlink, as opposed to merely resolving through one. */
async function isSymlink(file: string): Promise<boolean> {
	return await fs
		.lstat(file)
		.then((stat) => stat.isSymbolicLink())
		.catch(() => false)
}

/**
 * Install (or refresh) one shipped skill under `skillsDir`.
 *
 * **Writes through a symlink on purpose.** stow symlinks dotfiles at *file*
 * level, so `~/.claude/skills/ai-issue-loop/SKILL.md` is routinely a link into a
 * dotfiles checkout while its parent directories are real. `fs.writeFile`
 * follows the link and updates the dotfiles copy in place, which is the whole
 * point — the skill stays version-controlled with the rest of the Claude config.
 * Never swap this for an atomic-rename helper (`write-file-atomic` and friends):
 * rename *replaces* the symlink with a real file, orphaning the dotfiles copy
 * with no error at all, which is the split-brain this feature exists to end.
 */
export async function installClaudeSkill(
	skillsDir: string,
	name: string = SHIPPED_SKILL
): Promise<SkillInstallResult> {
	const shipped = await readShippedSkill(name)
	const file = path.join(skillsDir, name, 'SKILL.md')
	const existing = (await fs.pathExists(file)) ? await fs.readFile(file, 'utf8') : null
	const installedVersion = existing ? readSkillVersion(existing) : null
	const viaSymlink = await isSymlink(file)
	const base = {
		name,
		file,
		viaSymlink,
		realFile: viaSymlink ? await fs.realpath(file) : file,
		installedVersion,
		shippedVersion: shipped.version,
	}

	if (installedVersion && isNewerVersion(installedVersion, shipped.version)) {
		return { ...base, status: 'declined-downgrade' }
	}

	const next = stampSkillVersion(shipped.content, shipped.version)
	if (existing === next) return { ...base, status: 'up-to-date' }

	await fs.ensureDir(path.dirname(file))
	await fs.writeFile(file, next)
	return { ...base, status: existing === null ? 'installed' : 'updated' }
}

export interface SkillStatus {
	/** Null when no skills directory could be resolved at all. */
	file: string | null
	installed: boolean
	/** Null when installed but unstamped — a copy that predates this feature. */
	installedVersion: string | null
	shippedVersion: string
	/** True when nothing is installed, or what is installed predates what we ship. */
	needsInstall: boolean
}

/** Read-only counterpart of `installClaudeSkill`, for doctor. */
export async function claudeSkillStatus(
	name: string = SHIPPED_SKILL,
	explicit?: string
): Promise<SkillStatus> {
	const { version } = await readShippedSkill(name)
	const { dir } = await resolveSkillsDir(explicit)
	const absent = {
		installed: false,
		installedVersion: null,
		shippedVersion: version,
		needsInstall: true,
	}
	if (!dir) return { file: null, ...absent }
	const file = path.join(dir, name, 'SKILL.md')
	if (!(await fs.pathExists(file))) return { file, ...absent }
	const installedVersion = readSkillVersion(await fs.readFile(file, 'utf8'))
	return {
		file,
		installed: true,
		installedVersion,
		shippedVersion: version,
		needsInstall: installedVersion === null || isNewerVersion(version, installedVersion),
	}
}
