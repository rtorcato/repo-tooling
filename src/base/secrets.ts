import path from 'node:path'
import fs from 'fs-extra'
import { type GhExec, jobEnvironment, realGhExec, workflowJobs } from './github-settings.js'
import type { CheckResult } from './types.js'

/**
 * `secrets.NAME` references in the workflows, checked against the names GitHub
 * lists as configured (#685). Names only — the API never returns values, and
 * nothing here reads or writes one.
 */

export interface SecretUse {
	name: string
	/** Workflow file (or `action.yml`) that references it. */
	file: string
	job: string
	environment: string | null
	/** Referenced as `secrets.NAME || secrets.GITHUB_TOKEN` — fails late, not early. */
	fallback: boolean
}

export interface RequiredSecret {
	name: string
	usedBy: string[]
	whereToGet: string | null
	fallback: boolean
}

const WHERE_TO_GET: Record<string, string> = {
	RELEASE_TOKEN:
		'a fine-grained PAT with contents: write that can push past branch protection (not needed with the RELEASE_APP_* secrets)',
	RELEASE_APP_ID: "the release GitHub App's App ID or Client ID",
	RELEASE_APP_PRIVATE_KEY: "a private key (.pem) generated in the release GitHub App's settings",
}

/**
 * Release credentials (#1030): a GitHub App (both `RELEASE_APP_*` secrets) or
 * `RELEASE_TOKEN`. Either one fully set covers the other, so a repo on the App
 * is not nagged for a PAT. With neither, every use falls back to GITHUB_TOKEN.
 */
const RELEASE_APP_SECRETS = ['RELEASE_APP_ID', 'RELEASE_APP_PRIVATE_KEY']
const RELEASE_CREDENTIALS = new Set([...RELEASE_APP_SECRETS, 'RELEASE_TOKEN'])
const NO_RELEASE_CREDENTIALS_HINT =
	"Version Packages PRs opened with GITHUB_TOKEN wait on 'Approve and run workflows' and their required check never runs. Set RELEASE_APP_ID and RELEASE_APP_PRIVATE_KEY (one GitHub App installed on every repo), or RELEASE_TOKEN"

const withoutComments = (s: string) =>
	s
		.split('\n')
		.filter((l) => !l.trimStart().startsWith('#'))
		.join('\n')

function usesIn(text: string, file: string, job: string, environment: string | null): SecretUse[] {
	const clean = withoutComments(text)
	const found = new Map<string, SecretUse>()
	for (const m of clean.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
		const name = m[1] as string
		if (name === 'GITHUB_TOKEN' || found.has(name)) continue
		// The App secrets only mint a token, and the job falls back past it.
		const fallback =
			new RegExp(`secrets\\.${name}\\s*\\|\\|\\s*secrets\\.GITHUB_TOKEN`).test(clean) ||
			(RELEASE_APP_SECRETS.includes(name) && /\|\|\s*secrets\.GITHUB_TOKEN/.test(clean))
		found.set(name, { name, file, job, environment, fallback })
	}
	return [...found.values()]
}

/** Every non-GITHUB_TOKEN secret the workflows (and a composite action.yml) reference. */
export async function collectSecretUses(dir: string): Promise<SecretUse[]> {
	const uses: SecretUse[] = []
	const wfDir = path.join(dir, '.github', 'workflows')
	try {
		const files = (await fs.pathExists(wfDir)) ? (await fs.readdir(wfDir)).sort() : []
		for (const f of files) {
			if (!/\.ya?ml$/.test(f)) continue
			const content = await fs.readFile(path.join(wfDir, f), 'utf-8')
			for (const [job, body] of workflowJobs(content)) {
				uses.push(...usesIn(body, f, job, jobEnvironment(withoutComments(body))))
			}
		}
		for (const a of ['action.yml', 'action.yaml']) {
			const p = path.join(dir, a)
			if (await fs.pathExists(p)) uses.push(...usesIn(await fs.readFile(p, 'utf-8'), a, '-', null))
		}
	} catch {
		return []
	}
	return uses
}

