import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONFIG_SCHEMA } from '../../../src/cli/commands/setup-presets.js'
import {
	type JsonSchema,
	validateAgainstSchema as validate,
} from '../../../src/cli/utils/json-schema.js'
import { lockfileSchema } from '../../../src/cli/utils/lockfile.js'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '../../..')

const published = (file: string) =>
	JSON.parse(readFileSync(join(repoRoot, 'apps/docs/static/schemas', file), 'utf8')) as unknown

describe('published JSON Schemas', () => {
	// The docs site serves apps/docs/static/ verbatim, so these committed files
	// ARE the URLs the lockfiles point at. Stale copy → this fails CI.
	it('lockfile.json matches lockfileSchema()', () => {
		expect(published('lockfile.json'), 'run `pnpm schema:generate` and commit the result').toEqual(
			lockfileSchema()
		)
	})

	it('project-config.json matches CONFIG_SCHEMA', () => {
		expect(
			published('project-config.json'),
			'run `pnpm schema:generate` and commit the result'
		).toEqual(CONFIG_SCHEMA)
	})

	// The $id is the published URL: docs deploy to rtorcato.github.io/repo-tooling
	// and static/schemas/lockfile.json lands at /schemas/lockfile.json. Every
	// lockfile writeLockfile stamps carries this same constant as its $schema.
	it('$ids match the deployed static paths', () => {
		expect(lockfileSchema().$id).toBe(
			'https://rtorcato.github.io/repo-tooling/schemas/lockfile.json'
		)
		expect(CONFIG_SCHEMA.$id).toBe(
			'https://rtorcato.github.io/repo-tooling/schemas/project-config.json'
		)
	})
})

describe("this repo's own lockfile", () => {
	const schema = lockfileSchema() as unknown as JsonSchema
	const lockfile = JSON.parse(readFileSync(join(repoRoot, '.repo-tooling.json'), 'utf8')) as Record<
		string,
		unknown
	>

	// The repo that publishes the schema must never carry a lockfile that fails
	// it (#540). Hand-editing .repo-tooling.json, or adding a Lockfile field
	// without teaching lockfileSchema() about it, breaks here rather than in a
	// consumer's editor.
	it('validates against lockfileSchema()', () => {
		expect(validate(lockfile, schema)).toEqual([])
	})

	// Proves the assertion above is real: each mutation is a way the file could
	// drift, and each must produce at least one error. `record`/`rules` since #559.
	const record = lockfile.record as Record<string, unknown>
	const withRules = (rules: unknown) => ({ ...lockfile, rules })

	it('rejects a drifted lockfile', () => {
		const missingRequired = { ...lockfile, record: { ...record } }
		delete missingRequired.record.writtenBy
		expect(validate(missingRequired, schema)).not.toEqual([])
		expect(validate({ ...lockfile, strayKey: true }, schema)).not.toEqual([])
		expect(validate({ ...lockfile, version: '4' }, schema)).not.toEqual([])
		// The flat pre-#559 layout no longer validates as v4.
		expect(validate({ ...lockfile, aiLoop: { agentUser: 'flat' } }, schema)).not.toEqual([])
		expect(validate(withRules({ aiLoop: { agentUsr: 'typo' } }), schema)).not.toEqual([])
		// #533: only skills this package ships, and only as an array.
		expect(validate(withRules({ requiredSkills: ['not-a-skill'] }), schema)).not.toEqual([])
		expect(validate(withRules({ requiredSkills: 'ai-issue-loop' }), schema)).not.toEqual([])
		expect(
			validate(
				{
					...lockfile,
					record: { ...record, config: { ...(record.config as object), bundler: 'webpack' } },
				},
				schema
			)
		).not.toEqual([])
	})

	// #534: the schema is the whole enforcement of "advisory metadata, never an
	// install directive" — an entry may say what and why, and may not say how.
	it('accepts an advisory mcp.recommended entry and rejects executable config', () => {
		const mcp = (recommended: unknown) => validate(withRules({ mcp: { recommended } }), schema)
		expect(
			mcp([{ name: 'some-server', importance: 'important', why: 'edits the design files' }])
		).toEqual([])
		expect(mcp([{ name: 'some-server', importance: 'vital', why: 'x' }])).not.toEqual([])
		expect(mcp([{ name: 'some-server', importance: 'important' }])).not.toEqual([])
		expect(
			mcp([{ name: 'some-server', importance: 'important', why: 'x', command: 'npx anything' }])
		).not.toEqual([])
	})

	// #558: an exception's reason is mandatory and non-empty — the schema is what
	// enforces "every deviation is argued", so an empty reason must not validate.
	it('accepts a declared exception with a reason and rejects one without', () => {
		const exceptions = (value: unknown) => validate(withRules({ exceptions: value }), schema)
		expect(exceptions({ TypeScript: 'this repo is the package itself' })).toEqual([])
		expect(exceptions({ TypeScript: '' })).not.toEqual([])
		expect(exceptions({ TypeScript: true })).not.toEqual([])
		expect(exceptions(['TypeScript'])).not.toEqual([])
	})
})
