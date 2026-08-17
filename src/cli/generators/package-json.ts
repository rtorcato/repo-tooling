import fs from 'fs-extra'
import path from 'node:path'
import type { ProjectConfig } from '../commands/setup.js'
import { PNPM_FALLBACK_VERSION, detectPnpmVersion } from './misc.js'

export async function generatePackageJson(config: ProjectConfig, targetDir: string) {
	const packageJsonPath = path.join(targetDir, 'package.json')

	let existingPackageJson = {}
	if (await fs.pathExists(packageJsonPath)) {
		existingPackageJson = await fs.readJson(packageJsonPath)
	}

	const includeTreeshake = Boolean(config.treeshakeCheck && config.projectType === 'library')

	const packageJson: any = {
		name: config.projectName,
		version: '0.1.0',
		description: '',
		type: 'module',
		// The single source of truth for pnpm/action-setup, which is why the
		// generated workflows carry no `version:` input (#364).
		packageManager: `pnpm@${detectPnpmVersion() ?? PNPM_FALLBACK_VERSION}`,
		...existingPackageJson,
		scripts: {
			...getScripts(config, { includeTreeshake }),
			...(existingPackageJson as any)?.scripts,
		},
		dependencies: {
			...(existingPackageJson as any)?.dependencies,
		},
		devDependencies: {
			'@rtorcato/repo-tooling': 'latest',
			...getDependencies(config),
			...(existingPackageJson as any)?.devDependencies,
		},
	}

	// Add additional package.json fields based on project type.
	// Exports must match tsup's output for a "type": "module" package with
	// format: ['cjs','esm']: ESM → index.js, CJS → index.cjs, types →
	// index.d.ts (ESM) / index.d.cts (CJS).
	if (config.projectType === 'library') {
		packageJson.main = './dist/index.cjs'
		packageJson.module = './dist/index.js'
		packageJson.types = './dist/index.d.ts'
		packageJson.exports = {
			'.': {
				types: {
					import: './dist/index.d.ts',
					require: './dist/index.d.cts',
				},
				import: './dist/index.js',
				require: './dist/index.cjs',
			},
		}
		packageJson.files = ['dist']
		packageJson.publishConfig = {
			access: 'public',
		}
	}

	// Commitizen adapter path — makes `pnpm commit` launch the conventional
	// changelog prompt. Merged so an existing `config` block is preserved.
	if (config.commitLint) {
		packageJson.config = {
			...(packageJson.config ?? {}),
			commitizen: { path: './node_modules/cz-conventional-changelog' },
		}
	}

	// Build-script approvals (esbuild etc.) are NOT written here: pnpm 11 ignores
	// package.json's `pnpm` field and reads them from pnpm-workspace.yaml instead
	// (see ensureBuildApprovals in build.ts).

	await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 })
}

interface GetScriptsOptions {
	includeTreeshake?: boolean
}

