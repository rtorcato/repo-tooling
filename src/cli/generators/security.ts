import path from 'node:path'
import fs from 'fs-extra'
import { renderCodeQLWorkflow } from '../../base/ci.js'
import { LANGUAGES } from '../../languages/registry.js'

/**
 * The canonical dependency-update standard shared by every @rtorcato repo.
 *
 * `ecosystem` is the language's Dependabot `package-ecosystem` (#303) — null
 * for a language Dependabot doesn't support, which drops the manifest block and
 * leaves only the github-actions one.
 */
export function dependabotConfig(ecosystem: string | null): string {
	const manifest =
		ecosystem === null
			? ''
			: `  - package-ecosystem: ${ecosystem}
    directory: /
    schedule:
      interval: monthly
      time: "06:00"
      timezone: Etc/UTC
    # Let brand-new releases settle before opening a PR — keeps grouped bumps
    # from tripping pnpm's minimumReleaseAge supply-chain check (a same-day
    # release fails the frozen-lockfile install in CI).
    cooldown:
      default-days: 7
    open-pull-requests-limit: 5
    versioning-strategy: increase
    commit-message:
      prefix: chore
      include: scope
    groups:
      # Safe tier: runtime + dev minor/patch auto-merge on green (see the
      # dependabot-automerge workflow). Grouped so react/react-dom move together.
      production-minor:
        dependency-type: production
        update-types:
          - minor
          - patch
      dev-minor:
        dependency-type: development
        update-types:
          - minor
          - patch
      # Majors batch into one PR per ecosystem — breaking by definition, so
      # never auto-merged; triaged on the monthly cadence.
      major-updates:
        update-types:
          - major

`

	return `version: 2
updates:
${manifest}  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
    commit-message:
      prefix: ci
      include: scope
`
}

/** The JS flavour — the historical default, kept for the generators that don't
 * resolve a language module. */
export const DEPENDABOT_CONFIG = dependabotConfig('npm')

/** Where `.github/dependabot.yml` can live, in the order Dependabot resolves it. */
export const DEPENDABOT_CONFIG_PATHS = [
	'.github/dependabot.yml',
	'.github/dependabot.yaml',
] as const

/**
 * The `ignore:` rules an existing dependabot.yml carries, named by
 * `dependency-name` (#422).
 *
 * `dependabotConfig()` owns the whole file but emits no `ignore:` block, and
 * `ignore` is precisely the key that is inherently repo-local — a pin held back
 * by hand, with the reason usually in a comment above it. So every rule this
 * finds is one a regeneration would delete silently.
 *
 * ponytail: a line scanner, not a YAML parse — the repo ships no YAML parser and
 * this only needs to answer "is there something here to lose, and what is it
 * called". A rule split across lines (`-` alone, `dependency-name` beneath)
 * reports as `<unnamed rule>`, which still stops the overwrite. Reach for a
 * parser if the message ever has to reproduce the rules rather than name them.
 */
