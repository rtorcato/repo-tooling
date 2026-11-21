/**
 * The JavaScript/TypeScript module's CI contribution (#283): the pnpm/Node
 * steps that used to be baked into the generators' template literals.
 *
 * Everything here is Node-specific — `setup-node`, `pnpm install`, the
 * pnpm-store cache, the `pnpm <script>` commands. The shell around it lives in
 * `src/base/ci.ts` and is shared with Swift/Perl/Python (#287/#289/#290).
 */
import { pinActions } from '../../base/action-pins.js'
import {
	CHANGESET_JOB,
	type CiJob,
	type GitLabSpec,
	RELEASE_JOB_GATE,
	RELEASE_WORKFLOW_HEADER,
	renderGitHubWorkflow,
} from '../../base/ci.js'
import type { ProjectConfig } from '../../cli/commands/setup.js'

/** CI runs the tests with coverage when Vitest is the test runner. */
function usesCoverage(config: ProjectConfig): boolean {
	// Vite+ ships no coverage provider; `pnpm test` is its one test command (#897).
	return config.testing.framework === 'vitest' && !config.vitePlus
}

/** The package.json script the lint job runs — `check` under Biome, else `lint`. */
function lintScript(config: ProjectConfig): string {
	// `vp check` is Vite+'s lint, format and type check in one (#897).
	return config.vitePlus || config.linting.tool === 'biome' || config.linting.tool === 'both'
		? 'check'
		: 'lint'
}

function lintCommand(config: ProjectConfig): string {
	return `pnpm ${lintScript(config)}`
}

/**
 * Checkout → Node → pnpm → restore the cache the `dependencies` job primed.
 * Identical in every downstream job, so it's one const rather than five copies.
 */
const SETUP_STEPS = `      - name: 📦 Checkout repository
        uses: actions/checkout@v7

      - name: 📦 Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc

      - name: 📦 Setup pnpm
        uses: pnpm/action-setup@v6

      - name: 📦 Restore dependencies cache
        uses: actions/cache@v6
        with:
          path: |
            ~/.pnpm-store
            node_modules
          key: \${{ needs.dependencies.outputs.cache-key }}`

/** Primes the pnpm store + node_modules cache every other job restores. */
const DEPENDENCIES_JOB: CiJob = {
	id: 'dependencies',
	extra: `    outputs:
      cache-key: \${{ steps.cache-key.outputs.key }}`,
	steps: `      - name: 📦 Checkout repository
        uses: actions/checkout@v7

      - name: 📦 Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc

      - name: 📦 Setup pnpm
        uses: pnpm/action-setup@v6

      - name: 📦 Generate cache key
        id: cache-key
        run: echo "key=\${{ runner.os }}-pnpm-\${{ hashFiles('**/pnpm-lock.yaml') }}" >> $GITHUB_OUTPUT

      - name: 📦 Cache dependencies
        uses: actions/cache@v6
        with:
          path: |
            ~/.pnpm-store
            node_modules
          key: \${{ steps.cache-key.outputs.key }}
          restore-keys: |
            \${{ runner.os }}-pnpm-

      - name: 📦 Install dependencies
        run: pnpm install --frozen-lockfile`,
}

/**
 * The repo's `package.json` scripts, when we have a real one to read (#364).
 *
 * `setup` renders a workflow for a project it is about to *create*, so every
 * script it references is one it also writes. `fix github-actions` renders one
 * for a project that already exists and may have none of them: the generated
 * pipeline called `pnpm check`, `pnpm knip` and `pnpm coverage` on repos where
 * no target had created those scripts, and died with ERR_PNPM_RECURSIVE_EXEC.
 *
 * Undefined means "assume the setup shape" — omitting the steps there would
 * drop them from a project whose scripts simply don't exist yet.
 */
export interface JobOptions {
	scripts?: Record<string, string>
	/** The package declares a `bin`, so CI smoke-tests the packed tarball (#693). */
	bin?: boolean
	/**
	 * The `environment:` the existing release job declares — in release.yml, or
	 * in a pre-#753 ci.yml being migrated. Carried into the regenerated release
	 * workflow so `fix github-actions` never strips the publish gate that
	 * `fix release-environment` added (#740). Absent, the job still declares
	 * `release` (#785): a trusted publisher registered with an environment
	 * rejects a job without one, and GitHub creates it unprotected on first use.
	 */
	releaseEnvironment?: string | null
	/**
	 * The repo has `@commitlint/cli` installed. Undefined means the setup shape,
	 * which installs it whenever `commitLint` is on.
	 */
	commitlint?: boolean
	/**
	 * The `engines.node` floor major, the low end of the test matrix (#816).
	 * Undefined means the setup shape, which writes `>=`{@link DEFAULT_NODE_FLOOR}.
	 */
	nodeFloor?: number
}

/**
 * The newest Node major, the high end of every test matrix (#816).
 * ponytail: a constant; bump it when a new even major ships.
 */
export const NEWEST_NODE = 26

/** The floor `setup` writes into `engines.node`, assumed when a repo declares none. */
const DEFAULT_NODE_FLOOR = 22

/** `JobOptions.nodeFloor` for a real repo: the first integer in `engines.node`. */
export function nodeFloorOf(pkg: Record<string, unknown> | null): number | undefined {
	const range = (pkg?.engines as Record<string, string> | undefined)?.node
	const m = range?.match(/\d+/)
	return m ? Number.parseInt(m[0], 10) : undefined
}

