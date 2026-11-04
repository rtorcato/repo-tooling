/**
 * `fix changesets-migrate` (#967): move a semantic-release library to Changesets,
 * the one release flow the torcato.dev libraries share (#939). Merging the
 * Version Packages PR is the release, behind one `release` approval.
 */
import path from 'node:path'
import chalk from 'chalk'
import { FixerAbort, type Fixer } from '../../base/fixers.js'
import fs from '../../base/safe-fs.js'
import { SEMANTIC_RELEASE_FILES } from '../../cli/generators/build.js'
import {
	CI_WORKFLOW,
	RELEASE_WORKFLOW,
	releaseEnvironmentOf,
} from '../../cli/generators/github-actions.js'
import { WORKSPACE_FILE } from '../../cli/generators/pnpm-workspace.js'
import { copyPreset } from '../../cli/utils/copy-preset.js'
import { buildPresetConfig } from '../../cli/commands/setup-presets.js'
import { CHANGESETS_CLI_RANGE, RELEASE_TOOL_CHECK } from './checks.js'
import { NPM_NAME, type NpmExec, realNpmExec } from './npm-trust.js'
import { renderReleaseWorkflow, scriptsOf } from './ci.js'

const CHANGESETS_CONFIG = '.changeset/config.json'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
/** `semantic-release`, bare or behind a runner (`npx`, `pnpm exec`, ...) and only flags after it: a chained command (`&& node notify.js`) keeps the script. */
const SR_SCRIPT =
	/^(?:(?:npx|bunx|yarn|pnpm (?:exec|dlx))\s+)?(?:-\S+\s+)*semantic-release(?:\s+-[^\s;&|<>()$`]+)*\s*$/

/** The newest version npm serves for `name`; null when it was never published. */
export async function publishedVersion(name: string, npm: NpmExec): Promise<string | null> {
	// package.json is untrusted: refuse a name npm could parse as a flag.
	if (!NPM_NAME.test(name)) {
		throw new FixerAbort(
			'invalid-package-name',
			`package.json \`name\` (${name}) is not a valid npm package name`,
			'fix the name, then re-run `fix changesets-migrate`'
		)
	}
	const res = await npm(['view', '--', name, 'version'])
	if (res.ok) {
		const version = res.stdout.trim()
		if (!version) return null
		if (!SEMVER.test(version)) {
			throw new FixerAbort(
				'npm-view-failed',
				`npm returned an unexpected version for ${name}: ${version.slice(0, 40)}`,
				're-run `fix changesets-migrate`, or set `version` by hand'
			)
		}
		return version
	}
	if (/E404/.test(res.stderr)) return null
	// Fail closed: guessing here would seed Changesets with the wrong base version.
	throw new FixerAbort(
		'npm-view-failed',
		`could not read the published version of ${name} from npm: ${res.stderr.trim().split('\n')[0] ?? 'no output'}`,
		'check the network and `npm view` access, then re-run `fix changesets-migrate`'
	)
}

