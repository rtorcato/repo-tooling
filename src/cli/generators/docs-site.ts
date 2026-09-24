import path from 'node:path'
import fs from 'fs-extra'
import selfPackageJson from '../../../package.json' with { type: 'json' }
import { copyPreset, PRESETS } from '../utils/copy-preset.js'
import { buildBadgeRow, parseRepository } from './badges.js'
import { DOCS_SITE_BUILDS, mergeAllowBuilds } from './pnpm-workspace.js'
import { inferSubpathsFromExports } from './treeshake.js'

type Pkg = Record<string, unknown> | null

/**
 * What a scaffolded docs site should depend on for *this* CLI — read from the
 * running version rather than written down, because a literal here goes stale
 * silently. It had drifted to `^2.47.0`, two majors behind, so every site
 * scaffolded since was handed a pre-rename version predating the peer-dependency
 * split.
 *
 * The floor is the exact running version, not `^<major>.0.0`: the config being
 * generated is the one this version emits, and claiming compatibility back to
 * the start of the major would be the same over-wide-range problem doctor's
 * `Config schema versions` check exists to catch (#330).
 */
const SELF_RANGE = `^${selfPackageJson.version}`

/**
 * Docs-site (Docusaurus) generator — the Phase 2 counterpart to the shared
 * assets shipped in #54. Scaffolds a working Docusaurus site under `apps/docs`,
 * inferring name/org/repo from package.json (+ the shared design tokens and
 * sync-changelog script), matching the layout the `Docs site` doctor check
 * verifies. Every file is written only when absent, so `fix docs-site` is
 * idempotent and never clobbers a hand-edited site.
 */

const DOCS_APP = 'apps/docs'
/** Docusaurus's neutral green — the default accent, meant to be branded over. */
const DEFAULT_ACCENT = { light: '#2e8555', dark: '#25c2a0' }

export interface DocsSiteOptions {
	/** Accent colour override, e.g. Cloudflare orange. Falls back per project. */
	primaryColor?: { light: string; dark: string }
	/**
	 * Wire an opt-in TypeDoc API-reference section (#229): one
	 * `docusaurus-plugin-typedoc` instance per source module, generating
	 * `docs/api/<id>` from JSDoc. Modules are inferred from the package's
	 * single-segment subpath exports. No-op when there are none to document.
	 */
	typedoc?: boolean
}

/**
 * Source modules to document with TypeDoc: single-segment subpath exports
 * (`./errors` → `errors`), which map to `src/<id>/index.ts`. Multi-segment
 * subpaths (`./typescript/base`) are config/asset exports, not source modules,
 * so they're filtered out.
 */
function inferTypedocModules(pkg: Pkg): string[] {
	return inferSubpathsFromExports(pkg).allCandidates.filter((id) => !id.includes('/'))
}

interface SiteMeta {
	/** Docs package name, e.g. `@rtorcato/repo-tooling-docs`. */
	docsPkgName: string
	/** Site title shown in the navbar. */
	title: string
	tagline: string
	owner: string | null
	repo: string | null
}

/** Derive the docs package name from the consumer's own name (`<name>-docs`). */
function docsPackageName(pkgName: string | undefined): string {
	if (!pkgName) return 'docs'
	return `${pkgName}-docs`
}

function inferSiteMeta(pkg: Pkg): SiteMeta {
	const pkgName = pkg?.name as string | undefined
	const parsed = parseRepository(pkg?.repository)
	const base = pkgName ? (pkgName.split('/').pop() ?? pkgName) : 'docs'
	return {
		docsPkgName: docsPackageName(pkgName),
		title: parsed?.repo ?? base,
		tagline: (pkg?.description as string | undefined) ?? 'Documentation',
		owner: parsed?.owner ?? null,
		repo: parsed?.repo ?? null,
	}
}

/** Write `contents` at `rel` under targetDir only if it doesn't already exist. */
async function writeIfMissing(
	targetDir: string,
	rel: string,
	contents: string
): Promise<string | null> {
	const file = path.join(targetDir, rel)
	if (await fs.pathExists(file)) return null
	await fs.ensureDir(path.dirname(file))
	await fs.writeFile(file, contents)
	return rel
}

/**
 * Ensure `pnpm-workspace.yaml` lists `apps/*` and approves the site's build
 * scripts (idempotent).
 */