/** One entry per secret name, for setup's Next Steps. */
export function requiredSecrets(uses: SecretUse[]): RequiredSecret[] {
	const byName = new Map<string, RequiredSecret>()
	for (const u of uses) {
		const r = byName.get(u.name) ?? {
			name: u.name,
			usedBy: [],
			whereToGet: WHERE_TO_GET[u.name] ?? null,
			fallback: true,
		}
		if (!r.usedBy.includes(u.file)) r.usedBy.push(u.file)
		r.fallback &&= u.fallback
		byName.set(u.name, r)
	}
	return [...byName.values()]
}

/** `gh secret set` lines plus where-to-get, for every secret in the list. */
export function secretHints(secrets: RequiredSecret[]): string[] {
	return secrets.map((s) => `gh secret set ${s.name}${s.whereToGet ? `  # ${s.whereToGet}` : ''}`)
}

async function listNames(gh: GhExec, endpoint: string): Promise<Set<string> | null> {
	const r = await gh(['api', `${endpoint}?per_page=100`])
	if (!r.ok) return null
	try {
		const d = JSON.parse(r.stdout) as { secrets?: Array<{ name?: string }> }
		return new Set((d.secrets ?? []).flatMap((s) => (s.name ? [s.name] : [])))
	} catch {
		return null
	}
}

export const SECRETS_CHECK = 'Repository secrets'
const CHECK = SECRETS_CHECK
const skip = (why: string): CheckResult => ({
	check: CHECK,
	status: 'skipped',
	detail: `not checked (${why})`,
})

export async function checkRepositorySecrets(dir: string, exec?: GhExec): Promise<CheckResult> {
	if (!(await fs.pathExists(path.join(dir, '.git')))) return skip('not a git repository')
	const uses = await collectSecretUses(dir)
	if (uses.length === 0) return { check: CHECK, status: 'ok', detail: 'no secrets referenced' }

	const gh: GhExec = exec ?? ((args, stdin) => realGhExec(args, stdin, dir))
	const repo = await listNames(gh, 'repos/{owner}/{repo}/actions/secrets')
	if (!repo) return skip("can't list secrets — needs gh with admin access")
	// Best effort: an org scope that errors just contributes nothing.
	const org =
		(await listNames(gh, 'repos/{owner}/{repo}/actions/organization-secrets')) ?? new Set()
	const envs = new Map<string, Set<string> | null>()
	for (const e of new Set(uses.flatMap((u) => (u.environment ? [u.environment] : [])))) {
		envs.set(e, await listNames(gh, `repos/{owner}/{repo}/environments/${e}/secrets`))
	}

	const unset = uses.filter((u) => {
		if (repo.has(u.name) || org.has(u.name)) return false
		if (!u.environment) return true
		const env = envs.get(u.environment)
		// An unreadable environment can't prove absence.
		return env ? !env.has(u.name) : false
	})
	const referenced = new Set(uses.map((u) => u.name))
	const isSet = (name: string) => referenced.has(name) && !unset.some((u) => u.name === name)
	const releaseCredentials = RELEASE_APP_SECRETS.every(isSet) || isSet('RELEASE_TOKEN')
	const missing = releaseCredentials ? unset.filter((u) => !RELEASE_CREDENTIALS.has(u.name)) : unset
	if (missing.length === 0) {
		return { check: CHECK, status: 'ok', detail: 'all referenced secrets are set' }
	}

	const hard = missing.some((u) => !u.fallback)
	const names = missing
		.map((u) => `${u.name} (${u.file})${u.fallback ? ' [falls back to GITHUB_TOKEN]' : ''}`)
		.join(', ')
	return {
		check: CHECK,
		status: hard ? 'missing' : 'drift',
		detail: `not set: ${names}. Dependabot-triggered runs read Dependabot secrets, not these`,
		hint: [
			// Only a workflow that mints the App token opens Version Packages PRs.
			...(missing.some((u) => RELEASE_APP_SECRETS.includes(u.name))
				? [NO_RELEASE_CREDENTIALS_HINT]
				: []),
			...secretHints(requiredSecrets(missing)),
		].join('\n'),
	}
}
