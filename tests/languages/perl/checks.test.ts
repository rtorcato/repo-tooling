import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { runDoctor } from '../../../src/cli/commands/doctor.js'
import {
	checkPerlDistribution,
	checkPerlGitignore,
	checkPerlTests,
	runPerlChecks,
} from '../../../src/languages/perl/checks.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const status = (results: Awaited<ReturnType<typeof runPerlChecks>>, check: string) =>
	results.find((r) => r.check === check)?.status

describe('checkPerlDistribution', () => {
	it('is missing with no metadata file at all', async () => {
		const result = await checkPerlDistribution(newTmpDir())
		expect(result.status).toBe('missing')
	})

	// Without a floor, cpanm installs the distribution on an interpreter that
	// cannot compile it, and the user meets a syntax error instead.
	it('drifts when the metadata declares no minimum perl', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'cpanfile'), "requires 'Moose', '2.20';\n")
		const result = await checkPerlDistribution(dir)
		expect(result.status).toBe('drift')
		expect(result.detail).toContain('cpanfile')
	})

	it('is ok once a floor is declared', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'cpanfile'), "requires 'perl', '5.036';\n")
		const result = await checkPerlDistribution(dir)
		expect(result.status).toBe('ok')
		expect(result.detail).toContain('5.36')
	})

	it.each(['Makefile.PL', 'Build.PL', 'dist.ini'])('accepts %s as metadata', async (file) => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, file), "MIN_PERL_VERSION => '5.036',\n")
		expect((await checkPerlDistribution(dir)).status).toBe('ok')
	})
})

describe('Perl::Critic and perltidy config checks', () => {
	it('are missing on a bare distribution', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'cpanfile'), "requires 'perl', '5.036';\n")
		const results = await runPerlChecks(dir)
		expect(status(results, 'Perl::Critic')).toBe('missing')
		expect(status(results, 'perltidy')).toBe('missing')
	})

	it('accept a config in either spelling', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'perlcriticrc'), 'severity = 3\n')
		await fs.writeFile(join(dir, 'perltidyrc'), '-pbp\n-l=100\n')
		const results = await runPerlChecks(dir)
		expect(status(results, 'Perl::Critic')).toBe('ok')
		expect(status(results, 'perltidy')).toBe('ok')
	})

	it('accepts a perlcriticrc that only disables policies', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.perlcriticrc'), '[-Modules::RequireVersionVar]\n')
		expect(status(await runPerlChecks(dir), 'Perl::Critic')).toBe('ok')
	})

	// A file that exists but carries none of the tool's syntax is drift, not
	// absence — someone created it and it isn't doing anything.
	it('reports a config with no recognisable settings as drift', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.perltidyrc'), '# just a comment\n')
		expect(status(await runPerlChecks(dir), 'perltidy')).toBe('drift')
	})
})

describe('checkPerlGitignore', () => {
	it('is missing with no .gitignore', async () => {
		expect((await checkPerlGitignore(newTmpDir())).status).toBe('missing')
	})

	it('drifts when the build artefacts are not covered', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), 'notes.md\n')
		const result = await checkPerlGitignore(dir)
		expect(result.status).toBe('drift')
		expect(result.detail).toContain('blib')
	})

	it('is ok once the sentinels are present', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), '/blib/\nMYMETA.*\npm_to_blib\n')
		expect((await checkPerlGitignore(dir)).status).toBe('ok')
	})

	// Only Carton users have local/, so demanding it would nag everyone else.
	it('does not require Carton\'s local/', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), '/blib/\nMYMETA.*\npm_to_blib\n')
		expect((await checkPerlGitignore(dir)).status).toBe('ok')
	})
})

describe('checkPerlTests', () => {
	it('is missing with no t/ directory', async () => {
		expect((await checkPerlTests(newTmpDir())).status).toBe('missing')
	})

	// A t/ tree nothing executes is worse than none: it reads as covered.
	it('drifts when tests exist but no CI runs them', async () => {
		const dir = newTmpDir()
		await fs.outputFile(join(dir, 't/00-load.t'), '')
		expect((await checkPerlTests(dir)).status).toBe('drift')
	})

	it.each(['prove -lr t', 'make test', 'dzil test'])('accepts %s as running the suite', async (cmd) => {
		const dir = newTmpDir()
		await fs.outputFile(join(dir, 't/00-load.t'), '')
		await fs.outputFile(join(dir, '.github/workflows/ci.yml'), `jobs:\n  test:\n    run: ${cmd}\n`)
		expect((await checkPerlTests(dir)).status).toBe('ok')
	})

	it('counts an xt/ author-test tree as tests', async () => {
		const dir = newTmpDir()
		await fs.outputFile(join(dir, 'xt/author.t'), '')
		expect((await checkPerlTests(dir)).status).toBe('drift') // exists, but unrun
	})
})

describe('doctor on a Perl distribution', () => {
	async function perlRepo(): Promise<string> {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'cpanfile'), "requires 'perl', '5.036';\n")
		return dir
	}

	it('reports the language and layers the Perl checks on the base suite', async () => {
		const results = await runDoctor(await perlRepo())
		const names = results.map((r) => r.check)
		expect(results.find((r) => r.check === 'language')?.detail).toContain('Perl')
		// A base check and a module check, proving both halves ran.
		expect(names).toContain('EditorConfig')
		expect(names).toContain('Perl distribution')
	})

	// CodeQL ships no Perl analyzer, so `fix codeql` writes nothing. Reporting it
	// as missing would send the user to a fixer that is a silent no-op.
	it('reports CodeQL as not applicable rather than missing', async () => {
		const results = await runDoctor(await perlRepo())
		const codeql = results.find((r) => r.check === 'CodeQL')
		expect(codeql?.status).toBe('ok')
		expect(codeql?.detail).toContain('no analyzer')
	})

	// A Perl distribution has no package.json, so nothing JS-shaped should run.
	it('runs no JS checks', async () => {
		const names = (await runDoctor(await perlRepo())).map((r) => r.check)
		expect(names).not.toContain('package.json')
		expect(names).not.toContain('TypeScript')
	})
})
