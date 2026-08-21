/**
 * The fixer contract plus the language-agnostic fixers (#286, #303).
 *
 * These are the fixers for the checks in ./checks.ts — repo hygiene, security
 * automation, community health, AI agent files, GitHub repo settings. Nothing
 * here reads a package.json or emits a toolchain-specific step, so every
 * language module gets them for free; `fix` concatenates them with the module's
 * own set.
 *
 * Not here: `github-actions` / `gitlab-ci` / `lockfile`. Their *content* is
 * language-shaped (CI steps, recorded tool choices), so each module ships its
 * own — see src/base/ci.ts for the shell they share.
 */
import os from 'node:os'
import path from 'node:path'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { installAgentRules, installAiSetup } from '../cli/generators/agent-rules.js'
import {
	installClaudeSkill,
	resolveSkillsDir,
	SHIPPED_SKILLS,
	skillDiffCommand,
	type SkillInstallResult,
} from '../cli/generators/claude-skills.js'
import { generateBrand } from '../cli/generators/brand.js'
import { generateCommunityHealth } from '../cli/generators/community-health.js'
import { generateCommitlintConfig } from '../cli/generators/git.js'
import { generateCodeowners, generateEditorConfig } from '../cli/generators/misc.js'
import {
	findDependabotIgnoreRules,
	generateCodeQLWorkflow,
	generateDependabotConfig,
	generateRenovateConfig,
} from '../cli/generators/security.js'
import { classifyCopiedAssets } from '../cli/utils/copied-assets.js'
import { copyPreset } from '../cli/utils/copy-preset.js'
import { detectLanguage } from '../cli/utils/detect-language.js'
import type { Lockfile } from '../cli/utils/lockfile.js'
import { resolveLanguageModule } from '../languages/registry.js'
import {
	applyGithubSettings,
	applyReleaseEnvironment,
	RELEASE_ENV_CHECK,
	RELEASE_GATE_CHECK,
} from './github-settings.js'
import { applyLoopLabels } from './labels.js'
import { closeCompletedMilestones } from './milestones.js'
import type { CheckResult } from './types.js'

/** A parsed package.json, or null when the repo has none (any non-JS repo). */
export type Pkg = Record<string, unknown> | null

interface FixerContext {
	targetDir: string
	/** Always null outside the JS module — kept on the shared context so one
	 * fixer-runner drives every language. */
	pkg: Pkg
	result: CheckResult
	lock: Lockfile | null
	/** `--skills-dir`, for the one fixer that writes user-global state (#404). */
	skillsDir?: string
	/** `--force-skills`: overwrite a locally forked skill anyway (#480). */
	forceSkills?: boolean
	/** True under `--yes` / `--json`, so a fixer knows a prompt is not available. */
	assumeYes: boolean
}

export type FixRiskLevel = 'destructive' | 'safe-merge' | 'safe-add'

export interface Fixer {
	target: string
	description: string
	/** Doctor check names this fixer resolves. */
	appliesTo: string[]
	outputs: string[]
	/**
	 * - destructive (default): overwrites the target file
	 * - safe-merge: modifies an existing file without replacing user values
	 * - safe-add: only writes when the target file doesn't yet exist
	 */
	riskLevel?: FixRiskLevel
	canFixDrift?: boolean
	/**
	 * Never run by a bare `fix` / `fix --yes`; only when named as the target.
	 * For fixers whose blast radius is outside the repo — silently rewriting a
	 * developer's user-global agent skills because they ran a repo audit is a bad
	 * surprise, and the drift policy's whole promise is that it doesn't surprise.
	 */
	explicitOnly?: boolean
	/**
	 * Advisories printed from here go to `console.error`, never `console.log`:
	 * stdout is the `--json` payload's channel and a stray line lands in the
	 * middle of it, breaking every parser downstream (#357). They're diagnostics,
	 * not results, so stderr is the right stream regardless of the flag.
	 */
	run(ctx: FixerContext): Promise<{ filesWritten: string[] }>
}

/**
 * A fixer giving up on something the user has to resolve — a wrong flag, not a
 * crash. Thrown rather than printed-and-exited because a fixer runs underneath
 * `--json`: only the command layer knows whether the failure should surface as
 * an error payload on stdout or a red line on stderr. `code` joins the same
 * vocabulary as the command's own `no-lockfile` / `unknown-target` errors.
 */
