import { join, relative } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { getFixers } from '../../src/cli/commands/fix.js'
import { PRESET_NAMES } from '../../src/cli/commands/setup-presets.js'

// #829: a stranger copies commands out of the README and docs. Every
// `repo-tooling fix <target>` and `setup --preset <name>` there must name a
// target or preset that exists, or the first thing they paste fails.

const ROOT = join(import.meta.dirname, '..', '..')

/**
 * Targets the docs name only to say they moved: to @rtorcato/shared-docs (#718,
 * still caught by the CLI's pointer) and to @infrazero/repo-ai (#658, the 3.x
 * migration table).
 */
const MOVED = new Set(['docs-site', 'brand', 'claude-skills', 'labels', 'ai-loop-identity'])

async function docFiles(): Promise<string[]> {
	const docs = join(ROOT, 'apps', 'docs', 'docs')
	const inDocs = (await fs.readdir(docs, { recursive: true })) as string[]
	return [
		join(ROOT, 'README.md'),
		...inDocs.filter((f) => /\.mdx?$/.test(f)).map((f) => join(docs, f)),
	]
}

/** `[file, token]` for every match of `pattern`'s first group. */
async function mentions(pattern: RegExp): Promise<[string, string][]> {
	const found: [string, string][] = []
	for (const file of await docFiles()) {
		const text = await fs.readFile(file, 'utf8')
		for (const m of text.matchAll(pattern)) found.push([relative(ROOT, file), m[1] as string])
	}
	return found
}

describe('commands in the README and docs (#829)', () => {
	it('name only registered fix targets', async () => {
		const targets = new Set(getFixers().map((f) => f.target))
		const found = await mentions(/repo-tooling\s+fix\s+([a-z][a-z0-9-]*)/g)
		expect(found.length).toBeGreaterThan(0)
		expect(found.filter(([, t]) => !targets.has(t) && !MOVED.has(t))).toEqual([])
	})

	it('name only real setup presets', async () => {
		const presets = new Set<string>(PRESET_NAMES)
		const found = await mentions(/repo-tooling\s+setup\b[^\n`]*?--preset[= ]([a-z][a-z0-9-]*)/g)
		expect(found.length).toBeGreaterThan(0)
		expect(found.filter(([, p]) => !presets.has(p))).toEqual([])
	})
})