async function ensureWorkspace(targetDir: string): Promise<string | null> {
	const rel = 'pnpm-workspace.yaml'
	const file = path.join(targetDir, rel)
	const body = (await fs.pathExists(file)) ? await fs.readFile(file, 'utf8') : ''
	let next = body
	// Already a workspace covering apps/* (either `apps/*` or a broader glob).
	if (!/^\s*-\s*['"]?apps\/\*/m.test(body)) {
		next = /^packages:/m.test(body)
			? body.replace(/^packages:\n/m, "packages:\n  - 'apps/*'\n")
			: `packages:\n  - 'apps/*'\n${body ? `\n${body}` : ''}`
	}
	next = mergeAllowBuilds(next, DOCS_SITE_BUILDS)
	if (next === body) return null
	await fs.writeFile(file, next)
	return rel
}

/**
 * A JS string literal in the Biome preset's quote style: single quotes, unless
 * the value holds more single than double quotes — the same pick Biome makes.
 */
function jsString(value: string): string {
	const singles = value.split("'").length - 1
	const doubles = value.split('"').length - 1
	if (singles > doubles) return JSON.stringify(value)
	return `'${JSON.stringify(value).slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'")}'`
}

function docusaurusConfig(meta: SiteMeta, typedocModules: string[]): string {
	const owner = meta.owner ?? 'your-org'
	const repo = meta.repo ?? meta.title
	const ghUrl = `https://github.com/${owner}/${repo}`
	// TypeDoc plugins (opt-in) generate docs/api/<id>; the autogenerated sidebar
	// picks the api/ folder up automatically, so no sidebar change is needed.
	const typedocImport = typedocModules.length
		? "import { getTypedocPlugins } from '@rtorcato/repo-tooling/docusaurus'\n"
		: ''
	const typedocPlugins = typedocModules.length
		? `\t\t...getTypedocPlugins([${typedocModules.map(jsString).join(', ')}]),\n`
		: ''
	return `import type * as Preset from '@docusaurus/preset-classic'
import type { Config } from '@docusaurus/types'
import { themes as prismThemes } from 'prism-react-renderer'
${typedocImport}
const config: Config = {
\ttitle: '${meta.title}',
\ttagline: ${jsString(meta.tagline)},
\tfavicon: 'img/favicon.ico',

\turl: 'https://${owner}.github.io',
\tbaseUrl: '/${repo}/',

\torganizationName: '${owner}',
\tprojectName: '${repo}',

\tonBrokenLinks: 'warn',

\tmarkdown: {
\t\tformat: 'detect',
\t\thooks: {
\t\t\tonBrokenMarkdownLinks: 'warn',
\t\t},
\t},

\ti18n: {
\t\tdefaultLocale: 'en',
\t\tlocales: ['en'],
\t},

\tpresets: [
\t\t[
\t\t\t'classic',
\t\t\t{
\t\t\t\tdocs: {
\t\t\t\t\tsidebarPath: './sidebars.ts',
\t\t\t\t\trouteBasePath: '/docs',
\t\t\t\t\teditUrl: '${ghUrl}/edit/main/apps/docs/',
\t\t\t\t},
\t\t\t\tblog: false,
\t\t\t\ttheme: {
\t\t\t\t\tcustomCss: './src/css/custom.css',
\t\t\t\t},
\t\t\t} satisfies Preset.Options,
\t\t],
\t],

\tplugins: [
${typedocPlugins}\t\t[
\t\t\t'@easyops-cn/docusaurus-search-local',
\t\t\t{
\t\t\t\thashed: true,
\t\t\t\tindexDocs: true,
\t\t\t\tindexBlog: false,
\t\t\t\tdocsRouteBasePath: '/docs',
\t\t\t\thighlightSearchTermsOnTargetPage: true,
\t\t\t\tsearchBarShortcutHint: false,
\t\t\t},
\t\t],
\t],

\tthemeConfig: {
\t\tcolorMode: {
\t\t\tdefaultMode: 'dark',
\t\t\trespectPrefersColorScheme: true,
\t\t},
\t\tnavbar: {
\t\t\ttitle: '${meta.title}',
\t\t\titems: [
\t\t\t\t{ to: '/docs', position: 'left', label: 'Docs' },
\t\t\t\t{
\t\t\t\t\thref: '${ghUrl}',
\t\t\t\t\tlabel: 'GitHub',
\t\t\t\t\tposition: 'right',
\t\t\t\t},
\t\t\t],
\t\t},
\t\tfooter: {
\t\t\tstyle: 'dark',
\t\t\tlinks: [
\t\t\t\t{
\t\t\t\t\ttitle: 'Docs',
\t\t\t\t\titems: [{ label: 'Getting Started', to: '/docs' }],
\t\t\t\t},
\t\t\t\t{
\t\t\t\t\ttitle: 'More',
\t\t\t\t\titems: [
\t\t\t\t\t\t{ label: 'GitHub', href: '${ghUrl}' },
\t\t\t\t\t\t{ label: 'Issues', href: '${ghUrl}/issues' },
\t\t\t\t\t],
\t\t\t\t},
\t\t\t],
\t\t\tcopyright: \`Copyright © \${new Date().getFullYear()} ${meta.title}. Built with Docusaurus.\`,
\t\t},
\t\t// \`theme\` is the LIGHT-mode Prism theme and \`darkTheme\` the dark one. Both
\t\t// were vsDark here, which is why the shared stylesheet had to pin fenced
\t\t// blocks dark in light mode too (#324). Keep this pairing and the CSS in
\t\t// step — vsDark tokens on a light surface are unreadable.
\t\tprism: {
\t\t\ttheme: prismThemes.vsLight,
\t\t\tdarkTheme: prismThemes.vsDark,
\t\t\tadditionalLanguages: ['bash', 'json', 'typescript'],
\t\t},
\t} satisfies Preset.ThemeConfig,
}

export default config
`
}

const SIDEBARS = `import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

// Autogenerated from the docs/ folder structure — add markdown files and they
// appear here. Swap for an explicit list when you want to control ordering.
const sidebars: SidebarsConfig = {
\tdocs: [{ type: 'autogenerated', dirName: '.' }],
}

export default sidebars
`

const TSCONFIG = `// Improves IDE type-checking; not used by \`docusaurus start/build\`.
{
  "compilerOptions": {
    "baseUrl": ".",
    "ignoreDeprecations": "6.0",
    "strict": true,
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "allowJs": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "exclude": [".docusaurus", "build"]
}
`

function customCss(accent: { light: string; dark: string }): string {
	// Import the shared tokens, then override only the accent (per #54's model).
	return `/* Site theme: the shared design tokens + this project's accent. */
@import "./_jt-tokens.css";

:root {
\t--ifm-color-primary: ${accent.light};
\t--jt-accent: ${accent.light};
}

[data-theme="dark"] {
\t--ifm-color-primary: ${accent.dark};
\t--jt-accent: ${accent.dark};
}
`
}

function docsPackageJson(meta: SiteMeta, typedoc: boolean): string {
	const typedocDevDeps = typedoc
		? {
				'@rtorcato/repo-tooling': SELF_RANGE,
				'docusaurus-plugin-typedoc': '^1.4.0',
				typedoc: '^0.28.0',
				'typedoc-plugin-markdown': '^4.9.0',
			}
		: {}
	const pkg = {
		name: meta.docsPkgName,
		version: '0.0.1',
		private: true,
		scripts: {
			docusaurus: 'docusaurus',
			'sync-changelog': 'node ../../scripts/sync-changelog.mjs',
			// pnpm 8 doesn't run pre* hooks reliably — chain sync-changelog explicitly.
			start: 'pnpm run sync-changelog && docusaurus start',
			dev: 'pnpm run sync-changelog && docusaurus start',
			build: 'pnpm run sync-changelog && docusaurus build',
			serve: 'docusaurus serve',
			clear: 'docusaurus clear',
			typecheck: 'tsc --noEmit',
		},
		dependencies: {
			'@docusaurus/core': '^3.10.2',
			'@docusaurus/preset-classic': '^3.8.1',
			'@easyops-cn/docusaurus-search-local': '^0.55.2',
			'@mdx-js/react': '^3.1.0',
			clsx: '^2.1.1',
			'prism-react-renderer': '^2.4.1',
			react: '^19.0.0',
			'react-dom': '^19.0.0',
		},
		devDependencies: {
			'@docusaurus/module-type-aliases': '^3.10.2',
			'@docusaurus/tsconfig': '^3.8.1',
			'@docusaurus/types': '^3.10.2',
			'@rtorcato/repo-tooling': SELF_RANGE,
			'@types/react': '^19.0.0',
			typescript: '~5.6.3',
			...typedocDevDeps,
		},
		browserslist: {
			production: ['>0.5%', 'not dead', 'not op_mini all'],
			development: ['last 3 chrome version', 'last 3 firefox version', 'last 5 safari version'],
		},
		engines: { node: '>=22.0' },
	}
	return `${JSON.stringify(pkg, null, 2)}\n`
}

function introDoc(meta: SiteMeta, badges: string): string {
	return `---
title: ${meta.title}
slug: /
sidebar_position: 0
---

# ${meta.title}
${badges ? `\n${badges}\n` : ''}
${meta.tagline}

Welcome to the docs. Edit \`apps/docs/docs/intro.md\` to get started, and add
more markdown files under \`apps/docs/docs/\` — they appear in the sidebar
automatically.
`
}

/** The per-repo workflow that drives the shared reusable deploy on push to main. */
function docsWorkflow(meta: SiteMeta): string {
	return `name: 📚 Docs
on:
  push:
    branches: [main]
    paths:
      - 'apps/docs/**'
      - '.github/workflows/docs.yml'
  # The changelog page is built from GitHub Releases, and no release commit
  # lands on main any more (see #417) — so a push trigger alone would never
  # rebuild the site after a release.
  release:
    types: [published]
  workflow_dispatch:

jobs:
  docs:
    permissions:
      contents: read
      pages: write
      id-token: write
    uses: rtorcato/repo-tooling/.github/workflows/docs-deploy.yml@main
    with:
      build-filter: '${meta.docsPkgName}'
`
}

// routeBasePath is '/docs', so the site root has no page of its own and the
// navbar logo links to a 404 on every page (#664). Redirect it to the docs.
// Tabs/no semicolons to match the Biome preset the consuming repo is linted with.
const HOME_PAGE = `import { Redirect } from '@docusaurus/router'
import useBaseUrl from '@docusaurus/useBaseUrl'

export default function Home() {
\treturn <Redirect to={useBaseUrl('/docs')} />
}
`

/**
 * Scaffold the Docusaurus docs site. Writes each file only when missing and
 * returns the relative paths actually written, so `fix docs-site` is safe to
 * re-run. Also drops in the shared sync-changelog script + design tokens.
 */
export async function generateDocsSite(
	pkg: Pkg,
	targetDir: string,
	options: DocsSiteOptions = {}
): Promise<string[]> {
	const meta = inferSiteMeta(pkg)
	const accent = options.primaryColor ?? DEFAULT_ACCENT
	const written: string[] = []

	// Shared assets (only-if-missing copies of the shipped presets).
	written.push(...(await copyPresetIfMissing('docusaurus-sync-changelog', targetDir)))
	written.push(...(await copyPresetIfMissing('docusaurus-theme-tokens', targetDir)))

	// The docs homepage carries the same badge set as the README (#169), derived
	// from package.json + repo; visibility-aware (private repos drop npm/coverage).
	// Plain row (no upsert delimiters) to stay MDX-safe in the generated intro.
	const badges = buildBadgeRow({
		name: pkg?.name as string | undefined,
		owner: meta.owner ?? undefined,
		repo: meta.repo ?? undefined,
		isPrivate: pkg?.private === true,
	})

	// Opt-in TypeDoc API section (#229): only wire it when enabled AND the
	// package actually exposes source modules to document.
	const typedocModules = options.typedoc ? inferTypedocModules(pkg) : []

	// Project-specific scaffold.
	const files: Array<[string, string]> = [
		[`${DOCS_APP}/package.json`, docsPackageJson(meta, typedocModules.length > 0)],
		[`${DOCS_APP}/docusaurus.config.ts`, docusaurusConfig(meta, typedocModules)],
		[`${DOCS_APP}/sidebars.ts`, SIDEBARS],
		[`${DOCS_APP}/tsconfig.json`, TSCONFIG],
		[`${DOCS_APP}/src/css/custom.css`, customCss(accent)],
		[`${DOCS_APP}/src/pages/index.tsx`, HOME_PAGE],
		[`${DOCS_APP}/docs/intro.md`, introDoc(meta, badges)],
		['.github/workflows/docs.yml', docsWorkflow(meta)],
	]
	// TypeDoc emits docs/api/<id> on build — keep the generated tree out of git.
	if (typedocModules.length) {
		files.push([
			`${DOCS_APP}/.gitignore`,
			'# Generated by TypeDoc on build\ndocs/api/\n\n# Docusaurus build artifacts\nbuild/\n.docusaurus/\n',
		])
	}
	for (const [rel, contents] of files) {
		const w = await writeIfMissing(targetDir, rel, contents)
		if (w) written.push(w)
	}

	const ws = await ensureWorkspace(targetDir)
	if (ws) written.push(ws)

	return written
}

/** Copy a shipped preset only when its target file is absent. */
async function copyPresetIfMissing(
	name: 'docusaurus-sync-changelog' | 'docusaurus-theme-tokens',
	targetDir: string
): Promise<string[]> {
	const rel = PRESETS[name].target
	if (await fs.pathExists(path.join(targetDir, rel))) return []
	const res = await copyPreset(name, targetDir)
	return [res.target]
}
