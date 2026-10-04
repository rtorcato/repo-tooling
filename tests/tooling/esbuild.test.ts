import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { externalsPlugins } from '../../tooling/esbuild/index.mjs'

async function project(pkg?: object) {
	const dir = await mkdtemp(join(tmpdir(), 'esbuild-externals-'))
	if (pkg) await writeFile(join(dir, 'package.json'), JSON.stringify(pkg))
	return dir
}

describe('esbuild externalsPlugins', () => {
	it('skips esbuild-node-externals for a zero-dependency package', async () => {
		expect(
			await externalsPlugins(await project({ name: 'x', devDependencies: { a: '1' } }))
		).toEqual([])
	})

	it('skips it when there is no package.json', async () => {
		expect(await externalsPlugins(await project())).toEqual([])
	})

	it('loads the plugin when the package declares dependencies', async () => {
		const plugins = await externalsPlugins(await project({ dependencies: { a: '1' } }))
		expect(plugins.map((p) => p.name)).toEqual(['node-externals'])
	})
})