/**
 * The Node majors CI tests on (#816): the floor the package promises and the
 * newest Node, nothing between. Breaks show up at the ends of the range, so the
 * middle costs runner minutes to re-prove them absent. A floor at or past the
 * newest collapses to one entry.
 */
export function nodeMatrix(floor = DEFAULT_NODE_FLOOR): number[] {
	return floor >= NEWEST_NODE ? [floor] : [floor, NEWEST_NODE]
}

/** `JobOptions.bin` for a real repo. */
export function hasBin(pkg: Record<string, unknown> | null): boolean {
	return Boolean(pkg?.bin)
}

/** `JobOptions.commitlint` for a real repo; undefined without a package.json. */
export function hasCommitlint(pkg: Record<string, unknown> | null): boolean | undefined {
	if (!pkg) return undefined
	const deps = {
		...(pkg.dependencies as Record<string, string> | undefined),
		...(pkg.devDependencies as Record<string, string> | undefined),
	}
	return '@commitlint/cli' in deps
}

/**
 * On a PR, lint the title plus ` (#N)` — exactly the header a squash merge
 * commits — so an over-long title fails before merge, not on main (#777). The
 * title arrives through `env:`, never `${{ }}` inside `run:`: anyone opening a
 * PR controls it. On a push, lint the commit that landed.
 */
const COMMITLINT_STEP = `      - name: 🔍 Validate commit messages
        env:
          EVENT: \${{ github.event_name }}
          PR_TITLE: \${{ github.event.pull_request.title }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
        run: |
          if [ "$EVENT" = "pull_request" ]; then
            printf '%s (#%s)\\n' "$PR_TITLE" "$PR_NUMBER" | npx commitlint
          else
            git log -1 --pretty=format:"%s" | npx commitlint
          fi`

/**
 * A Changesets repo fails a PR that changes published source with no changeset
 * (#968), or the change merges and never ships. Runs on PRs only, and not on
 * the Version Packages PR, which consumes changesets. A title whose type
 * releases nothing (docs, chore, …) skips; `pnpm changeset --empty` is the
 * escape hatch for anything else. Diffs the merge commit against its first
 * parent, the base it merges into. The title arrives through `env:` (#777).
 * ponytail: "published source" is `src/` and `packages/<name>/src/`; read
 * package.json `files` if a repo publishes from elsewhere.
 */
const CHANGESET_JOB_DEF: CiJob = {
	id: CHANGESET_JOB,
	if: "github.event_name == 'pull_request' && !startsWith(github.head_ref, 'changeset-release/')",
	extra: `    permissions:
      contents: read`,
	steps: `      - name: 📦 Checkout repository
        uses: actions/checkout@v7
        with:
          fetch-depth: 2

      - name: 🦋 Require a changeset for published source
        env:
          PR_TITLE: \${{ github.event.pull_request.title }}
        run: |
          if printf '%s' "$PR_TITLE" | grep -Eq '^(docs|chore|ci|test|build|style|refactor)(\\([^)]*\\))?:'; then
            echo "Skipped: the PR title's type releases nothing"
            exit 0
          fi
          if ! git diff --name-only HEAD^1 HEAD | grep -Eq '^(src|packages/[^/]+/src)/'; then
            echo "No published source changed"
            exit 0
          fi
          if git diff --name-only --diff-filter=A HEAD^1 HEAD -- '.changeset/*.md' | grep -qv '^\\.changeset/README\\.md$'; then
            echo "Changeset found"
            exit 0
          fi
          echo "::error::This PR changes published source but adds no changeset. Run 'pnpm changeset' and commit the file, or 'pnpm changeset --empty' if it releases nothing."
          exit 1`,
}

/**
 * `JobOptions.scripts` for a real repo. A package.json with no `scripts` block
 * yields `{}` — "this repo has no scripts", which gates every step off —
 * whereas no package.json at all yields undefined, the setup shape.
 */
export function scriptsOf(pkg: Record<string, unknown> | null): Record<string, string> | undefined {
	if (!pkg) return undefined
	return (pkg.scripts as Record<string, string> | undefined) ?? {}
}

/** The repo defines this script — or we have no scripts to check it against. */
function hasScript(opts: JobOptions, script: string): boolean {
	return !opts.scripts || script in opts.scripts
}

/**
 * A bundler, or a known `build` script — a plain-`tsc` repo records `bundler:
 * 'none'` (#661) but still has a build to run.
 */
function buildsSomething(config: ProjectConfig, opts: JobOptions): boolean {
	return config.bundler !== 'none' || (opts.scripts !== undefined && 'build' in opts.scripts)
}

/** Emit a step only when the script it runs exists (or we can't know yet). */
function stepFor(opts: JobOptions, script: string, step: string): string | null {
	return hasScript(opts, script) ? step : null
}

/** Join the steps that survived gating onto the shared setup preamble. */
function jobSteps(steps: (string | null)[]): string | null {
	const kept = steps.filter((s): s is string => s !== null)
	return kept.length > 0 ? [SETUP_STEPS, ...kept].join('\n\n') : null
}

