import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	parsePyproject,
	pythonGithubJobs,
	readPyproject,
	renderPythonGitLabCI,
	renderPythonWorkflow,
} from '../../../src/languages/python/ci.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

describe('parsePyproject', () => {
	it('tests the declared floor and the newest interpreter', () => {
		expect(parsePyproject('requires-python = ">=3.10"\n').pythonVersions).toEqual(['3.10', '3.13'])
	})

	it('reads the Poetry spelling of the same constraint', () => {
		expect(parsePyproject('[tool.poetry.dependencies]\npython = "^3.11"\n').pythonVersions).toEqual(
			['3.11', '3.13']
		)
	})

	it('falls back to a floor when the manifest declares none', () => {
		expect(parsePyproject('[project]\nname = "demo"\n').pythonVersions).toEqual(['3.10', '3.13'])
	})

	// Emitting a matrix entry for an interpreter older than the floor would fail
	// CI on a repo that correctly declared it doesn't support that version.
	it('collapses to one entry when the floor is the newest release', () => {
		expect(parsePyproject('requires-python = ">=3.13"\n').pythonVersions).toEqual(['3.13'])
	})

	it('collapses when the floor is newer than anything we know about', () => {
		expect(parsePyproject('requires-python = ">=3.14"\n').pythonVersions).toEqual(['3.14'])
	})
})

describe('readPyproject', () => {
	it('falls back to the default range with no manifest', async () => {
		expect((await readPyproject(newTmpDir())).pythonVersions).toEqual(['3.10', '3.13'])
	})

	it('reads the floor off disk', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'pyproject.toml'), '[project]\nrequires-python = ">=3.12"\n')
		expect((await readPyproject(dir)).pythonVersions).toEqual(['3.12', '3.13'])
	})
})

describe('pythonGithubJobs', () => {
	const jobs = pythonGithubJobs({ pythonVersions: ['3.10', '3.13'] })

	it('lints, typechecks and tests', () => {
		expect(jobs.map((j) => j.id)).toEqual(['lint', 'typecheck', 'test'])
	})

	it('runs both halves of ruff — the linter and the formatter', () => {
		const lint = jobs.find((j) => j.id === 'lint')?.steps ?? ''
		expect(lint).toContain('ruff check --output-format=github')
		expect(lint).toContain('ruff format --check')
	})

	// mypy against bare source reports every third-party import as missing.
	it('installs the project before typechecking it', () => {
		const typecheck = jobs.find((j) => j.id === 'typecheck')?.steps ?? ''
		expect(typecheck).toContain('pip install -e .')
		expect(typecheck).toContain('mypy .')
	})

	it('matrixes the test job over the supported interpreters', () => {
		const test = jobs.find((j) => j.id === 'test')
		expect(test?.extra).toContain("- '3.10'")
		expect(test?.extra).toContain("- '3.13'")
		expect(test?.steps).toContain('pytest')
	})
})

describe('renderPythonWorkflow', () => {
	const workflow = renderPythonWorkflow({ pythonVersions: ['3.11', '3.13'] })

	it('wraps the jobs in the shared skeleton', () => {
		expect(workflow).toContain('check-skip:')
		expect(workflow).toMatch(/^name: 🚀 CI\/CD Pipeline/)
	})

	it('satisfies the Python tests check it is generated for', () => {
		expect(workflow).toMatch(/\bpytest\b/)
	})

	it('runs on Linux — nothing here needs a mac runner', () => {
		expect(workflow).not.toContain('macos')
	})
})

describe('renderPythonGitLabCI', () => {
	const ci = renderPythonGitLabCI({ pythonVersions: ['3.10', '3.13'] })

	it('pins the image to the newest supported interpreter', () => {
		expect(ci).toContain('image: python:3.13')
	})

	it('derives its stages from the jobs', () => {
		expect(ci).toContain('stages:\n  - lint\n  - test')
	})

	it('runs ruff and pytest', () => {
		expect(ci).toContain('ruff check')
		expect(ci).toContain('- pytest')
	})
})
