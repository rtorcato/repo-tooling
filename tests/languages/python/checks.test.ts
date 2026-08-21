import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	checkPyproject,
	checkPythonGitignore,
	checkPythonTests,
	runPythonChecks,
} from '../../../src/languages/python/checks.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const VALID_PYPROJECT = `[project]
name = "demo"
version = "0.1.0"
requires-python = ">=3.10"

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"
`

describe('checkPyproject', () => {
	it('is missing without a pyproject.toml', async () => {
		expect((await checkPyproject(newTmpDir())).status).toBe('missing')
	})

	// detect-language accepts setup.py, so the module runs on a repo with no
	// pyproject at all — that's drift from the packaging standard, not "not Python".
	it('names setup.py when that is all the repo has', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'setup.py'), 'from setuptools import setup\n')
		const result = await checkPyproject(dir)
		expect(result.status).toBe('missing')
		expect(result.detail).toContain('setup.py')
	})

	it('passes a PEP 621 manifest with a requires-python floor', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'pyproject.toml'), VALID_PYPROJECT)
		const result = await checkPyproject(dir)
		expect(result.status).toBe('ok')
		expect(result.detail).toContain('PEP 621')
	})

	it('flags a pyproject with no project metadata at all', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'pyproject.toml'), '[tool.ruff]\nline-length = 100\n')
		const result = await checkPyproject(dir)
		expect(result.status).toBe('drift')
		expect(result.detail).toContain('[project]')
	})

	it('flags a PEP 621 manifest with no requires-python', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\nversion = "0.1"\n')
		const result = await checkPyproject(dir)
		expect(result.status).toBe('drift')
		expect(result.detail).toContain('requires-python')
	})

	// Poetry spells the same two facts differently; both forms are in the wild.
	it('accepts a Poetry manifest', async () => {
		const dir = newTmpDir()
		await fs.writeFile(
			join(dir, 'pyproject.toml'),
			'[tool.poetry]\nname = "demo"\n\n[tool.poetry.dependencies]\npython = "^3.11"\n'
		)
		const result = await checkPyproject(dir)
		expect(result.status).toBe('ok')
		expect(result.detail).toContain('Poetry')
	})

	it('flags a Poetry manifest with no python constraint', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'pyproject.toml'), '[tool.poetry]\nname = "demo"\n')
		expect((await checkPyproject(dir)).status).toBe('drift')
	})
})

describe('checkPythonGitignore', () => {
	it('is missing without a .gitignore', async () => {
		expect((await checkPythonGitignore(newTmpDir())).status).toBe('missing')
	})

	it('passes when the artefacts are covered', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), '__pycache__/\n.venv/\n.pytest_cache/\n')
		expect((await checkPythonGitignore(dir)).status).toBe('ok')
	})

	it('names the entries that are missing', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), '__pycache__/\n')
		const result = await checkPythonGitignore(dir)
		expect(result.status).toBe('drift')
		expect(result.detail).toContain('.venv')
		expect(result.detail).toContain('.pytest_cache')
		expect(result.detail).not.toContain('__pycache__,')
	})
})

describe('checkPythonTests', () => {
	const CI = 'jobs:\n  test:\n    steps:\n      - run: pytest\n'

	it('is missing with no tests anywhere', async () => {
		expect((await checkPythonTests(newTmpDir())).status).toBe('missing')
	})

	// A tests/ directory nothing executes reads as covered, which is worse than
	// having none at all — the failure mode this half exists for.
	it('drifts when tests exist but no CI runs pytest', async () => {
		const dir = newTmpDir()
		await fs.outputFile(join(dir, 'tests/test_demo.py'), 'def test_x():\n    assert True\n')
		await fs.outputFile(join(dir, '.github/workflows/ci.yml'), 'jobs:\n  build:\n    steps: []\n')
		const result = await checkPythonTests(dir)
		expect(result.status).toBe('drift')
		expect(result.hint).toContain('fix python-ci')
	})

	it('passes when a workflow runs pytest', async () => {
		const dir = newTmpDir()
		await fs.outputFile(join(dir, 'tests/test_demo.py'), '')
		await fs.outputFile(join(dir, '.github/workflows/ci.yml'), CI)
		expect((await checkPythonTests(dir)).status).toBe('ok')
	})

	// GitLab is the only pipeline on a repo mirrored off GitHub.
	it('accepts .gitlab-ci.yml as the runner', async () => {
		const dir = newTmpDir()
		await fs.outputFile(join(dir, 'tests/test_demo.py'), '')
		await fs.writeFile(join(dir, '.gitlab-ci.yml'), 'test:\n  script:\n    - pytest\n')
		expect((await checkPythonTests(dir)).status).toBe('ok')
	})

	it('accepts a root-level test_*.py as the suite', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'test_demo.py'), '')
		await fs.outputFile(join(dir, '.github/workflows/ci.yml'), CI)
		expect((await checkPythonTests(dir)).status).toBe('ok')
	})
})

describe('runPythonChecks', () => {
	it('covers the manifest, tools, ignore file and tests', async () => {
		const names = (await runPythonChecks(newTmpDir())).map((r) => r.check)
		expect(names).toEqual([
			'pyproject.toml',
			'Ruff',
			'mypy',
			'pytest',
			'Python .gitignore',
			'Python tests',
		])
	})

	it('treats every tool config as required', async () => {
		const byName = Object.fromEntries(
			(await runPythonChecks(newTmpDir())).map((r) => [r.check, r.status])
		)
		expect(byName.Ruff).toBe('missing')
		expect(byName.mypy).toBe('missing')
		expect(byName.pytest).toBe('missing')
	})

	// The three tools can all be configured from pyproject.toml instead of their
	// own files, and that has to count.
	it('accepts the pyproject form of every tool config', async () => {
		const dir = newTmpDir()
		await fs.writeFile(
			join(dir, 'pyproject.toml'),
			`${VALID_PYPROJECT}\n[tool.ruff]\nline-length = 100\n\n[tool.mypy]\nstrict = true\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n`
		)
		const byName = Object.fromEntries((await runPythonChecks(dir)).map((r) => [r.check, r.status]))
		expect(byName.Ruff).toBe('ok')
		expect(byName.mypy).toBe('ok')
		expect(byName.pytest).toBe('ok')
	})

	// setup.cfg / tox.ini are the pre-pyproject homes for the same two tools.
	it('accepts the setup.cfg and tox.ini forms', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'setup.cfg'), '[mypy]\nstrict = True\n\n[tool:pytest]\n')
		const byName = Object.fromEntries((await runPythonChecks(dir)).map((r) => [r.check, r.status]))
		expect(byName.mypy).toBe('ok')
		expect(byName.pytest).toBe('ok')
	})

	it('flags a ruff.toml that carries no recognisable config', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'ruff.toml'), '# TODO: fill this in\n')
		const results = await runPythonChecks(dir)
		expect(results.find((r) => r.check === 'Ruff')?.status).toBe('drift')
	})

	// Every Python repo has a pyproject.toml. Reading its mere presence as a
	// broken tool config would report drift on every unconfigured repo — the
	// tools simply aren't set up, which is `missing`.
	it('does not read a bare pyproject.toml as a broken tool config', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'pyproject.toml'), VALID_PYPROJECT)
		const byName = Object.fromEntries((await runPythonChecks(dir)).map((r) => [r.check, r.status]))
		expect(byName.Ruff).toBe('missing')
		expect(byName.mypy).toBe('missing')
		expect(byName.pytest).toBe('missing')
	})

	// The dedicated file wins at runtime (ruff reads ruff.toml before pyproject),
	// so a broken one stays drift even when the pyproject table is fine.
	it('lets a broken dedicated config outrank a valid pyproject table', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'ruff.toml'), '# TODO: fill this in\n')
		await fs.writeFile(join(dir, 'pyproject.toml'), '[tool.ruff]\nline-length = 100\n')
		const results = await runPythonChecks(dir)
		expect(results.find((r) => r.check === 'Ruff')?.status).toBe('drift')
	})
})