/** Installs the packed tarball somewhere else and runs its bin (#693). */
const PACK_SMOKE_STEP = `      - name: 📦 Smoke-test the packed tarball
        run: |
          set -e
          BIN=$(node -p "const p=require('./package.json');typeof p.bin==='string'?p.name.split('/').pop():Object.keys(p.bin)[0]")
          TARBALL="$PWD/$(npm pack --silent | tail -n1)"
          tar -tzf "$TARBALL" | grep -q . || { echo "::error::npm pack produced an empty tarball"; exit 1; }
          SMOKE=$(mktemp -d)
          cd "$SMOKE" && npm init -y >/dev/null && npm install "$TARBALL"
          ./node_modules/.bin/"$BIN" --version`

/**
 * The GitHub Actions CI jobs for a JS repo, in workflow order. The release is
 * not one of them — it is its own workflow, `renderReleaseWorkflow` (#753).
 */
export function githubJobs(config: ProjectConfig, opts: JobOptions = {}): CiJob[] {
	// `vp check` already type-checks, so a Vite+ repo has no separate typecheck job.
	const hasTypeScript = config.typescript.enabled && !config.vitePlus
	const hasTests = config.testing.framework !== 'none'
	const hasBuild = buildsSomething(config, opts)
	const isLibrary = config.projectType === 'library'
	const hasCoverage = usesCoverage(config)

	const jobs: CiJob[] = [DEPENDENCIES_JOB]

	const lintSteps = jobSteps([
		stepFor(
			opts,
			lintScript(config),
			`      - name: 🔍 Run linting
        run: ${lintCommand(config)}`
		),
		stepFor(
			opts,
			'knip',
			`      - name: 🧹 Check for unused files, exports, and dependencies
        run: pnpm knip`
		),
	])
	if (lintSteps) {
		jobs.push({ id: 'lint', needs: ['dependencies'], steps: lintSteps })
	}

	if (config.commitLint && opts.commitlint !== false) {
		jobs.push({
			id: 'commitlint',
			needs: ['dependencies'],
			steps: `${SETUP_STEPS}\n\n${COMMITLINT_STEP}`,
		})
	}

	if (config.changesets) jobs.push(CHANGESET_JOB_DEF)

	if (hasTypeScript) {
		const steps = jobSteps([
			stepFor(
				opts,
				'typecheck',
				`      - name: 🔍 Type check
        run: pnpm typecheck`
			),
		])
		if (steps) jobs.push({ id: 'typecheck', needs: ['dependencies'], steps })
	}

	if (hasTests) {
		// Fall back to `pnpm test` when the repo has no coverage script.
		const useCoverage = hasCoverage && (!opts.scripts || 'coverage' in opts.scripts)
		const steps = jobSteps([
			stepFor(
				opts,
				useCoverage ? 'coverage' : 'test',
				`      - name: 🧪 Run tests
        run: ${useCoverage ? 'pnpm coverage' : 'pnpm test'}`
			),
		])
		if (steps) {
			jobs.push({
				id: 'test',
				needs: ['dependencies'],
				// Reports as `test (22)`, `test (26)`; protection requires only the `ci`
				// gate, so changing these legs never touches it (#816).
				extra: `    strategy:
      fail-fast: false
      matrix:
        node: [${nodeMatrix(opts.nodeFloor).join(', ')}]`,
				steps: steps.replace('node-version-file: .nvmrc', 'node-version: ${{ matrix.node }}'),
			})
		}
	}

	if (hasBuild && (!opts.scripts || 'build' in opts.scripts)) {
		// attw and publint validate what's about to be published — libraries only.
		const attw =
			isLibrary && (!opts.scripts || 'attw' in opts.scripts)
				? '\n      - name: 🔍 Validate type resolution (are-the-types-wrong)\n        run: pnpm attw\n'
				: ''
		const publint = config.publint
			? '\n      - name: 🔍 Validate package with publint\n        run: pnpm exec publint --strict\n'
			: ''
		// npm's own `bin[…] invalid and removed` warning and a bin pnpm never
		// links both hide until the tarball is installed somewhere else (#693).
		const packSmoke = opts.bin ? `\n${PACK_SMOKE_STEP}\n` : ''
		jobs.push({
			id: 'build',
			needs: ['dependencies'],
			steps: `${SETUP_STEPS}

      - name: 🏗️ Build project
        run: pnpm build
${attw}${publint}${packSmoke}
      - name: 📦 Upload build artifacts
        uses: actions/upload-artifact@v7
        with:
          name: build-artifacts
          path: |
            dist/
            package.json
            README.md
          retention-days: 7`,
		})
	}

	return jobs
}

/**
 * The reusable workflow's path (#1037). Callers reference it as
 * `rtorcato/repo-tooling/.github/workflows/js-ci.yml@<full sha> # vX.Y.Z`.
 */
export const REUSABLE_JS_CI_WORKFLOW = '.github/workflows/js-ci.yml'
const REUSABLE_JS_CI_USES = `rtorcato/repo-tooling/${REUSABLE_JS_CI_WORKFLOW}`

/**
 * The commit of this repo whose `js-ci.yml` generated callers pin (#1037), or
 * null while none is known. A caller must pin a full commit SHA, never `@main`,
 * and that SHA exists only once the workflow has merged — so the PR that adds
 * the workflow cannot carry it. Until a follow-up sets it, the generator keeps
 * emitting the inline pipeline. Set it to the merge commit that last changed
 * `js-ci.yml`, with that release's version for the comment; Dependabot's
 * github-actions ecosystem bumps it in every repo that scaffolded a caller.
 */
