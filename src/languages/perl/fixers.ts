/**
 * Perl language module — fixers (#289). One per check in ./checks.ts.
 *
 * ponytail: no `perl-lockfile` fixer, for the same reason the Python module has
 * none (#290). Swift's writes the config `setup --preset swift-library` would
 * have produced, and there is no `perl-library` preset. Inventing a
 * ProjectConfig here would put a fabricated set of JS tool choices in a Perl
 * distribution's lockfile — worse than doctor reporting it absent, which is
 * true.
 */
import path from 'node:path'
import chalk from 'chalk'
import fs from 'fs-extra'
import type { Fixer } from '../../base/fixers.js'
import { copyPreset } from '../../cli/utils/copy-preset.js'
import { readPerlProject, renderPerlGitLabCI, renderPerlWorkflow } from './ci.js'
import { PERL_HOOKS_DIR, installPerlGitHooks } from './git-hooks.js'
import { ensurePerlGitignore } from './gitignore.js'

export const PERL_FIXERS: Fixer[] = [
	{
		target: 'perlcritic',
		description: 'Scaffold .perlcriticrc (Perl::Critic at severity 3, with the family exceptions)',
		appliesTo: ['Perl::Critic'],
		outputs: ['.perlcriticrc'],
		canFixDrift: true,
		async run({ targetDir }) {
			const result = await copyPreset('perlcritic', targetDir)
			return { filesWritten: [result.target] }
		},
	},
	{
		target: 'perltidy',
		description: 'Scaffold .perltidyrc (Perl Best Practices layout at 100 columns)',
		appliesTo: ['perltidy'],
		outputs: ['.perltidyrc'],
		canFixDrift: true,
		async run({ targetDir }) {
			const result = await copyPreset('perltidy', targetDir)
			return { filesWritten: [result.target] }
		},
	},
	{
		target: 'perl-gitignore',
		description: 'Add the Perl build artefacts (blib, MYMETA.*, pm_to_blib, local/) to .gitignore',
		appliesTo: ['Perl .gitignore'],
		// Appends what's missing; never clobbers a project's own entries.
		riskLevel: 'safe-merge',
		outputs: ['.gitignore'],
		canFixDrift: true,
		async run({ targetDir }) {
			return { filesWritten: await ensurePerlGitignore(targetDir) }
		},
	},
	{
		target: 'perl-git-hooks',
		description: `Scaffold ${PERL_HOOKS_DIR}/pre-commit + pre-push (perltidy, perlcritic, prove) and point git at them via core.hooksPath`,
		appliesTo: ['Git hooks', 'Pre-push hook'],
		outputs: [`${PERL_HOOKS_DIR}/pre-commit`, `${PERL_HOOKS_DIR}/pre-push`],
		canFixDrift: true,
		async run({ targetDir }) {
			const { filesWritten, hooksPathSet } = await installPerlGitHooks(targetDir)
			console.log(
				hooksPathSet
					? chalk.dim(`   git config core.hooksPath ${PERL_HOOKS_DIR}`)
					: chalk.yellow(
							`   run \`git config core.hooksPath ${PERL_HOOKS_DIR}\` once per clone — it's local git config, not a committed file`
						)
			)
			return { filesWritten }
		},
	},
	{
		target: 'perl-ci',
		description:
			'Scaffold .github/workflows/ci.yml for Perl (perlcritic, perltidy, prove across the supported interpreters)',
		appliesTo: ['GitHub Actions'],
		outputs: ['.github/workflows/ci.yml'],
		canFixDrift: true,
		async run({ targetDir }) {
			const workflowsDir = path.join(targetDir, '.github', 'workflows')
			await fs.ensureDir(workflowsDir)
			const workflow = renderPerlWorkflow(await readPerlProject(targetDir))
			await fs.writeFile(path.join(workflowsDir, 'ci.yml'), workflow)
			return { filesWritten: ['.github/workflows/ci.yml'] }
		},
	},
	{
		target: 'perl-gitlab-ci',
		description: 'Scaffold .gitlab-ci.yml for Perl (perlcritic + prove on the official Perl image)',
		appliesTo: ['GitLab CI'],
		outputs: ['.gitlab-ci.yml'],
		canFixDrift: true,
		async run({ targetDir }) {
			const ci = renderPerlGitLabCI(await readPerlProject(targetDir))
			await fs.writeFile(path.join(targetDir, '.gitlab-ci.yml'), ci)
			return { filesWritten: ['.gitlab-ci.yml'] }
		},
	},
]
