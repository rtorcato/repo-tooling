import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkReusableWorkflowPins } from '../../src/base/checks.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()
const SHA = '0123456789abcdef0123456789abcdef01234567'

async function withWorkflow(name: string, body: string): Promise<string> {
	const dir = newTmpDir()
	await fs.outputFile(join(dir, '.github', 'workflows', name), body)
	return dir
}

const caller = (ref: string, quote = '') =>
	`jobs:\n  ci:\n    uses: ${quote}rtorcato/repo-tooling/.github/workflows/js-ci.yml${ref}${quote}\n`

describe('Reusable workflow pins (#1038)', () => {
	it('is not applicable without a workflows directory', async () => {
		const r = await checkReusableWorkflowPins(newTmpDir())
		expect(r.status).toBe('ok')
		expect(r.detail).toMatch(/not applicable/)
	})

	it('ignores workflows that call no repo-tooling reusable workflow', async () => {
		const dir = await withWorkflow(
			'ci.yml',
			'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v7\n  b:\n    uses: ./.github/workflows/local.yml\n  c:\n    uses: other/repo/.github/workflows/x.yml@main\n'
		)
		const r = await checkReusableWorkflowPins(dir)
		expect(r.status).toBe('ok')
		expect(r.detail).toMatch(/not applicable/)
	})

	it('passes a full commit SHA with a version comment', async () => {
		const dir = await withWorkflow('ci.yml', caller(`@${SHA} # v7.0.0`))
		const r = await checkReusableWorkflowPins(dir)
		expect(r.status).toBe('ok')
		expect(r.detail).toMatch(/1 repo-tooling reusable workflow call pinned/)
	})

	it('passes a quoted, upper-case SHA', async () => {
		const dir = await withWorkflow('ci.yaml', caller(`@${SHA.toUpperCase()}`, "'"))
		expect((await checkReusableWorkflowPins(dir)).status).toBe('ok')
	})

	it.each([
		['a branch', '@main'],
		['a tag', '@v7.0.0'],
		['a short SHA', `@${SHA.slice(0, 7)}`],
		['a 41-character ref', `@${SHA}0`],
	])('flags %s', async (_, ref) => {
		const dir = await withWorkflow('ci.yml', caller(ref))
		const r = await checkReusableWorkflowPins(dir)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain(`ci.yml:3 (${ref})`)
		expect(r.hint).toMatch(/full 40-character commit SHA/)
	})

	it('flags a call with no ref, quoted or not, and matches the owner case-insensitively', async () => {
		const dir = await withWorkflow(
			'ci.yml',
			'jobs:\n  ci:\n    uses: "RTorcato/Repo-Tooling/.github/workflows/js-ci.yml"\n'
		)
		const r = await checkReusableWorkflowPins(dir)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('ci.yml:3 (no ref)')
	})

	it('skips commented-out calls', async () => {
		const dir = await withWorkflow(
			'ci.yml',
			`# uses: rtorcato/repo-tooling/.github/workflows/js-ci.yml@main\n${caller(`@${SHA}`)}`
		)
		expect((await checkReusableWorkflowPins(dir)).status).toBe('ok')
	})

	it('lists every unpinned call across files and ignores non-YAML files', async () => {
		const dir = await withWorkflow('a.yml', caller('@main'))
		await fs.outputFile(join(dir, '.github', 'workflows', 'b.yml'), caller(`@${SHA}`))
		await fs.outputFile(join(dir, '.github', 'workflows', 'c.yml'), caller('@v1'))
		await fs.outputFile(join(dir, '.github', 'workflows', 'notes.md'), caller('@main'))
		const r = await checkReusableWorkflowPins(dir)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('a.yml:3 (@main), c.yml:3 (@v1)')
		expect(r.detail).not.toContain('notes.md')
	})
})
