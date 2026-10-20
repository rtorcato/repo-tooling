import path from 'node:path'
import fs from '../../base/safe-fs.js'

/**
 * Scaffold Tailwind CSS v4. v4 is CSS-first — there is no `tailwind.config.js`
 * and content is auto-detected, so the whole setup is a PostCSS plugin plus a
 * CSS entry that imports Tailwind. Works uniformly for Vite, Next.js, and any
 * PostCSS-based pipeline. Both files are safe-add — an existing file is never
 * clobbered — so this can also repair a half-wired setup.
 */
export async function generateTailwind(targetDir: string): Promise<string[]> {
	const written: string[] = []

	const postcss = path.join(targetDir, 'postcss.config.mjs')
	if (!(await fs.pathExists(postcss))) {
		await fs.writeFile(postcss, POSTCSS_CONFIG)
		written.push('postcss.config.mjs')
	}

	const cssRel = path.join('src', 'styles', 'globals.css')
	const css = path.join(targetDir, cssRel)
	if (!(await fs.pathExists(css))) {
		await fs.ensureDir(path.dirname(css))
		await fs.writeFile(css, GLOBALS_CSS)
		written.push(cssRel)
	}

	return written
}

const POSTCSS_CONFIG = `export default {
	plugins: {
		'@tailwindcss/postcss': {},
	},
}
`

// v4 config lives in CSS. Import `src/styles/globals.css` from your app entry.
const GLOBALS_CSS = `@import "tailwindcss";
`
