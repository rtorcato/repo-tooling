import { defineConfig } from 'tsup'

export const getConfig = (customOptions, env) => {
	// tsup invokes this callback with its own CLI options, so `customOptions`
	// must be merged in explicitly — a `(options = customOptions)` default is
	// bypassed and silently drops the consumer's config (e.g. `entry`). Layer
	// only the DEFINED CLI overrides on top so flags like `--watch` still win
	// without an absent `entry: undefined` clobbering the consumer's entry.
	return defineConfig((cliOptions) => {
		const overrides = Object.fromEntries(
			Object.entries(cliOptions ?? {}).filter(([, value]) => value !== undefined)
		)
		return baseOptions({ ...customOptions, ...overrides }, env)
	})
}

export const baseOptions = (options, env) => {
	const opts = {
		treeshake: true,
		splitting: true,
		format: ['cjs', 'esm'], // generate cjs and esm files
		// Default to all of src EXCEPT tests, so a consumer that doesn't pass an
		// explicit entry never ships compiled *.test.* / *.spec.* files in dist.
		entry: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.spec.ts'],
		skipNodeModulesBundle: true, // Skips building dependencies for node modules
		minify: !options.watch && env === 'production',
		// The glob entry emits every file, so bundle: false is safe. A narrowed
		// entry (e.g. ['src/index.ts']) with bundle: false emits only those
		// files while they still import unbuilt siblings (#942), so bundle by
		// default. An explicit bundle in options still wins.
		bundle: options.entry !== undefined,
		clean: true, // clean up the dist folder
		dts: true, // generate dts file for main module
		...options,
	}
	return opts
}
