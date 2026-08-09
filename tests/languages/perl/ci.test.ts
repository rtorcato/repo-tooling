import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	declaredPerlFloor,
	normalizePerlVersion,
	parsePerlProject,
	perlGithubJobs,
	readPerlProject,
	renderPerlGitLabCI,
	renderPerlWorkflow,
} from '../../../src/languages/perl/ci.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

describe('normalizePerlVersion', () => {
	// The whole reason this function exists: 5.036000 is perl's packed decimal
	// for 5.36.0. Read naively it is minor 36000, which would put a
	// `perl-version: '5.36000'` in the matrix and fail every run.
	it('unpacks the decimal form', () => {
		expect(normalizePerlVersion('5.036000')).toBe('5.36')
	})

	it.each([
		['5.036', '5.36'],
		['5.36', '5.36'],
		['v5.36.0', '5.36'],
		['5.010', '5.10'],
		['5.8.8', '5.8'],
	])('normalizes %s to %s', (raw, expected) => {
		expect(normalizePerlVersion(raw)).toBe(expected)
	})

	it('returns null for something that is not a version', () => {
		expect(normalizePerlVersion('latest')).toBeNull()
	})
})

describe('declaredPerlFloor', () => {
	it.each([
		["requires 'perl', '5.036';", '5.36'],
		["requires 'perl' => '5.036000';", '5.36'],
		["MIN_PERL_VERSION => '5.032',", '5.32'],
		["requires => { perl => '5.038' },", '5.38'],
		['[Prereqs]\nperl = 5.036\n', '5.36'],
	])('reads %s', (contents, expected) => {
		expect(declaredPerlFloor(contents)).toBe(expected)
	})

	it('is null when the distribution declares no floor', () => {
		expect(declaredPerlFloor("requires 'Moose', '2.20';\n")).toBeNull()
	})
})

describe('parsePerlProject', () => {
	it('tests the declared floor and the newest interpreter', () => {
		expect(parsePerlProject("requires 'perl', '5.036';").perlVersions).toEqual(['5.36', '5.42'])
	})

	it('falls back to a floor when the distribution declares none', () => {
		expect(parsePerlProject("requires 'Moose';").perlVersions).toEqual(['5.36', '5.42'])
	})

	// Emitting a matrix entry for an interpreter older than the floor would fail
	// CI on a distribution that correctly declared it doesn't support it.
	it('collapses to one entry when the floor is the newest release', () => {
		expect(parsePerlProject("requires 'perl', '5.042';").perlVersions).toEqual(['5.42'])
	})

	it('collapses when the floor is newer than anything we know about', () => {
		expect(parsePerlProject("requires 'perl', '5.044';").perlVersions).toEqual(['5.44'])
	})
})

describe('readPerlProject', () => {
	it('falls back to the default range with no metadata', async () => {
		expect((await readPerlProject(newTmpDir())).perlVersions).toEqual(['5.36', '5.42'])
	})

	it('reads the floor off a cpanfile', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'cpanfile'), "requires 'perl', '5.038';\n")
		expect((await readPerlProject(dir)).perlVersions).toEqual(['5.38', '5.42'])
	})

	// cpanfile is the modern spelling, so it wins when both are present.
	it('prefers cpanfile over Makefile.PL', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'cpanfile'), "requires 'perl', '5.038';\n")
		await fs.writeFile(join(dir, 'Makefile.PL'), "MIN_PERL_VERSION => '5.010',\n")
		expect((await readPerlProject(dir)).perlVersions).toEqual(['5.38', '5.42'])
	})
})

describe('perlGithubJobs', () => {
	const jobs = perlGithubJobs({ perlVersions: ['5.36', '5.42'] })

	it('lints and tests', () => {
		expect(jobs.map((j) => j.id)).toEqual(['lint', 'test'])
	})

	it('runs both tools — the linter and the formatter', () => {
		const lint = jobs.find((j) => j.id === 'lint')?.steps ?? ''
		expect(lint).toContain('perlcritic')
		expect(lint).toContain('perltidy')
		// perltidy has no reporting check mode, so the gate is the git delta.
		expect(lint).toContain('git diff --exit-code')
	})

	// Perl::Critic is static: pulling the distribution's dependencies would make
	// the lint job fail on a CPAN mirror hiccup unrelated to the code.
	it('does not install the distribution to lint it', () => {
		expect(jobs.find((j) => j.id === 'lint')?.steps).not.toContain('--installdeps')
	})

	it('matrixes the test job over the supported interpreters', () => {
		const test = jobs.find((j) => j.id === 'test')
		expect(test?.extra).toContain("- '5.36'")
		expect(test?.extra).toContain("- '5.42'")
		expect(test?.steps).toContain('prove -lr t')
	})
})

describe('renderPerlWorkflow', () => {
	const workflow = renderPerlWorkflow({ perlVersions: ['5.36', '5.42'] })

	it('wraps the jobs in the shared skeleton', () => {
		expect(workflow).toContain('check-skip:')
		expect(workflow).toMatch(/^name: 🚀 CI\/CD Pipeline/)
	})

	it('satisfies the Perl tests check it is generated for', () => {
		expect(workflow).toMatch(/\bprove\b/)
	})

	it('runs on Linux — nothing here needs a mac runner', () => {
		expect(workflow).not.toContain('macos')
	})

	// The find expression carries quotes, parens and braces; emitted as a plain
	// YAML scalar it would be fragile, so both steps use a block scalar.
	it('puts the find expression inside a block scalar', () => {
		expect(workflow).not.toMatch(/run: find /)
		expect(workflow).toContain('run: |')
	})
})

describe('renderPerlGitLabCI', () => {
	const ci = renderPerlGitLabCI({ perlVersions: ['5.36', '5.42'] })

	it('pins the image to the newest supported interpreter', () => {
		expect(ci).toContain('image: perl:5.42')
	})

	it('derives its stages from the jobs', () => {
		expect(ci).toContain('stages:\n  - lint\n  - test')
	})

	it('runs perlcritic and the test suite', () => {
		expect(ci).toContain('perlcritic')
		expect(ci).toContain('prove -lr t')
	})
})
