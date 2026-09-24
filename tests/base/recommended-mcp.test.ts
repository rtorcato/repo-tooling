import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { checkRecommendedMcp } from '../../src/base/checks.js'
import type { McpRecommendation } from '../../src/cli/utils/lockfile.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

describe('checkRecommendedMcp (#534)', () => {
	const pencil: McpRecommendation = {
		name: 'some-server',
		importance: 'important',
		why: 'edits the design files under design/',
	}

	it('quotes importance and why for a server .mcp.json does not declare', async () => {
		const r = await checkRecommendedMcp(newTmpDir(), [pencil])
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toContain('some-server (important) — edits the design files under design/')
		// Advisory: the hint must not point at a fixer, because there isn't one.
		expect(r.hint).toContain('by hand')
		expect(r.hint).not.toContain('fix ')
	})

	it('is ok once .mcp.json declares every recommended server', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, '.mcp.json'), {
			mcpServers: { 'some-server': { command: 'whatever' } },
		})

		const r = await checkRecommendedMcp(dir, [pencil])
		expect(r.status).toBe('ok')
	})

	it('reports only the servers that are absent', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, '.mcp.json'), { mcpServers: { 'some-server': {} } })

		const r = await checkRecommendedMcp(dir, [
			pencil,
			{ name: 'other-server', importance: 'critical', why: 'runs the thing' },
		])
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toContain('other-server (critical)')
		expect(r.detail).not.toContain('some-server')
	})

	it('treats a malformed .mcp.json as declaring nothing rather than erroring', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.mcp.json'), '{ not json')

		const r = await checkRecommendedMcp(dir, [pencil])
		expect(r.status).toBe('optional-missing')
	})
})
