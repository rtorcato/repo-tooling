// Shared badge-block builder. All URLs are derived from package.json (name +
// repository) — no hardcoded owner/repo — so it works for any consumer.

export const BADGE_START = '<!-- js-tooling:badges:start -->'
export const BADGE_END = '<!-- js-tooling:badges:end -->'

export interface BadgeInputs {
	/** Package name — drives the npm version/downloads/bundle-size badges. */
	name?: string
	/** GitHub owner + repo — drive the CI + coverage badges. */
	owner?: string
	repo?: string
	/** Default branch used by the coverage badge. Default: `main`. */
	branch?: string
	/** Private or unpublished: skip npm/bundlephobia/coverage (they would 404). */
	isPrivate?: boolean
}

/**
 * Parse a package.json `repository` field into `{ owner, repo }`.
 * Handles the shorthand (`owner/repo`, `github:owner/repo`) and full git URLs
 * (`git+https://github.com/owner/repo.git`, `git@github.com:owner/repo.git`).
 * Returns null for non-GitHub or unparseable values.
 */
export function parseRepository(repository: unknown): { owner: string; repo: string } | null {
	const url =
		typeof repository === 'string'
			? repository
			: repository && typeof repository === 'object'
				? (repository as { url?: unknown }).url
				: undefined
	if (typeof url !== 'string' || url.length === 0) return null

	// `owner/repo` or `github:owner/repo` shorthand (no scheme, no host).
	if (!url.includes('://') && !url.includes('@')) {
		const short = url.replace(/^github:/, '').match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)
		if (short?.[1] && short[2]) return { owner: short[1], repo: short[2] }
	}

	const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:$|[/#?])/)
	return m?.[1] && m[2] ? { owner: m[1], repo: m[2] } : null
}

/**
 * Build the badge markdown row (no delimiter comments). Returns '' when only
 * the always-on license badge would render — i.e. nothing package- or
 * repo-specific is derivable, so a badge row isn't worth adding.
 */
export function buildBadgeRow(inputs: BadgeInputs): string {
	const { name, owner, repo, branch = 'main', isPrivate = false } = inputs
	const slug = owner && repo ? `${owner}/${repo}` : null
	const badges: string[] = []
	let specific = false

	if (slug) {
		specific = true
		badges.push(
			`[![CI](https://github.com/${slug}/actions/workflows/ci.yml/badge.svg)](https://github.com/${slug}/actions/workflows/ci.yml)`
		)
	}
	if (!isPrivate && name) {
		specific = true
		badges.push(
			`[![npm version](https://img.shields.io/npm/v/${name})](https://www.npmjs.com/package/${name})`
		)
		badges.push(
			`[![npm downloads](https://img.shields.io/npm/dm/${name})](https://www.npmjs.com/package/${name})`
		)
		badges.push(
			`[![Bundle size](https://img.shields.io/bundlephobia/minzip/${name})](https://bundlephobia.com/package/${name})`
		)
	}
	if (!isPrivate && slug) {
		badges.push(
			`[![Coverage](https://codecov.io/gh/${slug}/branch/${branch}/graph/badge.svg)](https://codecov.io/gh/${slug})`
		)
	}
	badges.push(
		'[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)'
	)

	return specific ? badges.join('\n') : ''
}

/** Build the full delimited badge block, or '' when there's nothing worth showing. */
export function buildBadgeBlock(inputs: BadgeInputs): string {
	const row = buildBadgeRow(inputs)
	return row ? `${BADGE_START}\n${row}\n${BADGE_END}` : ''
}

/**
 * True when the text carries npm/bundlephobia/codecov badges (which 404 on
 * private/unpublished). Given `name`, npm/bundlephobia badges count only when
 * they point at that package — a README may advertise *other* packages (#634).
 */
export function hasPublicOnlyBadges(text: string, name?: string): boolean {
	if (/codecov\.io/.test(text)) return true
	if (!name) return /img\.shields\.io\/npm\/|bundlephobia/.test(text)
	const refs = text.matchAll(
		/(?:img\.shields\.io\/npm\/[\w-]+|bundlephobia\/[\w-]+|bundlephobia\.com\/package)\/([^\s)"'?#]+)/g
	)
	for (const [, raw = ''] of refs) {
		let ref = raw
		try {
			ref = decodeURIComponent(raw)
		} catch {
			// Malformed escape — compare the raw text.
		}
		if (ref === name || ref.startsWith(`${name}/`)) return true
	}
	return false
}

/**
 * Insert or refresh the badge block in a README. Replaces an existing delimited
 * block in place; otherwise inserts right after the first H1 (or prepends when
 * there is none). Passing an empty block strips any existing one. Idempotent.
 */
export function upsertBadges(readme: string, block: string): string {
	const start = readme.indexOf(BADGE_START)
	const end = readme.indexOf(BADGE_END)
	const hasBlock = start !== -1 && end !== -1 && end > start

	if (!block) {
		if (!hasBlock) return readme
		// Strip the block plus the blank line that follows it, if any.
		const after = readme.slice(end + BADGE_END.length).replace(/^\n\n/, '\n')
		return (readme.slice(0, start).replace(/\n\n$/, '\n') + after).replace(/^\n+/, '')
	}

	if (hasBlock) {
		return readme.slice(0, start) + block + readme.slice(end + BADGE_END.length)
	}

	const lines = readme.split('\n')
	const h1 = lines.findIndex((l) => /^#\s+/.test(l))
	if (h1 === -1) return `${block}\n\n${readme}`
	lines.splice(h1 + 1, 0, '', block)
	return lines.join('\n')
}