export const REUSABLE_JS_CI_PIN: { sha: string; version: string } | null = null

/** `uses:` pin for the reusable workflow, in the `<sha> # vX.Y.Z` form Dependabot reads. */
function reusableUses(pin: { sha: string; version: string }): string {
	return `${REUSABLE_JS_CI_USES}@${pin.sha} # v${pin.version.replace(/^v/, '')}`
}

/**
 * The reusable JS CI workflow (#1037): the read-only jobs `githubJobs` renders
 * inline — dependencies, lint, commitlint, changeset check, typecheck, test
 * matrix, build — behind `workflow_call` inputs. Rendered from the same step
 * constants as the inline pipeline so the two cannot drift; a test keeps the
 * committed `.github/workflows/js-ci.yml` equal to this output.
 *
 * Read-only by construction: `contents: read`, no `secrets:` block, so a caller
 * cannot hand it a secret and `secrets: inherit` has nothing to inherit. Triggers,
 * concurrency, the skip gate and the final `ci` check stay in the caller, so the
 * required check keeps its name and branch protection needs no edit. Script
 * names reach `run:` through `env:`, never `${{ }}` inside the script.
 */
export function renderReusableJsCiWorkflow(): string {
	const setupNode = SETUP_STEPS.replace(
		'node-version-file: .nvmrc',
		'node-version-file: ${{ inputs.node-version-file }}'
	)
	const setup = (extra = '') => `${setupNode}${extra}`
	return pinActions(`name: Reusable JS CI

# Reusable CI for pnpm/Node repos (rtorcato/repo-tooling#1037). Generated by
# \`renderReusableJsCiWorkflow\` in src/languages/js/ci.ts; edit the generator, not
# this file. Call it from a thin ci.yml and pin a full commit SHA, never @main:
#
#   jobs:
#     checks:
#       needs: check-skip
#       permissions: { contents: read }
#       uses: ${REUSABLE_JS_CI_USES}@<full sha> # vX.Y.Z
#       with:
#         changesets: true
#
# The caller owns \`on:\`, \`concurrency:\`, the skip check and a final \`ci\` job that
# needs the \`uses:\` job, so the required check stays named \`ci\`. Pass no secrets.
on:
  workflow_call:
    inputs:
      node-version-file:
        description: 'File setup-node reads the Node version from'
        type: string
        default: .nvmrc
      node-matrix:
        description: 'JSON array of Node majors the test job runs on'
        type: string
        default: '${JSON.stringify(nodeMatrix())}'
      lint-script:
        description: 'package.json script the lint job runs; empty skips it'
        type: string
        default: check
      knip:
        description: 'Run pnpm knip in the lint job'
        type: boolean
        default: false
      typecheck:
        description: 'Run the typecheck job (pnpm typecheck)'
        type: boolean
        default: true
      test-script:
        description: 'package.json script the test job runs; empty skips it'
        type: string
        default: test
      build:
        description: 'Run the build job (pnpm build, then upload the build artifacts)'
        type: boolean
        default: true
      attw:
        description: 'Validate type resolution in the build job (pnpm attw)'
        type: boolean
        default: false
      publint:
        description: 'Validate the package in the build job (publint --strict)'
        type: boolean
        default: false
      pack-smoke:
        description: 'Install the packed tarball and run its bin in the build job'
        type: boolean
        default: false
      commitlint:
        description: 'Lint the PR title, or the pushed commit'
        type: boolean
        default: false
      changesets:
        description: 'On a PR, require a changeset when published source changed'
        type: boolean
        default: false

# Least privilege: nothing here writes. A caller cannot grant more than it holds.
permissions:
  contents: read

jobs:
  dependencies:
    runs-on: ubuntu-latest
${DEPENDENCIES_JOB.extra}
    steps:
${DEPENDENCIES_JOB.steps.replace('node-version-file: .nvmrc', 'node-version-file: ${{ inputs.node-version-file }}')}

  lint:
    needs: dependencies
    if: \${{ inputs.lint-script != '' || inputs.knip }}
    runs-on: ubuntu-latest
    steps:
${setup(`

      - name: 🔍 Run linting
        if: \${{ inputs.lint-script != '' }}
        env:
          SCRIPT: \${{ inputs.lint-script }}
        run: pnpm run "$SCRIPT"

      - name: 🧹 Check for unused files, exports, and dependencies
        if: \${{ inputs.knip }}
        run: pnpm knip`)}

  commitlint:
    needs: dependencies
    if: \${{ inputs.commitlint }}
    runs-on: ubuntu-latest
    steps:
${setup(`\n\n${COMMITLINT_STEP}`)}

  ${CHANGESET_JOB}:
    if: \${{ inputs.changesets && github.event_name == 'pull_request' && !startsWith(github.head_ref, 'changeset-release/') }}
    runs-on: ubuntu-latest
${CHANGESET_JOB_DEF.steps.replace(/^/, '    steps:\n')}

  typecheck:
    needs: dependencies
    if: \${{ inputs.typecheck }}
    runs-on: ubuntu-latest
    steps:
${setup(`

      - name: 🔍 Type check
        run: pnpm typecheck`)}

  test:
    needs: dependencies
    if: \${{ inputs.test-script != '' }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: \${{ fromJSON(inputs.node-matrix) }}
    steps:
${setup(`

      - name: 🧪 Run tests
        env:
          SCRIPT: \${{ inputs.test-script }}
        run: pnpm run "$SCRIPT"`).replace(
	'node-version-file: ${{ inputs.node-version-file }}',
	'node-version: ${{ matrix.node }}'
)}

  build:
    needs: dependencies
    if: \${{ inputs.build }}
    runs-on: ubuntu-latest
    steps:
${setup(`

      - name: 🏗️ Build project
        run: pnpm build

      - name: 🔍 Validate type resolution (are-the-types-wrong)
        if: \${{ inputs.attw }}
        run: pnpm attw

      - name: 🔍 Validate package with publint
        if: \${{ inputs.publint }}
        run: pnpm exec publint --strict

${PACK_SMOKE_STEP.replace('        run: |', '        if: ${{ inputs.pack-smoke }}\n        run: |')}

      - name: 📦 Upload build artifacts
        uses: actions/upload-artifact@v7
        with:
          name: build-artifacts
          path: |
            dist/
            package.json
            README.md
          retention-days: 7`)}
`)
}

