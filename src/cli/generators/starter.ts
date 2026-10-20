import fs from '../../base/safe-fs.js'
import path from 'node:path'
import type { ProjectConfig } from '../commands/setup.js'

const HTML = (entry: string) =>
	`<!doctype html>\n<html lang="en">\n\t<head>\n\t\t<meta charset="utf-8" />\n\t\t<title>app</title>\n\t</head>\n\t<body>\n\t\t<div id="root"></div>\n\t\t<script type="module" src="/${entry}"></script>\n\t</body>\n</html>\n`

const NODE: Record<string, string> = {
	'src/index.ts': 'export const greet = (name: string): string => `hello ${name}`\n',
	'src/index.test.ts':
		"import { expect, it } from 'vitest'\nimport { greet } from './index'\n\nit('greets', () => {\n\texpect(greet('world')).toBe('hello world')\n})\n",
}

// `vite build` on an app (not library mode) resolves from index.html, so a bare
// src/ entry is not enough.
const WEB: Record<string, string> = {
	...NODE,
	'index.html': HTML('src/main.ts'),
	'src/main.ts':
		"import { greet } from './index'\n\nconst root = document.querySelector('#root')\nif (root) root.textContent = greet('world')\n",
}

const REACT: Record<string, string> = {
	'src/App.tsx': 'export const App = ({ name }: { name: string }) => <h1>hello {name}</h1>\n',
	'src/App.test.tsx':
		"import { expect, it } from 'vitest'\nimport { App } from './App'\n\nit('builds an element', () => {\n\texpect(App({ name: 'world' }).props.children).toContain('hello ')\n})\n",
	'src/main.tsx':
		"import { createRoot } from 'react-dom/client'\nimport { App } from './App'\n\ncreateRoot(document.querySelector('#root') as HTMLElement).render(<App name=\"world\" />)\n",
	'index.html': HTML('src/main.tsx'),
}

const NEXT: Record<string, string> = {
	'next-env.d.ts': '/// <reference types="next" />\n',
	'app/page.tsx': 'export default function Page() {\n\treturn <h1>hello world</h1>\n}\n',
	'app/layout.tsx':
		'export default function Layout({ children }: { children: React.ReactNode }) {\n\treturn (\n\t\t<html lang="en">\n\t\t\t<body>{children}</body>\n\t\t</html>\n\t)\n}\n',
	'src/page.test.tsx':
		"import { expect, it } from 'vitest'\nimport Page from '../app/page'\n\nit('renders a heading', () => {\n\texpect(Page().type).toBe('h1')\n})\n",
}

/**
 * The entry module and one test a fresh scaffold needs to pass its own
 * `pnpm build` and `pnpm verify` (#821): tsup/esbuild want src/index.ts, vite
 * wants index.html, and vitest exits 1 on "No test files found".
 *
 * Empty unless TypeScript + vitest — the files are .ts and import from vitest.
 * ponytail: jest/JS configs get no starter, add one if a preset ever uses them.
 */
export function starterFiles(config: ProjectConfig): Record<string, string> {
	if (!config.typescript.enabled || config.testing.framework !== 'vitest') return {}
	if (config.vitePlus) return vitePlusStarter(config)
	if (config.projectType === 'nextjs-app') return NEXT
	if (config.projectType === 'react-app') return REACT
	if (config.bundler === 'vite') return WEB
	return NODE
}

/**
 * Vite+ bundles Vitest and re-exports it as `vite-plus/test`, which is the
 * import its `prefer-vite-plus-imports` lint rule wants (#897). A library
 * needs no index.html; an app does, for `vp build`.
 */
function vitePlusStarter(config: ProjectConfig): Record<string, string> {
	const files = config.projectType === 'library' ? NODE : WEB
	return Object.fromEntries(
		Object.entries(files).map(([rel, body]) => [
			rel,
			body.replace("from 'vitest'", "from 'vite-plus/test'"),
		])
	)
}

/** True when the directory already holds source, so no starter is written. */
export async function hasSource(targetDir: string): Promise<boolean> {
	for (const dir of ['src', 'app']) {
		if (await fs.pathExists(path.join(targetDir, dir))) return true
	}
	return false
}

export async function generateStarter(config: ProjectConfig, targetDir: string) {
	for (const [rel, body] of Object.entries(starterFiles(config))) {
		const file = path.join(targetDir, rel)
		if (!(await fs.pathExists(file))) await fs.outputFile(file, body)
	}
}
