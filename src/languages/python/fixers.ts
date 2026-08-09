/**
 * Python language module — fixers (#290). One per check in ./checks.ts.
 *
 * ponytail: no `python-lockfile` fixer. Swift's writes the config that
 * `setup --preset swift-library` would have produced, and there is no
 * `python-library` preset yet (the Swift one landed in its own issue, #288).
 * Inventing a ProjectConfig here just to have something to record would put a
 * fabricated set of JS tool choices in a Python repo's lockfile — worse than
 * doctor saying the lockfile is absent, which is true.
 */
import path from 'node:path'
import chalk from 'chalk'
import fs from 'fs-extra'
import type { Fixer } from '../../base/fixers.js'
import { copyPreset } from '../../cli/utils/copy-preset.js'
import { readPyproject, renderPythonGitLabCI, renderPythonWorkflow } from './ci.js'
import { PYTHON_HOOKS_DIR, installPythonGitHooks } from './git-hooks.js'
import { ensurePythonGitignore } from './gitignore.js'

export const PYTHON_FIXERS: Fixer[] = [
	{
		target: 'ruff',
		description: 'Scaffold ruff.toml (lint + format — the linter and the formatter in one tool)',
		appliesTo: ['Ruff'],
		outputs: ['ruff.toml'],
		canFixDrift: true,
		async run({ targetDir }) {
			const result = await copyPreset('ruff', targetDir)
			return { filesWritten: [result.target] }
		},
	},
	{
		target: 'mypy',
		description: 'Scaffold mypy.ini (strict on your code, lenient on untyped dependencies)',
		appliesTo: ['mypy'],
		outputs: ['mypy.ini'],
		canFixDrift: true,
		async run({ targetDir }) {
			const result = await copyPreset('mypy', targetDir)
			return { filesWritten: [result.target] }
		},
	},
	{
		target: 'pytest',
		description: 'Scaffold pytest.ini (strict markers and config, warnings as errors)',
		appliesTo: ['pytest'],
		outputs: ['pytest.ini'],
		canFixDrift: true,
		async run({ targetDir }) {
			const result = await copyPreset('pytest', targetDir)
			return { filesWritten: [result.target] }
		},
	},
	{
		target: 'python-gitignore',
		description:
			'Add the Python artefacts (__pycache__, .venv, tool caches, build output) to .gitignore',
		appliesTo: ['Python .gitignore'],
		// Appends what's missing; never clobbers a project's own entries.
		riskLevel: 'safe-merge',
		outputs: ['.gitignore'],
		canFixDrift: true,
		async run({ targetDir }) {
			return { filesWritten: await ensurePythonGitignore(targetDir) }
		},
	},
	{
		target: 'python-git-hooks',
		description: `Scaffold ${PYTHON_HOOKS_DIR}/pre-commit + pre-push (ruff, mypy, pytest) and point git at them via core.hooksPath`,
		appliesTo: ['Git hooks', 'Pre-push hook'],
		outputs: [`${PYTHON_HOOKS_DIR}/pre-commit`, `${PYTHON_HOOKS_DIR}/pre-push`],
		canFixDrift: true,
		async run({ targetDir }) {
			const { filesWritten, hooksPathSet } = await installPythonGitHooks(targetDir)
			console.log(
				hooksPathSet
					? chalk.dim(`   git config core.hooksPath ${PYTHON_HOOKS_DIR}`)
					: chalk.yellow(
							`   run \`git config core.hooksPath ${PYTHON_HOOKS_DIR}\` once per clone — it's local git config, not a committed file`
						)
			)
			return { filesWritten }
		},
	},
	{
		target: 'python-ci',
		description:
			'Scaffold .github/workflows/ci.yml for Python (ruff, mypy, pytest across the supported interpreters)',
		appliesTo: ['GitHub Actions'],
		outputs: ['.github/workflows/ci.yml'],
		canFixDrift: true,
		async run({ targetDir }) {
			const workflowsDir = path.join(targetDir, '.github', 'workflows')
			await fs.ensureDir(workflowsDir)
			const workflow = renderPythonWorkflow(await readPyproject(targetDir))
			await fs.writeFile(path.join(workflowsDir, 'ci.yml'), workflow)
			return { filesWritten: ['.github/workflows/ci.yml'] }
		},
	},
	{
		target: 'python-gitlab-ci',
		description: 'Scaffold .gitlab-ci.yml for Python (ruff + pytest on the official Python image)',
		appliesTo: ['GitLab CI'],
		outputs: ['.gitlab-ci.yml'],
		canFixDrift: true,
		async run({ targetDir }) {
			const ci = renderPythonGitLabCI(await readPyproject(targetDir))
			await fs.writeFile(path.join(targetDir, '.gitlab-ci.yml'), ci)
			return { filesWritten: ['.gitlab-ci.yml'] }
		},
	},
]
