/**
 * npm OIDC trusted publishing (#687): what the publishing job needs, whether the
 * registry has a trusted publisher wired to it, and the fixer that registers one.
 *
 * Everything that talks to npm goes through `NpmExec`, the same resolve-never-
 * reject seam as `GhExec`, so tests never touch the registry and a network or
 * auth failure degrades to "couldn't check" rather than a failed doctor run.
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import chalk from 'chalk'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import { FixerAbort, type Fixer } from '../../base/fixers.js'
import { type GhResult, jobEnvironment, workflowJobs } from '../../base/github-settings.js'
import type { CheckResult } from '../../base/types.js'
import { parseRepository } from '../../cli/generators/badges.js'

export type NpmExec = (args: string[]) => Promise<GhResult>

const NPM_TIMEOUT_MS = 15_000

/** Real `npm` runner — never rejects. Args are derived, never free text, and execFile runs no shell. */
export const realNpmExec: NpmExec = (args) =>
	new Promise((resolve) => {
		execFile('npm', args, { timeout: NPM_TIMEOUT_MS }, (err, stdout, stderr) => {
			const code = err ? (typeof err.code === 'number' ? err.code : null) : 0
			resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr), code })
		})
	})

export const NPM_OIDC_CHECK = 'npm OIDC publish'
export const NPM_TRUST_CHECK = 'npm trusted publisher'
export const NPM_TRUST_FIX = 'npm-trusted-publisher'

/** OIDC publish needs npm ≥ 11.5.1 — Node 22 bundles npm 10. */
export const NPM_OIDC_MIN = '11.5.1'
/** `npm trust` landed in npm 11.15.0. */
export const NPM_TRUST_MIN = '11.15.0'
export const NPM_UPGRADE_CMD = `npm install -g npm@^${NPM_OIDC_MIN}`

const NPM_UPGRADE = /\bnpm\s+(?:install|i)\s+(?:-g|--global)\s+npm@/
const PUBLISHES = /semantic-release|\bnpm\s+publish\b/

/** a ≥ b for dotted numeric versions (prerelease tags ignored). */
export function versionAtLeast(a: string, b: string): boolean {
	const pa = a.trim().split(/[.-]/).map(Number)
	const pb = b.split('.').map(Number)
	for (let i = 0; i < 3; i++) {
		const x = pa[i] ?? 0
		const y = pb[i] ?? 0
		if (Number.isNaN(x)) return false
		if (x !== y) return x > y
	}
	return true
}

export interface NpmPublishJob {
	/** Workflow filename, e.g. `ci.yml` — what npm's trusted publisher records. */
	file: string
	/** Job body with whole-line comments dropped (the whole file when no `jobs:` split). */
	body: string
	/** Whole workflow file, for the NPM_TOKEN scan (a secret can sit in `env:` at any level). */
	content: string
	environment: string | null
}

const uncommented = (s: string) =>
	s
		.split('\n')
		.filter((l) => !l.trimStart().startsWith('#'))
		.join('\n')

/** The first workflow job that publishes to npm, or null. Throws when the directory can't be read. */
export async function findNpmPublishJob(dir: string): Promise<NpmPublishJob | null> {
	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (!(await fs.pathExists(workflowsDir))) return null
	for (const file of (await fs.readdir(workflowsDir)).sort()) {
		if (!/\.ya?ml$/.test(file)) continue
		const content = await fs.readFile(path.join(workflowsDir, file), 'utf-8')
		if (!PUBLISHES.test(uncommented(content))) continue
		const jobs = [...workflowJobs(content).values()].map(uncommented)
		const body = jobs.find((b) => PUBLISHES.test(b)) ?? uncommented(content)
		return { file, body, content, environment: jobEnvironment(body) }
	}
	return null
}

/**
 * What the publishing job itself needs for OIDC: no NPM_TOKEN, `id-token: write`,
 * and an npm new enough to use the token.
 */
