import path from 'node:path'
import os from 'node:os'
import chalk from 'chalk'
import { createPatch } from 'diff'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import { generateConfigs } from '../generators/index.js'
import {
	type Lockfile,
	LOCKFILE_NAME,
	readLockfile,
	updateLockfileConfig,
	writeLockfile,
} from '../utils/lockfile.js'
import type { CheckResult } from './doctor.js'
import { runDoctor } from './doctor.js'
import { declinedInLock, lockfilePatchForTarget } from './fix-targets.js'
import { computeFileList } from './setup-presets.js'
import {
	BASE_FIXERS,
	type Fixer,
	FixerAbort,
	type FixRiskLevel,
	type Pkg,
} from '../../base/fixers.js'
import { FIXERS, readPackageJson } from '../../languages/js/fixers.js'
import { PERL_FIXERS } from '../../languages/perl/fixers.js'
import { PYTHON_FIXERS } from '../../languages/python/fixers.js'
import { SWIFT_FIXERS } from '../../languages/swift/fixers.js'
import { detectLanguage } from '../utils/detect-language.js'

/** The module-specific fixer set per detected language (#286, #289, #290, #303). */
const LANGUAGE_FIXERS: Record<string, Fixer[]> = {
	swift: SWIFT_FIXERS,
	python: PYTHON_FIXERS,
	perl: PERL_FIXERS,
}

/**
 * The fixers that apply to a repo, by detected language: the language-agnostic
 * base set plus the module's own. Anything without a module of its own
 * (including a bare dir mid-setup) gets JS, the historical default.
 */
function fixersForLanguage(language: string): Fixer[] {
	return [...BASE_FIXERS, ...(LANGUAGE_FIXERS[language] ?? FIXERS)]
}

/** Every fixer across every language — for `--list` and the unknown-target hint. */
const ALL_FIXERS: Fixer[] = [
	...BASE_FIXERS,
	...FIXERS,
	...SWIFT_FIXERS,
	...PYTHON_FIXERS,
	...PERL_FIXERS,
]

export interface FixOptions {
	directory?: string
	yes?: boolean
	dryRun?: boolean
	json?: boolean
	list?: boolean
	resync?: boolean
	diff?: boolean
	/** Destination for the user-global agent skills `fix claude-skills` writes. */
	skillsDir?: string
}

export type FixActionStatus = 'applied' | 'dry-run' | 'skipped' | 'already-ok' | 'unsupported'

export interface FixActionRecord {
	target: string | null
	check: string
	status: FixActionStatus
	doctorStatus: CheckResult['status']
	filesWritten: string[]
	lockfileConflict?: boolean
}

export interface FixJsonResult {
	directory: string
	target: string | null
	actions: FixActionRecord[]
}

export function getFixers(): Fixer[] {
	return ALL_FIXERS
}

async function ownOutputsPresent(targetDir: string, fixer: Fixer): Promise<boolean> {
	for (const out of fixer.outputs) {
		// Outputs that reference a package.json field (e.g. "package.json (scripts.verify)")
		// can't be cheaply file-checked here; treat as present so we don't accidentally
		// re-run safe-merge fixers on every targeted invocation.
		if (out.includes('(')) return true
		if (await fs.pathExists(path.join(targetDir, out))) return true
	}
	return false
}

function findFixer(fixers: Fixer[], target: string): Fixer | undefined {
	const normalized = target.toLowerCase()
	return fixers.find((f) => f.target.toLowerCase() === normalized)
}

function findFixerForCheck(fixers: Fixer[], checkName: string): Fixer | undefined {
	return fixers.find((f) => f.appliesTo.includes(checkName))
}

function logTargets(fixers: Fixer[]) {
	console.log(chalk.gray('Available fix targets:'))
	for (const f of fixers) {
		console.log(`  ${chalk.green('●')} ${chalk.bold(f.target)}: ${chalk.gray(f.description)}`)
	}
}

export interface FixerSummary {
	target: string
	description: string
	appliesTo: string[]
	outputs: string[]
	riskLevel: FixRiskLevel
	canFixDrift: boolean
}

export function listFixers(): FixerSummary[] {
	return ALL_FIXERS.map((f) => ({
		target: f.target,
		description: f.description,
		appliesTo: f.appliesTo,
		outputs: f.outputs,
		riskLevel: f.riskLevel ?? 'destructive',
		canFixDrift: f.canFixDrift ?? false,
	}))
}

