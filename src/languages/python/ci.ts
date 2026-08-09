/**
 * Python CI generation (#290), built on the language-agnostic skeleton in
 * `src/base/ci.ts`. No `setup-node`, no `pnpm` — the Python path runs on Linux
 * with `actions/setup-python` and pip.
 *
 * Like the Swift path there's no `ProjectConfig` to read: the one fact CI needs
 * beyond the fixed job shapes — which interpreters to test on — is declared in
 * pyproject.toml, so the matrix is derived from the repo itself.
 */
import path from 'node:path'
import fs from 'fs-extra'
import { type CiJob, type GitLabSpec, renderGitHubWorkflow, renderGitLabCI } from '../../base/ci.js'

/**
 * The newest interpreter the emitted matrix tests against, and the one the
 * single-interpreter jobs (lint, typecheck) run on.
 *
 * ponytail: a constant, bumped by hand once a year when CPython ships a minor.
 * Resolving "latest" at generation time would need a network call from a
 * generator whose whole job is emitting text.
 */
const LATEST_PYTHON = '3.13'

/** The oldest interpreter to assume when pyproject declares no floor. */
const DEFAULT_FLOOR = '3.10'

export interface PythonProject {
	/**
	 * Interpreter versions for the test matrix, oldest first. Two points — the
	 * declared floor and the newest release — rather than every minor between:
	 * breaks show up at the ends of the range (a removed 3.9 builtin, a new 3.13
	 * deprecation), and the middle costs runner minutes to re-prove them absent.
	 */
	pythonVersions: string[]
}

const minorOf = (version: string): number => Number.parseInt(version.split('.')[1] ?? '0', 10)

/**
 * Pull the supported-Python floor out of a pyproject.toml. A regex rather than
 * a TOML parser: this is one key, and a parser is a dependency the CLI would
 * carry solely to read it.
 */
export function parsePyproject(contents: string): PythonProject {
	// PEP 621 `requires-python = ">=3.10"`, or Poetry's
	// `python = "^3.11"` under [tool.poetry.dependencies].
	const constraint =
		contents.match(/^requires-python\s*=\s*["']([^"']+)["']/m)?.[1] ??
		contents.match(/^\s*python\s*=\s*["']([^"']+)["']/m)?.[1] ??
		''
	const floor = constraint.match(/(\d+\.\d+)/)?.[1] ?? DEFAULT_FLOOR

	// A floor at or above the newest release we know about collapses the matrix
	// to one entry rather than emitting a version that doesn't exist yet.
	const versions = minorOf(floor) >= minorOf(LATEST_PYTHON) ? [floor] : [floor, LATEST_PYTHON]
	return { pythonVersions: versions }
}

export async function readPyproject(dir: string): Promise<PythonProject> {
	const filepath = path.join(dir, 'pyproject.toml')
	if (!(await fs.pathExists(filepath))) return { pythonVersions: [DEFAULT_FLOOR, LATEST_PYTHON] }
	return parsePyproject(await fs.readFile(filepath, 'utf-8'))
}

/** Checkout + interpreter. `cache: pip` keys off the manifests pip resolves from. */
function pythonSetup(version: string): string {
	return `      - name: 📦 Checkout repository
        uses: actions/checkout@v7

      - name: 🐍 Set up Python ${version}
        uses: actions/setup-python@v6
        with:
          python-version: '${version}'
          cache: pip`
}

export function pythonGithubJobs(project: PythonProject): CiJob[] {
	return [
		{
			id: 'lint',
			steps: `${pythonSetup(LATEST_PYTHON)}

      - name: 📦 Install Ruff
        run: pip install ruff

      - name: 🔍 ruff check
        run: ruff check --output-format=github

      - name: 🎨 ruff format --check
        run: ruff format --check`,
		},
		{
			id: 'typecheck',
			// mypy needs the package's own dependencies importable to resolve their
			// types — running it against bare source reports every third-party import
			// as missing.
			steps: `${pythonSetup(LATEST_PYTHON)}

      - name: 📦 Install project and mypy
        run: |
          pip install --upgrade pip
          pip install -e .
          pip install mypy

      - name: 🔎 mypy
        run: mypy .`,
		},
		{
			id: 'test',
			extra: `    name: pytest \${{ matrix.python-version }}
    strategy:
      fail-fast: false
      matrix:
        python-version:
${project.pythonVersions.map((v) => `          - '${v}'`).join('\n')}`,
			steps: `      - name: 📦 Checkout repository
        uses: actions/checkout@v7

      - name: 🐍 Set up Python \${{ matrix.python-version }}
        uses: actions/setup-python@v6
        with:
          python-version: \${{ matrix.python-version }}
          cache: pip

      - name: 📦 Install project and pytest
        run: |
          pip install --upgrade pip
          pip install -e .
          pip install pytest

      - name: 🧪 pytest
        run: pytest`,
		},
	]
}

export function renderPythonWorkflow(project: PythonProject): string {
	return renderGitHubWorkflow(pythonGithubJobs(project))
}

/**
 * GitLab runs the same three commands in the official Python image. The matrix
 * is dropped: GitLab's `parallel:matrix` would need a per-job image override,
 * and a mirrored repo is a secondary pipeline — the version sweep lives on the
 * GitHub side.
 */
function pythonGitlabSpec(project: PythonProject): GitLabSpec {
	const image = `python:${project.pythonVersions.at(-1) ?? LATEST_PYTHON}`
	return {
		image,
		preamble: `variables:
  PIP_CACHE_DIR: "$CI_PROJECT_DIR/.cache/pip"

cache:
  paths:
    - .cache/pip`,
		jobs: [
			{
				id: 'lint',
				stage: 'lint',
				script: ['pip install ruff', 'ruff check', 'ruff format --check'],
			},
			{
				id: 'test',
				stage: 'test',
				script: ['pip install -e .', 'pip install pytest', 'pytest'],
			},
		],
	}
}

export function renderPythonGitLabCI(project: PythonProject): string {
	return renderGitLabCI(pythonGitlabSpec(project))
}
