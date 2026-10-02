// Dogfood: run this repo's freshly-built CLI `doctor` against itself in CI, so
// every PR proves the built CLI runs and its checks pass on a real repo (#273).
//
// This repo consumes its OWN local sources (`./tooling/...`) rather than the
// published `@rtorcato/repo-tooling` package, so doctor's "adopts the package"
// checks are false positives here. We accept those by name; everything else
// must be clean. If a genuine finding appears, the job fails — fix it, or (only
// if it's a deliberate self-repo divergence) add its check name to ACCEPTED.
import { execFileSync } from 'node:child_process'

const ACCEPTED = new Set([
	'package.json', // the tool can't list itself as a dependency
	'TypeScript', // tsconfig lives in src/cli/tsconfig.json, not the repo root
	'Vitest', // vitest.config.mjs imports the local ./tooling source, not the export
	'Commitlint', // commitlint.config.mjs re-exports the local ./tooling source
	'semantic-release', // release.config.mjs extends the local ./tooling source
])

// --offline (#755): checks that read live GitHub state (milestones, settings,
// secrets) depend on timing and on which account runs them, so they never gate CI.
function runDoctor() {
	try {
		return execFileSync('node', ['./dist/cli/index.js', 'doctor', '--json', '--offline'], {
			env: { ...process.env, REPO_TOOLING_ALLOW_SELF: '1' },
			encoding: 'utf8',
		})
	} catch (err) {
		// doctor exits non-zero when it finds drift/missing — the JSON is still on stdout.
		if (err.stdout) return err.stdout
		throw err
	}
}

const { results } = JSON.parse(runDoctor())
const genuine = results.filter(
	(c) => (c.status === 'drift' || c.status === 'missing') && !ACCEPTED.has(c.check)
)

if (genuine.length > 0) {
	console.error(`\n❌ dogfood: doctor found ${genuine.length} genuine finding(s) on this repo:\n`)
	for (const c of genuine) console.error(`   [${c.status}] ${c.check} — ${c.detail}`)
	console.error(
		'\nFix the finding, or — only if it is a deliberate self-repo divergence —\nadd its check name to ACCEPTED in scripts/dogfood.mjs.\n'
	)
	process.exit(1)
}

console.log(
	`✅ dogfood: doctor clean on this repo (${results.length} checks; ${ACCEPTED.size} self-repo adoption checks accepted).`
)
