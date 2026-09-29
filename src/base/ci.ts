/**
 * Language-agnostic CI skeletons (#283).
 *
 * The *shell* of a pipeline — triggers, concurrency, the skip gate, job
 * scaffolding, stage derivation — is identical whether the repo is JS, Swift,
 * Perl or Python. Only the steps inside each job differ. This module owns the
 * shell; language modules (`src/languages/<id>/ci.ts`) supply the steps.
 *
 * Steps arrive pre-rendered rather than as a YAML AST: the generators' whole
 * job is emitting text, and a tree we'd immediately flatten buys nothing but a
 * serializer to maintain.
 */

/** Every job is gated on the skip-CI check; extra conditions are ANDed on. */
const SKIP_GUARD = "needs.check-skip.outputs.should-skip != 'true'"

/** A GitHub Actions job, minus the boilerplate the skeleton owns. */
export interface CiJob {
	/** YAML job id (`lint`, `build`, …). */
	id: string
	/** Runner label. Swift needs macOS for Xcode; everything else is happy on Linux. */
	runsOn?: string
	/** Jobs this one waits on. `check-skip` is appended automatically. */
	needs?: readonly string[]
	/** Extra condition ANDed with the skip gate. */
	if?: string
	/** Job-level keys rendered between `if:` and `steps:` (`outputs`, `permissions`). */
	extra?: string
	/** The `steps:` entries, already indented six spaces, no trailing newline. */
	steps: string
}

/** Header through `jobs:` — triggers and concurrency are language-independent. */
/** The generated CI workflow's `name:` — the docs workflow's `workflow_run` must match it. */
export const CI_WORKFLOW_NAME = '🚀 CI/CD Pipeline'

const WORKFLOW_HEADER = `name: ${CI_WORKFLOW_NAME}

on:
  push:
    branches: [main, release, develop]
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  # Never cancel on main: a newer push would kill a release that is waiting on
  # approval or halfway through publishing.
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

jobs:
`

/**
 * Honours `[ci skip]` / `[skip ci]` in the head commit message. Pure shell
 * plumbing — no toolchain involved, so every language shares it verbatim.
 */
const CHECK_SKIP_JOB = `  check-skip:
    runs-on: ubuntu-latest
    outputs:
      should-skip: \${{ steps.skip-check.outputs.should-skip }}
    steps:
      - name: Check for skip CI
        id: skip-check
        run: |
          if [[ "\${{ github.event.head_commit.message }}" =~ \\[(ci skip|skip ci)\\] ]]; then
            echo "should-skip=true" >> $GITHUB_OUTPUT
          else
            echo "should-skip=false" >> $GITHUB_OUTPUT
          fi`

function renderJob(job: CiJob): string {
	// A lone dependency stays a scalar (`needs: check-skip`) — that's the form
	// the hand-written workflows used, and Actions treats both identically.
	const needs = [...(job.needs ?? []), 'check-skip']
	const needsYaml = needs.length === 1 ? needs[0] : `[${needs.join(', ')}]`
	const condition = job.if ? `${SKIP_GUARD} && ${job.if}` : SKIP_GUARD

	return `  ${job.id}:
    runs-on: ${job.runsOn ?? 'ubuntu-latest'}
    needs: ${needsYaml}
    if: ${condition}
${job.extra ? `${job.extra}\n` : ''}    steps:
${job.steps}`
}

/** Wrap language-supplied jobs in the shared workflow shell. */
export function renderGitHubWorkflow(jobs: readonly CiJob[]): string {
	return `${WORKFLOW_HEADER}${[CHECK_SKIP_JOB, ...jobs.map(renderJob)].join('\n\n')}\n`
}

/**
 * The CodeQL workflow. Only the matrix languages vary, so the whole file lives
 * here and each language module contributes its `codeqlLanguages`.
 */
export function renderCodeQLWorkflow(languages: readonly string[]): string {
	return `name: CodeQL

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1'

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write

    strategy:
      fail-fast: false
      matrix:
        language: [${languages.join(', ')}]

    steps:
      - name: Checkout
        uses: actions/checkout@v7

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: \${{ matrix.language }}

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
        with:
          category: "/language:\${{ matrix.language }}"
`
}

/** A GitLab CI job. Reachable to callers as `GitLabSpec['jobs']`. */
interface GitLabJob {
	/** YAML job id (`lint`, `build`, …). */
	id: string
	stage: string
	script: readonly string[]
	/** Job-level YAML appended after `script` (artifacts, rules), indented two spaces. */
	extra?: string
}

export interface GitLabSpec {
	/** Runner image for the whole pipeline. */
	image: string
	/** Everything between `stages:` and the jobs — variables, cache, `default`. */
	preamble: string
	jobs: readonly GitLabJob[]
}

/**
 * Wrap language-supplied jobs in the shared `.gitlab-ci.yml` shell. Stages are
 * derived from the jobs in first-appearance order, so a language module never
 * has to keep a stage list in sync with the jobs it emits.
 */
export function renderGitLabCI({ image, preamble, jobs }: GitLabSpec): string {
	const stages = [...new Set(jobs.map((job) => job.stage))]
	// A pipeline with no jobs still needs a valid `stages:` key.
	if (stages.length === 0) stages.push('test')

	const blocks = jobs.map(
		(job) => `${job.id}:
  stage: ${job.stage}
  script:
${job.script.map((line) => `    - ${line}`).join('\n')}${job.extra ? `\n${job.extra}` : ''}`
	)

	return `# .gitlab-ci.yml — generated by @rtorcato/repo-tooling
# Customize stages and jobs to fit your pipeline.

image: ${image}

stages:
${stages.map((s) => `  - ${s}`).join('\n')}

${[preamble, ...blocks].join('\n\n')}
`
}
