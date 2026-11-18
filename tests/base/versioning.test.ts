import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	ensurePrefixedTag,
	hasVersioningConfig,
	latestSemverTag,
	renderVersionWorkflow,
	scaffoldVersioning,
	VERSIONING_CLI_RANGE,
	VERSION_WORKFLOW,
} from '../../src/base/versioning.js'
import { CHANGESETS_CLI_RANGE } from '../../src/languages/js/checks.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const git = (dir: string, ...args: string[]) =>
	execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', ...args], {
		cwd: dir,
		stdio: 'ignore',
	})

describe('Changesets for versioning only (#1032)', () => {
	it('keeps the CLI range equal to the JS module', () => {
		expect(VERSIONING_CLI_RANGE).toBe(CHANGESETS_CLI_RANGE)
	})

	it('scaffolds a private package, a tagging config and the Version Packages workflow', async () => {
		const dir = newTmpDir()
		const written = await scaffoldVersioning(dir, { name: 'demo' })
		expect(written).toEqual(
			expect.arrayContaining(['package.json', '.changeset/config.json', VERSION_WORKFLOW])
		)
		expect(await fs.readJson(join(dir, 'package.json'))).toMatchObject({
			name: 'demo',
			version: '0.0.0',
			private: true,
		})
		expect(await hasVersioningConfig(dir)).toBe(true)
	})

	it('leaves an existing package.json alone apart from filling in what is missing', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'docs-site',
			version: '4.5.6',
			private: true,
			scripts: { build: 'vite build' },
		})
		await scaffoldVersioning(dir, { name: 'ignored' })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg).toMatchObject({ name: 'docs-site', version: '4.5.6', private: true })
		expect(pkg.scripts).toMatchObject({ build: 'vite build', changeset: 'changeset' })
		expect(pkg.devDependencies['@changesets/cli']).toBe(VERSIONING_CLI_RANGE)
	})

	it('adds privatePackages to an existing config without dropping its keys', async () => {
		const dir = newTmpDir()
		await fs.outputJson(join(dir, '.changeset/config.json'), { baseBranch: 'dev', ignore: ['x'] })
		await scaffoldVersioning(dir, { name: 'demo' })
		const config = await fs.readJson(join(dir, '.changeset/config.json'))
		expect(config).toMatchObject({
			baseBranch: 'dev',
			ignore: ['x'],
			privatePackages: { version: true, tag: true },
		})
	})

	it('seeds the version from the latest semver tag', async () => {
		const dir = newTmpDir()
		git(dir, 'init', '-q')
		git(dir, 'commit', '-q', '--allow-empty', '-m', 'x')
		for (const tag of ['1.2.0', 'v1.10.0', 'v1.9.9', 'nightly']) git(dir, 'tag', tag)
		expect(latestSemverTag(dir)).toBe('1.10.0')
		await scaffoldVersioning(dir, { name: 'demo' })
		expect((await fs.readJson(join(dir, 'package.json'))).version).toBe('1.10.0')
	})

	it('mirrors an unprefixed latest tag as vX.Y.Z so Changesets does not tag it again', () => {
		const dir = newTmpDir()
		git(dir, 'init', '-q')
		git(dir, 'commit', '-q', '--allow-empty', '-m', 'x')
		git(dir, 'tag', '1.0.0')
		expect(ensurePrefixedTag(dir)).toBe('v1.0.0')
		expect(ensurePrefixedTag(dir)).toBeNull()
		const tags = execFileSync('git', ['tag', '--list'], { cwd: dir, encoding: 'utf-8' })
		expect(tags.split('\n').filter(Boolean).sort()).toEqual(['1.0.0', 'v1.0.0'])
	})

	it('leaves an already prefixed tag alone', () => {
		const dir = newTmpDir()
		git(dir, 'init', '-q')
		git(dir, 'commit', '-q', '--allow-empty', '-m', 'x')
		git(dir, 'tag', 'v2.0.0')
		expect(ensurePrefixedTag(dir)).toBeNull()
	})

	// A fresh scaffold sits at 0.0.0 with no changeset pending: the first push to
	// main must not tag v0.0.0 and start a release.
	it('never tags the 0.0.0 placeholder', async () => {
		const dir = newTmpDir()
		await scaffoldVersioning(dir, { name: 'demo' })
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(renderVersionWorkflow()).toContain('publish-script: npm run --silent changeset:tag')
		expect(pkg.scripts['changeset:tag']).toContain("!=='0.0.0'")
		git(dir, 'init', '-q')
		git(dir, 'commit', '-q', '--allow-empty', '-m', 'x')
		const bin = join(dir, 'bin')
		await fs.outputFile(join(bin, 'changeset'), '#!/bin/sh\ntouch "$PWD/tagged"\n', { mode: 0o755 })
		const run = () =>
			execFileSync('npm', ['run', '--silent', 'changeset:tag'], {
				cwd: dir,
				env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
				stdio: 'ignore',
			})
		run()
		expect(await fs.pathExists(join(dir, 'tagged'))).toBe(false)
		await fs.writeJson(join(dir, 'package.json'), { ...pkg, version: '0.0.1' })
		run()
		expect(await fs.pathExists(join(dir, 'tagged'))).toBe(true)
	})

	it('names no owner or account in anything it emits (#1032)', async () => {
		const dir = newTmpDir()
		await scaffoldVersioning(dir, { name: 'demo' })
		const emitted = [
			renderVersionWorkflow(),
			await fs.readFile(join(dir, '.changeset/config.json'), 'utf-8'),
		].join('\n')
		expect(emitted).not.toMatch(/rtorcato/i)
	})

	it('opens the PR ungated and tags on merge', () => {
		const yaml = renderVersionWorkflow()
		expect(yaml).not.toMatch(/^\s+environment:/m)
		expect(yaml).toContain('changeset tag')
		expect(yaml).toContain('RELEASE_TOKEN')
	})
})
