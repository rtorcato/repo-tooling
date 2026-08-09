import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * stdout belongs to the commands, not the modules underneath them (#357).
 *
 * `fix --json` / `doctor --json` promise a parseable payload on stdout, and a
 * single stray `console.log` from anything they call lands in the middle of it.
 * #358 fixed the sites it could see by grepping the fixer files — which missed
 * `src/base/github-settings.ts` (reachable from the `github-settings` fixer but
 * not a fixer file) and `src/languages/python/fixers.ts` (merged 16 seconds
 * after it). #360 then caught the Python half and added a guard over
 * `src/base/fixers.ts` + `src/languages/*` + `/fixers.ts`, which still can't see
 * github-settings.ts. Three passes, same class of miss each time: an
 * enumeration that has to be kept in sync by hand.
 *
 * So the invariant is stated over the *trees* rather than a file list, and
 * replaces #360's narrower scan rather than sitting alongside it — a new
 * language module is covered the day it lands, with no list to update.
 * Advisories still get printed; they just go to `console.error`, which is where
 * diagnostics belong whether or not `--json` is set.
 *
 * ponytail: a text scan, not a run of every fixer. Reaching each advisory branch
 * for real would mean constructing a dozen failure states (no package.json, no
 * git remote, gh unauthenticated); grepping is what a reader would do, and it
 * generalizes to code nobody thought to test. tests/cli/commands/fix.test.ts
 * covers the behaviour end to end for one path.
 */

const repoRoot = path.resolve(import.meta.dirname, '../..')

// src/cli/commands and src/cli/index.ts are the user-facing layer — printing is
// their job, and they gate it on `silent` themselves. Everything below them is
// library code with no business writing to stdout.
const TREES = ['src/base/**/*.ts', 'src/languages/**/*.ts']

const sourceFiles = TREES.flatMap((pattern) => globSync(pattern, { cwd: repoRoot }))

describe('nothing under src/base or src/languages writes to stdout', () => {
	it('finds files to scan (the scan itself still works)', () => {
		expect(sourceFiles.length).toBeGreaterThan(5)
	})

	it('uses console.error for advisories, never console.log', () => {
		const offenders = sourceFiles.filter((file) =>
			readFileSync(path.join(repoRoot, file), 'utf8').includes('console.log(')
		)
		expect(
			offenders,
			'stdout carries the --json payload — send diagnostics to console.error (#357)'
		).toEqual([])
	})
})
