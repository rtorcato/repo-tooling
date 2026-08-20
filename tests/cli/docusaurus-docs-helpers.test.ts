import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'fs-extra'
import { beforeAll, describe, expect, it } from 'vitest'
import { copyPreset } from '../../src/cli/utils/copy-preset.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

interface DocsHelpers {
	escapeForMarkdownTable: (text: string) => string
	collectExportNames: (file: string) => Set<string>
	spliceGeneratedBlock: (existing: string, block: string) => string | null
	MARKER_START: string
	MARKER_END: string
}

/** Exercise the asset as consumers get it: copied out, then imported. */
let helpers: DocsHelpers
let copiedTo: string

beforeAll(async () => {
	const dir = newTmpDir()
	const result = await copyPreset('docusaurus-docs-helpers', dir)
	copiedTo = result.target
	helpers = (await import(pathToFileURL(result.targetPath).href)) as DocsHelpers
})

describe('copy docusaurus-docs-helpers', () => {
	it('lands at scripts/docs-helpers.mjs', () => {
		expect(copiedTo).toBe('scripts/docs-helpers.mjs')
	})
})

describe('escapeForMarkdownTable', () => {
	it('escapes angle brackets outside code spans and leaves them inside', () => {
		// Escaping beats stripping: a one-pass `/<[^>]*>/` strip leaves `<b>`
		// behind here, and deletes the `<T>` from an unbackticked `Success<T>`.
		expect(helpers.escapeForMarkdownTable('a <<b>> c')).toBe('a &lt;&lt;b>> c')
		expect(helpers.escapeForMarkdownTable('returns Success<T>')).toBe('returns Success&lt;T>')
		expect(helpers.escapeForMarkdownTable('use `Success<T>` here')).toBe('use `Success<T>` here')
		expect(helpers.escapeForMarkdownTable('a | b')).toBe('a \\| b')
	})

	it('escapes a backslash so it cannot re-expose the pipe it precedes', () => {
		// Escaping only `|` would yield `a\\|b` — an escaped backslash plus a
		// live pipe, which still breaks the row.
		expect(helpers.escapeForMarkdownTable('a\\|b')).toBe('a\\\\\\|b')
	})
})

describe('spliceGeneratedBlock', () => {
	const page = [
		'# Colors',
		'',
		'Hand-written intro.',
		'',
		'<<START>>',
		'old reference',
		'<<END>>',
		'',
		'- [random](./random.md)',
		'',
	].join('\n')

	it('replaces only the marked block, leaving the guide alone', () => {
		const source = page
			.replace('<<START>>', helpers.MARKER_START)
			.replace('<<END>>', helpers.MARKER_END)
		const next = helpers.spliceGeneratedBlock(
			source,
			`${helpers.MARKER_START}\nnew reference\n${helpers.MARKER_END}`
		)

		expect(next).toContain('Hand-written intro.')
		expect(next).toContain('- [random](./random.md)')
		expect(next).toContain('new reference')
		expect(next).not.toContain('old reference')
	})

	it('returns null for a page with no markers, so it is left untouched', () => {
		expect(helpers.spliceGeneratedBlock('# Fully hand-written\n', 'anything')).toBeNull()
	})
})

describe('collectExportNames', () => {
	/** Write `files` (path → source) into a fresh dir and return that dir. */
	async function seed(files: Record<string, string>): Promise<string> {
		const dir = newTmpDir()
		for (const [name, src] of Object.entries(files)) {
			await fs.outputFile(join(dir, name), src)
		}
		return dir
	}

	it('picks up declaration, brace and aliased exports', async () => {
		const dir = await seed({
			'index.ts': [
				'export function alpha() {}',
				'export const beta = 1',
				'export class Gamma {}',
				'export type Delta = string',
				'export interface Epsilon {}',
				'export enum Zeta {}',
				'const inner = 2',
				'export { inner as eta }',
			].join('\n'),
		})

		expect([...helpers.collectExportNames(join(dir, 'index.ts'))].sort()).toEqual([
			'Delta',
			'Epsilon',
			'Gamma',
			'Zeta',
			'alpha',
			'beta',
			'eta',
		])
	})

	it('takes the alias, not the local name, for an aliased re-export', async () => {
		// The bug this asset exists to retire: `.split(/\s+as\s+/)[0]` yields
		// `foo`, a symbol no consumer can import — `bar` is the exported name.
		const dir = await seed({
			'index.ts': "export { foo as bar } from './impl.js'\n",
			'impl.ts': 'export function foo() {}\n',
		})

		const names = helpers.collectExportNames(join(dir, 'index.ts'))
		expect(names.has('bar')).toBe(true)
	})

	it('follows both re-export forms into relative files and skips bare specifiers', async () => {
		const dir = await seed({
			'index.ts': [
				"export * from './star.js'",
				"export { picked } from './named.js'",
				"export * from 'node:fs'",
			].join('\n'),
			'star.ts': 'export const fromStar = 1\n',
			'named.ts': 'export const picked = 1\nexport const notReexported = 2\n',
		})

		const names = helpers.collectExportNames(join(dir, 'index.ts'))
		expect(names.has('fromStar')).toBe(true)
		expect(names.has('picked')).toBe(true)
	})

	it('resolves a directory re-export via its index.ts', async () => {
		const dir = await seed({
			'index.ts': "export * from './nested/index.js'\n",
			'nested/index.ts': 'export const deep = 1\n',
		})

		expect(helpers.collectExportNames(join(dir, 'index.ts')).has('deep')).toBe(true)
	})

	it('survives an import cycle and a missing file', async () => {
		const dir = await seed({
			'a.ts': "export const a = 1\nexport * from './b.js'\n",
			'b.ts': "export const b = 1\nexport * from './a.js'\nexport * from './gone.js'\n",
		})

		expect([...helpers.collectExportNames(join(dir, 'a.ts'))].sort()).toEqual(['a', 'b'])
	})
})