/**
 * The thin ci.yml caller for a JS repo (#1037): one `uses:` job in place of the
 * inline jobs, gated by the same `check-skip`, followed by the `ci` gate — which
 * `needs` the `uses:` job, so the required check stays named `ci` and branch
 * protection needs no edit. Inputs mirror what `githubJobs` would have gated.
 */
export function githubCallerJob(
	config: ProjectConfig,
	opts: JobOptions,
	pin: { sha: string; version: string }
): CiJob {
	const hasTypeScript = config.typescript.enabled && !config.vitePlus
	const hasTests = config.testing.framework !== 'none'
	const hasBuild = buildsSomething(config, opts) && hasScript(opts, 'build')
	const useCoverage = usesCoverage(config) && hasScript(opts, 'coverage')
	const isLibrary = config.projectType === 'library'
	const lint = hasScript(opts, lintScript(config)) ? lintScript(config) : ''
	const test = hasTests && hasScript(opts, useCoverage ? 'coverage' : 'test')
	const inputs: [string, string | number | boolean][] = []
	// Only what differs from the reusable workflow's defaults is passed.
	if (lint !== 'check') inputs.push(['lint-script', lint === '' ? "''" : lint])
	if (hasScript(opts, 'knip')) inputs.push(['knip', true])
	if (!(hasTypeScript && hasScript(opts, 'typecheck'))) inputs.push(['typecheck', false])
	if (!test) inputs.push(['test-script', "''"])
	else if (useCoverage) inputs.push(['test-script', 'coverage'])
	const matrix = JSON.stringify(nodeMatrix(opts.nodeFloor))
	if (matrix !== JSON.stringify(nodeMatrix())) inputs.push(['node-matrix', `'${matrix}'`])
	if (!hasBuild) inputs.push(['build', false])
	else {
		if (isLibrary && hasScript(opts, 'attw')) inputs.push(['attw', true])
		if (config.publint) inputs.push(['publint', true])
		if (opts.bin) inputs.push(['pack-smoke', true])
	}
	if (config.commitLint && opts.commitlint !== false) inputs.push(['commitlint', true])
	if (config.changesets) inputs.push(['changesets', true])
	const withBlock =
		inputs.length > 0 ? `\n    with:\n${inputs.map(([k, v]) => `      ${k}: ${v}`).join('\n')}` : ''
	return {
		id: 'checks',
		uses: reusableUses(pin),
		extra: `    permissions:\n      contents: read${withBlock}`,
		steps: '',
	}
}

/**
 * The JS repo's ci.yml. A thin caller of the reusable workflow once
 * {@link REUSABLE_JS_CI_PIN} is set (or a `pin` is passed), the inline pipeline
 * until then. Everything that renders or audits a JS ci.yml goes through here, so
 * `setup`, `fix github-actions` and `doctor` always compare like with like.
 */
export function renderJsCiWorkflow(
	config: ProjectConfig,
	opts: JobOptions = {},
	pin: { sha: string; version: string } | null = REUSABLE_JS_CI_PIN
): string {
	if (!pin) return renderGitHubWorkflow(githubJobs(config, opts))
	return renderGitHubWorkflow([githubCallerJob(config, opts, pin)], {
		lintsTitle: config.commitLint && opts.commitlint !== false,
	})
}

/** Where the release lives (#753) — its own workflow, so its concurrency is its own. */
export const RELEASE_WORKFLOW = '.github/workflows/release.yml'

/**
 * The release workflow for a library that publishes with semantic-release, or
 * null when nothing is released.
 *
 * Split out of ci.yml (#753): there, a release waiting on approval held up the
 * push runs behind it, and approving it late released a stale checkout that
 * semantic-release refused ("behind remote"). Here a newer request supersedes
 * a waiting one — which has published nothing yet — but queues behind one
 * already publishing (#790). The job checks out
 * the released branch's tip when it starts, i.e. after approval: the dispatched
 * branch (so a dispatch from `beta` cuts a prerelease, #771), or the default
 * branch on a closed milestone. It runs only
 * install → build → test: the commit already passed full CI on its way to main.
 */