export class FixerAbort extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly hint?: string
	) {
		super(message)
		this.name = 'FixerAbort'
	}
}

/** The repo's language module, resolved from its marker files. */
async function moduleFor(targetDir: string) {
	return resolveLanguageModule(await detectLanguage(targetDir))
}

/**
 * Where to install user-global skills, asking only when nothing resolves. Under
 * `--yes` / `--json` a prompt is not available — `--json` would have its payload
 * corrupted by one — and guessing at a directory the user never mentioned is not
 * an option either, so the run fails: `--skills-dir` is required in that case
 * (#411). It used to warn and no-op, which exited 0 with an empty `filesWritten`
 * that no `--json` consumer could tell apart from "already up to date".
 */
async function resolveInstallDir(explicit: string | undefined, assumeYes: boolean) {
	const { dir } = await resolveSkillsDir(explicit)
	if (dir) return dir
	if (assumeYes) {
		throw new FixerAbort(
			'no-skills-dir',
			'no ~/.claude/skills found, and --yes/--json cannot prompt for one',
			'pass --skills-dir <path>'
		)
	}
	const { answer } = await inquirer.prompt([
		{
			type: 'input',
			name: 'answer',
			message: 'Install agent skills where?',
			default: path.join(os.homedir(), '.claude', 'skills'),
		},
	])
	const trimmed = typeof answer === 'string' ? answer.trim() : ''
	return trimmed ? path.resolve(trimmed) : null
}

/**
 * Why the install refused, and what to do about it. A bare "skipped" would be
 * its own failure mode: the user still wants the update, and nothing on screen
 * would say how to get it or what they would be giving up (#480).
 */
function describeSkillFork(result: SkillInstallResult): string[] {
	const target = result.viaSymlink ? `${result.file} → ${result.realFile}` : result.realFile
	const why =
		result.contentState === 'modified'
			? `its content has diverged from the ${result.installedVersion} release it was installed from`
			: 'it carries no content record, so a local fork and a stale copy are indistinguishable'
	return [
		`skipped — ${result.name} was not overwritten with ${result.shippedVersion}: ${why}`,
		`  ${target}`,
		`  compare:  ${skillDiffCommand(result)}`,
		'  overwrite anyway:  fix claude-skills --force-skills',
	]
}

