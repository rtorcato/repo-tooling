import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONFIG_SCHEMA } from '../../../src/cli/commands/setup-presets.js'
import { lockfileSchema } from '../../../src/cli/utils/lockfile.js'

const schemasDir = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'../../../apps/docs/static/schemas'
)

const published = (file: string) =>
	JSON.parse(readFileSync(join(schemasDir, file), 'utf8')) as unknown

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
