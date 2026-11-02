import { createRequire } from 'node:module'
import path from 'node:path'
import type { GhExec } from '../../base/github-settings.js'
import fs from '../../base/safe-fs.js'
import { type JsonSchema, validateAgainstSchema } from './json-schema.js'
import { type Lockfile, type LockfileRules, lockfileSchema, readLockfile } from './lockfile.js'
import { fetchFromGitHub, REFERENCE } from './reference-rules.js'

/**
 * `extends` (#947): a shared base of `rules` that a maintainer owns, merged under
 * the repo's own. The base is untrusted input from end to end, like a
 * `--rules-from` reference: the spec is shape-checked before it reaches a path or
 * an API call, the file is size-capped, and its `rules` are validated against the
 * published schema before anything reads them. Nothing here ever writes, so a
 * fixer can never put a base value into the repo's file or touch the base file.
 */

const MAX_BYTES = 128 * 1024
const RELATIVE = /^\.\.?\//
const GITHUB = /^github:([^/#]+\/[^/#]+)\/([^#]+)(?:#(.+))?$/
const FILE_SEGMENT = /^[A-Za-z0-9._-]+$/
// `@scope/pkg/path.json` or `pkg/path.json`: a package path always names a file.
const NPM = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:\/[A-Za-z0-9._-]+)+$/

export interface ExtendsReport {
	spec: string
	/** `skipped`: the base lives on GitHub and the run is `--offline`. */
	status: 'ok' | 'drift' | 'skipped'
	detail: string
	/** Dotted paths whose value comes from the base because the repo does not set them. */
	inherited: string[]
}

type Text = { ok: true; text: string } | { ok: false; reason: string }

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v)

/** Objects merge key by key; arrays and scalars are replaced whole, so the repo wins. */
function deepMerge(
	base: Record<string, unknown>,
	own: Record<string, unknown>
): Record<string, unknown> {
	const out = { ...base }
	for (const [key, value] of Object.entries(own)) {
		if (key === '__proto__') continue
		const inherited = out[key]
		out[key] = isObject(value) && isObject(inherited) ? deepMerge(inherited, value) : value
	}
	return out
}

function leafPaths(value: unknown, prefix = ''): string[] {
	if (!isObject(value)) return prefix ? [prefix] : []
	return Object.entries(value).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k))
}

async function readBase(dir: string, spec: string, exec: GhExec | undefined): Promise<Text> {
	if (RELATIVE.test(spec)) {
		const file = path.resolve(dir, spec)
		try {
			return { ok: true, text: await fs.readFile(file, 'utf8') }
		} catch (error) {
			return { ok: false, reason: `cannot read ${file}: ${(error as Error).message}` }
		}
	}
	const github = GITHUB.exec(spec)
	if (github) {
		const [, reference = '', file = '', ref] = github
		const segments = file.split('/')
		if (
			!REFERENCE.test(reference) ||
			!segments.every((s) => FILE_SEGMENT.test(s) && s !== '.' && s !== '..')
		) {
			return { ok: false, reason: `"${spec}" is not github:<owner>/<repo>/<path>[#<ref>]` }
		}
		return fetchFromGitHub(reference, exec, file, ref)
	}
	if (NPM.test(spec) && !spec.split('/').some((s) => s === '.' || s === '..')) {
		try {
			const file = createRequire(path.join(dir, 'package.json')).resolve(spec)
			return { ok: true, text: await fs.readFile(file, 'utf8') }
		} catch {
			return {
				ok: false,
				reason: `cannot resolve "${spec}" from ${dir}; is the package installed?`,
			}
		}
	}
	return {
		ok: false,
		reason: `"${spec}" is not a relative path (./…), an npm package path, or a github: ref`,
	}
}

function parseBase(
	spec: string,
	text: string
): { ok: true; rules: LockfileRules } | { ok: false; reason: string } {
	if (Buffer.byteLength(text) > MAX_BYTES) {
		return { ok: false, reason: `${spec} is larger than ${MAX_BYTES} bytes` }
	}
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch {
		return { ok: false, reason: `${spec} is not valid JSON` }
	}
	if (!isObject(raw) || !isObject(raw.rules)) {
		return { ok: false, reason: `${spec} has no "rules" object` }
	}
	// ponytail: one level only. A chain needs cycle detection; add it when a base wants a base.
	if ('extends' in raw)
		return { ok: false, reason: `${spec} has its own "extends", which is not followed` }
	const rulesSchema =
		(lockfileSchema().properties as unknown as Record<string, JsonSchema>).rules ?? {}
	const errors = validateAgainstSchema(raw.rules, rulesSchema)
	if (errors.length > 0) {
		return {
			ok: false,
			reason: `${spec} fails the published schema: ${errors.slice(0, 3).join('; ')}`,
		}
	}
	return { ok: true, rules: raw.rules as LockfileRules }
}

/**
 * The repo's lockfile with its `extends` base merged under `rules`, for readers
 * (`doctor`, the fixers). Never hand the result to `writeLockfile`: it would copy
 * the base into the repo's own file. Without `extends` this is `readLockfile`.
 */
export async function readEffectiveLockfile(
	dir: string,
	opts: { offline?: boolean; exec?: GhExec } = {}
): Promise<{ lock: Lockfile | null; report: ExtendsReport | null }> {
	const lock = await readLockfile(dir)
	const spec = lock?.extends
	if (!lock || spec === undefined) return { lock, report: null }
	const report = (status: ExtendsReport['status'], detail: string, inherited: string[] = []) => ({
		lock,
		report: { spec: String(spec), status, detail, inherited },
	})
	if (typeof spec !== 'string' || spec === '') {
		return report('drift', 'extends must be a non-empty string; no base rules applied')
	}
	if (opts.offline && spec.startsWith('github:')) {
		return report('skipped', `${spec} is read over gh, so --offline does not fetch it`)
	}
	const fail = (reason: string) =>
		report('drift', `could not read the base "${spec}": ${reason}; its rules are not applied`)
	const text = await readBase(dir, spec, opts.exec)
	if (!text.ok) return fail(text.reason)
	const base = parseBase(spec, text.text)
	if (!base.ok) return fail(base.reason)
	const own = (lock.rules ?? {}) as Record<string, unknown>
	const ownLeaves = new Set(leafPaths(own))
	const inherited = leafPaths(base.rules).filter((p) => !ownLeaves.has(p))
	return {
		lock: {
			...lock,
			rules: deepMerge(base.rules as Record<string, unknown>, own) as LockfileRules,
		},
		report: {
			spec,
			status: 'ok',
			detail: `${spec} — ${inherited.length} value(s) inherited, the rest set by this repo`,
			inherited,
		},
	}
}