export const BASE_FIXERS: Fixer[] = [
	{
		target: 'copied-assets',
		description:
			'Re-copy presets that are unchanged since they were copied but older than the version this package ships',
		appliesTo: ['Copied assets'],
		outputs: ['(the stale copied presets, re-copied in place)'],
		canFixDrift: true,
		async run({ targetDir }) {
			// Only the `stale` ones: their content provably still matches what was
			// copied, so overwriting loses nothing. `modified` assets are somebody's
			// deliberate fork and stay a human decision (#428).
			const stale = (await classifyCopiedAssets(targetDir)).filter((a) => a.state === 'stale')
			const filesWritten: string[] = []
			for (const asset of stale) {
				filesWritten.push((await copyPreset(asset.preset, targetDir)).target)
			}
			return { filesWritten }
		},
	},
	{
		target: 'editorconfig',
		description: 'Scaffold .editorconfig (UTF-8, LF, tab indent)',
		appliesTo: ['EditorConfig'],
		outputs: ['.editorconfig'],
		canFixDrift: true,
		async run({ targetDir }) {
			await generateEditorConfig(targetDir)
			return { filesWritten: ['.editorconfig'] }
		},
	},
	{
		target: 'commitlint',
		description:
			'Scaffold commitlint.config.mjs + the husky commit-msg hook, and install @commitlint/cli',
		// Conventional Commits is a repo convention, not a JS one (#309) — the
		// config is identical in any repo. Running commitlint still needs node on
		// PATH, which is why the Swift hooks don't wire a commit-msg hook.
		appliesTo: ['Commitlint'],
		outputs: ['commitlint.config.mjs', '.husky/commit-msg', 'package.json (devDependencies)'],
		// safe-merge: only missing devDependencies are added, existing ranges stand.
		riskLevel: 'safe-merge',
		canFixDrift: true,
		async run({ targetDir }) {
			const filesWritten = await generateCommitlintConfig(targetDir)
			if (filesWritten.includes('package.json')) {
				console.error(chalk.dim('   reminder: run `pnpm install` to install commitlint'))
			}
			return { filesWritten }
		},
	},
	{
		target: 'dependabot',
		description:
			'Scaffold the canonical .github/dependabot.yml (monthly, grouped: production-minor/dev-minor/major-updates) + the dependabot-automerge workflow',
		appliesTo: ['Dependabot'],
		outputs: ['.github/dependabot.yml', '.github/workflows/dependabot-automerge.yml'],
		canFixDrift: true,
		async run({ targetDir }) {
			// The template owns the whole file but emits no `ignore:` block, so
			// regenerating deletes any repo-local ignore rule — silently, and with
			// nothing in `doctor` to report the loss afterwards, because from the
			// fixer's point of view the file then matches the standard exactly (#422).
			// Refuse rather than warn: an unattended `fix --yes` would walk past a
			// warning, and the rules are unrecoverable once written over.
			const ignored = await findDependabotIgnoreRules(targetDir)
			if (ignored) {
				throw new FixerAbort(
					'dependabot-ignore-rules',
					`refusing to overwrite ${ignored.file} — it has ${ignored.rules.length} \`ignore:\` rule(s) the canonical config does not reproduce: ${ignored.rules.join(', ')}`,
					`re-add the \`ignore:\` block after regenerating, or delete it from ${ignored.file} to accept the loss — then re-run \`fix dependabot\``
				)
			}
			const { dependabotEcosystem } = await moduleFor(targetDir)
			return { filesWritten: await generateDependabotConfig(targetDir, dependabotEcosystem) }
		},
	},
	{
		target: 'renovate',
		description: 'Scaffold renovate.json (weekly schedule; alternative to Dependabot)',
		appliesTo: ['Dependabot'],
		outputs: ['renovate.json'],
		riskLevel: 'safe-add',
		async run({ targetDir }) {
			await generateRenovateConfig(targetDir)
			return { filesWritten: ['renovate.json'] }
		},
	},
	{
		target: 'codeql',
		description: 'Scaffold .github/workflows/codeql.yml (security scanning)',
		appliesTo: ['CodeQL'],
		outputs: ['.github/workflows/codeql.yml'],
		async run({ targetDir }) {
			const { codeqlLanguages, label } = await moduleFor(targetDir)
			// Say so rather than reporting a successful fix that wrote nothing: the
			// generator correctly emits no workflow for an empty matrix (Perl, #289),
			// and a silent no-op reads as "done".
			if (codeqlLanguages.length === 0) {
				console.error(chalk.yellow(`   skipped — CodeQL has no ${label} analyzer`))
				return { filesWritten: [] }
			}
			return { filesWritten: await generateCodeQLWorkflow(targetDir, codeqlLanguages) }
		},
	},
	{
		target: 'github-settings',
		description:
			'Apply branch protection + auto-merge + workflow permissions + code-scanning ruleset on GitHub via gh api (mutates the remote repo, not files)',
		appliesTo: [
			'Branch protection',
			'Merge settings',
			'Workflow permissions',
			'Code-scanning gate',
		],
		outputs: ['GitHub repo settings (remote, via gh api)'],
		// safe-add is load-bearing: it exempts this fixer from the `--diff` shadow-run
		// (previewFixer copies to tmp and *executes* run(), which would fire real
		// `gh api` PUTs during a mere preview).
		riskLevel: 'safe-add',
		canFixDrift: true,
		async run({ targetDir }) {
			return { filesWritten: await applyGithubSettings(targetDir) }
		},
	},
	{
		target: 'release-environment',
		description:
			'Create the `release` environment (authenticated user as required reviewer) and wire `environment: release` into the publishing job — the gate between merging and publishing (#429)',
		appliesTo: [RELEASE_GATE_CHECK, RELEASE_ENV_CHECK],
		outputs: [
			'GitHub `release` environment (remote, via gh api)',
			'.github/workflows/<the publishing workflow>',
		],
		// safe-add for the same shadow-run reason as github-settings, and
		// explicitOnly because arming the gate changes what a merge *does*: the
		// next release run sits `waiting` for an approval instead of publishing.
		// That is the point, but it must be a chosen rollout per repo, not a side
		// effect of a bare `fix`.
		riskLevel: 'safe-add',
		explicitOnly: true,
		canFixDrift: true,
		async run({ targetDir }) {
			return { filesWritten: await applyReleaseEnvironment(targetDir) }
		},
	},
	{
		target: 'milestones',
		description:
			'Close 100%-complete open milestones on GitHub via gh api (mutates the remote repo, not files). Never deletes or creates one',
		appliesTo: ['Milestones'],
		outputs: ['GitHub milestones (remote, via gh api)'],
		// safe-add for the same reason github-settings is: it exempts this fixer
		// from the `--diff` shadow-run, which executes run() for a mere preview.
		riskLevel: 'safe-add',
		canFixDrift: true,
		async run({ targetDir }) {
			return { filesWritten: await closeCompletedMilestones(targetDir) }
		},
	},
	{
		target: 'labels',
		description:
			'Repair ai-issue-loop label colours and descriptions on GitHub via `gh label edit` (mutates the remote repo, not files). No-ops on a repo that does not use the loop',
		appliesTo: ['AI loop labels'],
		outputs: ['GitHub labels (remote, via gh label edit)'],
		// safe-add for the same reason github-settings is: it exempts this fixer
		// from the `--diff` shadow-run, which executes run() for a mere preview.
		riskLevel: 'safe-add',
		canFixDrift: true,
		async run({ targetDir }) {
			return { filesWritten: await applyLoopLabels(targetDir) }
		},
	},
	{
		target: 'codeowners',
		description: 'Scaffold .github/CODEOWNERS with commented examples',
		appliesTo: ['CODEOWNERS'],
		outputs: ['.github/CODEOWNERS'],
		riskLevel: 'safe-add',
		canFixDrift: false,
		async run({ targetDir }) {
			const written = await generateCodeowners(targetDir)
			return { filesWritten: [written] }
		},
	},
	{
		target: 'community-health',
		description: 'Scaffold CONTRIBUTING.md, SECURITY.md, PR + issue templates',
		appliesTo: ['Community health'],
		outputs: [
			'CONTRIBUTING.md',
			'SECURITY.md',
			'.github/PULL_REQUEST_TEMPLATE.md',
			'.github/ISSUE_TEMPLATE/bug_report.md',
			'.github/ISSUE_TEMPLATE/feature_request.md',
		],
		riskLevel: 'safe-add',
		canFixDrift: false,
		async run({ targetDir }) {
			const filesWritten = await generateCommunityHealth(targetDir)
			return { filesWritten }
		},
	},
	{
		target: 'brand',
		description:
			'Scaffold brand/ — banner, mobile-banner and social-card SVG sources + render.sh, and repoint a README still on root-level banner paths',
		appliesTo: ['Brand assets'],
		outputs: [
			'brand/banner.svg',
			'brand/banner-mobile.svg',
			'brand/social-card.svg',
			'brand/render.sh',
			'README.md',
		],
		// Every SVG is written only when absent and the README edit rewrites two
		// image paths — hand-edited art is never clobbered.
		riskLevel: 'safe-merge',
		canFixDrift: true,
		async run({ targetDir, pkg }) {
			const filesWritten = await generateBrand(pkg, targetDir)
			if (filesWritten.some((f) => f.endsWith('.svg'))) {
				console.error(
					chalk.dim(
						'   next: run `brand/render.sh` to render the PNGs (needs librsvg — `brew install librsvg`)'
					)
				)
			}
			return { filesWritten }
		},
	},
	{
		target: 'ai',
		description:
			'Install all AI agent files at once (AGENTS.md, CLAUDE.md, Cursor, Copilot, Claude skill, MCP example)',
		appliesTo: ['AI setup', 'Claude worktree settings'],
		outputs: [
			'AGENTS.md',
			'CLAUDE.md',
			'.cursor/rules/repo-tooling.mdc',
			'.github/copilot-instructions.md',
			'.claude/skills/repo-tooling.md',
			'.mcp.json.example',
			// Only written for a repo with a package.json — nothing to symlink otherwise.
			'.claude/settings.json',
			// Only written when the repo ships its own skills/<name>/SKILL.md.
			'README.md',
		],
		// Every output is a delimited-block upsert or a `.example` file — existing
		// user content is never clobbered.
		riskLevel: 'safe-merge',
		canFixDrift: true,
		async run({ targetDir }) {
			const filesWritten = await installAiSetup(targetDir)
			return { filesWritten }
		},
	},
	{
		target: 'claude-skill',
		description: 'Install the repo-tooling Claude Code skill into .claude/skills/',
		appliesTo: ['Claude skill'],
		outputs: ['.claude/skills/repo-tooling.md'],
		riskLevel: 'safe-add',
		canFixDrift: true,
		async run({ targetDir }) {
			const result = await copyPreset('claude-skill', targetDir)
			return { filesWritten: [result.target] }
		},
	},
	{
		target: 'claude-skills',
		description: `Install the ${SHIPPED_SKILLS.join(', ')} Claude Code skills into the user-level skills dir (~/.claude/skills, or --skills-dir). Writes outside the repo`,
		appliesTo: ['Claude skills'],
		outputs: SHIPPED_SKILLS.map((name) => `~/.claude/skills/${name}/SKILL.md`),
		// safe-add is load-bearing for the same reason it is on github-settings:
		// it exempts this fixer from the `--diff` shadow-run, which copies the repo
		// to tmp and *executes* run() — here that would write to the real home dir
		// during what the user asked to be a preview.
		riskLevel: 'safe-add',
		explicitOnly: true,
		canFixDrift: true,
		async run({ skillsDir, forceSkills, assumeYes }) {
			const dir = await resolveInstallDir(skillsDir, assumeYes)
			if (!dir) return { filesWritten: [] }
			const filesWritten: string[] = []
			for (const name of SHIPPED_SKILLS) {
				const result = await installClaudeSkill(dir, name, { force: forceSkills })
				if (result.status === 'declined-downgrade') {
					console.error(
						chalk.yellow(
							`   skipped — ${result.file} is at ${result.installedVersion}, newer than the ${result.shippedVersion} this package ships`
						)
					)
					continue
				}
				if (result.status === 'declined-fork') {
					// Name `realFile`: through a stow symlink the overwrite would land in a
					// *second* repo's working tree, and that is the path to look at (#480).
					for (const line of describeSkillFork(result)) console.error(chalk.yellow(`   ${line}`))
					continue
				}
				if (result.status === 'up-to-date') continue
				// Report the resolved real path when the skill is a stow symlink: the bytes
				// landed in a dotfiles checkout, and that is where the user has to commit them.
				if (result.viaSymlink) {
					console.error(chalk.dim(`   wrote through a symlink — commit ${result.realFile}`))
				}
				filesWritten.push(result.realFile)
			}
			return { filesWritten }
		},
	},
	{
		target: 'cursor-rules',
		description: 'Install the repo-tooling rules for Cursor (.cursor/rules/repo-tooling.mdc)',
		appliesTo: ['Cursor rules'],
		outputs: ['.cursor/rules/repo-tooling.mdc'],
		riskLevel: 'safe-add',
		canFixDrift: true,
		async run({ targetDir }) {
			const written = await installAgentRules(targetDir, 'cursor')
			return { filesWritten: [written] }
		},
	},
	{
		target: 'copilot-instructions',
		description:
			'Install the repo-tooling rules for GitHub Copilot (.github/copilot-instructions.md)',
		appliesTo: ['Copilot instructions'],
		outputs: ['.github/copilot-instructions.md'],
		// Upserts a delimited block — never clobbers the consumer's own instructions.
		riskLevel: 'safe-merge',
		canFixDrift: true,
		async run({ targetDir }) {
			const written = await installAgentRules(targetDir, 'copilot')
			return { filesWritten: [written] }
		},
	},
	{
		target: 'agents-md',
		description: 'Install the repo-tooling rules into AGENTS.md (universal agent instructions)',
		appliesTo: ['AGENTS.md rules'],
		outputs: ['AGENTS.md'],
		// Upserts a delimited block — never clobbers existing AGENTS.md content.
		riskLevel: 'safe-merge',
		canFixDrift: true,
		async run({ targetDir }) {
			const written = await installAgentRules(targetDir, 'agents-md')
			return { filesWritten: [written] }
		},
	},
]
