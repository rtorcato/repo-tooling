/**
 * Perl CI generation (#289), built on the language-agnostic skeleton in
 * `src/base/ci.ts`. No `setup-node`, no `pnpm` — the Perl path runs on Linux
 * with `shogo82148/actions-setup-perl` and cpanm.
 *
 * Like the Swift and Python paths there's no `ProjectConfig` to read: the one
 * fact CI needs beyond the fixed job shapes — which interpreters to test on —
 * is declared in the distribution's own metadata, so the matrix is derived
 * from the repo itself.
 */
import path from 'node:path'
import fs from 'fs-extra'
import { type CiJob, type GitLabSpec, renderGitHubWorkflow, renderGitLabCI } from '../../base/ci.js'
import { FIND_PERL_SOURCES } from './sources.js'

/**
 * The newest interpreter the emitted matrix tests against, and the one the
 * single-interpreter lint job runs on.
 *
 * ponytail: a constant, bumped by hand when perl ships a stable minor (they
 * land roughly annually, even minors only). Resolving "latest" at generation
 * time would need a network call from a generator whose whole job is emitting
 * text.
 */
const LATEST_PERL = '5.42'

/**
 * The oldest interpreter to assume when the distribution declares no floor.
 * Debian stable's perl — the oldest one a consumer is actually likely to be
 * running, as opposed to the oldest one still theoretically supported.
 */
const DEFAULT_FLOOR = '5.36'

export interface PerlProject {
	/**
	 * Interpreter versions for the test matrix, oldest first. Two points — the
	 * declared floor and the newest release — rather than every minor between:
	 * breaks show up at the ends of the range, and the middle costs runner
	 * minutes to re-prove them absent.
	 */
	perlVersions: string[]
}

const minorOf = (version: string): number => Number.parseInt(version.split('.')[1] ?? '0', 10)

/**
 * Normalise any of the forms a perl version is written in to `major.minor`.
 *
 * Perl has three spellings of the same thing and metadata files use all of
 * them: `5.36`, the v-string `v5.36.0`, and the *packed decimal* `5.036000`,
 * where the minor is the first three digits after the point. Parsed naively,
 * that last one reads as minor 36000 — which would emit a matrix entry for a
 * perl that does not exist and fail every run.
 */
export function normalizePerlVersion(raw: string): string | null {
	const match = /^v?(\d+)\.(\d+)/.exec(raw.trim())
	if (!match?.[1] || !match[2]) return null
	const [, major, fraction] = match
	// 3+ digits means the packed form (5.036000 → 5.36); fewer is already plain.
	const minor =
		fraction.length >= 3 ? Number.parseInt(fraction.slice(0, 3), 10) : Number.parseInt(fraction, 10)
	return `${major}.${minor}`
}

/**
 * The declared minimum perl, or null when the distribution names none.
 *
 * A regex rather than parsing Perl: `cpanfile`, `Makefile.PL` and `Build.PL`
 * are all *executable Perl*, so reading them properly means running arbitrary
 * code from the audited repo — which `doctor` must never do. This is one key.
 */
