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
import chalk from 'chalk'
import { installAgentRules, installAiSetup } from '../cli/generators/agent-rules.js'
import { generateCommunityHealth } from '../cli/generators/community-health.js'
import { generateCommitlintConfig } from '../cli/generators/git.js'
import { generateCodeowners, generateEditorConfig } from '../cli/generators/misc.js'
import {
	generateCodeQLWorkflow,
	generateDependabotConfig,
	generateRenovateConfig,
} from '../cli/generators/security.js'
import { copyPreset } from '../cli/utils/copy-preset.js'
import { detectLanguage } from '../cli/utils/detect-language.js'
import type { Lockfile } from '../cli/utils/lockfile.js'
import { resolveLanguageModule } from '../languages/registry.js'
import { applyGithubSettings } from './github-settings.js'
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
	 * Advisories printed from here go to `console.error`, never `console.log`:
	 * stdout is the `--json` payload's channel and a stray line lands in the
	 * middle of it, breaking every parser downstream (#357). They're diagnostics,
	 * not results, so stderr is the right stream regardless of the flag.
	 */
	run(ctx: FixerContext): Promise<{ filesWritten: string[] }>
}

/** The repo's language module, resolved from its marker files. */
async function moduleFor(targetDir: string) {
	return resolveLanguageModule(await detectLanguage(targetDir))
}

export const BASE_FIXERS: Fixer[] = [
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
		target: 'ai',
		description:
			'Install all AI agent files at once (AGENTS.md, CLAUDE.md, Cursor, Copilot, Claude skill, MCP example)',
		appliesTo: ['AI setup'],
		outputs: [
			'AGENTS.md',
			'CLAUDE.md',
			'.cursor/rules/repo-tooling.mdc',
			'.github/copilot-instructions.md',
			'.claude/skills/repo-tooling.md',
			'.mcp.json.example',
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
