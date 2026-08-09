/**
 * Python git hooks (#290). Same shape as the Swift ones (#309) and for the same
 * reason: Husky is an npm package, and a Python repo has no node on the path to
 * run it. The committed `.githooks/` directory plus `core.hooksPath` is the
 * node-free equivalent; the mechanics live in `src/base/git-hooks.ts`.
 *
 * Deliberately *not* `pre-commit` (the Python framework of that name): it is a
 * second config file, a second pinned-tool source, and a second place the CI
 * commands have to be kept in sync with. The hooks run ruff/mypy/pytest
 * directly, exactly as CI does.
 */
import { installGitHooks } from '../../base/git-hooks.js'

export const PYTHON_HOOKS_DIR = '.githooks'

// `ruff format` before `ruff check --fix` so the lint pass sees final layout.
// Neither rewrites anything the other undoes — one tool owns both jobs.
const PYTHON_PRE_COMMIT = `#!/bin/sh
set -e
ruff format
ruff check --fix
`

// mypy before pytest: a type error is cheaper to surface than a test run.
const PYTHON_PRE_PUSH = `#!/bin/sh
set -e
echo "🔍 Running pre-push verify..."
ruff check
mypy .
pytest
echo "✅ Verify passed — pushing."
`

export function installPythonGitHooks(
	targetDir: string
): Promise<{ filesWritten: string[]; hooksPathSet: boolean }> {
	return installGitHooks(targetDir, PYTHON_HOOKS_DIR, {
		preCommit: PYTHON_PRE_COMMIT,
		prePush: PYTHON_PRE_PUSH,
	})
}