// Fixer outputs sometimes carry annotations like
// "package.json (lint-staged field)" — strip them to get a usable filesystem path.
function outputToRelativePath(output: string): string {
	return output.split(' ')[0] ?? output
}

function shouldColorise(): boolean {
	// Respect NO_COLOR (https://no-color.org) and chalk's own detection.
	if (process.env.NO_COLOR && process.env.NO_COLOR !== '') return false
	return chalk.level > 0
}

function colorisePatch(patch: string): string {
	if (!shouldColorise()) return patch
	return patch
		.split('\n')
		.map((line) => {
			if (line.startsWith('+++') || line.startsWith('---')) return chalk.bold(line)
			if (line.startsWith('@@')) return chalk.cyan(line)
			if (line.startsWith('+')) return chalk.green(line)
			if (line.startsWith('-')) return chalk.red(line)
			return line
		})
		.join('\n')
}

interface PreviewEntry {
	path: string
	kind: 'create' | 'modify' | 'unchanged'
	patch: string | null
}

/**
 * Shadow-run a fixer in a temp copy of the target directory and return per-output
 * diffs. We copy the real target into tmp so fixers that read existing state
 * (e.g. husky reading package.json) still produce realistic output.
 */
async function previewFixer(
	fixer: Fixer,
	result: CheckResult,
	targetDir: string,
	pkg: Pkg,
	lock: Lockfile | null
): Promise<PreviewEntry[]> {
	// Pick a tmp root that is NOT inside targetDir. macOS sometimes hands us a
	// $TMPDIR that lives under the working dir (e.g. when the caller is itself
	// running inside a tempdir tree), which would make fs.copy fail with
	// "subdirectory of itself". Fall back to the parent of targetDir if so.
	const resolvedTarget = path.resolve(targetDir)
	let tmpRoot = path.resolve(os.tmpdir())
	if (tmpRoot === resolvedTarget || tmpRoot.startsWith(resolvedTarget + path.sep)) {
		tmpRoot = path.dirname(resolvedTarget)
	}
	const tmpDir = await fs.mkdtemp(path.join(tmpRoot, 'repo-tooling-fix-preview-'))
	try {
		await fs.copy(targetDir, tmpDir, {
			filter: (src) => {
				const rel = path.relative(targetDir, src)
				if (!rel) return true
				const first = rel.split(path.sep)[0]
				// Skip large/derived dirs that fixers never touch — keeps preview fast on
				// big repos.
				return first !== 'node_modules' && first !== 'dist' && first !== 'build' && first !== '.git'
			},
		})
		// assumeYes: a preview must never prompt.
		await fixer.run({ targetDir: tmpDir, pkg, result, lock, assumeYes: true })

		const previews: PreviewEntry[] = []
		const seen = new Set<string>()
		for (const output of fixer.outputs) {
			const rel = outputToRelativePath(output)
			if (seen.has(rel)) continue
			seen.add(rel)

			const tmpPath = path.join(tmpDir, rel)
			const realPath = path.join(targetDir, rel)
			if (!(await fs.pathExists(tmpPath))) continue

			const newContent = await fs.readFile(tmpPath, 'utf-8')
			const existed = await fs.pathExists(realPath)
			const oldContent = existed ? await fs.readFile(realPath, 'utf-8') : ''

			if (newContent === oldContent) {
				previews.push({ path: rel, kind: 'unchanged', patch: null })
				continue
			}
			const patch = createPatch(rel, oldContent, newContent, undefined, undefined, { context: 3 })
			previews.push({
				path: rel,
				kind: existed ? 'modify' : 'create',
				patch: colorisePatch(patch),
			})
		}
		return previews
	} finally {
		await fs.remove(tmpDir).catch(() => {
			// Best-effort cleanup; tmp dirs get GC'd by the OS eventually.
		})
	}
}

function printPreviews(previews: PreviewEntry[]): void {
	if (previews.length === 0) {
		console.log(chalk.gray('  (no preview available — fixer produced no recognisable outputs)'))
		return
	}
	for (const p of previews) {
		if (p.kind === 'unchanged') {
			console.log(chalk.gray(`  ${p.path} — unchanged`))
			continue
		}
		const label = p.kind === 'create' ? chalk.green('create') : chalk.yellow('modify')
		console.log(`  ${label} ${chalk.bold(p.path)}`)
		if (p.patch) {
			console.log(
				p.patch
					.split('\n')
					.map((l) => `    ${l}`)
					.join('\n')
			)
		}
	}
}

