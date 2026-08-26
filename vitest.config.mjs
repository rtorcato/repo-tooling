import { defineConfig, mergeConfig } from 'vitest/config'
import { stripAmbientGitEnv } from './scripts/lib/git-env.mjs'
import base from './tooling/vitest/vitest.config.mjs'

// Before any test spawns git in a temp directory — under a hook, GIT_DIR would
// redirect it into this repo. See the helper for the full failure mode (#519).
stripAmbientGitEnv()

// repo-tooling-specific coverage scope and thresholds. The shared preset only
// provides generic v8 defaults so consumers don't inherit our paths.
export default mergeConfig(
	base,
	defineConfig({
		test: {
			exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
			coverage: {
				include: ['src/cli/generators/**/*.ts'],
				thresholds: {
					statements: 25,
					lines: 25,
					functions: 40,
					branches: 17,
				},
			},
		},
	})
)
