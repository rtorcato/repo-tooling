/**
 * Drift detection for copied presets (#428).
 *
 * `copy <preset>` used to be a one-shot: it wrote the file and nothing ever
 * looked at it again, so eight copies of `sync-changelog.mjs` drifted into six
 * versions with no signal. The fix is one recorded fact — the asset's pristine
 * hash at copy time, in `.repo-tooling.json` — which is enough to separate the
 * two cases that matter:
 *
 * - file ≠ recorded hash → `modified`. Someone edited it on purpose (js-common
 *   forked this very script and documented why in its header). Reported, never
 *   overwritten, never counted as drift.
 * - file = recorded hash, but the shipped asset has moved on → `stale`. Nothing
 *   local is in it, so re-copying is lossless.
 * - no recorded hash → `unknown`. Copies predating this, and repos with no
 *   lockfile at all. Absence of a record is not evidence of drift, so this
 *   never fails a build.
 */
import path from 'node:path'
import type { CheckResult } from '../../base/types.js'
import { getPackageRoot, hashFile, PRESETS, type PresetName } from './copy-preset.js'
import { readLockfile } from './lockfile.js'

export interface CopiedAssetStatus {
	preset: PresetName
	target: string
	state: 'ok' | 'modified' | 'stale' | 'unknown'
}

type AssetState = CopiedAssetStatus['state']

/**
 * Classify every preset whose target file exists in `dir`. Presets that were
 * never copied here are absent from the result rather than reported missing —
 * `copy` is opt-in, and doctor already has checks for the files that aren't.
 */
export async function classifyCopiedAssets(dir: string): Promise<CopiedAssetStatus[]> {
	const lock = await readLockfile(dir)
	const packageRoot = getPackageRoot()
	const statuses: CopiedAssetStatus[] = []

	for (const name of Object.keys(PRESETS) as PresetName[]) {
		const preset = PRESETS[name]
		const current = await hashFile(path.join(dir, preset.target))
		if (current === null) continue

		const recorded = lock?.assets?.[name]
		// Unmodified since the copy, so whether it's stale is purely a question of
		// what this package ships now. A source we can't read (shouldn't happen)
		// falls back to the recorded hash — "no news", not drift.
		const shipped = recorded
			? ((await hashFile(path.join(packageRoot, preset.source))) ?? recorded)
			: null

		let state: AssetState = 'ok'
		if (!recorded) state = 'unknown'
		else if (recorded !== current) state = 'modified'
		else if (shipped !== recorded) state = 'stale'

		statuses.push({ preset: name, target: preset.target, state })
	}

	return statuses
}

/**
 * Preset hashes `fix lockfile` can record with confidence (#531): the target
 * file exists and matches the shipped asset byte-for-byte, so it is provably an
 * unmodified copy of what this package ships. A file that differs could be a
 * local fork or a stale copy of an older release — indistinguishable without a
 * recorded hash, so those stay untracked, which is the honest answer.
 */
export async function identifiablePresetHashes(dir: string): Promise<Record<string, string>> {
	const packageRoot = getPackageRoot()
	const hashes: Record<string, string> = {}
	for (const name of Object.keys(PRESETS) as PresetName[]) {
		const preset = PRESETS[name]
		const current = await hashFile(path.join(dir, preset.target))
		if (current === null) continue
		const shipped = await hashFile(path.join(packageRoot, preset.source))
		if (shipped !== null && shipped === current) hashes[name] = current
	}
	return hashes
}

const listOf = (s: CopiedAssetStatus[]) => s.map((a) => a.preset).join(', ')

export async function checkCopiedAssets(dir: string): Promise<CheckResult> {
	const check = 'Copied assets'
	const all = await classifyCopiedAssets(dir)
	if (all.length === 0) {
		return { check, status: 'optional-missing', detail: 'no copied presets found' }
	}

	const by = (state: AssetState) => all.filter((a) => a.state === state)
	const stale = by('stale')
	const modified = by('modified')
	const unknown = by('unknown')

	const parts = [`${by('ok').length} in sync`]
	if (modified.length > 0) parts.push(`${modified.length} locally modified: ${listOf(modified)}`)
	if (unknown.length > 0) parts.push(`${unknown.length} untracked: ${listOf(unknown)}`)

	if (stale.length === 0) {
		return { check, status: 'ok', detail: parts.join('; ') }
	}
	return {
		check,
		status: 'drift',
		detail: `${stale.length} stale: ${listOf(stale)}; ${parts.join('; ')}`,
		hint: 'Run `npx @rtorcato/repo-tooling fix copied-assets` to re-copy them. They still match what was copied, so nothing local is lost — locally modified assets are left alone.',
	}
}
