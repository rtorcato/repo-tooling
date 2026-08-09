import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { BASE_FIXERS } from '../../../src/base/fixers.js'
import { runDoctor } from '../../../src/cli/commands/doctor.js'
import { FIXERS } from '../../../src/languages/js/fixers.js'
import { checkPerlGitignore, runPerlChecks } from '../../../src/languages/perl/checks.js'
import { PERL_FIXERS } from '../../../src/languages/perl/fixers.js'
import { ensurePerlGitignore } from '../../../src/languages/perl/gitignore.js'
import { PYTHON_FIXERS } from '../../../src/languages/python/fixers.js'
import { SWIFT_FIXERS } from '../../../src/languages/swift/fixers.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function fixer(target: string) {
	const found = PERL_FIXERS.find((f) => f.target === target)
	if (!found) throw new Error(`no perl fixer: ${target}`)
	return found
}

const ctx = (targetDir: string) => ({
	targetDir,
	pkg: null,
	result: { check: 'x', status: 'missing' as const, detail: '' },
	lock: null,
})

/** The marker that makes detectLanguage resolve the Perl module. */
async function perlRepo(dir: string): Promise<string> {
	await fs.writeFile(join(dir, 'cpanfile'), "requires 'perl', '5.036';\n")
	return dir
}