export function renderReleaseWorkflow(config: ProjectConfig, opts: JobOptions = {}): string | null {
	if (config.changesets) return renderChangesetsRelease(config, opts)
	if (config.projectType !== 'library' || !config.semanticRelease) return null
	const build =
		buildsSomething(config, opts) && hasScript(opts, 'build')
			? `
      - name: 🏗️ Build project
        run: pnpm build
`
			: ''
	const test =
		config.testing.framework !== 'none' && hasScript(opts, 'test')
			? `
      - name: 🧪 Run tests
        run: pnpm test
`
			: ''
	return pinActions(`${RELEASE_WORKFLOW_HEADER}  release:
${RELEASE_JOB_GATE.map((l) => `    ${l}`).join('\n')}
    environment: ${opts.releaseEnvironment || 'release'}
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
      id-token: write
    steps:
      - name: 📦 Checkout repository
        uses: actions/checkout@v7
        with:
          # The tip, not the event's SHA: the job starts after approval, and
          # semantic-release refuses a checkout the branch has moved past. A
          # dispatch releases the branch it ran from — dispatch from a prerelease
          # branch (e.g. beta) to cut a prerelease; a closed milestone releases
          # the default branch.
          ref: \${{ github.event_name == 'workflow_dispatch' && github.ref || github.event.repository.default_branch }}
          fetch-depth: 0
          # RELEASE_TOKEN (admin PAT) lets semantic-release push the version
          # commit + tag to a protected main; GITHUB_TOKEN can't bypass branch
          # protection. Falls back to GITHUB_TOKEN when no PAT is set.
          token: \${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}

      - name: 📦 Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          registry-url: 'https://registry.npmjs.org'

      - name: 📦 Setup pnpm
        uses: pnpm/action-setup@v6

      - name: 📦 Install dependencies
        run: pnpm install --frozen-lockfile
${build}${test}
      - name: 🔧 Configure Git
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"

      # OIDC trusted publishing needs npm >= 11.5.1; Node 22 bundles npm 10, whose
      # \`npm publish\` fails with ENEEDAUTH. Pinned to a range, not \`latest\`, so a
      # future npm major can't change publishing unannounced.
      - name: 📦 Upgrade npm for OIDC trusted publishing
        run: npm install -g npm@^11.5.1

      - name: 🚀 Run semantic-release
        # Publishes to npm via OIDC trusted publishing — no NPM_TOKEN. Requires
        # the \`id-token: write\` permission above + a trusted publisher configured
        # for the package on npmjs.com (Settings → Trusted Publisher, workflow
        # release.yml).
        env:
          GITHUB_TOKEN: \${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}
        run: |
          set -o pipefail
          npx semantic-release 2>&1 | tee release.log
          # semantic-release exits 0 when main moved on since this run started,
          # publishing nothing (rtorcato/repo-tooling#690). Say so instead of going
          # quietly green.
          # "No relevant changes" is a clean no-op, not this case.
          if grep -q "is behind the remote one" release.log; then
            if [ "\${{ github.event_name }}" = "workflow_dispatch" ]; then
              echo "::warning::main moved on during this run; nothing was published. Run the workflow again."
            else
              echo "::warning::main moved on; nothing was published. Re-run via workflow_dispatch."
            fi
          fi
`)
}

/**
 * Prints `release=true` to $GITHUB_OUTPUT when a public workspace package's
 * version is not on npm yet, i.e. the push merged the Version Packages PR.
 * A 404 means unpublished; any other npm error fails the step rather than
 * guessing either way. Exported so the tests can run it against stubs.
 */
export const UNPUBLISHED_CHECK = `release=false
for spec in $(pnpm -r ls --depth -1 --json | jq -r '.[] | select(.private != true and .name and .version) | "\\(.name)@\\(.version)"'); do
  if out=$(npm view "$spec" version 2>&1); then
    continue
  elif printf '%s' "$out" | grep -q E404; then
    echo "::notice::$spec is not on npm yet"
    release=true
  else
    printf '%s\\n' "$out" >&2
    exit 1
  fi
done
echo "release=$release" >> "$GITHUB_OUTPUT"`

/**
 * The token the Changesets release jobs push and open PRs with (#1030): a
 * GitHub App installation token when `RELEASE_APP_ID` and
 * `RELEASE_APP_PRIVATE_KEY` are set, else `RELEASE_TOKEN`, else `GITHUB_TOKEN`.
 */
const RELEASE_TOKEN_EXPR =
	'${{ steps.app-token.outputs.token || secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}'

/**
 * Picks the release credentials and mints the App token (#1030). GitHub runs no
 * workflows for events a GITHUB_TOKEN causes, so a Version Packages PR opened
 * with it waits on "Approve and run workflows" and never gets its required
 * check. One GitHub App installed on all of an owner's repos covers every repo.
 * The `!= ''` comparisons only say whether a secret is set; no value reaches
 * the shell.
 */
