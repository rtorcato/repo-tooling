import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { generateCommunityHealth } from '../../../src/cli/generators/community-health.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

describe('generateCommunityHealth', () => {
	it('scaffolds all five community-health files', async () => {
		const dir = newTmpDir()
		const written = await generateCommunityHealth(dir)
		expect(written).toEqual([
			'CONTRIBUTING.md',
			'SECURITY.md',
			'.github/PULL_REQUEST_TEMPLATE.md',
			'.github/ISSUE_TEMPLATE/bug_report.md',
			'.github/ISSUE_TEMPLATE/feature_request.md',
		])
		for (const rel of written) {
			expect(await fs.pathExists(join(dir, rel))).toBe(true)
		}
	})

	it('is safe-add: leaves an existing file untouched and reports only new files', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'CONTRIBUTING.md'), 'MY OWN CONTRIBUTING\n')

		const written = await generateCommunityHealth(dir)

		expect(written).not.toContain('CONTRIBUTING.md')
		expect(written).toContain('SECURITY.md')
		expect(await fs.readFile(join(dir, 'CONTRIBUTING.md'), 'utf-8')).toBe('MY OWN CONTRIBUTING\n')
	})

	it('writes nothing on a second run', async () => {
		const dir = newTmpDir()
		await generateCommunityHealth(dir)
		expect(await generateCommunityHealth(dir)).toEqual([])
	})
})

describe('generateCommunityHealth on a repo with no language marker (#1008)', () => {
	it('writes no pnpm commands and no example.com placeholder', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'run.sh'), '#!/bin/sh\n')
		const written = await generateCommunityHealth(dir)
		expect(written).toHaveLength(5)
		for (const rel of written) {
			const text = await fs.readFile(join(dir, rel), 'utf-8')
			expect(text, rel).not.toMatch(/pnpm|example\.com/)
		}
	})

	it('never ships the example.com placeholder, even for a JS repo', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'x' })
		await generateCommunityHealth(dir)
		expect(await fs.readFile(join(dir, 'SECURITY.md'), 'utf-8')).not.toContain('example.com')
		expect(await fs.readFile(join(dir, 'CONTRIBUTING.md'), 'utf-8')).toContain('pnpm')
	})
})
