import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { generateBun } from '../../../src/cli/generators/bun.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

describe('generateBun', () => {
	it('writes bunfig.toml + a tsconfig extending the bun preset', async () => {
		const dir = newTmpDir()
		const written = await generateBun(dir)
		expect(written).toEqual(['bunfig.toml', 'tsconfig.json'])

		expect(await fs.readFile(join(dir, 'bunfig.toml'), 'utf-8')).toContain('[test]')
		const tsconfig = await fs.readJson(join(dir, 'tsconfig.json'))
		expect(tsconfig.extends).toBe('@rtorcato/repo-tooling/typescript/bun')
	})

	it('never clobbers an existing tsconfig.json or bunfig.toml', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'tsconfig.json'), { extends: './my-base.json' })
		await fs.writeFile(join(dir, 'bunfig.toml'), '# mine\n')
		expect(await generateBun(dir)).toEqual([])
		expect((await fs.readJson(join(dir, 'tsconfig.json'))).extends).toBe('./my-base.json')
		expect(await fs.readFile(join(dir, 'bunfig.toml'), 'utf-8')).toBe('# mine\n')
	})

	it('the shipped bun tsconfig preset extends base and sets bun types', async () => {
		const preset = await fs.readJson(join(process.cwd(), 'tooling/typescript/tsconfig.bun.json'))
		expect(preset.extends).toBe('./tsconfig.base.json')
		expect(preset.compilerOptions.types).toEqual(['bun'])
	})
})
