/**
 * The Python .gitignore block, shared by the `python-gitignore` fixer and the
 * check that reports it. Its own module for the same reason Swift's is (#286):
 * nothing else in the module has to import from `fixers.ts` to reuse it.
 */
import path from 'node:path'
import fs from 'fs-extra'

/**
 * The Python artefacts that must stay out of git. Appended to an existing
 * .gitignore rather than replacing it — a Python repo's ignore file usually
 * carries project-specific entries worth keeping.
 */
const PYTHON_GITIGNORE_BLOCK = `# Python
__pycache__/
*.py[cod]
*.egg-info/
.eggs/
build/
dist/

# Environments
.venv/
venv/
.env

# Tool caches
.pytest_cache/
.mypy_cache/
.ruff_cache/
.coverage
htmlcov/
`

/**
 * Entries whose presence means the block (or an equivalent) is already there.
 * `__pycache__` and `.venv` are the expensive ones — either committed by
 * accident buries the diff — and a tool cache stands in for the rest.
 */
export const PYTHON_GITIGNORE_SENTINELS = ['__pycache__', '.venv', '.pytest_cache']

export async function ensurePythonGitignore(targetDir: string): Promise<string[]> {
	const filepath = path.join(targetDir, '.gitignore')
	if (!(await fs.pathExists(filepath))) {
		await fs.writeFile(filepath, PYTHON_GITIGNORE_BLOCK)
		return ['.gitignore']
	}

	const existing = await fs.readFile(filepath, 'utf-8')
	const missing = PYTHON_GITIGNORE_SENTINELS.filter((entry) => !existing.includes(entry))
	if (missing.length === 0) return []

	// Append only what's absent, so a repo that already ignores __pycache__
	// doesn't get a duplicate entry for it.
	const additions = PYTHON_GITIGNORE_BLOCK.split('\n').filter(
		(line) => line.length > 0 && !existing.includes(line)
	)
	const separator = existing.endsWith('\n') ? '' : '\n'
	await fs.writeFile(filepath, `${existing}${separator}\n${additions.join('\n')}\n`)
	return ['.gitignore']
}
