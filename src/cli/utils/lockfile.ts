import path from 'node:path'
import fs from 'fs-extra'
import packageJson from '../../../package.json' with { type: 'json' }
import { CONFIG_SCHEMA, validateProjectConfig } from '../commands/setup-presets.js'
import type { ProjectConfig } from '../commands/setup.js'
import { SHIPPED_SKILLS } from '../generators/claude-skills.js'

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

/**
 * How much of the repo's workflow assumes a recommended MCP server (#534).
 * Signals priority to a human reading the file, and nothing more — no code
 * branches on it beyond printing it.
 */
export const MCP_IMPORTANCE = ['nice-to-have', 'important', 'critical'] as const
export type McpImportance = (typeof MCP_IMPORTANCE)[number]

/**
 * One advisory MCP entry. Deliberately has no `command`, `args` or `env`: the
 * lockfile says *what and why*, the native `.mcp.json` says *how*, and the human
 * says *whether*. Executable server config committed here would be an install
 * directive, and MCP servers run code.
 */
export interface McpRecommendation {
	/** The server name as it would appear in `.mcp.json`. */
	name: string
	importance: McpImportance
	/** One line of free text — the thing `.mcp.json` structurally cannot say. */
	why: string
}

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
	/**
	 * Agent skills this repo's workflows depend on (#533), from `SHIPPED_SKILLS`.
	 * Absence of a skill fails loudly; a stale installed copy fails silently, and
	 * staleness is the one that hurts — so `doctor` compares each listed skill's
	 * stamped hash against what this package ships.
	 *
	 * Check and hint only. A committed file that directs writes into `~/` is the
	 * shape of a supply-chain attack even when the content is benign, so nothing
	 * here ever runs `fix claude-skills`; doctor says stale, the human runs it.
	 */
	requiredSkills?: string[]
	/**
	 * Advisory MCP metadata (#534) — never an install directive. See
	 * `McpRecommendation`.
	 */
	mcp?: {
		recommended?: McpRecommendation[]
	}
	writtenBy: string
	writtenAt: string
}

/**
 * JSON Schema for the lockfile, published with the docs site at the exact URL
 * every written lockfile's `$schema` points to (#529). The `satisfies` clauses
 * bind the property lists to the Lockfile interface, so adding or removing a
 * field on the type is a compile error until the schema names it too. The
 * committed copy under apps/docs/static/schemas/ is regenerated with
 * `pnpm schema:generate` and gated by tests/cli/utils/lockfile-schema.test.ts.
 *
 * A function, not a const: lockfile.ts sits in an import cycle with
 * setup-presets.ts (via the swift scaffolder) and with claude-skills.ts (via
 * copy-preset.ts), so CONFIG_SCHEMA and SHIPPED_SKILLS are both in their TDZ
 * while this module evaluates. Reading them here, at call time, is safe.
 */
// ponytail: key sets are compiler-checked against the type; a changed field
// *type* (string → number) still needs both lines edited by hand.
export function lockfileSchema() {
	// The published ProjectConfig schema, embedded (not $ref'd) so editors
	// resolve the whole lockfile schema in one fetch. Its own $schema/$id are
	// dropped: a nested $id would reset the base URI mid-document.
	const { $schema: _meta, $id: _id, ...projectConfigSchema } = CONFIG_SCHEMA
	return {
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		$id: LOCKFILE_SCHEMA_URL,
		title: 'Lockfile',
		description: `${LOCKFILE_NAME} — the committed record of what @rtorcato/repo-tooling set up in this repo. Written by \`setup\` and \`fix\`, read by \`doctor\`.`,
		type: 'object',
		additionalProperties: false,
		required: ['version', 'config', 'writtenBy', 'writtenAt'],
		properties: {
			$schema: {
				type: 'string',
				description: 'URL of this schema; stamped on every write so editors validate the file.',
			},
			version: {
				type: 'integer',
				description: `Lockfile format version (current: ${LOCKFILE_VERSION}). v2 added config.language, v3 added assets; older files are migrated on read.`,
			},
			config: {
				...projectConfigSchema,
				description: 'The resolved setup configuration this repo was scaffolded or audited with.',
			},
			assets: {
				type: 'object',
				additionalProperties: { type: 'string' },
				description:
					"Preset name → sha256 of the asset's pristine content at copy time. Lets doctor tell a deliberate local fork (file differs from this hash) from a copy the package has since moved past (file still matches, shipped asset doesn't). A preset with no entry is untracked, never drifted.",
			},
			aiLoop: {
				type: 'object',
				additionalProperties: false,
				description:
					'Settings for the ai-issue-loop skills. Repo-scoped on purpose: committed here they travel with the repo and survive a new laptop.',
				properties: {
					agentUser: {
						type: 'string',
						description:
							'Login that in-flight work is assigned to, so `assignee` says whose turn it is. Must be an assignable collaborator; the skills verify that at runtime.',
					},
				} satisfies Record<keyof NonNullable<Lockfile['aiLoop']>, object>,
			},
			requiredSkills: {
				type: 'array',
				items: { type: 'string', enum: SHIPPED_SKILLS },
				description:
					'Agent skills this repo\'s workflows depend on. doctor compares each installed copy\'s stamped hash against the shipped one and reports a missing or stale skill — always as "not configured", never drift, because it probes the machine rather than the repo. It never runs the fixer for you.',
			},
			mcp: {
				type: 'object',
				additionalProperties: false,
				description:
					"Advisory MCP metadata: names, importance and reasons only, never an install directive. Executable server config belongs in the native .mcp.json, which carries Claude Code's own first-use consent prompt.",
				properties: {
					recommended: {
						type: 'array',
						description:
							"MCP servers this repo's workflow assumes. doctor reports which of them .mcp.json does not declare, informationally — it never installs or enables one.",
						items: {
							type: 'object',
							additionalProperties: false,
							required: ['name', 'importance', 'why'],
							properties: {
								name: {
									type: 'string',
									description: 'The server name as it would appear in .mcp.json.',
								},
								importance: {
									type: 'string',
									enum: MCP_IMPORTANCE,
									description: "How much of the repo's workflow assumes the server.",
								},
								why: {
									type: 'string',
									description:
										'One line on what the server is for — the thing .mcp.json structurally cannot say.',
								},
							} satisfies Record<keyof McpRecommendation, object>,
						},
					},
				} satisfies Record<keyof NonNullable<Lockfile['mcp']>, object>,
			},
			writtenBy: {
				type: 'string',
				description: 'Package name and version that last wrote this file.',
			},
			writtenAt: {
				type: 'string',
				format: 'date-time',
				description: 'ISO 8601 timestamp of the last write.',
			},
		} satisfies Record<keyof Lockfile, object>,
	}
}

/**
 * Upgrade an older lockfile in-memory. Only touches files older than the
 * current version, so a newer-than-supported file is left as-is for
 * checkLockfile to flag. `version` stays at the on-disk value — bumping it here
 * hid every older file from doctor's older-than-current check (#531); the write
 * path stamps LOCKFILE_VERSION anyway, so the file is v3 next time it's saved.
 */
function migrate(lock: Lockfile): Lockfile {
	if (lock.version >= LOCKFILE_VERSION) return lock
	return {
		...lock,
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
		...(existing?.requiredSkills ? { requiredSkills: existing.requiredSkills } : {}),
		...(existing?.mcp ? { mcp: existing.mcp } : {}),
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
