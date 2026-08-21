import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { BASE_FIXERS } from '../../../src/base/fixers.js'
import { runDoctor } from '../../../src/cli/commands/doctor.js'
import { FIXERS } from '../../../src/languages/js/fixers.js'
import { checkPythonGitignore, runPythonChecks } from '../../../src/languages/python/checks.js'
import { PYTHON_FIXERS } from '../../../src/languages/python/fixers.js'
import { ensurePythonGitignore } from '../../../src/languages/python/gitignore.js'
import { SWIFT_FIXERS } from '../../../src/languages/swift/fixers.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function fixer(target: string) {
	const found = PYTHON_FIXERS.find((f) => f.target === target)
	if (!found) throw new Error(`no python fixer: ${target}`)
	return found
}

const ctx = (targetDir: string) => ({
	targetDir,
	pkg: null,
	result: { check: 'x', status: 'missing' as const, detail: '' },
	lock: null,
})

/** The marker that makes detectLanguage resolve the Python module. */
async function pythonRepo(dir: string): Promise<string> {
	await fs.writeFile(join(dir, 'pyproject.toml'), '[project]\nrequires-python = ">=3.10"\n')
	return dir
}

describe('python fixers', () => {
	// A fixer whose appliesTo doesn't match a real check name is dead code: `fix`
	// looks fixers up by check, so it would simply never run.
	it('every fixer resolves a check doctor actually emits for a Python repo', async () => {
		const dir = await pythonRepo(newTmpDir())
		const emitted = new Set((await runDoctor(dir)).map((r) => r.check))
		for (const f of PYTHON_FIXERS) {
			for (const check of f.appliesTo) {
				expect(emitted, `${f.target} → ${check}`).toContain(check)
			}
		}
	})

	it('uses target names that do not collide with the other fixer sets', () => {
		// `fix --list` shows every language's fixers in one list.
		const taken = new Set([...FIXERS, ...BASE_FIXERS, ...SWIFT_FIXERS].map((f) => f.target))
		for (const f of PYTHON_FIXERS) expect(taken).not.toContain(f.target)
	})

	// #303, in the Python shape: doctor reports the base findings, so `fix` has to
	// have a fixer for them rather than returning `unsupported` for every one.
	it('base + Python fixers cover every check doctor emits for a Python repo', async () => {
		const dir = await pythonRepo(newTmpDir())
		const fixable = new Set([...BASE_FIXERS, ...PYTHON_FIXERS].flatMap((f) => f.appliesTo))
		const uncovered = (await runDoctor(dir))
			.map((r) => r.check)
			.filter((check) => !fixable.has(check))
		// `language` and `Monorepo` are informational. `Git identity` is unfixable
		// by design (#328) — only the operator knows their own address. `README
		// badges` and `Coverage upload` need a package.json to build from, which a
		// Python repo hasn't got. `lockfile` has no Python preset to record yet
		// (see the note atop src/languages/python/fixers.ts). `pyproject.toml` and
		// `Python tests` are content only the project can write. `Release gate` and
		// `Release environment` (#429) report only — creating the environment needs
		// a `required_reviewers` list only a human can supply.
		expect(uncovered).toEqual([
			'language',
			'lockfile',
			'Monorepo',
			'Git identity',
			'Release gate',
			'Release environment',
			'README badges',
			'Coverage upload',
			'pyproject.toml',
			'Python tests',
		])
	})

	it('ruff writes a config the Ruff check accepts', async () => {
		const dir = newTmpDir()
		const { filesWritten } = await fixer('ruff').run(ctx(dir))
		expect(filesWritten).toEqual(['ruff.toml'])
		expect((await runPythonChecks(dir)).find((r) => r.check === 'Ruff')?.status).toBe('ok')
	})

	it('mypy writes a config the mypy check accepts', async () => {
		const dir = newTmpDir()
		const { filesWritten } = await fixer('mypy').run(ctx(dir))
		expect(filesWritten).toEqual(['mypy.ini'])
		expect((await runPythonChecks(dir)).find((r) => r.check === 'mypy')?.status).toBe('ok')
	})

	it('pytest writes a config the pytest check accepts', async () => {
		const dir = newTmpDir()
		const { filesWritten } = await fixer('pytest').run(ctx(dir))
		expect(filesWritten).toEqual(['pytest.ini'])
		expect((await runPythonChecks(dir)).find((r) => r.check === 'pytest')?.status).toBe('ok')
	})

	it('python-ci writes a workflow that satisfies the Python tests check', async () => {
		const dir = await pythonRepo(newTmpDir())
		await fs.outputFile(join(dir, 'tests/test_demo.py'), '')
		const { filesWritten } = await fixer('python-ci').run(ctx(dir))
		expect(filesWritten).toEqual(['.github/workflows/ci.yml'])
		const results = await runPythonChecks(dir)
		expect(results.find((r) => r.check === 'Python tests')?.status).toBe('ok')
	})

	it('python-gitlab-ci writes a pipeline that runs the suite', async () => {
		const dir = await pythonRepo(newTmpDir())
		const { filesWritten } = await fixer('python-gitlab-ci').run(ctx(dir))
		expect(filesWritten).toEqual(['.gitlab-ci.yml'])
		expect(await fs.readFile(join(dir, '.gitlab-ci.yml'), 'utf-8')).toContain('pytest')
	})

	it('python-git-hooks writes hooks the base Git hooks / Pre-push checks accept', async () => {
		const dir = await pythonRepo(newTmpDir())
		const { filesWritten } = await fixer('python-git-hooks').run(ctx(dir))
		expect(filesWritten).toEqual(['.githooks/pre-commit', '.githooks/pre-push'])
		expect(await fs.readFile(join(dir, '.githooks/pre-push'), 'utf-8')).toContain('pytest')
		// Executable, or git silently ignores the hook.
		expect((await fs.stat(join(dir, '.githooks/pre-commit'))).mode & 0o111).toBeTruthy()

		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Git hooks')?.status).toBe('ok')
		expect(results.find((r) => r.check === 'Pre-push hook')?.status).toBe('ok')
	})

	// No .git in the temp dir: an unguarded `git config` would walk up and
	// rewrite whatever repo the tmp dir happens to sit inside.
	it('python-git-hooks does not touch git config outside a repo', async () => {
		const dir = newTmpDir()
		await expect(fixer('python-git-hooks').run(ctx(dir))).resolves.toBeTruthy()
	})
})

describe('ensurePythonGitignore', () => {
	it('creates the file when absent and satisfies the check', async () => {
		const dir = newTmpDir()
		expect(await ensurePythonGitignore(dir)).toEqual(['.gitignore'])
		expect((await checkPythonGitignore(dir)).status).toBe('ok')
	})

	it('appends to an existing .gitignore without dropping its entries', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), 'secrets.env\n')
		await ensurePythonGitignore(dir)
		const contents = await fs.readFile(join(dir, '.gitignore'), 'utf-8')
		expect(contents).toContain('secrets.env')
		expect((await checkPythonGitignore(dir)).status).toBe('ok')
	})

	it('does not duplicate an entry the repo already ignores', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), '__pycache__/\nnotes.md\n')
		await ensurePythonGitignore(dir)
		const contents = await fs.readFile(join(dir, '.gitignore'), 'utf-8')
		expect(contents.match(/^__pycache__\/$/gm)).toHaveLength(1)
		expect((await checkPythonGitignore(dir)).status).toBe('ok')
	})

	it('is a no-op when everything is already covered', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), '__pycache__/\n.venv/\n.pytest_cache/\n')
		expect(await ensurePythonGitignore(dir)).toEqual([])
	})
})
