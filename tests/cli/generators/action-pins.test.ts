import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PINS, pinActions } from '../../../src/base/action-pins.js'

/**
 * Guard against the drift loop in #340: the generators embed action pins as
 * plain strings, so Dependabot can't see them. It bumps this repo's own
 * workflows, the emitted pins stay behind, the next workflow sync in a consuming
 * repo silently reverts that repo's bump, and Dependabot re-opens the same PR.
 *
 * Anchoring the emitted pins to the ones this repo actually runs means the
 * Dependabot PR that bumps our own ci.yml also fails here until the generators
 * follow — the reminder lands on the PR that caused the drift.
 *
 * Matches ANY org, not just `actions/`. The first cut of this test was scoped to
 * `actions/` and so covered 24 of the 42 emitted pins; the 18 it skipped were
 * already drifting the day it landed (one action was two majors behind, and
 * pnpm/action-setup was pinned at both v4 and v6 within the emitted set).
 *
 * ponytail: a text scan over the sources, not a generator invocation. The pins
 * are literals in template strings, so grepping is what a reader would do.
 */

const repoRoot = path.resolve(import.meta.dirname, '../../..')
// A pin is `@vN` in a template, or `@<sha> # vN.x.y` once it is immutable (#985).
const PIN = /\b([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)@(?:v(\d+)|[0-9a-f]{40}[ \t]*#[ \t]*v(\d+))/g

const pinsIn = (files: string[]) => {
	const found = new Map<string, Map<string, string[]>>()
	for (const file of files) {
		for (const [, action, tagMajor, shaMajor] of readFileSync(
			path.join(repoRoot, file),
			'utf8'
		).matchAll(PIN)) {
			const major = tagMajor ?? shaMajor
			if (!action || !major) continue
			const majors = found.get(action) ?? new Map()
			majors.set(major, [...(majors.get(major) ?? []), file])
			found.set(action, majors)
		}
	}
	return found
}

const glob = (pattern: string) => globSync(pattern, { cwd: repoRoot })

const ownPins = pinsIn(glob('.github/workflows/*.yml'))
const emittedPins = pinsIn([
	...glob('src/**/*.ts'),
	...glob('tooling/github-actions/workflows/*.yml'),
	// action.yml (#315) runs on consumers' runners, so its pins drift the same
	// way an emitted workflow's do.
	'action.yml',
])

describe("emitted action pins track this repo's own workflows", () => {
	it('finds pins on both sides (the scan itself still works)', () => {
		expect(ownPins.size).toBeGreaterThan(0)
		expect(emittedPins.size).toBeGreaterThan(0)
	})

	// Only the intersection is checkable: an action we scaffold but never run
	// ourselves (e.g. actions/github-script) has nothing to compare against.
	for (const [action, majors] of emittedPins) {
		const own = ownPins.get(action)
		if (!own) continue

		it(`${action} matches the major this repo runs`, () => {
			const expected = [...own.keys()]
			expect(expected).toHaveLength(1) // our own workflows must agree first
			expect([...majors.keys()], `emitted in: ${[...majors.values()].flat().join(', ')}`).toEqual(
				expected
			)
		})
	}
})

describe('emitted workflows pin every action to a commit SHA (#985)', () => {
	it('rewrites a known tag to its SHA and leaves the rest alone', () => {
		const out = pinActions(
			'      - uses: actions/checkout@v7\n      - uses: "pnpm/action-setup@v6"\n      - uses: ./\n      - uses: acme/unknown@v1\n'
		)
		expect(out).toMatch(/uses: actions\/checkout@[0-9a-f]{40} # v7\.\d+\.\d+\n/)
		expect(out).toMatch(/uses: "pnpm\/action-setup@[0-9a-f]{40} # v6\.\d+\.\d+"\n/)
		expect(out).toContain('uses: ./\n')
		expect(out).toContain('uses: acme/unknown@v1\n')
	})

	// A new `uses: org/action@vN` in a generator with no table entry would ship
	// as a mutable tag, so fail here until it gets one.
	it('has a table entry for every action a generator emits', () => {
		const emitted = new Set<string>()
		for (const file of glob('src/**/*.ts')) {
			if (file.endsWith('action-pins.ts')) continue
			const text = readFileSync(path.join(repoRoot, file), 'utf8')
			for (const [, ref] of text.matchAll(/uses:\s*['"]?([\w.-]+\/[\w./-]+@v[\w.]+)/g))
				emitted.add(ref ?? '')
		}
		expect(emitted.size).toBeGreaterThan(0)
		expect([...emitted].filter((ref) => !(ref in PINS))).toEqual([])
	})
})
