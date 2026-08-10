/**
 * Python language module — checks (#290), on the same template as Swift (#286).
 *
 * The standard encoded here is ruff (lint *and* format), mypy and pytest.
 * Deliberately *not* checked:
 *
 * - **black** — ruff's formatter is black-compatible and already runs in the
 *   pre-commit hook and the lint job. A second *rewriting* formatter fights the
 *   first, which is the same reason the Swift module checks SwiftLint's `--fix`
 *   rather than SwiftFormat. If a repo wants black instead, it configures black
 *   in its own pyproject.toml — nothing here objects.
 * - **flake8 / isort / pyupgrade** — the `select` list in the shipped ruff.toml
 *   covers all three (E/W, I, UP), so a separate config would be a second place
 *   to keep the same rules.
 * - **A pinned interpreter file** (`.python-version`) — the supported range is
 *   declared once in pyproject's `requires-python`, and CI derives its matrix
 *   from that. A root file would be a second thing to keep in sync.
 */
import path from 'node:path'
import fs from 'fs-extra'
import { type FileCheck, type GitHooksProfile, checkFile, matches } from '../../base/checks.js'
import type { CheckResult } from '../../base/types.js'
import { PYTHON_GITIGNORE_SENTINELS } from './gitignore.js'
import { PYTHON_HOOKS_DIR } from './git-hooks.js'

/**
 * A Python tool config, which can live in the tool's own file *or* in a table
 * inside a file that belongs to something else. That split is why this isn't a
 * plain `FileCheck`: `checkFile` treats "candidate exists but doesn't match" as
 * drift, and every Python repo has a pyproject.toml. Reporting `pyproject.toml
 * found but is not a valid Ruff configuration` on a repo that simply keeps its
 * ruff config in ruff.toml — or hasn't configured ruff at all — is noise.
 */
interface PythonToolCheck {
	/** Files that exist *only* to configure this tool. A bad one is real drift. */
	dedicated: FileCheck
	/**
	 * Files that may carry the tool's table among unrelated config. Their mere
	 * presence says nothing, so they can only ever upgrade the result to `ok`.
	 */
	shared: string[]
}

