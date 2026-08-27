import { type GhExec, realGhExec } from '../../base/github-settings.js'
import { type JsonSchema, validateAgainstSchema } from './json-schema.js'
import {
	type Lockfile,
	LOCKFILE_NAME,
	lockfileSchema,
	parseLockfile,
	readLockfile,
} from './lockfile.js'

/**
 * Rules are per-repo (#563): there is no guideline package, so sharing a
 * guideline means pointing at another repo. This module is the one fetcher both
 * halves of that share — `doctor --rules-from` reads a reference repo's rules to
 * report differences, and `setup --from` reads the same file to seed the wizard.
 *
 * The reference is untrusted input from end to end: the `owner/repo` string is
 * shape-checked before it reaches an API path, the response is size-capped, and
 * the JSON is validated against the published schema before a single field is
 * read. Nothing here ever writes, and nothing is ever applied.
 */

/**
 * `owner/repo`. The injection boundary — the reference is interpolated into the
 * gh API path below, so anything with a slash, `..` or a shell metacharacter in
 * it has to be rejected here rather than defended against later.
 */
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Generous by four orders of magnitude — a real lockfile is ~1 KB. This is not a
 * tuning knob, it is the "huge file" guard: the response is fully buffered by the
 * time we see it, so the cap stops us parsing and diffing a repo's 40 MB joke.
 */
const MAX_BYTES = 128 * 1024

export type ReferenceResult = { ok: true; lockfile: Lockfile } | { ok: false; reason: string }

/**
 * The GitHub arm of the fetch. Another forge is a second function of this shape
 * dispatched from fetchReferenceLockfile — everything downstream (size cap,
 * parse, schema validation, diff) is forge-agnostic and already shared.
 */
async function fetchFromGitHub(
	reference: string,
	exec?: GhExec
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
	const gh: GhExec = exec ?? ((args, stdin) => realGhExec(args, stdin))
	// `Accept: raw` returns the file itself rather than the base64-in-JSON envelope.
	const r = await gh([
		'api',
		`repos/${reference}/contents/${LOCKFILE_NAME}`,
		'-H',
		'Accept: application/vnd.github.raw',
	])
	if (r.ok) return { ok: true, text: r.stdout }
	if (/HTTP 404/.test(r.stderr)) {
		return { ok: false, reason: `${reference} has no ${LOCKFILE_NAME} (or is not visible to you)` }
	}
	const detail = r.stderr.trim().split('\n').pop() ?? 'gh failed'
	return { ok: false, reason: `could not read ${reference}: ${detail}` }
}

function parseReference(reference: string, text: string): ReferenceResult {
	if (Buffer.byteLength(text) > MAX_BYTES) {
		return {
			ok: false,
			reason: `${reference}'s ${LOCKFILE_NAME} is larger than ${MAX_BYTES} bytes`,
		}
	}
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch {
		return { ok: false, reason: `${reference}'s ${LOCKFILE_NAME} is not valid JSON` }
	}
	// Migrate first, then validate: an older reference is flat on disk and would
	// fail the current schema for a reason that says nothing about its rules.
	const lockfile = parseLockfile(raw)
	if (!lockfile) {
		return { ok: false, reason: `${reference}'s ${LOCKFILE_NAME} is not a recognisable lockfile` }
	}
	const errors = validateAgainstSchema(lockfile, lockfileSchema() as unknown as JsonSchema)
	if (errors.length > 0) {
		return {
			ok: false,
			reason: `${reference}'s ${LOCKFILE_NAME} fails the published schema: ${errors.slice(0, 3).join('; ')}`,
		}
	}
	return { ok: true, lockfile }
}

export async function fetchReferenceLockfile(
	reference: string,
	exec?: GhExec
): Promise<ReferenceResult> {
	if (!REFERENCE.test(reference)) {
		return { ok: false, reason: `"${reference}" is not an owner/repo reference` }
	}
	const fetched = await fetchFromGitHub(reference, exec)
	if (!fetched.ok) return fetched
	return parseReference(reference, fetched.text)
}

export interface RuleDifference {
	/** Dotted path within the rules view, e.g. `config.bundler`. */
	path: string
	/** `undefined` means the path is absent on that side. */
	local: unknown
	reference: unknown
}

/**
 * The comparable half of a lockfile: the resolved config plus the human-written
 * rules. `assets` hashes and the `writtenBy`/`writtenAt` stamps are excluded on
 * purpose — they differ between any two repos by construction, so diffing them
 * would bury every difference that means something.
 */
function rulesView(lock: Lockfile): Record<string, unknown> {
	return { config: lock.record.config, ...(lock.rules ?? {}) }
}

function flatten(
	value: unknown,
	prefix = '',
	out = new Map<string, unknown>()
): Map<string, unknown> {
	// Arrays are leaves: `requiredSkills` differing by one entry is one difference
	// about the list, not a per-index report that shifts when the order does.
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		for (const [key, child] of Object.entries(value)) {
			flatten(child, prefix ? `${prefix}.${key}` : key, out)
		}
		return out
	}
	out.set(prefix, value)
	return out
}

export function diffRules(local: Lockfile | null, reference: Lockfile): RuleDifference[] {
	const mine = local ? flatten(rulesView(local)) : new Map<string, unknown>()
	const theirs = flatten(rulesView(reference))
	return [...new Set([...mine.keys(), ...theirs.keys()])]
		.sort()
		.filter((p) => JSON.stringify(mine.get(p)) !== JSON.stringify(theirs.get(p)))
		.map((p) => ({ path: p, local: mine.get(p), reference: theirs.get(p) }))
}

export interface RulesComparison {
	reference: string
	/** False when the reference could not be read — never a finding about this repo. */
	compared: boolean
	reason?: string
	differences?: RuleDifference[]
}

export async function compareRulesWithReference(
	dir: string,
	reference: string,
	exec?: GhExec
): Promise<RulesComparison> {
	const result = await fetchReferenceLockfile(reference, exec)
	if (!result.ok) return { reference, compared: false, reason: result.reason }
	return {
		reference,
		compared: true,
		differences: diffRules(await readLockfile(dir), result.lockfile),
	}
}
