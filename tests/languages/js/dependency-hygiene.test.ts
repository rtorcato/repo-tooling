import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	checkConfigSchemaVersions,
	checkGitDependencies,
	checkPeerVersions,
	isGitSpecifier,
	rangeFloor,
	schemaUrlVersion,
} from '../../../src/languages/js/checks.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

/** A dir with a biome.json targeting `schemaVersion`. */
function repoWith(schemaVersion: string, pkg: object, file = 'biome.json'): string {
	const dir = newTmpDir()
	fs.writeFileSync(
		join(dir, file),
		`{\n\t"$schema": "https://biomejs.dev/schemas/${schemaVersion}/schema.json"\n}\n`
	)
	fs.writeJsonSync(join(dir, 'package.json'), pkg)
	return dir
}

describe('rangeFloor', () => {
	it('reads the floor out of the common range operators', () => {
		expect(rangeFloor('^2.0.0')).toEqual([2, 0, 0])
		expect(rangeFloor('~2.5.1')).toEqual([2, 5, 1])
		expect(rangeFloor('2.5.5')).toEqual([2, 5, 5])
		expect(rangeFloor('>=2.1.0 <3.0.0')).toEqual([2, 1, 0])
		expect(rangeFloor('v1.2.3')).toEqual([1, 2, 3])
	})

	it('returns null for ranges with no single floor', () => {
		expect(rangeFloor('*')).toBeNull()
		expect(rangeFloor('workspace:*')).toBeNull()
		expect(rangeFloor('catalog:')).toBeNull()
		expect(rangeFloor('2.x')).toBeNull()
	})
})

describe('schemaUrlVersion', () => {
	it('reads the version out of a versioned schema URL', () => {
		expect(schemaUrlVersion('https://biomejs.dev/schemas/2.5.0/schema.json')).toEqual([2, 5, 0])
	})

	it('returns null for an unversioned URL', () => {
		expect(schemaUrlVersion('https://biomejs.dev/schemas/latest/schema.json')).toBeNull()
		expect(schemaUrlVersion('https://json.schemastore.org/package.json')).toBeNull()
	})
})

describe('checkConfigSchemaVersions', () => {
	it('passes when there is no versioned config schema to compare', async () => {
		expect((await checkConfigSchemaVersions(newTmpDir(), {})).status).toBe('ok')
	})

	// The actual #330 defect: a preset written for 2.5 shipped under a ^2.0.0
	// peer range, so consumers on 2.0-2.4 got an unknown-key parse error.
	it('flags a config targeting a version above the declared peer floor', async () => {
		const dir = repoWith('2.5.0', { peerDependencies: { '@biomejs/biome': '^2.0.0' } })
		const r = await checkConfigSchemaVersions(dir, {
			peerDependencies: { '@biomejs/biome': '^2.0.0' },
		})
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toContain('2.5.0')
		expect(r.detail).toContain('^2.0.0')
	})

	// The same failure one level down — this is what broke js-common's lint.
	it('flags it in a consuming repo via devDependencies', async () => {
		const dir = repoWith('2.5.0', {})
		const r = await checkConfigSchemaVersions(dir, {
			devDependencies: { '@biomejs/biome': '^2.3.0' },
		})
		expect(r.status).toBe('optional-missing')
	})

	it('passes when the declared floor covers the schema version', async () => {
		const dir = repoWith('2.5.0', {})
		const r = await checkConfigSchemaVersions(dir, {
			devDependencies: { '@biomejs/biome': '^2.5.0' },
		})
		expect(r.status).toBe('ok')
	})

	// A floor above the schema version is fine — the config is older than the
	// tool, which parses it happily.
	it('does not flag a floor above the schema version', async () => {
		const dir = repoWith('2.5.0', {})
		const r = await checkConfigSchemaVersions(dir, {
			devDependencies: { '@biomejs/biome': '^2.6.0' },
		})
		expect(r.status).toBe('ok')
	})

	it('ignores the config when the tool is not a declared dependency', async () => {
		const dir = repoWith('2.5.0', {})
		expect((await checkConfigSchemaVersions(dir, { devDependencies: {} })).status).toBe('ok')
	})

	// Biome configs may be JSONC, where a comment defeats JSON.parse.
	it('reads $schema out of a config with comments', async () => {
		const dir = newTmpDir()
		fs.writeFileSync(
			join(dir, 'biome.jsonc'),
			'{\n\t// linter preset\n\t"$schema": "https://biomejs.dev/schemas/2.5.0/schema.json"\n}\n'
		)
		const r = await checkConfigSchemaVersions(dir, {
			devDependencies: { '@biomejs/biome': '^2.0.0' },
		})
		expect(r.status).toBe('optional-missing')
	})
})

