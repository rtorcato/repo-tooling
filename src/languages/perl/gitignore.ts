/**
 * The Perl .gitignore block, shared by the `perl-gitignore` fixer and the check
 * that reports it. Its own module for the same reason Swift's and Python's are
 * (#286, #290): nothing else in the module has to import from `fixers.ts`.
 */
import path from 'node:path'
import fs from 'fs-extra'

/**
 * The Perl build artefacts that must stay out of git. Appended to an existing
 * .gitignore rather than replacing it — a Perl distribution's ignore file
 * usually carries project-specific entries worth keeping.
 */
const PERL_GITIGNORE_BLOCK = `# Perl build output
/blib/
/_build/
/Build
/Build.bat
pm_to_blib
MYMETA.*
Makefile
Makefile.old
/_eumm/

# Distribution tarballs
/*.tar.gz
/*.zip

# Dependencies (Carton / local::lib)
/local/
/.carton/

# Test and profiling output
/cover_db/
nytprof.out
/tmon.out

# Compiled XS
*.o
*.bs
*.c.tmp
`

/**
 * Entries whose presence means the block (or an equivalent) is already there.
 * All three are produced by any Makefile.PL/Build.PL build, so they are the
 * ones a repo accidentally commits. `local/` is deliberately not a sentinel:
 * only Carton users have it, and demanding it would nag every other repo.
 */
export const PERL_GITIGNORE_SENTINELS = ['blib', 'MYMETA', 'pm_to_blib']

export async function ensurePerlGitignore(targetDir: string): Promise<string[]> {
	const filepath = path.join(targetDir, '.gitignore')
	if (!(await fs.pathExists(filepath))) {
		await fs.writeFile(filepath, PERL_GITIGNORE_BLOCK)
		return ['.gitignore']
	}

	const existing = await fs.readFile(filepath, 'utf-8')
	const missing = PERL_GITIGNORE_SENTINELS.filter((entry) => !existing.includes(entry))
	if (missing.length === 0) return []

	// Append only what's absent, so a repo that already ignores blib doesn't get
	// a duplicate entry for it.
	const additions = PERL_GITIGNORE_BLOCK.split('\n').filter(
		(line) => line.length > 0 && !existing.includes(line)
	)
	const separator = existing.endsWith('\n') ? '' : '\n'
	await fs.writeFile(filepath, `${existing}${separator}\n${additions.join('\n')}\n`)
	return ['.gitignore']
}
