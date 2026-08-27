import path from 'node:path'
import fs from 'fs-extra'
import { CONFIG_SCHEMA, validateProjectConfig } from '../commands/setup-presets.js'
import type { ProjectConfig } from '../commands/setup.js'
import { SHIPPED_SKILLS } from '../generators/claude-skills.js'
import { getToolVersion } from './version.js'

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
// v4 split the file into two subtrees with documented ownership (#559):
// `record` (tool-written, stamped) and `rules` (human-written, unstamped).
// Nothing was renamed or dropped — the flat v3 fields just moved into them.
export const LOCKFILE_VERSION = 4
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

/**
 * The tool-written half (#559): what `setup`/`fix` last did, stamped with the
 * version that did it. Only the tool writes here, so `writtenBy`/`writtenAt`
 * are provenance claims about exactly this subtree and nothing else — a hand
 * edit to `rules` no longer makes the stamp a lie.
 */
export interface LockfileRecord {
	config: ProjectConfig
	/**
	 * Preset name → sha256 of the asset's *pristine* content at copy time (#428).
	 * Lets doctor tell a deliberate local fork (`modified` — file differs from
	 * this hash) from a copy the package has since moved past (`stale` — file
	 * still matches this hash, but the shipped asset doesn't). A preset with no
	 * entry here is simply untracked; absence is not evidence of drift.
	 */
	assets?: Record<string, string>
	writtenBy: string
	writtenAt: string
}

/**
 * The human-written half (#559): the repo's stated rules, edited by hand and
 * reviewed in PRs. Deliberately unstamped — the tool carries this subtree
 * forward verbatim on every write and never claims authorship of it.
 */
export interface LockfileRules {
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
	/**
	 * Declared exceptions (#558): doctor check name (`CheckResult.check`) → the
	 * mandatory reason this repo deliberately deviates. doctor reports the check
	 * as `declared` (reason shown, never hidden) and it stops failing the run.
	 * An entry naming a check the run doesn't know is itself reported as drift,
	 * so a typo or a renamed check can't silently mute (or un-mute) anything.
	 */
	exceptions?: Record<string, string>
}

export interface Lockfile {
	$schema?: string
	version: number
	record: LockfileRecord
	rules?: LockfileRules
}

/**
 * The empty ruleset a repo with no stated rules gets (#571). `rules` used to
 * appear only via v1–v3 migration, so the repos this tool creates were exactly
 * the ones with nothing to edit and nothing to compare. Writing the containers
 * — with `$schema` stamped alongside — makes the file teach its own shape.
 *
 * Values, never defaults: every entry is empty, because a populated one would
 * be this tool asserting a rule on a repo whose humans have not stated any.
 */
export const DEFAULT_RULES: LockfileRules = {
	aiLoop: {},
	requiredSkills: [],
	mcp: { recommended: [] },
	exceptions: {},
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
		description: `${LOCKFILE_NAME} — two documents sharing one file: \`record\` is written by @rtorcato/repo-tooling (\`setup\` and \`fix\`) and stamped with provenance; \`rules\` is written by humans, reviewed in PRs, and never stamped. Both are read by \`doctor\`.`,
		type: 'object',
		additionalProperties: false,
		required: ['version', 'record'],
		properties: {
			$schema: {
				type: 'string',
				description: 'URL of this schema; stamped on every write so editors validate the file.',
			},
			version: {
				type: 'integer',
				description: `Lockfile format version (current: ${LOCKFILE_VERSION}). v2 added config.language, v3 added assets, v4 split the file into record/rules subtrees; older files are migrated on read.`,
			},
			record: {
				type: 'object',
				additionalProperties: false,
				required: ['config', 'writtenBy', 'writtenAt'],
				description:
					'The tool-written record of what setup/fix last did. Only the tool writes here — the writtenBy/writtenAt stamps are provenance claims about exactly this subtree.',
				properties: {
					config: {
						...projectConfigSchema,
						description:
							'The resolved setup configuration this repo was scaffolded or audited with.',
					},
					assets: {
						type: 'object',
						additionalProperties: { type: 'string' },
						description:
							"Preset name → sha256 of the asset's pristine content at copy time. Lets doctor tell a deliberate local fork (file differs from this hash) from a copy the package has since moved past (file still matches, shipped asset doesn't). A preset with no entry is untracked, never drifted.",
					},
					writtenBy: {
						type: 'string',
						description: 'Package name and version that last wrote the record subtree.',
					},
					writtenAt: {
						type: 'string',
						format: 'date-time',
						description: 'ISO 8601 timestamp of the last record write.',
					},
				} satisfies Record<keyof LockfileRecord, object>,
			},
			rules: {
				type: 'object',
				additionalProperties: false,
				description:
					"The human-written ruleset: the repo's stated intent, edited by hand and reviewed in PRs. The tool carries it forward verbatim on every write and never stamps it.",
				properties: {
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
						} satisfies Record<keyof NonNullable<LockfileRules['aiLoop']>, object>,
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
						} satisfies Record<keyof NonNullable<LockfileRules['mcp']>, object>,
					},
					exceptions: {
						type: 'object',
						additionalProperties: { type: 'string', minLength: 1 },
						description:
							'Declared exceptions: doctor check name → the reason this repo deliberately deviates. The reason is mandatory and non-empty — doctor shows the check as `declared` with it (never hidden) and stops failing the run for it. An entry naming a check doctor does not run is itself reported as drift.',
					},
				} satisfies Record<keyof LockfileRules, object>,
			},
		} satisfies Record<keyof Lockfile, object>,
	}
}

