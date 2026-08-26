import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONFIG_SCHEMA } from '../../../src/cli/commands/setup-presets.js'
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

interface JsonSchema {
	type?: string
	enum?: readonly string[]
	minLength?: number
	required?: readonly string[]
	properties?: Record<string, JsonSchema>
	additionalProperties?: boolean | JsonSchema
}

/**
 * Validate against the keyword subset lockfileSchema() actually uses: type
 * (object/string/integer/boolean), enum, minLength, required, properties and
 * additionalProperties (`false` or a schema). Returns one message per problem.
 *
 * Hand-rolled because the repo has no JSON Schema validator, and the schema
 * leans on six keywords — not enough to justify an ajv devDependency.
 */
// ponytail: `format: date-time` on writtenAt is not checked, and neither are
// arrays or composition keywords — none appear in the schema. Reach for ajv the
// day one does.
function validate(value: unknown, schema: JsonSchema, path = '$'): string[] {
	const errors: string[] = []
	if (schema.enum && !schema.enum.includes(value as string)) {
		errors.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`)
	}
	if (schema.type === 'object') {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			return [`${path}: expected object`]
		}
		const obj = value as Record<string, unknown>
		for (const key of schema.required ?? []) {
			if (!(key in obj)) errors.push(`${path}: missing required property "${key}"`)
		}
		for (const [key, child] of Object.entries(obj)) {
			const property = schema.properties?.[key]
			if (property) errors.push(...validate(child, property, `${path}.${key}`))
			else if (schema.additionalProperties === false) {
				errors.push(`${path}: unknown property "${key}"`)
			} else if (typeof schema.additionalProperties === 'object') {
				errors.push(...validate(child, schema.additionalProperties, `${path}.${key}`))
			}
		}
		return errors
	}
	if (schema.type === 'integer') {
		if (!Number.isInteger(value)) errors.push(`${path}: expected integer`)
	} else if (schema.type && typeof value !== schema.type) {
		errors.push(`${path}: expected ${schema.type}, got ${typeof value}`)
	}
	if (
		schema.minLength !== undefined &&
		typeof value === 'string' &&
		value.length < schema.minLength
	) {
		errors.push(`${path}: shorter than minLength ${schema.minLength}`)
	}
	return errors
}

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
	// drift, and each must produce at least one error.
	it('rejects a drifted lockfile', () => {
		const missingRequired = { ...lockfile }
		delete missingRequired.writtenBy
		expect(validate(missingRequired, schema)).not.toEqual([])
		expect(validate({ ...lockfile, strayKey: true }, schema)).not.toEqual([])
		expect(validate({ ...lockfile, version: '3' }, schema)).not.toEqual([])
		expect(validate({ ...lockfile, aiLoop: { agentUsr: 'typo' } }, schema)).not.toEqual([])
		expect(
			validate(
				{ ...lockfile, config: { ...(lockfile.config as object), bundler: 'webpack' } },
				schema
			)
		).not.toEqual([])
	})
})
