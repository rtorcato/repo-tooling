/**
 * A JSON Schema validator covering exactly the keyword subset `lockfileSchema()`
 * and `CONFIG_SCHEMA` use: type (object/array/string/integer/boolean), enum,
 * minLength, required, properties, additionalProperties (`false` or a schema)
 * and items. Returns one message per problem; an empty array means valid.
 *
 * Hand-rolled because the repo has no JSON Schema validator and the schemas lean
 * on seven keywords — not enough to justify an ajv dependency. It lives in src
 * rather than in a test because a reference repo's lockfile is untrusted input
 * that has to be schema-checked before it is read (#563).
 */
// ponytail: `format: date-time` is not checked, and neither are composition
// keywords — none appear in either schema. Reach for ajv the day one does.

export interface JsonSchema {
	type?: string
	enum?: readonly string[]
	minLength?: number
	required?: readonly string[]
	properties?: Record<string, JsonSchema>
	additionalProperties?: boolean | JsonSchema
	items?: JsonSchema
}

export function validateAgainstSchema(value: unknown, schema: JsonSchema, path = '$'): string[] {
	const errors: string[] = []
	if (schema.enum && !schema.enum.includes(value as string)) {
		errors.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`)
	}
	if (schema.type === 'array') {
		if (!Array.isArray(value)) return [`${path}: expected array`]
		if (schema.items) {
			for (const [i, item] of value.entries()) {
				errors.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`))
			}
		}
		return errors
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
			if (property) errors.push(...validateAgainstSchema(child, property, `${path}.${key}`))
			else if (schema.additionalProperties === false) {
				errors.push(`${path}: unknown property "${key}"`)
			} else if (typeof schema.additionalProperties === 'object') {
				errors.push(...validateAgainstSchema(child, schema.additionalProperties, `${path}.${key}`))
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