const RELEASE_CREDENTIAL_STEPS = `      # A GitHub App token opens the Version Packages PR, so its CI runs on its
      # own: GitHub runs no workflows for events a GITHUB_TOKEN causes. Set
      # RELEASE_APP_ID and RELEASE_APP_PRIVATE_KEY for one App installed on
      # every repo; RELEASE_TOKEN (a PAT) is the fallback, then GITHUB_TOKEN.
      - name: 🔑 Pick the release credentials
        id: creds
        env:
          HAS_APP_ID: \${{ secrets.RELEASE_APP_ID != '' }}
          HAS_APP_KEY: \${{ secrets.RELEASE_APP_PRIVATE_KEY != '' }}
          HAS_RELEASE_TOKEN: \${{ secrets.RELEASE_TOKEN != '' }}
        run: |
          if [ "$HAS_APP_ID" = true ] && [ "$HAS_APP_KEY" = true ]; then
            echo "app=true" >> "$GITHUB_OUTPUT"
          elif [ "$HAS_RELEASE_TOKEN" != true ]; then
            echo "::warning title=No release credentials::Version Packages PRs opened with GITHUB_TOKEN wait on 'Approve and run workflows' and their required check never runs. Set RELEASE_APP_ID and RELEASE_APP_PRIVATE_KEY (a GitHub App), or RELEASE_TOKEN."
          fi

      - name: 🔑 Mint a GitHub App token
        id: app-token
        if: steps.creds.outputs.app == 'true'
        uses: actions/create-github-app-token@v3
        with:
          client-id: \${{ secrets.RELEASE_APP_ID }}
          private-key: \${{ secrets.RELEASE_APP_PRIVATE_KEY }}
          # Scope the token to what Changesets needs, not every App permission.
          permission-contents: write
          permission-pull-requests: write
`

/**
 * The Changesets release workflow (#938): still batched, but shipping is
 * "merge the Version Packages PR (VPR) + one approval".
 *
 * The old shape put the `release` environment on its one job, run on dispatch
 * or a closed milestone: one approval to open the VPR, a second to publish it,
 * and a changeset merged while the second waited turned it into an empty VPR
 * (react-common#261). Here every push runs the ungated `version` job, which
 * only opens or updates the VPR. The gated `publish` job runs only on the push
 * that merged it (nothing pending, a version not on npm) or a dispatch, so an
 * ordinary merge never queues an approval. It checks out the commit that
 * triggered the run, not the tip, so a changeset merged during the approval
 * wait can't turn the publish back into a VPR update. The file name and the
 * environment stay: npm trusted publishing is bound to both.
 */
function renderChangesetsRelease(config: ProjectConfig, opts: JobOptions): string {
	// The version job is ungated and holds the release token, so no dependency
	// install script runs there; `changeset version` needs no build.
	const setup = (publish: boolean) => `      - name: 📦 Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc${publish ? "\n          registry-url: 'https://registry.npmjs.org'" : ''}

      - name: 📦 Setup pnpm
        uses: pnpm/action-setup@v6

      - name: 📦 Install dependencies
        run: pnpm install --frozen-lockfile${publish ? '' : ' --ignore-scripts'}
`
	const build =
		buildsSomething(config, opts) && hasScript(opts, 'build')
			? `
      - name: 🏗️ Build packages
        run: pnpm build
`
			: ''
	const changesetsInputs = `          github-token: ${RELEASE_TOKEN_EXPR}
          version-script: pnpm changeset version
          commit-message: 'chore(release): version packages'
          pr-title: 'chore(release): version packages'`
	return pinActions(`name: 🚀 Release

# Changesets, batched (rtorcato/repo-tooling#938). Every push to main opens or
# updates the "Version Packages" PR and publishes nothing. Merging that PR is
# the release: its push runs the \`publish\` job, which waits for one \`release\`
# approval. A dispatch re-runs the publish, e.g. after a failed one; with
# changesets pending it updates the Version Packages PR instead.
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  # No environment: it only opens or updates the Version Packages PR, so it
  # never asks for an approval.
  version:
    # Release only from the default branch; a dispatch from another is skipped.
    if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
    # Its own group, so a publish waiting for approval never holds it: a group
    # keeps only one pending run, and a Version Packages PR merge queued behind
    # that wait would be dropped by the next push.
    concurrency:
      group: release-version
      cancel-in-progress: false
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    outputs:
      release: \${{ steps.unpublished.outputs.release }}
    steps:
${RELEASE_CREDENTIAL_STEPS}
      - name: 📦 Checkout repository
        uses: actions/checkout@v7
        with:
          fetch-depth: 0
          # The App token (or RELEASE_TOKEN) pushes the Version Packages branch,
          # so its PR runs CI; GITHUB_TOKEN-made PRs trigger none.
          token: ${RELEASE_TOKEN_EXPR}

${setup(false)}
      # No publish-script: with changesets pending this opens or updates the
      # Version Packages PR; with none it does nothing.
      - name: 📝 Open or update the Version Packages PR
        id: changesets
        uses: changesets/action@v2.1.2
        with:
${changesetsInputs}

      # Nothing pending and a version not on npm yet: this push merged the
      # Version Packages PR (pre mode included: the version is the -beta.N one).
      - name: 🔎 Check for a version not on npm yet
        id: unpublished
        if: steps.changesets.outputs.has-changesets == 'false'
        run: |
${UNPUBLISHED_CHECK.split('\n')
	.map((l) => `          ${l}`)
	.join('\n')}

  # No environment, so it never asks for an approval. It queues in the \`release\`
  # group behind any publish still waiting for one, then re-runs the npm check:
  # a push that landed during that wait saw the version as unpublished (the
  # \`version\` job is outside the group on purpose), and without this it would
  # queue a duplicate approval request for a publish that already happened.
  # A newer gate replaces an older pending one, which is safe: its own check
  # sees whatever is still unpublished at its commit.
  gate:
    needs: version
    if: needs.version.outputs.release == 'true'
    concurrency:
      group: release
      cancel-in-progress: false
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      release: \${{ steps.unpublished.outputs.release }}
    steps:
      - name: 📦 Checkout repository
        uses: actions/checkout@v7

${setup(false)}
      - name: 🔎 Re-check for a version not on npm yet
        id: unpublished
        run: |
${UNPUBLISHED_CHECK.split('\n')
	.map((l) => `          ${l}`)
	.join('\n')}

  publish:
    needs: [version, gate]
    # The Version Packages PR merge, or a dispatch. Any other push skips this
    # job, so it never queues an approval request; a push whose version a
    # publish ahead of it already shipped is skipped by \`gate\`.
    if: >-
      !cancelled() && needs.version.result == 'success' &&
      (github.event_name == 'workflow_dispatch' || needs.gate.outputs.release == 'true')
    # Holds the run until a required reviewer approves it. npm trusted
    # publishing is bound to release.yml + this environment, or the OIDC
    # publish fails with E404.
    environment: ${opts.releaseEnvironment || 'release'}
    # Queue rather than cancel: a newer publish waits for the one ahead of it
    # (approval included) instead of killing one already in flight
    # (rtorcato/repo-tooling#790).
    concurrency:
      group: release
      cancel-in-progress: false
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
      # The commit that triggered the run, not the tip: a changeset merged while
      # this waited for approval would otherwise make it update the Version
      # Packages PR instead of publishing.
${RELEASE_CREDENTIAL_STEPS}
      - name: 📦 Checkout repository
        uses: actions/checkout@v7
        with:
          fetch-depth: 0
          token: ${RELEASE_TOKEN_EXPR}

${setup(true)}${build}
      # OIDC trusted publishing needs npm >= 11.5.1; Node 22 bundles npm 10, whose
      # \`npm publish\` fails with ENEEDAUTH. Pinned to a range, not \`latest\`, so a
      # future npm major can't change publishing unannounced.
      - name: 📦 Upgrade npm for OIDC trusted publishing
        run: npm install -g npm@^11.5.1

      # Publishes every package whose version is not on npm yet (with the pre
      # mode tag, e.g. beta), then tags it and creates its GitHub release. No
      # NPM_TOKEN: OIDC trusted publishing, via \`id-token: write\` above.
      - name: 🚀 Publish to npm
        uses: changesets/action@v2.1.2
        with:
          publish-script: pnpm changeset publish
${changesetsInputs}
`)
}

