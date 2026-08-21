import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { beforeAll, describe, expect, it } from 'vitest'
import { PRESETS } from '../../../src/cli/utils/copy-preset.js'

const repoRoot = join(import.meta.dirname, '../../..')
const pkg = fs.readJsonSync(join(repoRoot, 'package.json'))

/**
 * #486 renamed `tooling/biome/biome.json` to `tooling/biome/preset.json`. Three
 * places had to move together — `PRESETS.biome.source`, the `./biome` exports
 * entry, and the `files` array — and nothing failed if one of them was missed:
 * `files` is globs, so a stale exports target still resolves in the repo and
 * only 404s once published. `npm pack --dry-run` answers what actually ships
 * without reimplementing npm's glob semantics.
 */
describe('shipped preset paths', () => {
	let published: Set<string>

	beforeAll(() => {
		// --ignore-scripts skips the build; nothing asserted here lives in dist.
		const run = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
			cwd: repoRoot,
			encoding: 'utf8',
			timeout: 120_000,
		})
		// Without this, a failed pack surfaces as an opaque JSON.parse error.
		if (run.status !== 0) throw new Error(`npm pack failed (${run.status}): ${run.stderr}`)
		const files = JSON.parse(run.stdout)[0].files as { path: string }[]
		published = new Set(files.map((f) => f.path))
	})

	it('publishes every file `copy <preset>` reads from', () => {
		for (const [name, preset] of Object.entries(PRESETS)) {
			expect(fs.existsSync(join(repoRoot, preset.source)), `${name}: missing on disk`).toBe(true)
			expect(published.has(preset.source), `${name}: not in package.json files`).toBe(true)
		}
	})

	it('publishes every file the exports map points at', () => {
		// Object-valued entries resolve into dist, which --ignore-scripts skipped.
		for (const [subpath, target] of Object.entries(pkg.exports)) {
			if (typeof target !== 'string') continue
			const rel = target.replace(/^\.\//, '')
			expect(fs.existsSync(join(repoRoot, rel)), `${subpath}: missing on disk`).toBe(true)
			expect(published.has(rel), `${subpath}: not in package.json files`).toBe(true)
		}
	})
})
