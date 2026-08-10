import { configDefaults, defineConfig } from 'vitest/config'

// No `resolve.alias` here on purpose: this file's `__dirname` is wherever the
// package got installed, so a `@` → `<preset dir>/src` alias resolves to a
// directory that exists in no consumer (nor in the published tarball). Now that
// generated configs actually import this preset, that alias would poison them.
// Consumers that want `@`/`~` declare them in their own config.
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		// Keep vitest's defaults, plus ignore Claude Code worktrees so mirrored
		// test files under .claude/worktrees/ aren't collected twice.
		exclude: [...configDefaults.exclude, '.claude/**'],
		coverage: {
			provider: 'v8',
			// lcov feeds Codecov (the CI we generate uploads it); text is the local
			// console summary; the rest back the HTML report.
			reporter: ['text', 'lcov', 'json', 'html', 'json-summary'],
		},
	},
})
