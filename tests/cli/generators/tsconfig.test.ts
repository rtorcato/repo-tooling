import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { generateTSConfig } from '../../../src/cli/generators/tsconfig.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		projectName: 'demo',
		projectType: 'library',
		typescript: { enabled: true, config: 'base' },
		linting: { tool: 'none' },
		formatting: { tool: 'none' },
		testing: { framework: 'none' },
		gitHooks: false,
		commitLint: false,
		semanticRelease: false,
		bundler: 'none',
		...overrides,
	}
}

describe('generateTSConfig', () => {
	it('writes a tsconfig.json that extends the requested preset', async () => {
		const dir = newTmpDir()
		await generateTSConfig(baseConfig({ typescript: { enabled: true, config: 'react' } }), dir)

		const tsconfig = await fs.readJson(join(dir, 'tsconfig.json'))
		expect(tsconfig.extends).toBe('@rtorcato/repo-tooling/typescript/react')
		// paths/baseUrl are inherited from the shared preset (anchored via ${configDir}),
		// not redeclared per project — baseUrl is deprecated in TS 7.0.
		expect(tsconfig.compilerOptions.baseUrl).toBeUndefined()
		expect(tsconfig.compilerOptions.paths).toBeUndefined()
		expect(tsconfig.include).toContain('reset.d.ts')
	})

	it('sets outDir/rootDir for library projects', async () => {
		const dir = newTmpDir()
		await generateTSConfig(baseConfig({ projectType: 'library' }), dir)

		const tsconfig = await fs.readJson(join(dir, 'tsconfig.json'))
		expect(tsconfig.compilerOptions.outDir).toBe('./dist')
		expect(tsconfig.compilerOptions.rootDir).toBe('./src')
	})

	it('extends the Bun preset when targeting Bun, regardless of config (#225)', async () => {
		const dir = newTmpDir()
		await generateTSConfig(
			baseConfig({ typescript: { enabled: true, config: 'base' }, bun: true }),
			dir
		)
		const tsconfig = await fs.readJson(join(dir, 'tsconfig.json'))
		expect(tsconfig.extends).toBe('@rtorcato/repo-tooling/typescript/bun')
	})

	it('switches include/exclude for Next.js projects', async () => {
		const dir = newTmpDir()
		await generateTSConfig(
			baseConfig({ projectType: 'nextjs-app', typescript: { enabled: true, config: 'next' } }),
			dir
		)

		const tsconfig = await fs.readJson(join(dir, 'tsconfig.json'))
		expect(tsconfig.include).toEqual([
			'next-env.d.ts',
			'src',
			'app',
			'pages',
			'components',
			'reset.d.ts',
		])
		expect(tsconfig.exclude).toContain('.next')
		expect(tsconfig.compilerOptions.outDir).toBeUndefined()
		// The next preset clears `paths` (#922), so the app declares its own aliases.
		expect(tsconfig.compilerOptions.paths).toEqual({ '~/*': ['./src/*'], '@/*': ['./src/*'] })
	})

	it('keeps ${configDir} out of the next preset paths, which Turbopack cannot expand (#922)', async () => {
		const preset = await fs.readFile(
			join(__dirname, '../../../tooling/typescript/tsconfig.next.json'),
			'utf8'
		)
		expect(preset).toMatch(/"paths":\s*\{\}/)
	})
})