describe('isGitSpecifier', () => {
	it('recognises the git protocols and the GitHub shorthand', () => {
		expect(isGitSpecifier('github:rtorcato/shared-docs')).toBe(true)
		expect(isGitSpecifier('gitlab:owner/repo')).toBe(true)
		expect(isGitSpecifier('git+https://example.com/a/b.git')).toBe(true)
		expect(isGitSpecifier('git://example.com/a/b.git')).toBe(true)
		expect(isGitSpecifier('rtorcato/shared-docs')).toBe(true)
		expect(isGitSpecifier('rtorcato/shared-docs#main')).toBe(true)
	})

	it('does not mistake ordinary specifiers for git ones', () => {
		for (const spec of [
			'^2.0.0',
			'2.5.5',
			'*',
			'workspace:*',
			'catalog:',
			'npm:@scope/pkg@1.0.0',
			'file:../local',
			'link:../local',
			'../local',
			'https://example.com/x.tar.gz',
		]) {
			expect(isGitSpecifier(spec), spec).toBe(false)
		}
	})
})

describe('checkGitDependencies', () => {
	it('passes when there are none', () => {
		expect(checkGitDependencies({ dependencies: { chalk: '^5.0.0' } }).status).toBe('ok')
		expect(checkGitDependencies(null).status).toBe('ok')
	})

	// The actual #332 defect.
	it('flags a refless git dependency', () => {
		const r = checkGitDependencies({
			dependencies: { '@rtorcato/shared-docs': 'github:rtorcato/shared-docs' },
		})
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toContain('@rtorcato/shared-docs')
	})

	it('accepts a git dependency carrying any explicit ref', () => {
		for (const spec of [
			'github:rtorcato/shared-docs#main',
			'github:rtorcato/shared-docs#semver:^1.2.0',
			'git+https://example.com/a/b.git#v1.0.0',
		]) {
			expect(checkGitDependencies({ dependencies: { dep: spec } }).status, spec).toBe('ok')
		}
	})

	it('looks in devDependencies and optionalDependencies too', () => {
		expect(checkGitDependencies({ devDependencies: { a: 'github:o/r' } }).status).toBe(
			'optional-missing'
		)
		expect(checkGitDependencies({ optionalDependencies: { a: 'github:o/r' } }).status).toBe(
			'optional-missing'
		)
	})

	it('reports every offender, not just the first', () => {
		const r = checkGitDependencies({
			dependencies: { a: 'github:o/a', b: 'github:o/b#main' },
			devDependencies: { c: 'gitlab:o/c' },
		})
		expect(r.detail).toContain('a (github:o/a)')
		expect(r.detail).toContain('c (gitlab:o/c)')
		expect(r.detail).not.toContain('b (')
	})
})

describe('checkPeerVersions', () => {
	/** A consumer repo with repo-tooling and the given peers installed. */
	function consumer(peers: Record<string, string>, installed: Record<string, string>): string {
		const dir = newTmpDir()
		fs.outputJsonSync(join(dir, 'node_modules/@rtorcato/repo-tooling/package.json'), {
			name: '@rtorcato/repo-tooling',
			peerDependencies: peers,
		})
		for (const [name, version] of Object.entries(installed)) {
			fs.outputJsonSync(join(dir, `node_modules/${name}/package.json`), { name, version })
		}
		return dir
	}

	it('passes when no peer is installed', async () => {
		const r = await checkPeerVersions(consumer({ '@biomejs/biome': '^2.5.0' }, {}), {})
		expect(r.status).toBe('ok')
	})

	// The actual #591 defect: Biome 2.4.5 under a ^2.5.0 peer range, which
	// surfaces only as an unknown-key error inside the shipped preset.
	it('flags a peer installed below the declared floor', async () => {
		const dir = consumer({ '@biomejs/biome': '^2.5.0' }, { '@biomejs/biome': '2.4.5' })
		const r = await checkPeerVersions(dir, {})
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('@biomejs/biome 2.4.5 installed')
	})

	it('accepts a newer major and an or-range above its floor', async () => {
		const dir = consumer(
			{ typescript: '>=5.0.0', '@commitlint/cli': '^20.0.0 || ^21.0.0' },
			{ typescript: '6.1.0', '@commitlint/cli': '21.2.0' }
		)
		expect((await checkPeerVersions(dir, {})).status).toBe('ok')
	})

	it('reads its own package.json when run against this package', async () => {
		const dir = consumer({}, { '@biomejs/biome': '2.4.5' })
		const r = await checkPeerVersions(dir, {
			name: '@rtorcato/repo-tooling',
			peerDependencies: { '@biomejs/biome': '^2.5.0' },
		})
		expect(r.status).toBe('drift')
	})
})
