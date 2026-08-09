/**
 * Swift git hooks (#309). Husky is an npm package, so a SwiftPM repo can't use
 * it without dragging node into a toolchain that otherwise has none. The
 * node-free equivalent is a committed `.githooks/` directory that git is pointed
 * at with `core.hooksPath` — the mechanics live in `src/base/git-hooks.ts`; only
 * the hook bodies are Swift's.
 *
 * The hooks run the tools directly rather than a `verify` indirection: SwiftPM
 * has no scripts field, and inventing a Makefile target would be a third place
 * to keep the CI commands in sync (they already live in .github/workflows/ci.yml
 * and .swiftlint.yml).
 */
import { installGitHooks } from '../../base/git-hooks.js'

export const SWIFT_HOOKS_DIR = '.githooks'

// SwiftLint's --fix is the formatter (see ./checks.ts), so pre-commit formats
// then lints. --quiet keeps a clean commit from printing a wall of nothing.
export const SWIFT_PRE_COMMIT = `#!/bin/sh
set -e
swiftlint --fix --quiet
swiftlint lint --quiet
`

export const SWIFT_PRE_PUSH = `#!/bin/sh
set -e
echo "🔍 Running pre-push verify..."
swift build
swift test
swiftlint lint --strict
echo "✅ Verify passed — pushing."
`

export function installSwiftGitHooks(
	targetDir: string
): Promise<{ filesWritten: string[]; hooksPathSet: boolean }> {
	return installGitHooks(targetDir, SWIFT_HOOKS_DIR, {
		preCommit: SWIFT_PRE_COMMIT,
		prePush: SWIFT_PRE_PUSH,
	})
}