/** Lists the repo root `.` in a `packages:` block that omits it, or Changesets cannot see the root package. */
function listRootPackage(yaml: string): string {
	const lines = yaml.split('\n')
	const at = lines.findIndex((l) => /^packages:\s*$/.test(l))
	if (at === -1) return yaml
	const items: string[] = []
	for (const l of lines.slice(at + 1)) {
		if (/^\s*#/.test(l) || l.trim() === '') continue
		if (!/^\s+-\s/.test(l)) break
		items.push(
			l
				.replace(/^\s+-\s*/, '')
				.replace(/\s+#.*$/, '')
				.replace(/^['"]|['"]$/g, '')
		)
	}
	if (items.includes('.')) return yaml
	lines.splice(at + 1, 0, "  - '.'")
	return lines.join('\n')
}

export async function migrateToChangesets(
	targetDir: string,
	pkg: Record<string, unknown> | null,
	npm: NpmExec = realNpmExec
): Promise<string[]> {
	const pkgPath = path.join(targetDir, 'package.json')
	if (!pkg || pkg.private === true || typeof pkg.name !== 'string') {
		console.error(chalk.gray('   skipping — no public package to migrate'))
		return []
	}
	const srFiles: string[] = []
	for (const f of SEMANTIC_RELEASE_FILES) {
		if (await fs.pathExists(path.join(targetDir, f))) srFiles.push(f)
	}
	const deps = (k: string) => (pkg[k] ?? {}) as Record<string, string>
	const isSr = (n: string) => n === 'semantic-release' || n.startsWith('@semantic-release/')
	const hasSrDeps = [
		...Object.keys(deps('dependencies')),
		...Object.keys(deps('devDependencies')),
	].some(isSr)
	if (srFiles.length === 0 && !('release' in pkg) && !hasSrDeps) {
		console.error(chalk.gray('   skipping — not on semantic-release'))
		return []
	}

	// Network first, so a failure leaves the repo untouched.
	const version = await publishedVersion(pkg.name, npm)

	// A release job left in ci.yml belongs to `fix github-actions`, which migrates it.
	const ciPath = path.join(targetDir, CI_WORKFLOW)
	if (
		(await fs.pathExists(ciPath)) &&
		/semantic-release/.test(await fs.readFile(ciPath, 'utf-8'))
	) {
		throw new FixerAbort(
			'release-job-in-ci',
			`${CI_WORKFLOW} still runs semantic-release`,
			'run `fix github-actions` first to move the release job to release.yml, then re-run'
		)
	}

	const written: string[] = []
	for (const f of srFiles) {
		await fs.remove(path.join(targetDir, f))
		written.push(f)
	}

	const next = { ...pkg } as Record<string, unknown>
	delete next.release
	for (const k of ['dependencies', 'devDependencies']) {
		if (!(k in next)) continue
		const kept = Object.fromEntries(Object.entries(deps(k)).filter(([n]) => !isSr(n)))
		next[k] = kept
	}
	const scripts = { ...((next.scripts ?? {}) as Record<string, string>) }
	if (SR_SCRIPT.test(scripts.release ?? '')) delete scripts.release
	if (!scripts.changeset) scripts.changeset = 'changeset'
	next.scripts = scripts
	next.devDependencies = {
		...(next.devDependencies as Record<string, string>),
		'@changesets/cli': CHANGESETS_CLI_RANGE,
	}
	if (version) next.version = version
	// Keep the file's own indent (tabs included) so the diff stays small.
	const indent = /^([ \t]+)"/m.exec(await fs.readFile(pkgPath, 'utf-8'))?.[1] ?? 2
	await fs.writeJson(pkgPath, next, { spaces: indent })
	written.push('package.json')

	if (!(await fs.pathExists(path.join(targetDir, CHANGESETS_CONFIG)))) {
		written.push((await copyPreset('changesets', targetDir)).target)
	}

	const wsPath = path.join(targetDir, WORKSPACE_FILE)
	if (await fs.pathExists(wsPath)) {
		const yaml = await fs.readFile(wsPath, 'utf-8')
		const listed = listRootPackage(yaml)
		if (listed !== yaml) {
			await fs.writeFile(wsPath, listed)
			written.push(WORKSPACE_FILE)
		}
	}

	// Keep the `environment:` name: npm trusted publishing is bound to it and to the file name.
	const releasePath = path.join(targetDir, RELEASE_WORKFLOW)
	const existing = (await fs.pathExists(releasePath))
		? await fs.readFile(releasePath, 'utf-8')
		: null
	const environment = releaseEnvironmentOf(existing)
	const release = renderReleaseWorkflow(
		{ ...buildPresetConfig('library', pkg.name), changesets: true, semanticRelease: false },
		{ scripts: scriptsOf(pkg), releaseEnvironment: environment }
	)
	if (release) {
		await fs.outputFile(releasePath, release)
		written.push(RELEASE_WORKFLOW)
	}

	console.error(
		chalk.yellow(
			`   ${RELEASE_WORKFLOW} was regenerated from the Changesets template — re-add any custom steps; run \`pnpm install\` to refresh the lockfile${version ? '' : ` (${pkg.name} is not on npm yet, so its version was left as is)`}`
		)
	)
	if (!environment) {
		console.error(
			chalk.yellow(
				'   the old release workflow had no `environment:` — run `fix release-environment` to put the publish job behind a required reviewer'
			)
		)
	}
	return written
}

export const CHANGESETS_MIGRATE_FIXER: Fixer = {
	target: 'changesets-migrate',
	description:
		'Migrate a semantic-release library to Changesets: drop the release config and deps, add .changeset/config.json and @changesets/cli, set package.json version to the latest on npm, rewrite release.yml as the two-job Version Packages flow',
	appliesTo: [RELEASE_TOOL_CHECK],
	outputs: ['.changeset/config.json', 'package.json', RELEASE_WORKFLOW],
	canFixDrift: true,
	// Moving the release tool changes what a merge does, so only when named.
	explicitOnly: true,
	async run({ targetDir, pkg }) {
		return { filesWritten: await migrateToChangesets(targetDir, pkg) }
	},
}