export function checkPublishJob(job: NpmPublishJob): CheckResult {
	const check = NPM_OIDC_CHECK
	const f = job.file
	if (/secrets\.NPM_TOKEN/.test(job.content)) {
		return {
			check,
			status: 'drift',
			detail: `${f} authenticates npm publish with NPM_TOKEN`,
			hint: 'Migrate to OIDC trusted publishing: add a Trusted Publisher for each published package on npmjs.com (Settings → Trusted Publisher), then run `fix github-actions` to drop NPM_TOKEN (the release job keeps `id-token: write`). npm is deprecating 2FA-bypass tokens.',
		}
	}
	// The grant may sit on the job or at workflow level (everything before `jobs:`).
	const workflowLevel = uncommented(job.content.split(/^jobs:/m)[0] ?? '')
	if (!/id-token:\s*write/.test(job.body) && !/id-token:\s*write/.test(workflowLevel)) {
		return {
			check,
			status: 'drift',
			detail: `${f}: the publishing job lacks \`id-token: write\` — npm can't mint an OIDC token`,
			hint: 'Add `permissions: { id-token: write }` to the publishing job (or run `fix github-actions`)',
		}
	}
	if (!NPM_UPGRADE.test(job.body)) {
		return {
			check,
			status: 'drift',
			detail: `${f}: the publishing job runs the npm bundled with Node — OIDC publish needs npm ≥ ${NPM_OIDC_MIN} and fails with ENEEDAUTH below it`,
			hint: `add \`${NPM_UPGRADE_CMD}\` before semantic-release`,
		}
	}
	return { check, status: 'ok', detail: `${f} publishes via OIDC (no NPM_TOKEN)` }
}

/** Everything a human (or agent) types on npmjs.com, or runs, to register the publisher. */
export interface NpmPublishGuide {
	package: string
	where: string
	organizationOrUser: string
	repository: string
	workflowFilename: string
	environment: string | null
	/** `npm trust github …` — needs npm ≥ 11.15.0, a 2FA login, and a package already on npm. */
	command: string
	/** First publish of a package that isn't on npm yet — OIDC can't do it (npm/cli#8544). */
	bootstrap: string[]
}

export function npmPublishGuide(opts: {
	name: string
	owner: string
	repo: string
	file: string
	environment: string | null
}): NpmPublishGuide {
	const env = opts.environment ? ` --env ${opts.environment}` : ''
	return {
		package: opts.name,
		where: 'npmjs.com → package → Settings → Trusted Publisher → GitHub Actions',
		organizationOrUser: opts.owner,
		repository: opts.repo,
		workflowFilename: opts.file,
		environment: opts.environment,
		command: `npm trust github ${opts.name} --file ${opts.file} --repo ${opts.owner}/${opts.repo}${env} --allow-publish`,
		bootstrap: [
			"Publish one version BELOW semantic-release's next one by hand: `npm publish --access public --provenance=false --otp=<code>`",
			`Register the trusted publisher: \`npx @rtorcato/repo-tooling fix ${NPM_TRUST_FIX}\` (or on npmjs.com)`,
			'Let CI take over — every later release publishes via OIDC',
		],
	}
}

/** The guide as text lines, for Next Steps and doctor hints. Never mentions an NPM_TOKEN secret. */
export function formatNpmPublishGuide(g: NpmPublishGuide, unpublished: boolean): string[] {
	const lines = [
		`On ${g.where}:`,
		`  Organization or user: ${g.organizationOrUser}`,
		`  Repository: ${g.repository}`,
		`  Workflow filename: ${g.workflowFilename}`,
	]
	if (g.environment) lines.push(`  Environment: ${g.environment}`)
	lines.push(`Or from a logged-in npm ≥ ${NPM_TRUST_MIN}: ${g.command}`)
	if (unpublished) {
		lines.push(
			`${g.package} isn't on npm yet — npm only accepts a trusted publisher for an existing package:`
		)
		for (const [i, s] of g.bootstrap.entries()) lines.push(`  ${i + 1}. ${s}`)
	}
	return lines
}

/** A trusted-publisher entry's string leaves, lowercased — npm's JSON shape is matched loosely. */
function stringsOf(v: unknown, out: string[] = []): string[] {
	if (typeof v === 'string') out.push(v.toLowerCase())
	else if (Array.isArray(v)) for (const x of v) stringsOf(x, out)
	else if (v && typeof v === 'object') for (const x of Object.values(v)) stringsOf(x, out)
	return out
}

/** `npm trust list --json` → its entries, whether npm wraps them or not. */
function trustEntries(json: unknown): unknown[] {
	if (Array.isArray(json)) return json
	if (json && typeof json === 'object') {
		const arr = Object.values(json).find(Array.isArray)
		if (arr) return arr
		return Object.keys(json).length > 0 ? [json] : []
	}
	return []
}

/**
 * Compare `npm trust list` entries against the publishing job. Returns null on a
 * match, else why nothing matches.
 * ponytail: matches on string leaves rather than a fixed schema — npm's JSON
 * shape isn't pinned in its docs; tighten once it is.
 */
