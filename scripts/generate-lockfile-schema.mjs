// Regenerate the published JSON Schemas from the source constants (#529).
// Run via `pnpm schema:generate` (builds the CLI first — this imports dist/).
// tests/cli/utils/lockfile-schema.test.ts fails CI when the committed copies
// are stale against the source.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG_SCHEMA } from '../dist/cli/commands/setup-presets.js'
import { lockfileSchema } from '../dist/cli/utils/lockfile.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'apps/docs/static/schemas')
fs.mkdirSync(outDir, { recursive: true })

for (const [file, schema] of [
	['lockfile.json', lockfileSchema()],
	['project-config.json', CONFIG_SCHEMA],
]) {
	fs.writeFileSync(path.join(outDir, file), `${JSON.stringify(schema, null, '\t')}\n`)
	console.log(`wrote apps/docs/static/schemas/${file}`)
}
