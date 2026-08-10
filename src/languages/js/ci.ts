/**
 * The JavaScript/TypeScript module's CI contribution (#283): the pnpm/Node
 * steps that used to be baked into the generators' template literals.
 *
 * Everything here is Node-specific — `setup-node`, `pnpm install`, the
 * pnpm-store cache, the `pnpm <script>` commands. The shell around it lives in
 * `src/base/ci.ts` and is shared with Swift/Perl/Python (#287/#289/#290).
 */
import type { CiJob, GitLabSpec } from '../../base/ci.js'
import type { ProjectConfig } from '../../cli/commands/setup.js'

/** Coverage is uploaded when Vitest is the test runner (it emits an lcov report). */
export function usesCoverage(config: ProjectConfig): boolean {
	return config.testing.framework === 'vitest'
}

/** The package.json script the lint job runs — `check` under Biome, else `lint`. */
function lintScript(config: ProjectConfig): string {
	return config.linting.tool === 'biome' || config.linting.tool === 'both' ? 'check' : 'lint'
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

/** Emit a step only when the script it runs exists (or we can't know yet). */
function stepFor(opts: JobOptions, script: string, step: string): string | null {
	return hasScript(opts, script) ? step : null
}

/** Join the steps that survived gating onto the shared setup preamble. */
function jobSteps(steps: (string | null)[]): string | null {
	const kept = steps.filter((s): s is string => s !== null)
	return kept.length > 0 ? [SETUP_STEPS, ...kept].join('\n\n') : null
}

/**
 * The GitHub Actions jobs for a JS repo, in workflow order. The `release` job
 * needs the ids of everything that ran before it, so the list is assembled
 * rather than filtered from a fixed shape.
 */
export function githubJobs(config: ProjectConfig, opts: JobOptions = {}): CiJob[] {
	const hasTypeScript = config.typescript.enabled
	const hasTests = config.testing.framework !== 'none'
	const hasBuild = config.bundler !== 'none'
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
		const coverageUpload = hasCoverage
			? `

      - name: 📊 Upload coverage to Codecov
        uses: codecov/codecov-action@v7
        with:
          token: \${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: false`
			: ''
		// Fall back to `pnpm test` when the repo has no coverage script — the
		// coverage upload goes with it, since there'd be no lcov to upload.
		const useCoverage = hasCoverage && (!opts.scripts || 'coverage' in opts.scripts)
		const steps = jobSteps([
			stepFor(
				opts,
				useCoverage ? 'coverage' : 'test',
				`      - name: 🧪 Run tests
        run: ${useCoverage ? 'pnpm coverage' : 'pnpm test'}${useCoverage ? coverageUpload : ''}`
			),
		])
		if (steps) jobs.push({ id: 'test', needs: ['dependencies'], steps })
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
		jobs.push({
			id: 'build',
			needs: ['dependencies'],
			steps: `${SETUP_STEPS}

      - name: 🏗️ Build project
        run: pnpm build
${attw}${publint}
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

	if (isLibrary && config.semanticRelease) {
		jobs.push({
			id: 'release',
			// Gate the publish on everything that ran before it.
			needs: jobs.map((job) => job.id),
			if: "github.ref == 'refs/heads/main'",
			extra: `    permissions:
      contents: write
      issues: write
      pull-requests: write
      id-token: write`,
			steps: `      - name: 📦 Checkout repository
        uses: actions/checkout@v7
        with:
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

      - name: 📦 Restore dependencies cache
        uses: actions/cache@v6
        with:
          path: |
            ~/.pnpm-store
            node_modules
          key: \${{ needs.dependencies.outputs.cache-key }}

      - name: 🔧 Configure Git
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"

      - name: 🚀 Run semantic-release
        # Publishes to npm via OIDC trusted publishing — no NPM_TOKEN. Requires
        # the \`id-token: write\` permission above + a trusted publisher configured
        # for the package on npmjs.com (Settings → Trusted Publisher).
        env:
          GITHUB_TOKEN: \${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}
        run: npx semantic-release`,
		})
	}

	return jobs
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
	const hasBuild = config.bundler !== 'none'
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
