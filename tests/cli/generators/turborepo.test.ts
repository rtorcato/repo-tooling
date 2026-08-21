import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { runDoctor } from '../../../src/cli/commands/doctor.js'
import { generateNx } from '../../../src/cli/generators/nx.js'
import { generateTurborepo } from '../../../src/cli/generators/turborepo.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

describe('generateTurborepo', () => {
	it('writes a valid turbo.json with a task pipeline', async () => {
		const dir = newTmpDir()
		const written = await generateTurborepo(dir)
		expect(written).toBe('turbo.json')

		const turbo = await fs.readJson(join(dir, 'turbo.json'))
		expect(turbo.$schema).toContain('turborepo')
		expect(turbo.tasks.build.dependsOn).toEqual(['^build'])
		expect(turbo.tasks.build.outputs).toContain('dist/**')
		expect(turbo.tasks.dev).toEqual({ cache: false, persistent: true })
	})
})

describe('doctor Turborepo check', () => {
	const findTurbo = (results: { check: string }[]) => results.find((r) => r.check === 'Turborepo')

	it('does not surface the check in a single-package repo', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo' })
		expect(findTurbo(await runDoctor(dir))).toBeUndefined()
	})

	it('flags optional-missing in a workspace without turbo.json', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo' })
		await fs.writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
		expect(findTurbo(await runDoctor(dir))?.status).toBe('optional-missing')
	})

	it('reports ok in a workspace with turbo.json', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo' })
		await fs.writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
		await generateTurborepo(dir)
		expect(findTurbo(await runDoctor(dir))?.status).toBe('ok')
	})

	it('reports ok in a workspace with nx.json (using Nx)', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo' })
		await fs.writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
		await generateNx(dir)
		const turbo = findTurbo(await runDoctor(dir))
		expect(turbo?.status).toBe('ok')
		expect(turbo?.detail).toMatch(/Nx/)
	})

	it('flags drift when both turbo.json and nx.json are present', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo' })
		await fs.writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
		await generateTurborepo(dir)
		await generateNx(dir)
		expect(findTurbo(await runDoctor(dir))?.status).toBe('drift')
	})
})

describe('generateNx', () => {
	it('writes a valid nx.json with targetDefaults', async () => {
		const dir = newTmpDir()
		const written = await generateNx(dir)
		expect(written).toEqual(['nx.json'])

		const nx = await fs.readJson(join(dir, 'nx.json'))
		expect(nx.$schema).toContain('nrwl/nx')
		expect(nx.targetDefaults.build.dependsOn).toEqual(['^build'])
	})

	it('never clobbers an existing nx.json', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'nx.json'), { custom: true })
		expect(await generateNx(dir)).toEqual([])
		expect((await fs.readJson(join(dir, 'nx.json'))).custom).toBe(true)
	})
})