function getScripts(config: ProjectConfig, opts: GetScriptsOptions = {}): Record<string, string> {
	const scripts: Record<string, string> = {}

	// TypeScript scripts
	if (config.typescript.enabled) {
		scripts['typecheck'] = 'tsc --noEmit'
	}

	// Linting scripts
	if (config.linting.tool === 'biome' || config.linting.tool === 'both') {
		scripts['lint'] = 'biome lint .'
		scripts['format'] = 'biome format .'
		scripts['check'] = 'biome check .'
		scripts['check:fix'] = 'biome check --fix .'
	} else if (config.linting.tool === 'eslint') {
		scripts['lint'] = 'eslint .'
		scripts['lint:fix'] = 'eslint . --fix'
		scripts['format'] = 'prettier --write .'
	}

	// Testing scripts
	if (config.testing.framework === 'vitest') {
		scripts['test'] = 'vitest'
		scripts['test:watch'] = 'vitest --watch'
		scripts['test:ui'] = 'vitest --ui'
		scripts['coverage'] = 'vitest run --coverage'
	} else if (config.testing.framework === 'jest') {
		scripts['test'] = 'jest'
		scripts['test:watch'] = 'jest --watch'
		scripts['coverage'] = 'jest --coverage'
	} else if (config.testing.framework === 'playwright') {
		scripts['test:e2e'] = 'playwright test'
		scripts['test:e2e:ui'] = 'playwright test --ui'
	} else if (config.testing.framework === 'cypress') {
		scripts['test:e2e'] = 'cypress run'
		scripts['test:e2e:ui'] = 'cypress open'
	}

	// Build scripts
	if (config.bundler === 'tsup') {
		scripts['build'] = 'tsup'
		scripts['build:watch'] = 'tsup --watch'
	} else if (config.bundler === 'esbuild') {
		scripts['build'] = 'node build.mjs'
	} else if (config.bundler === 'rollup') {
		scripts['build'] = 'rollup -c'
		scripts['build:watch'] = 'rollup -c --watch'
	} else if (config.bundler === 'rolldown') {
		scripts['build'] = 'rolldown -c'
		scripts['build:watch'] = 'rolldown -c --watch'
	} else if (config.bundler === 'vite') {
		scripts['build'] = 'vite build'
		scripts['dev'] = 'vite'
		scripts['preview'] = 'vite preview'
	}

	// Commitizen assistant — `pnpm commit` guides a conventional commit that
	// then passes the commitlint enforcement layer.
	if (config.commitLint) {
		scripts['commit'] = 'cz'
	}

	// knip is part of the universal baseline (knip.json is always generated).
	scripts['knip'] = 'knip'

	// publint validates the published package (exports, types, main) against dist.
	if (config.publint) {
		scripts['publint'] = 'publint --strict'
	}

	// are-the-types-wrong validates that a consumer's `import` actually resolves
	// the shipped `.d.ts`. Only meaningful for publishable libraries. The default
	// profile fits the dual (cjs+esm) exports the library scaffold emits.
	if (config.projectType === 'library') {
		scripts['attw'] = 'attw --pack'
		// The budget scaffolded alongside it (generateConfigs) is inert without a
		// way to run it — a size budget nothing runs implies an enforcement that
		// isn't there (#382).
		Object.assign(scripts, SIZE_LIMIT_SCRIPTS)
	}

	// Git hooks
	if (config.gitHooks) {
		scripts['prepare'] = 'husky'
	}

	// Semantic release
	if (config.semanticRelease) {
		scripts['release'] = 'semantic-release'
	}

	if (opts.includeTreeshake) {
		scripts['pretreeshake'] = scripts['build'] ? 'pnpm build' : 'echo "no build step"'
		scripts['treeshake'] = 'pnpm --filter=*treeshake-check run check'
	}

	const verify = composeVerifyScript(config, opts)
	if (verify) {
		scripts['verify'] = verify
	}

	return scripts
}

/**
 * Add any of `scripts` the package.json doesn't already define, leaving every
 * existing value alone. Returns true when something was written.
 *
 * A `fix` target that scaffolds a tool's config but no way to run it leaves the
 * repo half-wired: the generated CI called `pnpm check`, and `fix verify`
 * refused to compose a chain, both because no target ever created that script
 * (#364).
 */
/**
 * The one definition of the `size-limit` script, shared by `getScripts()` (setup)
 * and the `size-limit` fixer, so the two paths can't drift (#382 — the divergence
 * behind #371 and #377).
 */
export const SIZE_LIMIT_SCRIPTS: Record<string, string> = { 'size-limit': 'size-limit' }

/** Shared by the same two paths, for the same reason. */
export const SIZE_LIMIT_VERSION = '^11.2.0'

export async function ensureScripts(
	targetDir: string,
	scripts: Record<string, string>
): Promise<boolean> {
	const pkgPath = path.join(targetDir, 'package.json')
	if (!(await fs.pathExists(pkgPath))) return false

	const pkg = (await fs.readJson(pkgPath)) as Record<string, unknown>
	const existing = { ...((pkg.scripts as Record<string, string> | undefined) ?? {}) }
	let added = false
	for (const [name, command] of Object.entries(scripts)) {
		if (!existing[name]) {
			existing[name] = command
			added = true
		}
	}
	if (!added) return false

	pkg.scripts = existing
	await fs.writeJson(pkgPath, pkg, { spaces: 2 })
	return true
}