const PYTHON_TOOL_CHECKS: PythonToolCheck[] = [
	{
		dedicated: {
			check: 'Ruff',
			candidates: ['ruff.toml', '.ruff.toml'],
			expected: 'is a valid Ruff configuration',
			// `[tool.ruff...]` is the pyproject form; the rest are ruff.toml's own
			// top-level keys and sections.
			matcher: /^\[tool\.ruff|^\[(lint|format)\]|^(line-length|target-version)\s*=/m,
			hint: 'Run `npx @rtorcato/repo-tooling fix ruff` to scaffold (or add a `[tool.ruff]` table to pyproject.toml)',
		},
		shared: ['pyproject.toml'],
	},
	{
		dedicated: {
			check: 'mypy',
			candidates: ['mypy.ini', '.mypy.ini'],
			expected: 'is a valid mypy configuration',
			// `[mypy]` in mypy.ini/setup.cfg, `[tool.mypy]` in pyproject.
			matcher: /^\[(tool\.)?mypy\]/m,
			hint: 'Run `npx @rtorcato/repo-tooling fix mypy` to scaffold (or add a `[tool.mypy]` table to pyproject.toml)',
		},
		shared: ['setup.cfg', 'pyproject.toml'],
	},
	{
		dedicated: {
			check: 'pytest',
			candidates: ['pytest.ini'],
			expected: 'is a valid pytest configuration',
			// `[pytest]` in pytest.ini/tox.ini, `[tool:pytest]` in setup.cfg,
			// `[tool.pytest.ini_options]` in pyproject.
			matcher: /^\[(pytest|tool:pytest|tool\.pytest\.ini_options)\]/m,
			hint: 'Run `npx @rtorcato/repo-tooling fix pytest` to scaffold (or add a `[tool.pytest.ini_options]` table to pyproject.toml)',
		},
		shared: ['tox.ini', 'setup.cfg', 'pyproject.toml'],
	},
]

async function checkPythonTool(dir: string, spec: PythonToolCheck): Promise<CheckResult> {
	const result = await checkFile(dir, spec.dedicated)
	// A dedicated file that exists takes precedence over any shared table — all
	// three tools read it first — so `ok` and `drift` are both final answers.
	if (result.status !== 'missing') return result

	for (const candidate of spec.shared) {
		const filepath = path.join(dir, candidate)
		if (!(await fs.pathExists(filepath))) continue
		if (matches(spec.dedicated.matcher, await fs.readFile(filepath, 'utf-8'))) {
			return {
				check: spec.dedicated.check,
				status: 'ok',
				detail: `${candidate} ${spec.dedicated.expected}`,
			}
		}
	}
	return result
}

export async function checkPythonGitignore(dir: string): Promise<CheckResult> {
	const check = 'Python .gitignore'
	const filepath = path.join(dir, '.gitignore')
	if (!(await fs.pathExists(filepath))) {
		return {
			check,
			status: 'missing',
			detail: 'no .gitignore',
			hint: 'Run `npx @rtorcato/repo-tooling fix python-gitignore` to scaffold the Python template',
		}
	}

	const contents = await fs.readFile(filepath, 'utf-8')
	const missing = PYTHON_GITIGNORE_SENTINELS.filter((entry) => !contents.includes(entry))
	if (missing.length > 0) {
		return {
			check,
			status: 'drift',
			detail: `.gitignore missing Python artefacts: ${missing.join(', ')}`,
			hint: 'Run `npx @rtorcato/repo-tooling fix python-gitignore` to append the missing entries',
		}
	}

	return {
		check,
		status: 'ok',
		detail: `.gitignore covers ${PYTHON_GITIGNORE_SENTINELS.join(', ')}`,
	}
}

/**
 * pyproject.toml hygiene, the Python shape of the `Package.swift` check. Both
 * signals are things no tool infers for you: without a metadata table there is
 * nothing to build or publish, and without a `requires-python` floor pip will
 * happily install the package on an interpreter it cannot run on — the failure
 * lands on the user, at import time.
 */
export async function checkPyproject(dir: string): Promise<CheckResult> {
	const check = 'pyproject.toml'
	const filepath = path.join(dir, 'pyproject.toml')

	if (!(await fs.pathExists(filepath))) {
		// detect-language also accepts setup.py, so a repo can reach this module
		// without a pyproject at all. That's drift rather than "not a Python repo".
		const legacy = await fs.pathExists(path.join(dir, 'setup.py'))
		return {
			check,
			status: 'missing',
			detail: legacy ? 'setup.py only — no pyproject.toml' : 'no pyproject.toml',
			hint: 'Add a PEP 621 pyproject.toml with a `[project]` table — setup.py is legacy and no longer the packaging standard',
		}
	}

	const contents = await fs.readFile(filepath, 'utf-8')
	// PEP 621 `[project]` or Poetry's `[tool.poetry]` — the two forms in the wild.
	const poetry = /^\[tool\.poetry\]/m.test(contents)
	if (!/^\[project\]/m.test(contents) && !poetry) {
		return {
			check,
			status: 'drift',
			detail: 'pyproject.toml declares no `[project]` (or `[tool.poetry]`) metadata',
			hint: 'Add a `[project]` table with `name`, `version` and `requires-python` — see PEP 621',
		}
	}

	// Poetry spells the same constraint `python = "^3.11"` under its dependencies.
	const hasFloor = poetry
		? /^\s*python\s*=/m.test(contents)
		: /^requires-python\s*=/m.test(contents)
	if (!hasFloor) {
		return {
			check,
			status: 'drift',
			detail: `pyproject.toml declares no ${poetry ? '`python` constraint' : '`requires-python`'}`,
			hint: 'Add `requires-python = ">=3.10"` — without it pip installs the package on interpreters it cannot run on',
		}
	}

	return {
		check,
		status: 'ok',
		detail: `pyproject.toml declares ${poetry ? 'Poetry' : 'PEP 621'} metadata and a Python floor`,
	}
}

/** CI files that could be running the test suite, most likely first. */
async function ciFiles(dir: string): Promise<string[]> {
	const candidates: string[] = ['.gitlab-ci.yml', '.gitlab-ci.yaml']
	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (await fs.pathExists(workflowsDir)) {
		const files = (await fs.readdir(workflowsDir)).filter(
			(f) => f.endsWith('.yml') || f.endsWith('.yaml')
		)
		candidates.unshift(...files.map((f) => path.join('.github', 'workflows', f)))
	}
	return candidates
}

/** `tests/`, `test/`, or a root-level `test_*.py` — the three layouts pytest finds. */
async function hasTestFiles(dir: string): Promise<string | null> {
	for (const candidate of ['tests', 'test']) {
		if (await fs.pathExists(path.join(dir, candidate))) return `${candidate}/`
	}
	try {
		const found = (await fs.readdir(dir)).find((f) => /^test_.*\.py$/.test(f))
		return found ?? null
	} catch {
		return null
	}
}

/**
 * The test setup. Same two halves as the Swift version: a suite has to exist,
 * and CI has to run it. A green pipeline over a repo with no tests proves
 * nothing, and a tests/ directory nothing executes is worse than none at all —
 * it reads as covered.
 */
export async function checkPythonTests(dir: string): Promise<CheckResult> {
	const check = 'Python tests'
	const tests = await hasTestFiles(dir)
	if (!tests) {
		return {
			check,
			status: 'missing',
			detail: 'no tests/ directory or test_*.py files',
			hint: 'Add a `tests/` directory — the shipped pytest.ini sets `testpaths = tests`',
		}
	}

	for (const candidate of await ciFiles(dir)) {
		const filepath = path.join(dir, candidate)
		if (!(await fs.pathExists(filepath))) continue
		if (/\bpytest\b/.test(await fs.readFile(filepath, 'utf-8'))) {
			return { check, status: 'ok', detail: `${tests} found and run by ${candidate}` }
		}
	}

	return {
		check,
		status: 'drift',
		detail: `${tests} found but no CI job runs pytest`,
		hint: 'Run `npx @rtorcato/repo-tooling fix python-ci` to regenerate a workflow that runs pytest',
	}
}

/**
 * The Python shape of the base `Git hooks` / `Pre-push hook` checks (#309).
 * `install` is null for the same reason Swift's is: the wiring —
 * `git config core.hooksPath` — is per-clone local state that nothing commits,
 * so flagging its absence would fail every fresh CI checkout.
 */
export const PYTHON_GIT_HOOKS: GitHooksProfile = {
	dir: PYTHON_HOOKS_DIR,
	install: null,
	verifyCommand: 'pytest',
	fixTarget: 'python-git-hooks',
}

/** The Python module's suite, layered on top of the base checks by doctor. */
export async function runPythonChecks(dir: string): Promise<CheckResult[]> {
	return [
		await checkPyproject(dir),
		...(await Promise.all(PYTHON_TOOL_CHECKS.map((spec) => checkPythonTool(dir, spec)))),
		await checkPythonGitignore(dir),
		await checkPythonTests(dir),
	]
}
