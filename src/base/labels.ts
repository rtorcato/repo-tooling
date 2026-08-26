import path from 'node:path'
import chalk from 'chalk'
import fs from 'fs-extra'
import { type GhExec, realGhExec } from './github-settings.js'
import type { CheckResult } from './types.js'

/**
 * `ai-issue-loop` label hygiene (#446). Same class of GitHub-side drift as
 * github-settings.ts and milestones.ts, on the same `gh` seam.
 *
 * The bug this exists for: the skill's bootstrap uses `gh label create`, which
 * *errors as a no-op* when the label already exists. It can add a missing label
 * but can never repair an existing one, so a hand-created `ai-ready` keeps
 * whatever colour the web picker gave it forever. Measured across eight repos,
 * six had `ai-ready` at `B60205` — byte-identical to `ai-blocked`, so "an agent
 * should pick this up" and "an agent gave up" rendered the same. Repair here
 * goes through `gh label edit`, which is the whole point of the fixer.
 *
 * This table is the single source of truth for the label set. The bootstrap
 * block in skills/ai-issue-loop/SKILL.md is asserted against it in
 * tests/base/labels.test.ts, so the two cannot drift apart.
 */

const CHECK = 'AI loop labels'

export interface LabelSpec {
	name: string
	/** Six hex digits, no leading `#`, lowercase — what `gh` writes. */
	color: string
	description: string
}

export const LOOP_LABELS: readonly LabelSpec[] = [
	{
		name: 'holding',
		color: '5319e7',
		description: 'Gate/holding issue — human judgement, never auto-picked',
	},
	{ name: 'ai-ready', color: '0e8a16', description: 'Eligible for an AI agent to implement' },
	{ name: 'ai-wip', color: 'fbca04', description: 'Claimed by an agent; worktree exists' },
	{ name: 'ai-blocked', color: 'b60205', description: 'Agent gave up; needs a human' },
	{ name: 'ai-review', color: '1d76db', description: 'PR awaiting agent review' },
	{ name: 'ai-reviewing-code', color: 'c5def5', description: 'code-reviewer claimed and running' },
	{ name: 'ai-reviewing-sec', color: 'c5def5', description: 'security-expert claimed and running' },
	{ name: 'ai-ok-code', color: '0e8a16', description: 'code-reviewer passed' },
	{ name: 'ai-ok-sec', color: '0e8a16', description: 'security-expert passed' },
	{ name: 'ai-changes', color: 'd93f0b', description: 'Reviewer requested changes' },
	{
		name: 'ai-notes',
		color: 'fbca04',
		description: 'Passed, but a reviewer left something to read before merging',
	},
	{
		name: 'merge-ready',
		color: '8250df',
		description: 'Both agent reviews passed and the PR is mergeable — waiting on a human',
	},
	{
		name: 'ai-suggested',
		color: 'c2e0c6',
		description: 'Follow-up surfaced by an agent review — triage queue, never auto-picked',
	},
]

/**
 * How many of the set have to exist before this repo counts as running the
 * loop. A repo with none has opted out, not drifted — creating thirteen labels it
 * will never use is the nag this threshold exists to prevent. One alone is the
 * observed half-state (`cf-common` has only `ai-ready`, applied by hand), which
 * is likewise not evidence the pipeline runs there.
 */
const IN_USE_THRESHOLD = 2

interface GhLabel {
	name: string
	color: string
	description: string
}

const skip = (reason: string): CheckResult => ({
	check: CHECK,
	status: 'ok',
	detail: `skipped — ${reason}`,
})

/**
 * Case-insensitive, `#`-insensitive. The drift that started this was uppercase
 * `B60205` against lowercase `b60205` — GitHub's colour picker writes uppercase,
 * `gh` writes lowercase, and the two render identically. Comparing raw would
 * report every hand-created label as drift forever and have the fixer PATCH a
 * colour that was already correct.
 */