export function composeVerifyScript(
	config: ProjectConfig,
	opts: { includeTreeshake?: boolean } = {}
): string | null {
	const cmds: string[] = []
	if (config.typescript.enabled) cmds.push('pnpm typecheck')
	if (config.linting.tool === 'biome' || config.linting.tool === 'both') {
		cmds.push('pnpm check')
	} else if (config.linting.tool === 'eslint') {
		cmds.push('pnpm lint')
	}
	if (config.testing.framework === 'vitest') {
		cmds.push('pnpm exec vitest run')
	} else if (config.testing.framework === 'jest') {
		cmds.push('pnpm test --ci')
	} else if (config.testing.framework === 'playwright' || config.testing.framework === 'cypress') {
		cmds.push('pnpm test:e2e')
	}
	if (opts.includeTreeshake) cmds.push('pnpm treeshake')
	if (config.publint) cmds.push('pnpm publint')
	// attw is a publish-safety rider, not a core check — it never justifies a
	// verify chain on its own, so append it only once we've decided to emit one.
	if (cmds.length < 2) return null
	if (config.projectType === 'library') cmds.push('pnpm attw')
	return cmds.join(' && ')
}

/**
 * Derive the verify chain from a real package.json's scripts + deps.
 * Used by `fix verify`, where we shouldn't assume tools beyond what the
 * project actually has.
 */
export function composeVerifyScriptFromPkg(
	pkg: Record<string, unknown>,
	opts: { includeTreeshake?: boolean } = {}
): string | null {
	const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
	const deps = {
		...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
		...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
	}
	const cmds: string[] = []
	if (scripts.typecheck || deps.typescript) cmds.push('pnpm typecheck')
	if (scripts.check) cmds.push('pnpm check')
	else if (scripts.lint && !scripts.check) cmds.push('pnpm lint')
	if (deps.vitest) cmds.push('pnpm exec vitest run')
	else if (deps.jest) cmds.push('pnpm test --ci')
	else if (deps['@playwright/test'] || deps.cypress) cmds.push('pnpm test:e2e')
	// A repo can run tests without any runner we recognise — `node --test`, for
	// one. Its `test` script is still the thing verify should call (#364).
	else if (scripts.test) cmds.push('pnpm test')
	if (opts.includeTreeshake) cmds.push('pnpm treeshake')
	if (deps.publint || scripts.publint) cmds.push('pnpm publint')
	return cmds.length >= 2 ? cmds.join(' && ') : null
}

