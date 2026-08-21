/**
 * User-global agent skills (#404). Every other generator writes inside the repo;
 * this one writes to `~/.claude/skills/<name>/SKILL.md`, which is shared by every
 * project on the machine. That difference drives all three rules below — the
 * version stamp, the symlink handling, and the fixer's opt-in `explicitOnly`.
 */

import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'fs-extra'
import { getPackageRoot } from '../utils/copy-preset.js'
import { shellQuote } from '../utils/shell.js'

/** Skills this package owns the content of and keeps up to date. */
export const SHIPPED_SKILL = 'ai-issue-loop'

/**
 * Stamped into the installed copy's frontmatter so a second repo pinned to an
 * older release can tell it would be a downgrade and skip. Without it two repos
 * on different versions overwrite each other's skill on every `fix`, and neither
 * is wrong to do so.
 */
export const VERSION_KEY = 'repo-tooling-version'

/**
 * The pristine sha256 of the content we wrote, stamped beside the version — the
 * skills half of #448. The version alone cannot tell a stale copy from a
 * deliberate local fork: a fork that is merely older than the package looks
 * exactly like a copy waiting for an update, and gets overwritten (#480).
 * With the hash, "installed content still matches what some release of this
 * package shipped" is a fact rather than an inference.
 *
 * It lives in the file instead of `.repo-tooling.json` because skills are
 * user-global — no one repo owns the record.
 */
export const HASH_KEY = 'repo-tooling-hash'

const STAMP_KEYS = [VERSION_KEY, HASH_KEY]

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

function readStamp(content: string, key: string): string | null {
	return content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? null
}

/** The version recorded in an installed copy, or null if it predates the stamp. */
export function readSkillVersion(content: string): string | null {
	return readStamp(content, VERSION_KEY)
}

/** The pristine hash recorded in an installed copy, or null if it predates it. */
export function readSkillHash(content: string): string | null {
	return readStamp(content, HASH_KEY)
}

/**
 * Replace (or add) the stamp lines in the frontmatter. Appending them last is
 * safe even after a multi-line `description: |` block: an unindented key ends
 * the block scalar, which is exactly what these lines are.
 *
 * With no stamps this is the exact inverse of stamping, so a file we wrote
 * strips back to the bytes we were given — which is what makes the hash
 * comparable.
 */
function setStamps(content: string, stamps: string[]): string {
	const match = content.match(FRONTMATTER)
	if (!match) return stamps.length === 0 ? content : `---\n${stamps.join('\n')}\n---\n\n${content}`
	const kept = (match[1] ?? '')
		.split('\n')
		.filter((line) => !STAMP_KEYS.some((key) => line.startsWith(`${key}:`)))
	return `---\n${[...kept, ...stamps].join('\n')}\n---\n${content.slice(match[0].length)}`
}

/** An installed copy with this package's own bookkeeping lines removed. */
export function stripSkillStamps(content: string): string {
	return setStamps(content, [])
}

/**
 * The version stamp on its own — the shape releases before #480 wrote, and what
 * `classifySkillContent` sees as `unknown`. Not the write path; `stampSkill` is.
 */
export function stampSkillVersion(content: string, version: string): string {
	return setStamps(content, [`${VERSION_KEY}: ${version}`])
}

/** sha256 of the content this package shipped, ignoring the stamps it adds. */
export function hashSkillContent(content: string): string {
	return createHash('sha256').update(stripSkillStamps(content)).digest('hex')
}

/** The version + hash stamps, as written to disk. */
export function stampSkill(content: string, version: string): string {
	return setStamps(content, [
		`${VERSION_KEY}: ${version}`,
		`${HASH_KEY}: ${hashSkillContent(content)}`,
	])
}

/**
 * How an installed copy relates to the releases this package has shipped —
 * #448's vocabulary, applied to skills.
 *
 * - `pristine` — content still matches the hash the install recorded (or is
 *   verbatim what we ship right now), so re-writing it loses nothing.
 * - `modified` — content has diverged from that record. Somebody's fork.
 * - `unknown` — no record at all (installed before this stamp existed). A fork
 *   and a stale copy are indistinguishable, so it is not safe to overwrite.
 */
export type SkillContentState = 'pristine' | 'modified' | 'unknown'

export function classifySkillContent(installed: string, shipped: string): SkillContentState {
	if (stripSkillStamps(installed) === stripSkillStamps(shipped)) return 'pristine'
	const recorded = readSkillHash(installed)
	if (!recorded) return 'unknown'
	return recorded === hashSkillContent(installed) ? 'pristine' : 'modified'
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
	/** Where that content lives on disk, inside this package. */
	file: string
}

/** The skill source and the package version that will be stamped into it. */
export async function readShippedSkill(name: string = SHIPPED_SKILL): Promise<ShippedSkill> {
	const root = getPackageRoot()
	const file = path.join(root, 'skills', name, 'SKILL.md')
	const content = await fs.readFile(file, 'utf8')
	const pkg = await fs.readJson(path.join(root, 'package.json'))
	return { content, version: String(pkg.version), file }
}

