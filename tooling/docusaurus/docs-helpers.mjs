// Canonical docs-generator helpers for @rtorcato/* repos (shipped by
// @rtorcato/repo-tooling — copy via `repo-tooling copy docusaurus-docs-helpers`).
//
// The pure pieces every subpath-exports package's doc generator needs, so the
// generator script above them stays small and project-specific:
//
//   escapeForMarkdownTable(text)          — make a JSDoc summary safe for a table cell
//   collectExportNames(file)              — recursive `export` parser over a module graph
//   spliceGeneratedBlock(existing, block) — rewrite only the fenced generated region
//
// Zero-config and side-effect free: no paths, no package names, no I/O beyond
// reading the files you hand it, so this file is copied unmodified.
//
//   import {
//     collectExportNames,
//     escapeForMarkdownTable,
//     MARKER_END,
//     MARKER_START,
//     spliceGeneratedBlock,
//   } from './docs-helpers.mjs'

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const EXPORT_NAMED =
	/export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g
const EXPORT_BRACE = /export\s*\{\s*([^}]+)\}/g
// Both re-export forms, any specifier — `export * from …` and
// `export { … } from …`. Non-relative specifiers are filtered below rather than
// in the pattern, so a bare-package re-export is recognised and then skipped
// instead of silently parsed as nothing.
const REEXPORT_FROM = /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g

/**
 * Escape `text` so it survives a markdown table cell.
 *
 * Neutralises raw HTML-ish tags outside code spans, which would otherwise
 * confuse Docusaurus's MDX parser — but keeps them inside backticks, where
 * `Success<T>` and `<br>` are the point. Then escapes pipes everywhere, since
 * one anywhere in the cell breaks the row.
 *
 * Escaping the `<` beats stripping `/<[^>]*>/`: a one-pass tag strip can leave
 * a tag behind on nested input (`<<b>>` -> `<b>`) and silently eats text like
 * `Success<T>` when the JSDoc forgot the backticks.
 *
 * Escape the backslash in the same pass as the pipe, not after it: escaping
 * only `|` turns the input `a\|b` into `a\\|b`, which markdown reads as an
 * escaped backslash followed by a live pipe, and the row breaks anyway.
 */
export function escapeForMarkdownTable(text) {
	return text
		.split(/(`[^`]*`)/)
		.map((part, i) => (i % 2 === 1 ? part : part.replace(/</g, '&lt;')))
		.join('')
		.replace(/[\\|]/g, '\\$&')
}

/**
 * Collect every name `file` exports, following relative re-exports into the
 * files they name. Returns the accumulating `names` set; `seen` guards against
 * an import cycle re-entering a file.
 *
 * For an aliased export the *alias* is the exported name — `export { foo as
 * bar }` exports `bar`, which is what a consumer imports — so this takes the
 * last segment, not the first.
 */
export function collectExportNames(file, names = new Set(), seen = new Set()) {
	if (seen.has(file) || !existsSync(file)) return names
	seen.add(file)
	const src = readFileSync(file, 'utf8')

	for (const m of src.matchAll(EXPORT_NAMED)) names.add(m[1])
	for (const m of src.matchAll(EXPORT_BRACE)) {
		for (const part of m[1].split(',')) {
			const name = part
				.trim()
				.split(/\s+as\s+/)
				.pop()
				?.trim()
			if (name) names.add(name)
		}
	}
	for (const m of src.matchAll(REEXPORT_FROM)) {
		if (!m[1].startsWith('.')) continue
		const base = resolve(dirname(file), m[1].replace(/\.js$/, ''))
		for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
			if (existsSync(candidate)) {
				collectExportNames(candidate, names, seen)
				break
			}
		}
	}
	return names
}

export const MARKER_START =
	'<!-- generated:exports — do not edit; `pnpm docs:generate` rewrites this block -->'
export const MARKER_END = '<!-- /generated:exports -->'

/**
 * Splice `block` into `existing` between the markers. Returns null when the
 * page has no markers, which means "hand-written, leave it alone".
 */
export function spliceGeneratedBlock(existing, block) {
	const start = existing.indexOf(MARKER_START)
	const end = existing.indexOf(MARKER_END)
	if (start === -1 || end === -1 || end < start) return null
	return existing.slice(0, start) + block + existing.slice(end + MARKER_END.length)
}