function getDependencies(config: ProjectConfig): Record<string, string> {
	// knip is part of the universal baseline (knip.json + `knip` script).
	const deps: Record<string, string> = { knip: '^6.0.0' }

	// TypeScript
	if (config.typescript.enabled) {
		deps['typescript'] = '^5.9.3'
		deps['@types/node'] = '^26.0.1'
	}

	// Linting tools
	if (config.linting.tool === 'biome' || config.linting.tool === 'both') {
		deps['@biomejs/biome'] = '^2.5.1'
	}
	if (config.linting.tool === 'eslint' || config.linting.tool === 'both') {
		deps['eslint'] = '^9.0.0'
		deps['prettier'] = '^3.0.0'
		// Everything tooling/eslint/base.mjs imports. All optional peers of
		// repo-tooling, so pnpm skips them and `eslint .` dies on the config
		// import — the scaffold shipped a lint script that could never run.
		deps['@eslint/js'] = '^9.0.0'
		deps['@typescript-eslint/eslint-plugin'] = '^8.0.0'
		deps['typescript-eslint'] = '^8.0.0'
		deps['eslint-plugin-import'] = '^2.0.0'
		deps['eslint-plugin-jest'] = '^29.0.0'
	}
	// The shipped prettier preset lists this in `plugins`, and the nextjs eslint
	// preset imports the Next plugin. Both are only *optional* peers of
	// repo-tooling, so pnpm skips them and the scaffold's first format/lint dies
	// with ERR_MODULE_NOT_FOUND.
	if (config.formatting.tool === 'prettier') {
		deps['@ianvs/prettier-plugin-sort-imports'] = '^4.7.0'
	}
	if (config.linting.eslintConfig === 'nextjs') {
		deps['@next/eslint-plugin-next'] = '^16.2.11'
	}

	// Testing frameworks
	if (config.testing.framework === 'vitest') {
		deps['vitest'] = '^4.1.9'
		// Coverage provider so `pnpm coverage` (and the CI Codecov upload) works.
		deps['@vitest/coverage-v8'] = '^4.1.9'
		if (config.testing.environment === 'browser' || config.testing.environment === 'both') {
			deps['@vitest/ui'] = '^4.1.9'
			deps['jsdom'] = '^25.0.0'
		}
	} else if (config.testing.framework === 'jest') {
		deps['jest'] = '^29.0.0'
		if (config.typescript.enabled) {
			deps['ts-jest'] = '^29.0.0'
		}
	} else if (config.testing.framework === 'playwright') {
		deps['@playwright/test'] = '^1.60.0'
	} else if (config.testing.framework === 'cypress') {
		deps['cypress'] = '^13.0.0'
	}

	// Build tools
	if (config.bundler === 'tsup') {
		deps['tsup'] = '^8.0.0'
	} else if (config.bundler === 'esbuild') {
		deps['esbuild'] = '^0.25.0'
		// The generated build.mjs imports this directly. It's only an *optional*
		// peer of repo-tooling, so pnpm won't pull it in — without it here every
		// esbuild scaffold fails its first `pnpm build` with ERR_MODULE_NOT_FOUND.
		deps['esbuild-node-externals'] = '^1.18.0'
	} else if (config.bundler === 'rollup') {
		deps['rollup'] = '^4.0.0'
		deps['@rollup/plugin-typescript'] = '^12.0.0'
		deps['tslib'] = '^2.0.0'
	} else if (config.bundler === 'rolldown') {
		// Rolldown transpiles TypeScript natively — no plugin-typescript/tslib.
		deps['rolldown'] = '^1.0.0'
	} else if (config.bundler === 'vite') {
		deps['vite'] = '^6.0.0'
		// generateViteConfig emits `import react from '@vitejs/plugin-react'` for
		// react-app, so the plugin has to be installed or `vite build` can't even
		// load the config. Keep this condition in step with that one.
		if (config.projectType === 'react-app') deps['@vitejs/plugin-react'] = '^5.0.0'
	}

	// Tailwind CSS v4 — CSS-first, wired via the PostCSS plugin.
	if (config.tailwind) {
		deps['tailwindcss'] = '^4.0.0'
		deps['@tailwindcss/postcss'] = '^4.0.0'
	}

	// Publishing hygiene
	if (config.publint) {
		deps['publint'] = '^0.3.0'
	}

	// Git hooks
	if (config.gitHooks) {
		deps['husky'] = '^9.0.0'
		deps['lint-staged'] = '^16.0.0'
	}

	// are-the-types-wrong — validate published type resolution for libraries.
	// size-limit enforces the bundle-size budget scaffolded next to it; without
	// the dependency the script dies with "command not found" (#382).
	if (config.projectType === 'library') {
		deps['@arethetypeswrong/cli'] = '^0.18.2'
		deps['size-limit'] = SIZE_LIMIT_VERSION
	}

	// Commit linting (enforcement) + commitizen (assistance)
	if (config.commitLint) {
		deps['@commitlint/cli'] = '^20.0.0'
		deps['@commitlint/config-conventional'] = '^20.0.0'
		deps['commitizen'] = '^4.3.1'
		deps['cz-conventional-changelog'] = '^3.3.0'
	}

	// Semantic release. The shipped github preset uses only plugins that
	// semantic-release core bundles, plus @semantic-release/github — no
	// changelog/git plugins (see tooling/semantic-release/github.mjs, #417).
	if (config.semanticRelease) {
		deps['semantic-release'] = '^25.0.0'
		deps['@semantic-release/github'] = '^12.0.0'
	}

	return deps
}