async function applyFixer(
	fixer: Fixer,
	result: CheckResult,
	targetDir: string,
	pkg: Pkg,
	lock: Lockfile | null,
	dryRun: boolean,
	silent: boolean,
	opts: { skillsDir?: string; assumeYes: boolean }
): Promise<{ filesWritten: string[]; dryRun: boolean }> {
	if (dryRun) {
		if (!silent) {
			console.log(chalk.cyan(`  [dry-run] would write: ${fixer.outputs.join(', ')}`))
		}
		return { filesWritten: [], dryRun: true }
	}
	const { filesWritten } = await fixer.run({ targetDir, pkg, result, lock, ...opts })
	if (!silent && filesWritten.length > 0) {
		console.log(chalk.green(`  ✅ wrote ${filesWritten.join(', ')}`))
	}
	// Auto-resync the lockfile when a fix changes a recorded choice.
	if (lock && fixer.target !== 'lockfile') {
		const patch = lockfilePatchForTarget(fixer.target, lock)
		if (patch) {
			const ok = await updateLockfileConfig(targetDir, patch)
			if (ok && !silent) {
				console.log(chalk.dim(`     ↻ ${LOCKFILE_NAME} updated to reflect the new choice`))
			}
		}
	}
	return { filesWritten, dryRun: false }
}

function promptMessageFor(
	fixer: Fixer,
	result: CheckResult
): { message: string; default: boolean } {
	const risk: FixRiskLevel = fixer.riskLevel ?? 'destructive'
	if (risk === 'safe-merge') {
		return { message: `${fixer.description} (existing fields preserved)?`, default: true }
	}
	if (risk === 'safe-add') {
		return { message: `${fixer.description}?`, default: true }
	}
	// destructive
	if (result.status === 'drift') {
		return {
			message: `⚠️  ${fixer.description} — overwrite existing file? user customizations will be lost`,
			default: false,
		}
	}
	return { message: `Apply ${fixer.description}?`, default: true }
}

async function confirmApply(
	fixer: Fixer,
	result: CheckResult,
	assumeYes: boolean
): Promise<boolean> {
	if (assumeYes) return true
	const { message, default: defaultValue } = promptMessageFor(fixer, result)
	const { confirm } = await inquirer.prompt([
		{ type: 'confirm', name: 'confirm', message, default: defaultValue },
	])
	return confirm === true
}

function recordFor(
	target: string | null,
	check: string,
	doctorStatus: CheckResult['status'],
	status: FixActionStatus,
	filesWritten: string[],
	lockfileConflict = false
): FixActionRecord {
	const base: FixActionRecord = { target, check, status, doctorStatus, filesWritten }
	if (lockfileConflict) base.lockfileConflict = true
	return base
}

