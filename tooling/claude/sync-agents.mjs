#!/usr/bin/env node
// Canonical sync-agents for @rtorcato/* repos (shipped by @rtorcato/repo-tooling
// — copy via `repo-tooling copy claude-sync-agents`).
//
// Regenerates AGENTS.md from the repo's SKILL.md body so the two can never
// drift. SKILL.md (with its YAML frontmatter) is the single source of truth;
// AGENTS.md is its frontmatter-stripped mirror for non-Claude AI tools.
//
//   node scripts/sync-agents.mjs           # write AGENTS.md
//   node scripts/sync-agents.mjs --check   # exit 1 if AGENTS.md is stale (used by CI)
//
// Zero-config: the skill directory is derived from the root package.json `name`
// with any npm scope stripped — `@rtorcato/js-common` → `skills/js-common/`.
// That is the convention across the family, so this file is copied unmodified.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const skillRelative = `skills/${name.replace(/^@[^/]+\//, '')}/SKILL.md`
const SKILL = join(root, skillRelative)
const AGENTS = join(root, 'AGENTS.md')

const HEADER = `<!-- Generated from ${skillRelative} by scripts/sync-agents.mjs — do not edit by hand; run \`pnpm sync:agents\`. -->\n\n`

// Strip the leading YAML frontmatter block, keep the markdown body.
const body = readFileSync(SKILL, 'utf8').replace(/^---\n[\s\S]*?\n---\n+/, '')
const expected = HEADER + body

if (process.argv.includes('--check')) {
	let current = ''
	try {
		current = readFileSync(AGENTS, 'utf8')
	} catch {
		// AGENTS.md missing → treat as stale below.
	}
	if (current !== expected) {
		console.error(`AGENTS.md is out of sync with ${skillRelative} — run \`pnpm sync:agents\`.`)
		process.exit(1)
	}
	console.log(`AGENTS.md is in sync with ${skillRelative}.`)
} else {
	writeFileSync(AGENTS, expected)
	console.log(`Wrote AGENTS.md from ${skillRelative}`)
}
