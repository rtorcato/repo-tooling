import { defineConfig } from 'rolldown'

/**
 * Rolldown config factory for TypeScript libraries.
 *
 * Rolldown is the Rust-based, Rollup-API-compatible bundler (the one Vite uses
 * internally). Mirrors the rollup preset's intent — unbundled per-file output
 * (`preserveModules`), dual ESM + CJS, and every bare import left external so
 * dependencies aren't inlined — but needs no `@rollup/plugin-typescript`:
 * Rolldown transpiles TypeScript natively.
 *
 * Consumers scaffold a `rolldown.config.mjs` that re-exports the default:
 *
 *   export { default } from '@rtorcato/repo-tooling/rolldown'
 *
 * …or customize the entry / output:
 *
 *   import { getConfig } from '@rtorcato/repo-tooling/rolldown'
 *   export default getConfig({ input: 'src/main.ts' })
 *
 * Type declarations (`.d.ts`) are not emitted here — run `tsc --emitDeclarationOnly`
 * (or Rolldown's experimental `dts` output) alongside the bundle.
 *
 * @param {import('./rolldown.config.d.mts').GetConfigOptions} [options]
 */
export function getConfig(options = {}) {
	const {
		input = 'src/index.ts',
		outDir = 'dist',
		sourcemap = true,
		external = isBareImport,
	} = options

	return defineConfig({
		input,
		external,
		output: [
			{
				dir: outDir,
				format: 'esm',
				entryFileNames: '[name].mjs',
				preserveModules: true,
				sourcemap,
			},
			{
				dir: outDir,
				format: 'cjs',
				entryFileNames: '[name].cjs',
				preserveModules: true,
				exports: 'named',
				sourcemap,
			},
		],
	})
}

// Treat every non-relative, non-absolute id as an external dependency so the
// library ships thin and deps resolve from the consumer's node_modules.
// (`\0`-prefixed ids are virtual modules — never externalize those.)
function isBareImport(id) {
	return !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')
}

export default getConfig()
