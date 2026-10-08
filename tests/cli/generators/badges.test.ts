import { describe, expect, it } from 'vitest'
import {
	BADGE_END,
	BADGE_START,
	buildBadgeBlock,
	buildBadgeRow,
	parseRepository,
	upsertBadges,
} from '../../../src/cli/generators/badges.js'

describe('parseRepository', () => {
	it('parses a git+https url', () => {
		expect(parseRepository('git+https://github.com/rtorcato/js-tooling.git')).toEqual({
			owner: 'rtorcato',
			repo: 'js-tooling',
		})
	})

	it('parses an { url } object and an scp-style git url', () => {
		expect(parseRepository({ url: 'git@github.com:owner/repo.git' })).toEqual({
			owner: 'owner',
			repo: 'repo',
		})
	})

	it('parses the owner/repo and github: shorthands', () => {
		expect(parseRepository('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' })
		expect(parseRepository('github:owner/repo')).toEqual({ owner: 'owner', repo: 'repo' })
	})

	it('returns null for non-GitHub or missing values', () => {
		expect(parseRepository('https://gitlab.com/owner/repo.git')).toBeNull()
		expect(parseRepository(undefined)).toBeNull()
		expect(parseRepository({})).toBeNull()
	})
})

describe('buildBadgeRow', () => {
	it('includes CI, npm, and license for a public repo', () => {
		const row = buildBadgeRow({ name: 'my-lib', owner: 'o', repo: 'r' })
		expect(row).toContain('actions/workflows/ci.yml/badge.svg')
		expect(row).toContain('img.shields.io/npm/v/my-lib')
		expect(row).toContain('img.shields.io/npm/dm/my-lib')
		expect(row).toContain('bundlephobia/minzip/my-lib')
		expect(row).toContain('License-MIT')
	})

	it('drops npm/bundlephobia for a private repo, keeps CI + license', () => {
		const row = buildBadgeRow({ name: 'my-lib', owner: 'o', repo: 'r', isPrivate: true })
		expect(row).toContain('actions/workflows/ci.yml')
		expect(row).toContain('License-MIT')
		expect(row).not.toContain('shields.io/npm')
		expect(row).not.toContain('bundlephobia')
	})

	it('returns empty when only the license badge would render', () => {
		// Private and no repo → nothing package/repo-specific.
		expect(buildBadgeRow({ name: 'x', isPrivate: true })).toBe('')
	})
})

describe('upsertBadges', () => {
	const block = buildBadgeBlock({ name: 'my-lib', owner: 'o', repo: 'r' })

	it('inserts the block right after the first H1', () => {
		const out = upsertBadges('# Title\n\nBody', block)
		const lines = out.split('\n')
		expect(lines[0]).toBe('# Title')
		expect(lines[2]).toBe(BADGE_START)
		expect(out).toContain('Body')
	})

	it('replaces an existing block in place (idempotent)', () => {
		const once = upsertBadges('# Title\n\nBody', block)
		const twice = upsertBadges(once, block)
		expect(twice).toBe(once)
		expect(twice.match(new RegExp(BADGE_START, 'g'))).toHaveLength(1)
	})

	it('strips the block when passed an empty string', () => {
		const withBadges = upsertBadges('# Title\n\nBody', block)
		const stripped = upsertBadges(withBadges, '')
		expect(stripped).not.toContain(BADGE_START)
		expect(stripped).not.toContain(BADGE_END)
		expect(stripped).toContain('# Title')
		expect(stripped).toContain('Body')
	})
})