/** The flat v1–v3 layout: every field at the top level, no subtrees (#559). */
interface FlatLockfile {
	$schema?: string
	version: number
	config: ProjectConfig
	assets?: Record<string, string>
	aiLoop?: LockfileRules['aiLoop']
	requiredSkills?: string[]
	mcp?: LockfileRules['mcp']
	exceptions?: Record<string, string>
	writtenBy: string
	writtenAt: string
}

/**
 * Upgrade an older lockfile in-memory. Only touches files older than the
 * current version, so a newer-than-supported file is left as-is for
 * checkLockfile to flag. `version` stays at the on-disk value — bumping it here
 * hid every older file from doctor's older-than-current check (#531); the write
 * path stamps LOCKFILE_VERSION anyway, so the file is v4 next time it's saved.
 *
 * v1–v3 are flat: nest the fields into record/rules (#559), default language
 * to 'js' (v1, #140) and assets to {} (pre-v3, #428). Nothing is renamed.
 */
function migrate(raw: Record<string, unknown>): Lockfile {
	if ((raw.version as number) >= LOCKFILE_VERSION) return raw as unknown as Lockfile
	const flat = raw as unknown as FlatLockfile
	const rules: LockfileRules = {
		...(flat.aiLoop ? { aiLoop: flat.aiLoop } : {}),
		...(flat.requiredSkills ? { requiredSkills: flat.requiredSkills } : {}),
		...(flat.mcp ? { mcp: flat.mcp } : {}),
		...(flat.exceptions ? { exceptions: flat.exceptions } : {}),
	}
	return {
		...(flat.$schema ? { $schema: flat.$schema } : {}),
		version: flat.version,
		record: {
			config: { language: 'js', ...flat.config },
			assets: flat.assets ?? {},
			writtenBy: flat.writtenBy,
			writtenAt: flat.writtenAt,
		},
		...(Object.keys(rules).length > 0 ? { rules } : {}),
	}
}

/**
 * Normalize already-parsed JSON into a Lockfile, or null when it isn't one.
 * Split out of readLockfile so a lockfile fetched from somewhere other than the
 * filesystem — a reference repo, over `gh` — goes through the same migration
 * before anything reads it (#563).
 */
export function parseLockfile(raw: unknown): Lockfile | null {
	if (typeof raw !== 'object' || raw === null) return null
	const obj = raw as Record<string, unknown>
	if (typeof obj.version !== 'number') return null
	// v4+ keeps config under `record`; v1–v3 keep it at the top level (#559).
	const config =
		obj.version >= LOCKFILE_VERSION
			? (obj.record as Record<string, unknown> | undefined)?.config
			: obj.config
	if (typeof config !== 'object' || config === null) return null
	return migrate(obj)
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
		return parseLockfile((await fs.readJson(filepath)) as unknown)
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
	// not named here is dropped by the next `fix lockfile`. `rules` rides along
	// verbatim: it is the human's subtree, and the stamp says nothing about it.
	const existing = await readLockfile(dir)
	const carried = assets ?? existing?.record.assets
	const filepath = path.join(dir, LOCKFILE_NAME)
	const lockfile: Lockfile = {
		$schema: LOCKFILE_SCHEMA_URL,
		version: LOCKFILE_VERSION,
		record: {
			config,
			...(carried && Object.keys(carried).length > 0 ? { assets: carried } : {}),
			writtenBy: `@rtorcato/repo-tooling@${await getToolVersion()}`,
			writtenAt: new Date().toISOString(),
		},
		// A repo that has stated no rules gets the empty scaffold, not nothing (#571).
		rules: existing?.rules ?? DEFAULT_RULES,
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
	const merged: ProjectConfig = { ...existing.record.config, ...patch }
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
	await writeLockfile(dir, existing.record.config, { ...existing.record.assets, [preset]: hash })
	return true
}