export function trustMismatch(
	entries: unknown[],
	want: { nwo: string; file: string; environment: string | null }
): string | null {
	if (entries.length === 0) return 'no trusted publisher is registered'
	const nwo = want.nwo.toLowerCase()
	const file = want.file.toLowerCase()
	const env = want.environment?.toLowerCase() ?? null
	const forRepo = entries.filter((e) =>
		stringsOf(e).some((x) => x === nwo || x.endsWith(`/${nwo}`))
	)
	if (forRepo.length === 0) return `no trusted publisher for ${want.nwo}`
	const forFile = forRepo.filter((e) =>
		stringsOf(e).some((x) => x === file || x.endsWith(`/${file}`) || x.includes(`/${file}@`))
	)
	if (forFile.length === 0)
		return `the trusted publisher for ${want.nwo} names a different workflow (want ${want.file})`
	if (env && !forFile.some((e) => stringsOf(e).includes(env))) {
		return `the trusted publisher for ${want.nwo} has no \`${want.environment}\` environment, but the job declares one`
	}
	// The reverse (#785): npm rejects — as a 404 — every publish from a job that
	// omits the environment the publisher was registered with.
	const required = env ? [] : forFile.map(environmentOf)
	if (required.length > 0 && required.every(Boolean)) {
		return `the trusted publisher for ${want.nwo} requires the \`${required[0]}\` environment, but the publishing job declares none — add \`environment: ${required[0]}\` to the job`
	}
	return null
}

/** The first non-empty `environment` string anywhere in a trusted-publisher entry. */
function environmentOf(v: unknown): string | null {
	if (!v || typeof v !== 'object') return null
	for (const [k, x] of Object.entries(v)) {
		if (k.toLowerCase() === 'environment' && typeof x === 'string' && x) return x
		const inner = environmentOf(x)
		if (inner) return inner
	}
	return null
}

type TrustContext =
	| { skip: string; unpublished?: boolean; guide?: NpmPublishGuide }
	| { guide: NpmPublishGuide; nwo: string; job: NpmPublishJob }

const NPM_NAME = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/
const ENV_NAME = /^[\w.-]+$/

/** What the check and the fixer both need, or why it can't be had. Network only past the offline gates. */
async function trustContext(
	dir: string,
	pkg: Record<string, unknown> | null,
	npm: NpmExec,
	opts: { needLogin: boolean }
): Promise<TrustContext> {
	if (!pkg || pkg.private === true) return { skip: 'private package — no npm publish' }
	const name = typeof pkg.name === 'string' ? pkg.name : null
	if (!name) return { skip: 'package.json has no name' }
	// Untrusted (audited repo's package.json): reject anything npm could parse as a flag.
	if (!NPM_NAME.test(name)) return { skip: 'package.json `name` is not a valid npm package name' }
	let job: NpmPublishJob | null
	try {
		job = await findNpmPublishJob(dir)
	} catch {
		return { skip: 'unable to read .github/workflows/' }
	}
	if (!job) return { skip: 'no workflow publishes to npm' }
	if (job.environment && !ENV_NAME.test(job.environment)) {
		return { skip: 'the publish job declares an environment with unsupported characters' }
	}
	const repo = parseRepository(pkg.repository)
	if (!repo) return { skip: 'package.json `repository` names no GitHub repo' }
	const nwo = `${repo.owner}/${repo.repo}`
	const guide = npmPublishGuide({ name, ...repo, file: job.file, environment: job.environment })

	const view = await npm(['view', '--', name, 'version'])
	if (!view.ok) {
		if (/E404|404 Not Found/i.test(view.stderr)) {
			return { skip: `${name} is not on npm yet`, unpublished: true, guide }
		}
		return { skip: 'could not reach the npm registry', guide }
	}
	if (opts.needLogin && process.env.CI) return { skip: 'running in CI — no npm login', guide }
	const ver = await npm(['--version'])
	if (!ver.ok || !versionAtLeast(ver.stdout, NPM_TRUST_MIN)) {
		return {
			skip: `local npm ${ver.stdout.trim() || '?'} is older than ${NPM_TRUST_MIN} (\`npm install -g npm@^${NPM_TRUST_MIN}\`)`,
			guide,
		}
	}
	const who = await npm(['whoami'])
	if (!who.ok) return { skip: 'not logged in to npm (`npm login`)', guide }
	return { guide, nwo, job }
}