export type SkillInstallStatus =
	| 'installed'
	| 'updated'
	| 'up-to-date'
	| 'declined-downgrade'
	/** Content this package never shipped — a local fork, or unprovable either way. */
	| 'declined-fork'

export interface SkillInstallResult {
	name: string
	status: SkillInstallStatus
	/** Null when nothing is installed yet. */
	contentState: SkillContentState | null
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
	/** The shipped source inside this package, so a refusal can name a real `diff`. */
	shippedFile: string
	installedVersion: string | null
	shippedVersion: string
}

/**
 * The command a human runs to see what their fork changed, before deciding
 * whether to take the shipped copy. One builder, because `doctor` and `fix`
 * both print it and two independently-built strings drift (#484). Always
 * `realFile`: through a stow symlink the nominal path is the link, and the
 * bytes worth reading are in the dotfiles checkout it points at.
 *
 * Both paths are user-influenced — `--skills-dir` is an argument (#490) and
 * `realFile` is wherever a symlink happens to point — and this line exists to
 * be pasted into a shell, so it is quoted rather than merely interpolated
 * (#493). Quoting beats refusing to emit a command: single quotes make an odd
 * path *more* visible, not less, and keep the hint usable in the odd case
 * instead of only the ordinary one.
 */
export function skillDiffCommand(paths: { realFile: string; shippedFile: string }): string {
	return `diff ${shellQuote(paths.realFile)} ${shellQuote(paths.shippedFile)}`
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
	name: string = SHIPPED_SKILL,
	{ force = false }: { force?: boolean } = {}
): Promise<SkillInstallResult> {
	const shipped = await readShippedSkill(name)
	const file = path.join(skillsDir, name, 'SKILL.md')
	const existing = (await fs.pathExists(file)) ? await fs.readFile(file, 'utf8') : null
	const installedVersion = existing ? readSkillVersion(existing) : null
	const viaSymlink = await isSymlink(file)
	const base = {
		name,
		contentState: existing === null ? null : classifySkillContent(existing, shipped.content),
		file,
		viaSymlink,
		shippedFile: shipped.file,
		realFile: viaSymlink ? await fs.realpath(file) : file,
		installedVersion,
		shippedVersion: shipped.version,
	}

	if (installedVersion && isNewerVersion(installedVersion, shipped.version)) {
		return { ...base, status: 'declined-downgrade' }
	}

	// Only `pristine` content is provably ours to replace. Anything else is a
	// fork (or unprovable, which for a destructive write is the same thing) and
	// stays a human decision — the same rule `fix copied-assets` follows (#448).
	if (!force && base.contentState !== null && base.contentState !== 'pristine') {
		return { ...base, status: 'declined-fork' }
	}

	const next = stampSkill(shipped.content, shipped.version)
	if (existing === next) return { ...base, status: 'up-to-date' }

	await fs.ensureDir(path.dirname(file))
	await fs.writeFile(file, next)
	return { ...base, status: existing === null ? 'installed' : 'updated' }
}

export interface SkillStatus {
	/** Null when no skills directory could be resolved at all. */
	file: string | null
	/**
	 * Where the bytes actually live — `file` resolved when it is a symlink into a
	 * dotfiles checkout. Null when nothing is installed, so there is nothing to
	 * resolve. See `SkillInstallResult.realFile`.
	 */
	realFile: string | null
	/** The shipped source inside this package, so doctor can name a real `diff`. */
	shippedFile: string
	installed: boolean
	/** Null when installed but unstamped — a copy that predates this feature. */
	installedVersion: string | null
	shippedVersion: string
	/** Null when nothing is installed. */
	contentState: SkillContentState | null
	/**
	 * True when nothing is installed, or what is installed predates what we ship
	 * *and* `fix` would actually replace it. A fork is never "needs install":
	 * pointing at a fix that will refuse is worse than saying nothing.
	 */
	needsInstall: boolean
}

/** Read-only counterpart of `installClaudeSkill`, for doctor. */
export async function claudeSkillStatus(
	name: string = SHIPPED_SKILL,
	explicit?: string
): Promise<SkillStatus> {
	const shipped = await readShippedSkill(name)
	const { dir } = await resolveSkillsDir(explicit)
	const absent = {
		realFile: null,
		shippedFile: shipped.file,
		installed: false,
		installedVersion: null,
		shippedVersion: shipped.version,
		contentState: null,
		needsInstall: true,
	}
	if (!dir) return { file: null, ...absent }
	const file = path.join(dir, name, 'SKILL.md')
	if (!(await fs.pathExists(file))) return { file, ...absent }
	const content = await fs.readFile(file, 'utf8')
	const installedVersion = readSkillVersion(content)
	const contentState = classifySkillContent(content, shipped.content)
	const behind = installedVersion === null || isNewerVersion(shipped.version, installedVersion)
	return {
		file,
		realFile: (await isSymlink(file)) ? await fs.realpath(file) : file,
		shippedFile: shipped.file,
		installed: true,
		installedVersion,
		shippedVersion: shipped.version,
		contentState,
		needsInstall: behind && contentState === 'pristine',
	}
}