export async function fixCommand(target: string | undefined, options: FixOptions = {}) {
	const targetDir = path.resolve(options.directory ?? process.cwd())
	const dryRun = options.dryRun === true
	const json = options.json === true
	// JSON mode implies --yes so prompts don't corrupt the output stream.
	const assumeYes = options.yes === true || json
	const silent = json
	// Diff preview is interactive-only — suppress in JSON mode.
	const showDiff = options.diff === true && !json

	if (options.list) {
		const summary = listFixers()
		if (json) {
			console.log(JSON.stringify({ targets: summary }, null, 2))
			return
		}
		console.log(chalk.cyan('\n🔧 Registered fix targets:\n'))
		for (const f of summary) {
			console.log(`  ${chalk.green('●')} ${chalk.bold(f.target)}`)
			console.log(`     ${chalk.gray(f.description)}`)
			console.log(
				`     ${chalk.dim(`risk=${f.riskLevel}, drift=${f.canFixDrift ? 'yes' : 'no'}, outputs=${f.outputs.join(', ')}`)}`
			)
		}
		console.log()
		return
	}

	if (options.resync) {
		if (target) {
			console.error(chalk.red('\n❌ --resync cannot be combined with a [target] argument\n'))
			process.exit(1)
		}
		const resyncLock = await readLockfile(targetDir)
		if (!resyncLock) {
			if (json) {
				console.log(
					JSON.stringify(
						{ directory: targetDir, error: 'no-lockfile', hint: 'run `fix lockfile` first' },
						null,
						2
					)
				)
			} else {
				console.error(
					chalk.red(
						`\n❌ No ${LOCKFILE_NAME} found — run \`fix lockfile\` first to record choices\n`
					)
				)
			}
			process.exit(1)
		}
		const files = computeFileList(resyncLock.config)
		if (!silent) {
			console.log(
				chalk.cyan(`\n🔄 Resync from ${LOCKFILE_NAME} (${files.length} files in scope)\n`)
			)
		}
		if (dryRun) {
			if (json) {
				console.log(
					JSON.stringify({ directory: targetDir, mode: 'resync', dryRun: true, files }, null, 2)
				)
			} else {
				for (const f of files) console.log(chalk.cyan(`  [dry-run] would write: ${f}`))
				console.log()
			}
			return
		}
		if (!assumeYes) {
			const { confirm } = await inquirer.prompt([
				{
					type: 'confirm',
					name: 'confirm',
					message: `Re-scaffold ${files.length} file(s) from ${LOCKFILE_NAME}? Generators preserve existing customizations where possible, but README.md will be rewritten.`,
					default: false,
				},
			])
			if (!confirm) {
				console.log(chalk.gray('   skipped\n'))
				return
			}
		}
		await generateConfigs(resyncLock.config, targetDir)
		await writeLockfile(targetDir, resyncLock.config)
		if (json) {
			console.log(
				JSON.stringify({ directory: targetDir, mode: 'resync', dryRun: false, files }, null, 2)
			)
		} else {
			console.log(chalk.green(`  ✅ resynced ${files.length} file(s)\n`))
		}
		return
	}

	const pkg = await readPackageJson(targetDir)
	const lock = await readLockfile(targetDir)
	const fixers = fixersForLanguage(await detectLanguage(targetDir))
	const results = await runDoctor(targetDir)
	const actions: FixActionRecord[] = []

	const noteLockConflict = (check: string): boolean => {
		if (!lock) return false
		const conflict = declinedInLock(lock, check)
		if (conflict && !silent) {
			console.log(
				chalk.yellow(
					`  ⚠ ${LOCKFILE_NAME} says this tool was declined — applying anyway will update the lockfile to reflect the new choice.`
				)
			)
		}
		return conflict
	}

	const emitJson = (resolvedTarget: string | null) => {
		const payload: FixJsonResult = { directory: targetDir, target: resolvedTarget, actions }
		console.log(JSON.stringify(payload, null, 2))
	}

	if (target) {
		const fixer = findFixer(fixers, target)
		if (!fixer) {
			if (json) {
				console.log(
					JSON.stringify(
						{
							directory: targetDir,
							error: 'unknown-target',
							target,
							available: FIXERS.map((f) => f.target),
						},
						null,
						2
					)
				)
				process.exit(1)
			}
			console.error(chalk.red(`\n❌ Unknown fix target: ${target}\n`))
			logTargets(fixers)
			console.log()
			process.exit(1)
		}
		// A fixer can cover several checks (e.g. husky covers Husky + lint-staged +
		// Husky pre-push). Pick the first that still needs work rather than the
		// first that merely matches — otherwise an `ok` check (Husky wired) masks a
		// sibling drift (pre-push not calling verify) and the fixer no-ops.
		const applicable = results.filter((r) => fixer.appliesTo.includes(r.check))
		const result =
			applicable.find((r) => r.status !== 'ok') ??
			applicable[0] ??
			({ check: fixer.appliesTo[0] ?? fixer.target, status: 'missing', detail: '' } as CheckResult)
		// A check that's `ok` because the lockfile records an opt-out should still be
		// fixable when the user explicitly targets it — treat it as optional-missing
		// so the override + lockfile resync paths run.
		const lockfileDemoted = lock !== null && declinedInLock(lock, result.check)
		// When multiple fixers share a check (e.g. dependabot + renovate both apply to
		// "Dependabot" deps-update coverage), the check can be `ok` from a sibling tool
		// while this fixer's own outputs are still absent. In that case, treat as missing
		// so the targeted scaffold runs.
		const fixerOutputsPresent = await ownOutputsPresent(targetDir, fixer)
		const effectiveResult: CheckResult =
			result.status === 'ok' && (lockfileDemoted || !fixerOutputsPresent)
				? { ...result, status: 'optional-missing' }
				: result
		if (effectiveResult.status === 'ok') {
			actions.push(recordFor(fixer.target, result.check, 'ok', 'already-ok', []))
			if (json) return emitJson(fixer.target)
			console.log(chalk.green(`\n✅ ${result.check} is already configured\n`))
			return
		}
		if (!silent) {
			console.log(
				chalk.cyan(
					`\n🔧 ${fixer.target} — ${chalk.bold(result.check)} is ${effectiveResult.status}\n`
				)
			)
		}
		const conflict = noteLockConflict(result.check)
		if (showDiff && (fixer.riskLevel ?? 'destructive') !== 'safe-add') {
			const previews = await previewFixer(fixer, effectiveResult, targetDir, pkg, lock)
			printPreviews(previews)
		}
		const ok = await confirmApply(fixer, effectiveResult, assumeYes)
		if (!ok) {
			actions.push(
				recordFor(fixer.target, result.check, effectiveResult.status, 'skipped', [], conflict)
			)
			if (json) return emitJson(fixer.target)
			console.log(chalk.gray('   skipped\n'))
			return
		}
		// ponytail: only the targeted path is guarded, because the only fixer that
		// aborts is `claude-skills` and it is explicitOnly — the bulk loop below
		// cannot reach it. A non-explicitOnly fixer that throws FixerAbort would
		// surface as an unhandled rejection there; guard the loop when one exists.
		const outcome = await applyFixer(fixer, effectiveResult, targetDir, pkg, lock, dryRun, silent, {
			skillsDir: options.skillsDir,
			assumeYes,
		}).catch((err: unknown) => {
			if (!(err instanceof FixerAbort)) throw err
			if (json) {
				console.log(
					JSON.stringify(
						{ directory: targetDir, target: fixer.target, error: err.code, hint: err.hint },
						null,
						2
					)
				)
			} else {
				console.error(chalk.red(`\n❌ ${fixer.target}: ${err.message}`))
				if (err.hint) console.error(chalk.gray(`   ${err.hint}\n`))
			}
			process.exit(1)
		})
		actions.push(
			recordFor(
				fixer.target,
				result.check,
				effectiveResult.status,
				outcome.dryRun ? 'dry-run' : 'applied',
				outcome.filesWritten,
				conflict
			)
		)
		if (json) return emitJson(fixer.target)
		console.log()
		return
	}

	const fixable = results.filter((r) => r.status !== 'ok')
	if (fixable.length === 0) {
		if (json) return emitJson(null)
		console.log(chalk.green('\n✅ All checks pass — nothing to fix\n'))
		return
	}

	if (!silent) {
		console.log(chalk.cyan(`\n🔧 ${fixable.length} item(s) to address\n`))
	}

	let appliedCount = 0
	let skippedCount = 0
	let unsupportedCount = 0

	for (const result of fixable) {
		const fixer = findFixerForCheck(fixers, result.check)
		if (!fixer) {
			actions.push(recordFor(null, result.check, result.status, 'unsupported', []))
			if (!silent) console.log(chalk.gray(`  — ${result.check}: no fixer registered`))
			unsupportedCount++
			continue
		}
		if (!silent) {
			console.log(`  ${chalk.bold(result.check)} (${result.status}) → ${fixer.target}`)
		}
		// Opt-in only — `--yes` must not sweep in a fixer that writes outside the repo.
		if (fixer.explicitOnly) {
			actions.push(recordFor(fixer.target, result.check, result.status, 'skipped', []))
			if (!silent) {
				console.log(chalk.gray(`    skipped — run \`fix ${fixer.target}\` explicitly`))
			}
			skippedCount++
			continue
		}
		const conflict = noteLockConflict(result.check)
		if (showDiff && (fixer.riskLevel ?? 'destructive') !== 'safe-add') {
			const previews = await previewFixer(fixer, result, targetDir, pkg, lock)
			printPreviews(previews)
		}
		const ok = await confirmApply(fixer, result, assumeYes)
		if (!ok) {
			actions.push(recordFor(fixer.target, result.check, result.status, 'skipped', [], conflict))
			if (!silent) console.log(chalk.gray('    skipped'))
			skippedCount++
			continue
		}
		const outcome = await applyFixer(fixer, result, targetDir, pkg, lock, dryRun, silent, {
			skillsDir: options.skillsDir,
			assumeYes,
		})
		actions.push(
			recordFor(
				fixer.target,
				result.check,
				result.status,
				outcome.dryRun ? 'dry-run' : 'applied',
				outcome.filesWritten,
				conflict
			)
		)
		appliedCount++
	}

	if (json) return emitJson(null)

	console.log()
	console.log(
		`  Summary: ${chalk.green(`${appliedCount} applied`)}, ${chalk.gray(`${skippedCount} skipped`)}, ${chalk.yellow(`${unsupportedCount} unsupported`)}\n`
	)
}
