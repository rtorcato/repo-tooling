import { join } from 'node:path'
import fs from 'fs-extra'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	doctorExitCode,
	runDoctor,
	skippedReport,
	summarize,
} from '../../../src/cli/commands/doctor.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

// #1020: a check that did not run must say why, and the summary must name it.
// Runs the real doctor over one fixture per language, offline, so every remote
// check takes its skip path.

const FIXTURES: Record<string, string> = {
	js: 'package.json',
	swift: 'Package.swift',
	python: 'pyproject.toml',
	perl: 'cpanfile',
}

const newTmpDir = useTmpDir()

afterEach(() => vi.restoreAllMocks())

async function project(language: string): Promise<string> {
	const dir = newTmpDir()
	const marker = FIXTURES[language] as string
	await fs.writeFile(
		join(dir, marker),
		marker === 'package.json' ? JSON.stringify({ name: 'demo', version: '0.0.0' }) : ''
	)
	return dir
}

describe.each(Object.keys(FIXTURES))('%s: every skipped check explains itself', (language) => {
	it('--offline: skipped results carry a reason, the summary names them, strict exits 1', async () => {
		const results = await runDoctor(await project(language), { offline: true })
		const skipped = results.filter((r) => r.status === 'skipped')
		expect(skipped.length).toBeGreaterThan(0)
		for (const r of skipped) expect(r.detail.trim(), `${r.check} skipped silently`).toBeTruthy()

		const report = skippedReport(results, null)
		expect(report.skipped.map((s) => s.check)).toEqual(skipped.map((r) => r.check))
		for (const s of report.skipped) {
			expect(s.reason.trim()).toBeTruthy()
			expect(report.line).toContain(s.check)
		}

		const summary = summarize(results)
		expect(doctorExitCode(summary, true)).toBe(1)
	})
})