/**
 * The `.gitlab-ci.yml` spec for a JS repo — node image, pnpm store cache, pnpm
 * scripts. `opts.scripts` gates each job on the script it runs exactly as
 * `githubJobs` does (#386): `fix gitlab-ci` renders for a repo that already
 * exists and may have none of them, and a job calling a missing script dies
 * with ERR_PNPM_RECURSIVE_EXEC. Undefined still means "assume the setup shape".
 *
 * Dropping the `build` job takes its `artifacts` block with it; no other job
 * references that artifact, so the pipeline stays coherent without it.
 */
export function gitlabSpec(config: ProjectConfig, opts: JobOptions = {}): GitLabSpec {
	const hasTypeScript = config.typescript.enabled
	const hasTests = config.testing.framework !== 'none'
	const hasLint = config.linting.tool !== 'none'
	const hasBuild = buildsSomething(config, opts)
	const test = gitlabTest(config)

	const jobs: GitLabSpec['jobs'] = [
		...(hasLint && hasScript(opts, lintScript(config))
			? [{ id: 'lint', stage: 'test', script: [lintCommand(config)] }]
			: []),
		...(hasTypeScript && hasScript(opts, 'typecheck')
			? [{ id: 'typecheck', stage: 'test', script: ['pnpm typecheck'] }]
			: []),
		...(hasTests && (test.script === null || hasScript(opts, test.script))
			? [{ id: 'test', stage: 'test', script: [test.command] }]
			: []),
		...(hasBuild && hasScript(opts, 'build')
			? [
					{
						id: 'build',
						stage: 'build',
						script: ['pnpm build'],
						extra: `  artifacts:
    paths:
      - dist/
    expire_in: 1 week`,
					},
				]
			: []),
	]

	return {
		image: 'node:22',
		preamble: `variables:
  PNPM_CACHE_FOLDER: .pnpm-store

cache:
  key:
    files:
      - pnpm-lock.yaml
  paths:
    - .pnpm-store
    - node_modules

default:
  before_script:
    - corepack enable
    - corepack prepare pnpm@latest --activate
    - pnpm config set store-dir "$PNPM_CACHE_FOLDER"
    - pnpm install --frozen-lockfile`,
		jobs,
	}
}

/**
 * The GitLab test command, paired with the package.json script it needs.
 * Vitest is invoked through `pnpm exec` — a direct binary call, so `script` is
 * null and the job is never gated away; the other frameworks run a script that
 * has to exist.
 */
function gitlabTest(config: ProjectConfig): { command: string; script: string | null } {
	if (config.testing.framework === 'vitest')
		return { command: 'pnpm exec vitest run', script: null }
	if (config.testing.framework === 'playwright' || config.testing.framework === 'cypress')
		return { command: 'pnpm test:e2e', script: 'test:e2e' }
	return { command: 'pnpm test', script: 'test' }
}
