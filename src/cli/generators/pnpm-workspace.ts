import path from 'node:path'
import fs from 'fs-extra'

/**
 * Since pnpm 10, repo-wide settings live in `pnpm-workspace.yaml` rather than
 * `.npmrc` — for single-package repos too, not just workspaces. These are the
 * family-wide settings that otherwise get hand-copied and drift (#314).
 *
 * Every write here is a merge: `pnpm-workspace.yaml` also carries the repo's own
 * `packages:` globs and hand-vetted `allowBuilds` entries, so nothing is
 * rewritten and no existing value is overridden.
 */
export const WORKSPACE_FILE = 'pnpm-workspace.yaml'

/**
 * pnpm's `minimumReleaseAge` cutoff holds back freshly published versions —
 * good against a typosquat or a hijacked account, but it also stalls every
 * consumer of a same-day fix in a sibling package for 24h. Exempting the
 * repo's *own* scope trades that off only for packages it already publishes.
 *
 * Derived from the consuming package's name rather than hardcoded: this is a
 * public CLI, and writing one organisation's scope into a stranger's config
 * would loosen a supply-chain guard for packages they neither use nor chose.
 * An unscoped package gets no such setting at all — there is no "family" to
 * infer, and guessing one would be worse than leaving it alone.
 *
 * One glob covers a whole scope: pnpm matches these entries with
 * `@pnpm/config.matcher`, so there's no package list to keep in sync.
 *
 * The scope is matched against npm's own name charset, not just "anything up
 * to the slash": the name comes verbatim from a pre-existing `package.json`
 * and is never validated as an npm name on the way here, so a scope of a lone
 * wildcard would otherwise be taken as a glob and exempt every scoped package
 * from the release-age delay. An unparseable scope gets no setting at all.
 */
export function familyGlob(packageName: unknown): string | null {
	const name = typeof packageName === 'string' ? packageName : ''
	const scope = /^(@[a-z0-9-][a-z0-9._-]*)\//i.exec(name)?.[1]
	return scope ? `${scope}/*` : null
}

/** Bundlers that pull in esbuild, whose install script pnpm 11 refuses to run unapproved. */
const ESBUILD_BUNDLERS = ['esbuild', 'tsup', 'vite']

/** True when the repo depends on a bundler that drags esbuild in. */
export function dependsOnEsbuild(deps: Record<string, string>): boolean {
	return ESBUILD_BUNDLERS.some((name) => name in deps)
}

/**
 * The lines of a top-level YAML block, e.g. everything indented under
 * `allowBuilds:`. Returns null when the key isn't present at all. Hand-rolled
 * because adding a YAML parser to a 5-dependency CLI to read three keys isn't
 * worth it — and the same shape is already parsed this way in `misc.ts`.
 */
function section(yaml: string, key: string): string[] | null {
	const lines = yaml.split('\n')
	const start = lines.findIndex((line) => line.startsWith(`${key}:`))
	if (start === -1) return null
	const body: string[] = []
	for (const line of lines.slice(start + 1)) {
		if (/^\S/.test(line)) break // a new top-level key ends the block
		body.push(line)
	}
	return body
}

interface Setting {
	/** How doctor names this setting when it's missing. */
	label: string
	/** Only managed when this returns true for the repo. */
	applies: (needsEsbuild: boolean) => boolean
	satisfied: (yaml: string) => boolean
	/** Merged in when absent: appended as a new block, or inserted under an existing key. */
	key: string
	block: string
	item: string
}

/**
 * The managed settings for one repo. A function rather than a constant because
 * the release-age exemption is scope-derived, and a repo with no scope to
 * derive doesn't get that setting at all.
 */
function settingsFor(glob: string | null): Setting[] {
	return glob ? [...BASE_SETTINGS, releaseAgeSetting(glob)] : BASE_SETTINGS
}

function releaseAgeSetting(glob: string): Setting {
	return {
		label: `minimumReleaseAgeExclude: ${glob}`,
		applies: () => true,
		satisfied: (yaml) =>
			(section(yaml, 'minimumReleaseAgeExclude') ?? []).some((l) => l.includes(glob)),
		key: 'minimumReleaseAgeExclude',
		block: `# Exempt this package's own scope from pnpm's minimumReleaseAge cutoff, so a
# same-day fix in a sibling package is installable today rather than tomorrow.
minimumReleaseAgeExclude:
  - '${glob}'
`,
		item: `  - '${glob}'`,
	}
}

const BASE_SETTINGS: Setting[] = [
	{
		label: 'verifyDepsBeforeRun: false',
		applies: () => true,
		// Any explicit value counts — a repo that deliberately opted into
		// verification shouldn't be nagged back to the family default.
		satisfied: (yaml) => /^verifyDepsBeforeRun:/m.test(yaml),
		key: 'verifyDepsBeforeRun',
		block: `# Don't re-verify node_modules on every script run — the check costs a
# second per invocation and CI installs with --frozen-lockfile anyway.
verifyDepsBeforeRun: false
`,
		item: '',
	},
	{
		label: 'allowBuilds: esbuild',
		applies: (needsEsbuild) => needsEsbuild,
		satisfied: (yaml) => (section(yaml, 'allowBuilds') ?? []).some((l) => /^\s*esbuild:/.test(l)),
		key: 'allowBuilds',
		block: `# pnpm 11 reads build-script approvals from this map, not the older
# onlyBuiltDependencies list, and fails the install outright without them.
allowBuilds:
  esbuild: true
`,
		item: '  esbuild: true',
	},
]

/** Managed settings absent from `yaml`, named as doctor reports them. */
export function missingPnpmSettings(
	yaml: string,
	needsEsbuild: boolean,
	glob: string | null
): string[] {
	return settingsFor(glob)
		.filter((s) => s.applies(needsEsbuild) && !s.satisfied(yaml))
		.map((s) => s.label)
}

/** Insert `item` directly under an existing `key:` line, keeping the rest untouched. */
function insertUnder(yaml: string, key: string, item: string): string {
	const lines = yaml.split('\n')
	const at = lines.findIndex((line) => line.startsWith(`${key}:`))
	lines.splice(at + 1, 0, item)
	return lines.join('\n')
}

/** Merge every missing managed setting into `yaml` and return the new contents. */
export function upsertPnpmSettings(
	yaml: string,
	needsEsbuild: boolean,
	glob: string | null
): string {
	let next = yaml
	for (const setting of settingsFor(glob)) {
		if (!setting.applies(needsEsbuild) || setting.satisfied(next)) continue
		if (setting.item && section(next, setting.key)) {
			next = insertUnder(next, setting.key, setting.item)
		} else {
			next = `${next.replace(/\n*$/, '\n')}\n${setting.block}`
		}
	}
	return next
}

/**
 * Merge the managed pnpm settings into `pnpm-workspace.yaml`, creating it when
 * absent. Returns the relative path if anything changed, else null.
 */
export async function ensurePnpmSettings(
	targetDir: string,
	needsEsbuild: boolean,
	glob: string | null
): Promise<string | null> {
	const file = path.join(targetDir, WORKSPACE_FILE)
	const current = (await fs.pathExists(file)) ? await fs.readFile(file, 'utf-8') : ''
	const next = upsertPnpmSettings(current, needsEsbuild, glob)
	if (next === current) return null
	await fs.writeFile(file, next.replace(/^\n+/, ''))
	return WORKSPACE_FILE
}
