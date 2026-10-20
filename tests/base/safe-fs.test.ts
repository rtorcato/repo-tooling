import os from 'node:os'
import path from 'node:path'
import fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FixerAbort } from '../../src/base/fixers.js'
import safeFs, { setWriteRoot } from '../../src/base/safe-fs.js'
import { generateEditorConfig } from '../../src/cli/generators/misc.js'

// A cloned repo can commit any output file, or a directory above it, as a symlink
// to somewhere outside the checkout. Writes must refuse those (#908).

let tmp: string
let repo: string
let outside: string

beforeEach(async () => {
	tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-fs-'))
	repo = path.join(tmp, 'repo')
	outside = path.join(tmp, 'outside')
	await fs.ensureDir(repo)
	await fs.ensureDir(outside)
	setWriteRoot(repo)
})

afterEach(async () => {
	setWriteRoot(undefined)
	await fs.remove(tmp)
})

describe('safe-fs', () => {
	it('refuses a file symlinked outside the repo and leaves the target alone', async () => {
		await fs.writeFile(path.join(outside, 'zshrc'), 'mine\n')
		await fs.symlink(path.join(outside, 'zshrc'), path.join(repo, '.gitignore'))
		await expect(safeFs.writeFile(path.join(repo, '.gitignore'), 'x')).rejects.toThrow(FixerAbort)
		expect(await fs.readFile(path.join(outside, 'zshrc'), 'utf-8')).toBe('mine\n')
	})

	it('refuses a parent directory symlinked outside the repo', async () => {
		await fs.symlink(outside, path.join(repo, '.github'))
		const dest = path.join(repo, '.github', 'workflows', 'ci.yml')
		await expect(safeFs.outputFile(dest, 'x')).rejects.toThrow(/\.github.*symlink/)
		await expect(safeFs.ensureDir(path.dirname(dest))).rejects.toThrow(FixerAbort)
		expect(await fs.readdir(outside)).toEqual([])
	})

	it('refuses a chmod through a hook symlinked outside the repo', async () => {
		await fs.writeFile(path.join(outside, 'script'), 'lint-staged\n', { mode: 0o644 })
		await fs.ensureDir(path.join(repo, '.husky'))
		await fs.symlink(path.join(outside, 'script'), path.join(repo, '.husky', 'pre-commit'))
		await expect(safeFs.chmod(path.join(repo, '.husky', 'pre-commit'), 0o755)).rejects.toThrow(
			FixerAbort
		)
		expect((await fs.stat(path.join(outside, 'script'))).mode & 0o777).toBe(0o644)
	})

	it('refuses a dangling symlink, which a write would otherwise create', async () => {
		await fs.symlink(path.join(outside, 'new'), path.join(repo, '.nvmrc'))
		await expect(safeFs.writeJson(path.join(repo, '.nvmrc'), {})).rejects.toThrow(FixerAbort)
		expect(await fs.pathExists(path.join(outside, 'new'))).toBe(false)
	})

	it('refuses a relative symlink that climbs out', async () => {
		await fs.writeFile(path.join(tmp, 'src.txt'), 'x')
		await fs.symlink('../outside', path.join(repo, 'docs'))
		await expect(
			safeFs.copy(path.join(tmp, 'src.txt'), path.join(repo, 'docs', 'a.txt'))
		).rejects.toThrow(FixerAbort)
		expect(await fs.readdir(outside)).toEqual([])
	})

	it('writes through a symlink that stays inside the repo', async () => {
		await fs.writeFile(path.join(repo, 'AGENTS.md'), 'old\n')
		await fs.symlink('AGENTS.md', path.join(repo, 'CLAUDE.md'))
		await safeFs.writeFile(path.join(repo, 'CLAUDE.md'), 'new\n')
		expect(await fs.readFile(path.join(repo, 'AGENTS.md'), 'utf-8')).toBe('new\n')
	})

	it('leaves writes outside the root, and writes with no root set, alone', async () => {
		await safeFs.writeFile(path.join(outside, 'preview'), 'x')
		setWriteRoot(undefined)
		await fs.symlink(path.join(outside, 'preview'), path.join(repo, '.editorconfig'))
		await safeFs.writeFile(path.join(repo, '.editorconfig'), 'y')
		expect(await fs.readFile(path.join(outside, 'preview'), 'utf-8')).toBe('y')
	})

	it('guards the generators that import it', async () => {
		await fs.symlink(path.join(outside, 'x'), path.join(repo, '.editorconfig'))
		await expect(generateEditorConfig(repo)).rejects.toThrow(FixerAbort)
	})
})