const normalizeColor = (c: string) => c.trim().replace(/^#/, '').toLowerCase()

async function readLabels(gh: GhExec): Promise<Map<string, GhLabel> | null> {
	const r = await gh(['label', 'list', '--json', 'name,color,description', '--limit', '200'])
	if (!r.ok) return null
	try {
		const parsed = JSON.parse(r.stdout)
		if (!Array.isArray(parsed)) return null
		const byName = new Map<string, GhLabel>()
		for (const l of parsed) {
			if (typeof l?.name !== 'string') continue
			byName.set(l.name, {
				name: l.name,
				color: typeof l.color === 'string' ? l.color : '',
				description: typeof l.description === 'string' ? l.description : '',
			})
		}
		return byName
	} catch {
		return null
	}
}

interface LabelDeltas {
	present: LabelSpec[]
	missing: LabelSpec[]
	wrongColor: Array<{ spec: LabelSpec; actual: string }>
	wrongDescription: LabelSpec[]
}

export function classifyLabels(existing: Map<string, GhLabel>): LabelDeltas {
	const deltas: LabelDeltas = { present: [], missing: [], wrongColor: [], wrongDescription: [] }
	for (const spec of LOOP_LABELS) {
		const actual = existing.get(spec.name)
		if (!actual) {
			deltas.missing.push(spec)
			continue
		}
		deltas.present.push(spec)
		if (normalizeColor(actual.color) !== normalizeColor(spec.color))
			deltas.wrongColor.push({ spec, actual: normalizeColor(actual.color) })
		if (actual.description.trim() !== spec.description) deltas.wrongDescription.push(spec)
	}
	return deltas
}

const names = (specs: LabelSpec[]) => specs.map((s) => `\`${s.name}\``).join(', ')

export async function checkLoopLabels(dir: string, exec?: GhExec): Promise<CheckResult> {
	// Cheap gate first: no .git → never spawn (keeps tmp-dir doctor runs offline).
	if (!(await fs.pathExists(path.join(dir, '.git')))) return skip('not a git repository')
	const gh: GhExec = exec ?? ((args, stdin) => realGhExec(args, stdin, dir))
	const existing = await readLabels(gh)
	if (!existing) return skip('could not read labels')

	const { present, missing, wrongColor, wrongDescription } = classifyLabels(existing)
	if (present.length < IN_USE_THRESHOLD)
		return {
			check: CHECK,
			status: 'ok',
			detail: 'not applicable — repo does not use the ai-issue-loop labels',
		}

	const deltas: string[] = []
	for (const { spec, actual } of wrongColor)
		deltas.push(`\`${spec.name}\` is #${actual}, should be #${spec.color}`)
	if (wrongDescription.length) deltas.push(`wrong description: ${names(wrongDescription)}`)
	if (missing.length) deltas.push(`missing: ${names(missing)}`)

	if (deltas.length)
		return {
			check: CHECK,
			status: 'drift',
			detail: deltas.join('; '),
			hint: 'Run `npx @rtorcato/repo-tooling fix labels` to repair them with `gh label edit` — `gh label create` cannot change an existing label, which is how this drifted',
		}
	return {
		check: CHECK,
		status: 'ok',
		detail: `${present.length} ai-issue-loop label(s) match spec`,
	}
}

/**
 * Repairs colour and description with `gh label edit`, and creates the labels
 * the set is missing. Only on a repo already running the loop (the same
 * `IN_USE_THRESHOLD` gate the check uses) — otherwise a plain `fix --yes` would
 * push thirteen labels into every repo it touches.
 *
 * Idempotent: an aligned repo is a no-op, and a label whose only difference is
 * the hex case is not touched at all.
 *
 * Advisories go to `console.error`; stdout carries the `--json` payload (#357).
 */
export async function applyLoopLabels(dir: string, exec?: GhExec): Promise<string[]> {
	if (!(await fs.pathExists(path.join(dir, '.git')))) {
		console.error(chalk.gray('   skipped — not a git repository'))
		return []
	}
	const gh: GhExec = exec ?? ((args, stdin) => realGhExec(args, stdin, dir))
	const existing = await readLabels(gh)
	if (!existing) {
		console.error(chalk.gray('   skipped — could not read labels'))
		return []
	}

	const { present, missing, wrongColor, wrongDescription } = classifyLabels(existing)
	if (present.length < IN_USE_THRESHOLD) {
		console.error(chalk.gray('   skipped — repo does not use the ai-issue-loop labels'))
		return []
	}

	// One edit per drifted label, whichever field drifted — the API takes both.
	const toEdit = new Set([...wrongColor.map((w) => w.spec), ...wrongDescription])
	const applied: string[] = []
	for (const spec of toEdit) {
		// `edit`, not `create`: create errors as a no-op on an existing label, so a
		// fixer built on it would silently repair nothing (#446).
		const r = await gh([
			'label',
			'edit',
			spec.name,
			'--color',
			spec.color,
			'--description',
			spec.description,
		])
		if (r.ok) applied.push(`repaired label "${spec.name}"`)
		else
			console.error(
				chalk.yellow(`   could not repair "${spec.name}": ${r.stderr.trim() || 'gh error'}`)
			)
	}
	for (const spec of missing) {
		const r = await gh([
			'label',
			'create',
			spec.name,
			'--color',
			spec.color,
			'--description',
			spec.description,
		])
		if (r.ok) applied.push(`created label "${spec.name}"`)
		else
			console.error(
				chalk.yellow(`   could not create "${spec.name}": ${r.stderr.trim() || 'gh error'}`)
			)
	}
	if (applied.length === 0) console.error(chalk.gray('   labels already match spec'))
	return applied
}