describe('perl fixers', () => {
	// A fixer whose appliesTo doesn't match a real check name is dead code: `fix`
	// looks fixers up by check, so it would simply never run.
	it('every fixer resolves a check doctor actually emits for a Perl repo', async () => {
		const dir = await perlRepo(newTmpDir())
		const emitted = new Set((await runDoctor(dir)).map((r) => r.check))
		for (const f of PERL_FIXERS) {
			for (const check of f.appliesTo) {
				expect(emitted, `${f.target} → ${check}`).toContain(check)
			}
		}
	})

	it('uses target names that do not collide with the other fixer sets', () => {
		// `fix --list` shows every language's fixers in one list.
		const taken = new Set(
			[...FIXERS, ...BASE_FIXERS, ...SWIFT_FIXERS, ...PYTHON_FIXERS].map((f) => f.target)
		)
		for (const f of PERL_FIXERS) expect(taken).not.toContain(f.target)
	})

	// #303, in the Perl shape: doctor reports the base findings, so `fix` has to
	// have a fixer for them rather than returning `unsupported` for every one.
	it('base + Perl fixers cover every check doctor emits for a Perl repo', async () => {
		const dir = await perlRepo(newTmpDir())
		const fixable = new Set([...BASE_FIXERS, ...PERL_FIXERS].flatMap((f) => f.appliesTo))
		const uncovered = (await runDoctor(dir))
			.map((r) => r.check)
			.filter((check) => !fixable.has(check))
		// `language` and `Monorepo` are informational. `Git identity` is unfixable
		// by design (#328) — only the operator knows their own address. `README
		// badges` and `Coverage upload` need a package.json to build from, which a
		// Perl repo hasn't got. `lockfile` has no Perl preset to record yet (see
		// the note atop src/languages/perl/fixers.ts). `Perl distribution` and
		// `Perl tests` are content only the project can write.
		expect(uncovered).toEqual([
			'language',
			'lockfile',
			'Monorepo',
			'Git identity',
			'README badges',
			'Coverage upload',
			'Perl distribution',
			'Perl tests',
		])
	})

	it('perlcritic writes a config the Perl::Critic check accepts', async () => {
		const dir = newTmpDir()
		const { filesWritten } = await fixer('perlcritic').run(ctx(dir))
		expect(filesWritten).toEqual(['.perlcriticrc'])
		expect((await runPerlChecks(dir)).find((r) => r.check === 'Perl::Critic')?.status).toBe('ok')
	})

	it('perltidy writes a config the perltidy check accepts', async () => {
		const dir = newTmpDir()
		const { filesWritten } = await fixer('perltidy').run(ctx(dir))
		expect(filesWritten).toEqual(['.perltidyrc'])
		expect((await runPerlChecks(dir)).find((r) => r.check === 'perltidy')?.status).toBe('ok')
	})

	// -b rewrites in place, which is right for the hook and wrong for a human
	// running perltidy by hand, so the shipped config must not set it.
	it('the shipped perltidyrc does not turn on in-place editing', async () => {
		const dir = newTmpDir()
		await fixer('perltidy').run(ctx(dir))
		const contents = await fs.readFile(join(dir, '.perltidyrc'), 'utf-8')
		expect(contents).not.toMatch(/^-b$/m)
	})

	it('perl-ci writes a workflow that satisfies the Perl tests check', async () => {
		const dir = await perlRepo(newTmpDir())
		await fs.outputFile(join(dir, 't/00-load.t'), '')
		const { filesWritten } = await fixer('perl-ci').run(ctx(dir))
		expect(filesWritten).toEqual(['.github/workflows/ci.yml'])
		expect((await runPerlChecks(dir)).find((r) => r.check === 'Perl tests')?.status).toBe('ok')
	})

	it('perl-gitlab-ci writes a pipeline that runs the suite', async () => {
		const dir = await perlRepo(newTmpDir())
		const { filesWritten } = await fixer('perl-gitlab-ci').run(ctx(dir))
		expect(filesWritten).toEqual(['.gitlab-ci.yml'])
		expect(await fs.readFile(join(dir, '.gitlab-ci.yml'), 'utf-8')).toContain('prove')
	})

	it('perl-git-hooks writes hooks the base Git hooks / Pre-push checks accept', async () => {
		const dir = await perlRepo(newTmpDir())
		const { filesWritten } = await fixer('perl-git-hooks').run(ctx(dir))
		expect(filesWritten).toEqual(['.githooks/pre-commit', '.githooks/pre-push'])
		expect(await fs.readFile(join(dir, '.githooks/pre-push'), 'utf-8')).toContain('prove -lr t')
		// Executable, or git silently ignores the hook.
		expect((await fs.stat(join(dir, '.githooks/pre-commit'))).mode & 0o111).toBeTruthy()

		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Git hooks')?.status).toBe('ok')
		expect(results.find((r) => r.check === 'Pre-push hook')?.status).toBe('ok')
	})

	// GNU xargs (the Linux CI runners) runs the command once even with no input
	// unless given -r, and perltidy with no file arguments reads stdin — so a
	// pipe here hangs the job. `-exec … +` runs nothing instead, everywhere.
	it('enumerates sources with -exec rather than piping into xargs', async () => {
		const dir = await perlRepo(newTmpDir())
		await fixer('perl-git-hooks').run(ctx(dir))
		const hook = await fs.readFile(join(dir, '.githooks/pre-commit'), 'utf-8')
		expect(hook).toContain('-exec perltidy')
		expect(hook).not.toContain('xargs')
	})

	// No .git in the temp dir: an unguarded `git config` would walk up and
	// rewrite whatever repo the tmp dir happens to sit inside.
	it('perl-git-hooks does not touch git config outside a repo', async () => {
		const dir = newTmpDir()
		await expect(fixer('perl-git-hooks').run(ctx(dir))).resolves.toBeTruthy()
	})
})

describe('ensurePerlGitignore', () => {
	it('creates the file when absent and satisfies the check', async () => {
		const dir = newTmpDir()
		expect(await ensurePerlGitignore(dir)).toEqual(['.gitignore'])
		expect((await checkPerlGitignore(dir)).status).toBe('ok')
	})

	it('appends to an existing .gitignore without dropping its entries', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), 'secrets.env\n')
		await ensurePerlGitignore(dir)
		const contents = await fs.readFile(join(dir, '.gitignore'), 'utf-8')
		expect(contents).toContain('secrets.env')
		expect((await checkPerlGitignore(dir)).status).toBe('ok')
	})

	it('does not duplicate an entry the repo already ignores', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), '/blib/\nnotes.md\n')
		await ensurePerlGitignore(dir)
		const contents = await fs.readFile(join(dir, '.gitignore'), 'utf-8')
		expect(contents.match(/^\/blib\/$/gm)).toHaveLength(1)
		expect((await checkPerlGitignore(dir)).status).toBe('ok')
	})

	it('is a no-op when everything is already covered', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), '/blib/\nMYMETA.*\npm_to_blib\n')
		expect(await ensurePerlGitignore(dir)).toEqual([])
	})
})