export function declaredPerlFloor(contents: string): string | null {
	const raw =
		// cpanfile: `requires 'perl', '5.036';` / `requires 'perl' => '5.036000';`
		/requires\s*\(?\s*['"]perl['"]\s*(?:,|=>)\s*['"]?v?([\d._]+)/.exec(contents)?.[1] ??
		// Makefile.PL: `MIN_PERL_VERSION => '5.036'`
		/MIN_PERL_VERSION\s*=>\s*['"]?v?([\d._]+)/.exec(contents)?.[1] ??
		// Build.PL: `requires => { perl => '5.036' }`
		/\bperl\s*=>\s*['"]?v?([\d._]+)/.exec(contents)?.[1] ??
		// dist.ini: `perl = 5.036` under [Prereqs]
		/^\s*perl\s*=\s*['"]?v?([\d._]+)/m.exec(contents)?.[1]
	return raw ? normalizePerlVersion(raw) : null
}

export function parsePerlProject(contents: string): PerlProject {
	const floor = declaredPerlFloor(contents) ?? DEFAULT_FLOOR

	// A floor at or above the newest release we know about collapses the matrix
	// to one entry rather than emitting a version that doesn't exist yet.
	const versions = minorOf(floor) >= minorOf(LATEST_PERL) ? [floor] : [floor, LATEST_PERL]
	return { perlVersions: versions }
}

/**
 * Files that can carry a distribution's metadata, most authoritative first.
 * `cpanfile` is the modern one; the `.PL` scripts are the older build systems,
 * and `dist.ini` is Dist::Zilla, which generates the others at release time.
 */
export const PERL_METADATA_FILES = ['cpanfile', 'Makefile.PL', 'Build.PL', 'dist.ini']

/** The first metadata file present, with its contents. Null when none exists. */
export async function readPerlMetadata(
	dir: string
): Promise<{ file: string; contents: string } | null> {
	for (const file of PERL_METADATA_FILES) {
		const filepath = path.join(dir, file)
		if (!(await fs.pathExists(filepath))) continue
		return { file, contents: await fs.readFile(filepath, 'utf-8') }
	}
	return null
}

export async function readPerlProject(dir: string): Promise<PerlProject> {
	const metadata = await readPerlMetadata(dir)
	if (!metadata) return { perlVersions: [DEFAULT_FLOOR, LATEST_PERL] }
	return parsePerlProject(metadata.contents)
}

/** Checkout + interpreter. cpanm comes from the setup action, not a separate step. */
function perlSetup(version: string): string {
	return `      - name: 📦 Checkout repository
        uses: actions/checkout@v7

      - name: 🐪 Set up Perl ${version}
        uses: shogo82148/actions-setup-perl@v1
        with:
          perl-version: '${version}'
          install-modules-with: cpanm`
}

export function perlGithubJobs(project: PerlProject): CiJob[] {
	return [
		{
			id: 'lint',
			// Perl::Critic is static, so the distribution's own dependencies are not
			// installed here — the lint job stays fast and can't fail on a CPAN
			// mirror hiccup that has nothing to do with the code.
			steps: `${perlSetup(LATEST_PERL)}

      - name: 📦 Install Perl::Critic and Perl::Tidy
        run: cpanm --notest Perl::Critic Perl::Tidy

      - name: 🔍 perlcritic
        # A block scalar, not a plain one: the find expression carries quotes,
        # parentheses and braces that a plain YAML scalar would make fragile.
        run: |
          ${FIND_PERL_SOURCES} -exec perlcritic {} +

      - name: 🎨 perltidy --check
        # perltidy has no non-rewriting check mode that reports *which* files
        # are untidy, so this tidies in place and lets git report the delta.
        # The diff in the log is the fix, ready to apply.
        run: |
          ${FIND_PERL_SOURCES} -exec perltidy -b -bext='/' {} +
          git diff --exit-code`,
		},
		{
			id: 'test',
			extra: `    name: prove \${{ matrix.perl-version }}
    strategy:
      fail-fast: false
      matrix:
        perl-version:
${project.perlVersions.map((v) => `          - '${v}'`).join('\n')}`,
			steps: `      - name: 📦 Checkout repository
        uses: actions/checkout@v7

      - name: 🐪 Set up Perl \${{ matrix.perl-version }}
        uses: shogo82148/actions-setup-perl@v1
        with:
          perl-version: \${{ matrix.perl-version }}
          install-modules-with: cpanm

      - name: 📦 Install dependencies
        run: cpanm --installdeps --notest .

      - name: 🧪 prove
        run: prove -lr t`,
		},
	]
}

export function renderPerlWorkflow(project: PerlProject): string {
	return renderGitHubWorkflow(perlGithubJobs(project))
}

/**
 * GitLab runs the same commands in the official Perl image. The matrix is
 * dropped for the same reason Python's is: GitLab's `parallel:matrix` would
 * need a per-job image override, and a mirrored repo is a secondary pipeline —
 * the version sweep lives on the GitHub side.
 */
function perlGitlabSpec(project: PerlProject): GitLabSpec {
	const image = `perl:${project.perlVersions.at(-1) ?? LATEST_PERL}`
	return {
		image,
		preamble: `variables:
  PERL_CPANM_OPT: "--notest"`,
		jobs: [
			{
				id: 'lint',
				stage: 'lint',
				script: ['cpanm --notest Perl::Critic', `${FIND_PERL_SOURCES} -exec perlcritic {} +`],
			},
			{
				id: 'test',
				stage: 'test',
				script: ['cpanm --installdeps --notest .', 'prove -lr t'],
			},
		],
	}
}

export function renderPerlGitLabCI(project: PerlProject): string {
	return renderGitLabCI(perlGitlabSpec(project))
}
