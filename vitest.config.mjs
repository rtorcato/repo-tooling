import { defineConfig, mergeConfig } from 'vitest/config'
import base from './tooling/vitest/vitest.config.mjs'

// Git exports GIT_DIR / GIT_INDEX_FILE to everything a hook runs, so under the
// pre-push hook every test that spawns `git` in a temp directory silently
// operates on *this* repo instead — `git init` in a tmp dir, then a commit
// against the real index. CI has no hook environment, so this only ever failed
// on the developer's machine, which is the worst place for it to fail (#519).
// Nothing here wants git's ambient repo: every call passes `cwd` or `-C`.
for (const key of [
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_COMMON_DIR',
	'GIT_OBJECT_DIRECTORY',
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_PREFIX',
	'GIT_NAMESPACE',
]) {
	delete process.env[key]
}

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
