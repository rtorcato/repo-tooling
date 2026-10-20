import path from 'node:path'
import fs from '../../base/safe-fs.js'

/**
 * Scaffold a minimal PostCSS config for non-Tailwind CSS pipelines (autoprefixer
 * over your browserslist). Tailwind v4 users get their PostCSS wiring from the
 * Tailwind preset instead (`@tailwindcss/postcss`, which autoprefixes on its
 * own), so this stays out of their way — safe-add never clobbers an existing
 * postcss.config.mjs.
 */
export async function generatePostcss(targetDir: string): Promise<string[]> {
	const dest = path.join(targetDir, 'postcss.config.mjs')
	if (await fs.pathExists(dest)) return []
	await fs.writeFile(dest, POSTCSS_CONFIG)
	return ['postcss.config.mjs']
}

const POSTCSS_CONFIG = `export default {
	plugins: {
		// Adds vendor prefixes based on your browserslist (package.json or
		// .browserslistrc). Add more PostCSS plugins here as needed.
		autoprefixer: {},
	},
}
`