/**
 * Is a trusted publisher registered on npm, matching the publishing job? Every
 * "couldn't check" is `optional-missing` with the manual steps — never a failure.
 */
export async function checkNpmTrustedPublisher(
	dir: string,
	pkg: Record<string, unknown> | null,
	npm: NpmExec = realNpmExec
): Promise<CheckResult> {
	const check = NPM_TRUST_CHECK
	const ctx = await trustContext(dir, pkg, npm, { needLogin: true })
	if ('skip' in ctx) {
		return {
			check,
			status: 'optional-missing',
			detail: ctx.skip,
			...(ctx.guide && {
				hint: formatNpmPublishGuide(ctx.guide, ctx.unpublished === true).join('\n'),
			}),
		}
	}
	const list = await npm(['trust', 'list', '--json', '--', ctx.guide.package])
	let entries: unknown[] | null = null
	if (list.ok) {
		try {
			entries = trustEntries(JSON.parse(list.stdout || '[]'))
		} catch {
			entries = null
		}
	}
	if (!entries) {
		return {
			check,
			status: 'optional-missing',
			detail: 'could not read `npm trust list`',
			hint: formatNpmPublishGuide(ctx.guide, false).join('\n'),
		}
	}
	const why = trustMismatch(entries, {
		nwo: ctx.nwo,
		file: ctx.job.file,
		environment: ctx.job.environment,
	})
	if (why) {
		return {
			check,
			status: 'drift',
			detail: `${ctx.guide.package}: ${why}`,
			hint: `Run \`npx @rtorcato/repo-tooling fix ${NPM_TRUST_FIX}\`, or: ${ctx.guide.command}`,
		}
	}
	return {
		check,
		status: 'ok',
		detail: `${ctx.guide.package} trusts ${ctx.nwo} ${ctx.job.file}${ctx.job.environment ? ` (${ctx.job.environment})` : ''}`,
	}
}

/**
 * Register the trusted publisher with `npm trust github`, flags derived from the
 * publishing job. Dry-runs first and asks before the real call.
 */
export async function applyNpmTrustedPublisher(
	dir: string,
	pkg: Record<string, unknown> | null,
	assumeYes: boolean,
	npm: NpmExec = realNpmExec
): Promise<string[]> {
	const ctx = await trustContext(dir, pkg, npm, { needLogin: true })
	if ('skip' in ctx) {
		const hint = ctx.unpublished && ctx.guide ? ctx.guide.bootstrap.join(' → ') : undefined
		throw new FixerAbort('npm-trust-unavailable', ctx.skip, hint)
	}
	const args = [
		'trust',
		'github',
		'--file',
		ctx.job.file,
		'--repo',
		ctx.nwo,
		...(ctx.job.environment ? ['--env', ctx.job.environment] : []),
		'--allow-publish',
	]
	// `--` last so the name can never be read as a flag.
	const tail = ['--', ctx.guide.package]
	const dry = await npm([...args, '--dry-run', ...tail])
	if (!dry.ok) {
		throw new FixerAbort('npm-trust-failed', `npm trust --dry-run failed: ${dry.stderr.trim()}`)
	}
	console.error(chalk.gray(dry.stdout.trim()))
	if (!assumeYes) {
		if (!process.stdin.isTTY) return []
		const { confirm } = await inquirer.prompt([
			{
				type: 'confirm',
				name: 'confirm',
				message: 'Register this trusted publisher on npm?',
				default: false,
			},
		])
		if (confirm !== true) return []
	}
	const real = await npm([...args, '--yes', ...tail])
	if (!real.ok) throw new FixerAbort('npm-trust-failed', `npm trust failed: ${real.stderr.trim()}`)
	return [`npm trusted publisher for ${ctx.guide.package} (remote, via npm trust)`]
}

export const NPM_TRUST_FIXER: Fixer = {
	target: NPM_TRUST_FIX,
	description:
		'Register the npm trusted publisher (OIDC) for this package with `npm trust github`, derived from the publishing job (#687)',
	appliesTo: [NPM_TRUST_CHECK],
	outputs: ['npm trusted publisher (remote, via npm trust)'],
	// safe-add keeps `--diff` from shadow-running it (that would call npm for real);
	// explicitOnly because it changes registry state, like release-environment.
	riskLevel: 'safe-add',
	explicitOnly: true,
	canFixDrift: true,
	async run({ targetDir, pkg, assumeYes }) {
		return { filesWritten: await applyNpmTrustedPublisher(targetDir, pkg, assumeYes) }
	},
}
