/**
 * Perl git hooks (#289). Same shape as the Swift (#309) and Python (#290) ones
 * and for the same reason: Husky is an npm package, and a Perl distribution has
 * no node on the path to run it. The committed `.githooks/` directory plus
 * `core.hooksPath` is the node-free equivalent; the mechanics live in
 * `src/base/git-hooks.ts`.
 *
 * The hooks call perltidy/perlcritic/prove directly rather than going through
 * `dzil` or a `Makefile` target — those exist only in some distributions, and a
 * hook that assumes the wrong build system fails on every commit.
 */
import { installGitHooks } from '../../base/git-hooks.js'
import { FIND_PERL_SOURCES } from './sources.js'

export const PERL_HOOKS_DIR = '.githooks'

/** Wraps the shared find expression so each hook can name the action once. */
const FIND_PERL_FN = `# Every Perl source file in the distribution, minus build output and deps.
find_perl() {
  ${FIND_PERL_SOURCES} "$@"
}`

// perltidy before perlcritic so the lint pass sees the final layout. The two
// never fight, unlike SwiftLint/SwiftFormat or ruff/black: Perl::Critic only
// reports, it never rewrites.
//
// `-b -bext='/'` means in-place with no backup file. Both flags are passed here
// rather than baked into the shipped .perltidyrc, so a human running `perltidy
// lib/Foo.pm` by hand still gets Foo.pm.tdy instead of a silent overwrite.
const PERL_PRE_COMMIT = `#!/bin/sh
set -e

${FIND_PERL_FN}

find_perl -exec perltidy -b -bext='/' {} +
find_perl -exec perlcritic {} +
`

// perlcritic before prove: a lint violation is cheaper to surface than a full
// test run. `prove -lr t` puts ./lib on @INC and recurses into subdirectories,
// which is what a distribution's t/ tree needs.
const PERL_PRE_PUSH = `#!/bin/sh
set -e
echo "🔍 Running pre-push verify..."

${FIND_PERL_FN}

find_perl -exec perlcritic {} +
prove -lr t
echo "✅ Verify passed — pushing."
`

export function installPerlGitHooks(
	targetDir: string
): Promise<{ filesWritten: string[]; hooksPathSet: boolean }> {
	return installGitHooks(targetDir, PERL_HOOKS_DIR, {
		preCommit: PERL_PRE_COMMIT,
		prePush: PERL_PRE_PUSH,
	})
}
