import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { detectLanguage, detectNestedLanguages } from '../../../src/cli/utils/detect-language.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

describe('detectLanguage', () => {
	it('returns unknown for a bare dir with no marker files', async () => {
		expect(await detectLanguage(newTmpDir())).toBe('unknown')
	})

	it.each([
		['package.json', 'js'],
		['Package.swift', 'swift'],
		['cpanfile', 'perl'],
		['Makefile.PL', 'perl'],
		['dist.ini', 'perl'],
		['pyproject.toml', 'python'],
		['setup.py', 'python'],
	])('resolves %s to %s', async (marker, expected) => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, marker), '')
		expect(await detectLanguage(dir)).toBe(expected)
	})

	it('prefers js when package.json coexists with another marker (first match wins)', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'package.json'), '{}')
		await fs.writeFile(join(dir, 'pyproject.toml'), '')
		expect(await detectLanguage(dir)).toBe('js')
	})
})

/** Writes `marker` inside `dir/relative`, creating the path. */
async function seed(dir: string, relative: string, marker: string): Promise<void> {
	await fs.outputFile(join(dir, relative, marker), '')
}

describe('detectNestedLanguages', () => {
	it('finds a JS docs app under a Swift root — the #317 case', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), '')
		await seed(dir, 'apps/docs', 'package.json')
		expect(await detectNestedLanguages(dir, 'swift')).toEqual([
			{ dir: 'apps/docs', language: 'js' },
		])
	})

	it('stays quiet when every package matches the root language', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'package.json'), '{}')
		await seed(dir, 'apps/docs', 'package.json')
		await seed(dir, 'packages/core', 'package.json')
		expect(await detectNestedLanguages(dir, 'js')).toEqual([])
	})

	it('reports every differing package, sorted', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'package.json'), '{}')
		await seed(dir, 'packages/scraper', 'pyproject.toml')
		await seed(dir, 'apps/mobile', 'Package.swift')
		expect(await detectNestedLanguages(dir, 'js')).toEqual([
			{ dir: 'apps/mobile', language: 'swift' },
			{ dir: 'packages/scraper', language: 'python' },
		])
	})

	it('ignores node_modules and dot dirs', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), '')
		await seed(dir, 'node_modules/left-pad', 'package.json')
		await seed(dir, '.venv/lib', 'package.json')
		expect(await detectNestedLanguages(dir, 'swift')).toEqual([])
	})

	it('does not descend into a package it has already reported', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), '')
		await seed(dir, 'docs', 'package.json')
		await seed(dir, 'docs/api', 'pyproject.toml')
		expect(await detectNestedLanguages(dir, 'swift')).toEqual([{ dir: 'docs', language: 'js' }])
	})
})
