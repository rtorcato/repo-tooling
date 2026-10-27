import type { Options } from 'tsup'
import { defineConfig } from 'tsup'

export type DefineConfig = ReturnType<typeof defineConfig>

export const getConfig: (customOptions: Options, env: string) => DefineConfig = (
	customOptions: Options,
	env: string
): DefineConfig => {
	return defineConfig((options: Options = customOptions) => {
		return baseOptions(options, env)
	})
}

export const baseOptions = (options: Options, env: string): Options => {
	const opts: Options = {
		treeshake: true,
		splitting: true,
		// target: 'es2020',
		// target: 'nodeNext',
		format: ['cjs', 'esm'], // generate cjs and esm files
		entry: [
			// './src/index.ts',
			'src/**/*.ts',
			// './src/**/*!(index).ts?(x)',
			// '!./src/**/*.spec.*',
			// '!./src/**/*.stories.*',
		],
		skipNodeModulesBundle: true, // Skips building dependencies for node modules
		minify: !options.watch && env === 'production',
		// The glob entry emits every file, so bundle: false is safe. A narrowed
		// entry (e.g. ['src/index.ts']) with bundle: false emits only those
		// files while they still import unbuilt siblings (#942), so bundle by
		// default. An explicit bundle in options still wins.
		bundle: options.entry !== undefined,
		clean: true, // clean up the dist folder
		dts: true, // generate dts file for main module
		// sourcemap: env === 'production', // source map is only available in prod
		// sourcemap: true,
		// outDir: env === 'production' ? 'dist' : 'lib',
		// outDir: 'dist',
		// tsconfig: path.resolve(__dirname, './tsconfig.build.json'),
		// esbuildOptions(options, context) {
		//   options.outbase = './'
		// },
		// external: ['react'],
		...options,
		// banner: {js: '"use client";'},
		// dts: {
		//   footer: "declare module 'knex/types/tables';"
		// },
	}
	return opts
}