export function dependabotIgnoreRules(content: string): string[] {
	const lines = content.split('\n')
	const rules: string[] = []

	for (const [index, line] of lines.entries()) {
		const header = /^(\s*)ignore:\s*(#.*)?$/.exec(line)
		if (!header) continue
		const blockIndent = (header[1] ?? '').length

		// Rules sit at the first list indent under `ignore:`; deeper `- ` lines are
		// an entry's own values (`update-types:`) and must not count as rules.
		let itemIndent: number | null = null
		const names: string[] = []
		let items = 0

		for (const next of lines.slice(index + 1)) {
			if (next.trim() === '') continue
			const indent = next.search(/\S/)
			if (indent <= blockIndent) break

			if (/^\s*-\s/.test(next)) {
				itemIndent ??= indent
				if (indent === itemIndent) items++
			}
			const named = /(?:^|\s)dependency-name:\s*["']?([^"'#\s]+)/.exec(next)
			if (named?.[1] && (itemIndent === null || indent >= itemIndent)) names.push(named[1])
		}

		while (names.length < items) names.push('<unnamed rule>')
		rules.push(...names)
	}

	return rules
}

/**
 * Auto-merges patch + minor Dependabot PRs once CI is green. Requires branch
 * protection with required status checks on the target branch — without it,
 * \`gh pr merge --auto\` never fires. Majors are excluded (they land in the
 * major-updates group for manual triage).
 */
export const DEPENDABOT_AUTOMERGE_WORKFLOW = `name: Dependabot auto-merge

on: pull_request

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    steps:
      - name: Fetch Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@v3
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}

      - name: Auto-merge patch and minor updates
        if: |
          steps.metadata.outputs.update-type == 'version-update:semver-patch' ||
          steps.metadata.outputs.update-type == 'version-update:semver-minor'
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: \${{ github.event.pull_request.html_url }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`

/** Relative paths this generator owns, in a stable order for \`filesWritten\`. */
export const DEPENDABOT_FILES = [
	'.github/dependabot.yml',
	'.github/workflows/dependabot-automerge.yml',
] as const

/**
 * The repo-local `ignore:` rules a regeneration would delete, with the file
 * they live in — or null when there is nothing to lose (#422).
 */
export async function findDependabotIgnoreRules(
	targetDir: string
): Promise<{ file: string; rules: string[] } | null> {
	for (const file of DEPENDABOT_CONFIG_PATHS) {
		const candidate = path.join(targetDir, file)
		if (!(await fs.pathExists(candidate))) continue
		const rules = dependabotIgnoreRules(await fs.readFile(candidate, 'utf8'))
		return rules.length > 0 ? { file, rules } : null
	}
	return null
}

/**
 * Scaffold the canonical Dependabot setup: the grouped \`dependabot.yml\` **and**
 * the auto-merge workflow. They're a paired unit — the config batches updates
 * into a safe tier and a major tier, and the workflow merges the safe tier on
 * green. See \`apps/docs/docs/guides/dependabot-strategy.md\`.
 */
export async function generateDependabotConfig(
	targetDir: string,
	ecosystem: string | null = 'npm'
) {
	await fs.ensureDir(path.join(targetDir, '.github', 'workflows'))
	await fs.writeFile(path.join(targetDir, '.github', 'dependabot.yml'), dependabotConfig(ecosystem))
	await fs.writeFile(
		path.join(targetDir, '.github', 'workflows', 'dependabot-automerge.yml'),
		DEPENDABOT_AUTOMERGE_WORKFLOW
	)
	return [...DEPENDABOT_FILES]
}

export async function generateRenovateConfig(targetDir: string) {
	const filepath = path.join(targetDir, 'renovate.json')

	const content = `${JSON.stringify(
		{
			$schema: 'https://docs.renovatebot.com/renovate-schema.json',
			extends: ['config:recommended', ':semanticCommits', ':semanticCommitTypeAll(chore)'],
			schedule: ['before 4am on Monday'],
			prConcurrentLimit: 10,
			prHourlyLimit: 0,
			rangeStrategy: 'bump',
			packageRules: [
				{
					matchManagers: ['github-actions'],
					commitMessagePrefix: 'chore(ci):',
				},
				{
					matchManagers: ['npm'],
					commitMessagePrefix: 'chore(deps):',
				},
			],
		},
		null,
		2
	)}\n`

	await fs.writeFile(filepath, content)
}

/**
 * Scaffold `.github/workflows/codeql.yml` for the given CodeQL languages,
 * defaulting to the JS module's matrix (#283).
 *
 * Returns the files written — empty when the language has no CodeQL support at
 * all (Perl), since a workflow with an empty matrix would fail every run.
 */
export async function generateCodeQLWorkflow(
	targetDir: string,
	languages: readonly string[] = LANGUAGES.js.codeqlLanguages
): Promise<string[]> {
	if (languages.length === 0) return []

	await fs.ensureDir(path.join(targetDir, '.github', 'workflows'))
	const filepath = path.join(targetDir, '.github', 'workflows', 'codeql.yml')
	await fs.writeFile(filepath, renderCodeQLWorkflow(languages))
	return ['.github/workflows/codeql.yml']
}

export async function generateSecurityConfigs(targetDir: string) {
	await generateDependabotConfig(targetDir)
	await generateCodeQLWorkflow(targetDir)
}
