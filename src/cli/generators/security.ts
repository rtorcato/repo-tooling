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
      # Runtime minor/patch. Grouped so react/react-dom move together, but NOT
      # auto-merged — these ship to consumers of a published package, so they
      # get a human (see the dependabot-automerge workflow).
      production-minor:
        dependency-type: production
        update-types:
          - minor
          - patch
      # The tier that can auto-merge on green. "development" is Dependabot's
      # classification, not a safety property: a package listed in both
      # devDependencies and peerDependencies lands here, and peer deps are part
      # of a published package's contract (#458). The auto-merge workflow
      # re-checks every name against the manifests rather than trusting this.
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
 * Auto-merges patch + minor Dependabot PRs from the \`dev-minor\` group **and the
 * \`github-actions\` ecosystem** once CI is green. Requires branch protection with
 * required status checks on the target branch — without it, \`gh pr merge --auto\`
 * never fires.
 *
 * Everything else falls through to a human: production bumps ship to consumers
 * of a published package (#423), majors are breaking by definition, and an
 * ungrouped npm PR reports an empty \`dependency-group\`, so the gate fails closed.
 *
 * CI action bumps are the one ungrouped case that is allowed through, matched on
 * \`package-ecosystem\` (#452): they reach no consumer of the published package
 * and land as \`ci(deps): …\`, which cuts no release. The counter-argument is real
 * — a compromised action runs in CI holding \`GITHUB_TOKEN\` — so the majors
 * exclusion and required status checks are doing the work here.
 *
 * The group name is the one \`dependabotConfig()\` writes — the two files are a
 * paired unit and have to move together.
 *
 * **The group name alone is not enough** (#458). Dependabot classifies a package
 * listed in both \`devDependencies\` and \`peerDependencies\` as *development*, so
 * it lands in \`dev-minor\` — and \`peerDependencies\` are part of what a published
 * package hands its consumers. This repo had 32 such packages, and 13 of them
 * rode a single "dev-only" group PR. So the workflow resolves every bumped name
 * against the tracked manifests and stands down if any of them ships.
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

      - uses: actions/checkout@v7

      # The group name is Dependabot's opinion, not a safety property: a package
      # in both devDependencies and peerDependencies is classified "development"
      # and lands in dev-minor, while peerDependencies ship to consumers of a
      # published package (#458). So resolve every bumped name against the
      # tracked manifests and stand down if any of them reaches a consumer.
      #
      # npm-specific by design. A repo with no package.json (Swift, Python) finds
      # nothing here and falls back to the group + semver gate below.
      - name: Check whether any bumped package ships to consumers
        id: gate
        env:
          NAMES: \${{ steps.metadata.outputs.dependency-names }}
        run: |
          set -euo pipefail

          # A private workspace publishes nothing, so its deps reach nobody.
          ships=$(git ls-files -- 'package.json' '*/package.json' | while read -r f; do
            if [ "$(jq -r '.private // false' "$f")" = 'true' ]; then continue; fi
            jq -r '((.dependencies // {}) + (.optionalDependencies // {}) + (.peerDependencies // {})) | keys[]' "$f"
          done | sort -u)

          safe=true
          # No names reported means we cannot verify anything — fail closed.
          if [ -z "\${NAMES//[, ]/}" ]; then
            echo "::notice::no dependency names reported — leaving this PR for a human"
            safe=false
          fi
          for name in \${NAMES//,/ }; do
            if printf '%s\\n' "$ships" | grep -qxF -- "$name"; then
              echo "::notice::$name ships to consumers — leaving this PR for a human"
              safe=false
              break
            fi
          done
          echo "safe=$safe" >> "$GITHUB_OUTPUT"

      # Belt and braces: the dev-minor group is already declared minor+patch in
      # dependabot.yml, but this workflow is the security gate and shouldn't
      # trust a config file a consumer repo can edit independently.
      #
      # github-actions bumps are ungrouped, so they report an empty
      # dependency-group and are matched by ecosystem instead (#452). They reach
      # no consumer of the published package, and their squash subject is
      # "ci(deps): …", which cuts no release. Majors still fall through to a
      # human — the update-type clause below applies to them too.
      - name: Auto-merge dev-dependency and CI action patch and minor updates
        if: |
          steps.gate.outputs.safe == 'true' &&
          (steps.metadata.outputs.dependency-group == 'dev-minor' ||
          steps.metadata.outputs.package-ecosystem == 'github-actions') &&
          (steps.metadata.outputs.update-type == 'version-update:semver-patch' ||
          steps.metadata.outputs.update-type == 'version-update:semver-minor')
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
