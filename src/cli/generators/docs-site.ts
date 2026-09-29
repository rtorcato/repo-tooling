import path from 'node:path'
import fs from 'fs-extra'
import selfPackageJson from '../../../package.json' with { type: 'json' }
import { CI_WORKFLOW_NAME } from '../../base/ci.js'
import { coverageUploadWorkflow } from '../../base/checks.js'
import { jsBadgeAudience } from '../../languages/js/checks.js'
import { copyPreset, PRESETS } from '../utils/copy-preset.js'
import { buildBadgeRow, parseRepository } from './badges.js'
import { syncBrandToDocs } from './brand.js'
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

// One range for every @docusaurus/* package; TypeScript tracks repo-tooling's own devDependency (tested).
export const DOCUSAURUS_RANGE = '^3.10.2'
export const TYPESCRIPT_RANGE = '~7.0.2'

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

function docusaurusConfig(meta: SiteMeta, typedocModules: string[], hasLogo: boolean): string {
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
\t\timage: 'img/social-card.png',
\t\tcolorMode: {
\t\t\tdefaultMode: 'dark',
\t\t\trespectPrefersColorScheme: true,
\t\t},
\t\tnavbar: {
\t\t\ttitle: '${meta.title}',
${hasLogo ? `\t\t\tlogo: { alt: ${jsString(meta.title)}, src: 'img/favicon.svg' },\n` : ''}
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
    // TypeScript 7 removed \`baseUrl\` and \`moduleResolution: node\`.
    "paths": { "@site/*": ["./*"] },
    "strict": true,
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowJs": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/", "docusaurus.config.ts", "sidebars.ts"],
  "exclude": [".docusaurus", "build", "node_modules"]
}
`

function customCss(accent: { light: string; dark: string }): string {
	// Import the shared tokens, then override only the accent (per #54's model).
	return `/* biome-ignore-all lint/complexity/noImportantStyles: the mobile drawer must beat Infima's transform */
/* Site theme: the shared design tokens + this project's accent. */
@import "./_jt-tokens.css";
@import "./theme.css";

:root {
\t--ifm-color-primary: ${accent.light};
\t--jt-accent: ${accent.light};
}

[data-theme="dark"] {
\t--ifm-color-primary: ${accent.dark};
\t--jt-accent: ${accent.dark};
}

${MOBILE_MENU_CSS}`
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
			'@docusaurus/core': DOCUSAURUS_RANGE,
			'@docusaurus/preset-classic': DOCUSAURUS_RANGE,
			'@easyops-cn/docusaurus-search-local': '^0.55.2',
			'@mdx-js/react': '^3.1.0',
			clsx: '^2.1.1',
			'prism-react-renderer': '^2.4.1',
			react: '^19.0.0',
			'react-dom': '^19.0.0',
		},
		devDependencies: {
			'@docusaurus/module-type-aliases': DOCUSAURUS_RANGE,
			'@docusaurus/tsconfig': DOCUSAURUS_RANGE,
			'@docusaurus/types': DOCUSAURUS_RANGE,
			'@rtorcato/repo-tooling': SELF_RANGE,
			'@types/react': '^19.0.0',
			typescript: TYPESCRIPT_RANGE,
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
  # The changelog page is built from GitHub Releases. A release created with
  # GITHUB_TOKEN never fires \`release: published\`, so rebuild once CI (which
  # runs semantic-release) succeeds on main instead — no PAT needed (#691).
  workflow_run:
    workflows: ['${CI_WORKFLOW_NAME}']
    types: [completed]
    branches: [main]
  workflow_dispatch:

jobs:
  docs:
    if: github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'
    permissions:
      contents: read
      pages: write
      id-token: write
    uses: rtorcato/repo-tooling/.github/workflows/docs-deploy.yml@main
    with:
      build-filter: '${meta.docsPkgName}'
`
}

// routeBasePath is '/docs', so without a page of its own the site root — and the
// navbar logo — would 404 (#664). Tabs/no semicolons to match the Biome preset
// the consuming repo is linted with.
function homePage(meta: SiteMeta, install: string | null): string {
	const installBlock = install
		? `\t\t\t\t<pre className={styles.install}>
\t\t\t\t\t<code>{${jsString(install)}}</code>
\t\t\t\t</pre>
`
		: ''
	return `import Link from '@docusaurus/Link'
import Layout from '@theme/Layout'
import styles from './index.module.css'

// Placeholder pillars — replace with what the project is actually about.
const PILLARS = [
\t{ title: 'Pillar one', body: 'One sentence on the first thing that sets this project apart.' },
\t{ title: 'Pillar two', body: 'One sentence on the second thing.' },
\t{ title: 'Pillar three', body: 'One sentence on the third thing.' },
]

export default function Home() {
\treturn (
\t\t<Layout title={${jsString(meta.title)}} description={${jsString(meta.tagline)}}>
\t\t\t<header className={styles.hero}>
\t\t\t\t<h1 className={styles.title}>{${jsString(meta.title)}}</h1>
\t\t\t\t<p className={styles.tagline}>{${jsString(meta.tagline)}}</p>
${installBlock}\t\t\t\t<Link className="button button--primary button--lg" to="/docs">
\t\t\t\t\tGet started
\t\t\t\t</Link>
\t\t\t</header>
\t\t\t<main className={styles.pillars}>
\t\t\t\t{PILLARS.map((p) => (
\t\t\t\t\t<section key={p.title} className={styles.pillar}>
\t\t\t\t\t\t<h2>{p.title}</h2>
\t\t\t\t\t\t<p>{p.body}</p>
\t\t\t\t\t</section>
\t\t\t\t))}
\t\t\t</main>
\t\t</Layout>
\t)
}
`
}

const HOME_CSS = `.hero {
\tpadding: 5rem 1rem 3rem;
\ttext-align: center;
}

.title {
\tfont-size: clamp(2.5rem, 6vw, 4rem);
\tmargin-bottom: 0.5rem;
}

.tagline {
\tfont-size: 1.25rem;
\tcolor: var(--jt-muted);
\tmax-width: 40rem;
\tmargin: 0 auto 1.5rem;
}

.install {
\tdisplay: inline-block;
\tpadding: 0.75rem 1.25rem;
\tmargin-bottom: 1.5rem;
\tbackground: var(--jt-code-bg);
\tborder: 1px solid var(--jt-border);
\tborder-radius: 12px;
}

.pillars {
\tdisplay: grid;
\tgap: 1rem;
\tgrid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
\tmax-width: 64rem;
\tmargin: 0 auto;
\tpadding: 1rem 1rem 4rem;
}

.pillar {
\tpadding: 1.25rem;
\tbackground: var(--jt-surface);
\tborder: 1px solid var(--jt-border);
\tborder-radius: 14px;
}

.pillar:hover {
\tborder-color: var(--jt-accent-border);
}
`

/** Mobile drawer swizzle: one flat menu mirroring the navbar (docs + GitHub). */
function mobilePrimaryMenu(ghUrl: string): string {
	return `import Link from '@docusaurus/Link'
import { useLocation } from '@docusaurus/router'
import useBaseUrl from '@docusaurus/useBaseUrl'
import { type ReactElement, useEffect, useRef } from 'react'

/**
 * Swizzled (replace) theme/Navbar/MobileSidebar/PrimaryMenu: a single flat
 * list instead of the primary→secondary drawer flow. Keep ITEMS in step with the
 * navbar in docusaurus.config.ts by hand.
 *
 * On doc pages the doc plugin's mobile-sidebar filler makes Layout set \`inert\`
 * on the primary panel, which leaves these links unclickable — a
 * MutationObserver strips it. The drawer also stops auto-closing after the
 * swizzle, so each link tap clicks \`.navbar-sidebar__close\` on the next tick.
 */
const ITEMS: Array<{ label: string; to?: string; href?: string }> = [
\t{ label: 'Docs', to: '/docs' },
\t{ label: 'GitHub', href: ${jsString(ghUrl)} },
]

function closeDrawer(): void {
\tsetTimeout(() => document.querySelector<HTMLButtonElement>('.navbar-sidebar__close')?.click(), 0)
}

function MenuLink({ item }: { item: (typeof ITEMS)[number] }): ReactElement {
\tconst { pathname } = useLocation()
\tconst resolved = useBaseUrl(item.to ?? '/')
\tconst isActive = item.to !== undefined && pathname === resolved
\tconst className = [
\t\t'jt-mobile-menu__link',
\t\tisActive && 'jt-mobile-menu__link--active',
\t\titem.href && 'jt-mobile-menu__external',
\t]
\t\t.filter(Boolean)
\t\t.join(' ')
\tconst linkProps = item.href ? { href: item.href } : { to: item.to ?? '/' }
\treturn (
\t\t<li>
\t\t\t<Link
\t\t\t\tclassName={className}
\t\t\t\t{...linkProps}
\t\t\t\tonClick={closeDrawer}
\t\t\t\taria-current={isActive ? 'page' : undefined}
\t\t\t>
\t\t\t\t{item.label}
\t\t\t</Link>
\t\t</li>
\t)
}

export default function NavbarMobilePrimaryMenu(): ReactElement {
\tconst ref = useRef<HTMLUListElement>(null)

\tuseEffect(() => {
\t\tconst panel = ref.current?.closest<HTMLElement>('.navbar-sidebar__item')
\t\tif (!panel) return
\t\tconst strip = () => panel.removeAttribute('inert')
\t\tstrip()
\t\tconst observer = new MutationObserver(strip)
\t\tobserver.observe(panel, { attributes: true, attributeFilter: ['inert'] })
\t\treturn () => observer.disconnect()
\t}, [])

\treturn (
\t\t<ul ref={ref} className="jt-mobile-menu">
\t\t\t{ITEMS.map((item) => (
\t\t\t\t<MenuLink key={item.label} item={item} />
\t\t\t))}
\t\t</ul>
\t)
}
`
}

const MOBILE_SECONDARY_MENU = `/**
 * Swizzled (replace) theme/Navbar/MobileSidebar/SecondaryMenu — disabled, so the
 * drawer stays on the flat PrimaryMenu. The CSS in custom.css locks the items
 * container so the primary panel never slides away.
 */
export default function NavbarMobileSidebarSecondaryMenu(): null {
\treturn null
}
`

const MOBILE_MENU_CSS = `/* Mobile drawer: one flat menu (see src/theme/Navbar/MobileSidebar). */
.navbar-sidebar__items,
.navbar-sidebar__items.navbar-sidebar__items--show-secondary {
\ttransform: translate3d(0, 0, 0) !important;
}
.navbar-sidebar__items > .navbar-sidebar__item:nth-child(2),
.navbar-sidebar__back {
\tdisplay: none !important;
}
.jt-mobile-menu {
\tdisplay: flex;
\tflex-direction: column;
\tgap: 4px;
\tpadding: 4px 0;
\tmargin: 0;
\tlist-style: none;
}
.jt-mobile-menu__link {
\tdisplay: block;
\tpadding: 12px 14px;
\tborder-radius: 8px;
\tcolor: var(--jt-heading);
\tfont-weight: 600;
\tfont-size: 15px;
\ttext-decoration: none;
}
.jt-mobile-menu__link:hover,
.jt-mobile-menu__link:focus-visible {
\tbackground: var(--jt-surface2);
\tcolor: var(--jt-heading);
\ttext-decoration: none;
}
.jt-mobile-menu__link--active {
\tbackground: var(--jt-accent-soft);
\tcolor: var(--jt-accent);
}
.jt-mobile-menu__external::after {
\tcontent: " ↗";
\tcolor: var(--jt-faint);
\tfont-weight: 400;
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
	written.push(...(await copyPresetIfMissing('docusaurus-theme', targetDir)))

	// The docs homepage carries the same badge set as the README (#169), derived
	// from package.json + repo; visibility-aware (private repos drop npm/coverage).
	// Plain row (no upsert delimiters) to stay MDX-safe in the generated intro.
	// Bundlephobia only for a published library, Codecov only when CI uploads
	// coverage — the same rules doctor's badge/coverage checks use (#675).
	const badges = buildBadgeRow({
		name: pkg?.name as string | undefined,
		owner: meta.owner ?? undefined,
		repo: meta.repo ?? undefined,
		isPrivate: pkg?.private === true,
		bundled: jsBadgeAudience(pkg) === 'public',
		uploadsCoverage: (await coverageUploadWorkflow(targetDir)) !== null,
	})

	// Opt-in TypeDoc API section (#229): only wire it when enabled AND the
	// package actually exposes source modules to document.
	const typedocModules = options.typedoc ? inferTypedocModules(pkg) : []

	// Project-specific scaffold.
	const files: Array<[string, string]> = [
		[`${DOCS_APP}/package.json`, docsPackageJson(meta, typedocModules.length > 0)],
		[
			`${DOCS_APP}/docusaurus.config.ts`,
			docusaurusConfig(
				meta,
				typedocModules,
				await fs.pathExists(path.join(targetDir, 'brand', 'favicon.svg'))
			),
		],
		[`${DOCS_APP}/sidebars.ts`, SIDEBARS],
		[`${DOCS_APP}/tsconfig.json`, TSCONFIG],
		[`${DOCS_APP}/src/css/custom.css`, customCss(accent)],
		[
			`${DOCS_APP}/src/pages/index.tsx`,
			homePage(meta, pkg?.name && pkg.private !== true ? `npm i ${pkg.name}` : null),
		],
		[`${DOCS_APP}/src/pages/index.module.css`, HOME_CSS],
		[
			`${DOCS_APP}/src/theme/Navbar/MobileSidebar/PrimaryMenu/index.tsx`,
			mobilePrimaryMenu(
				`https://github.com/${meta.owner ?? 'your-org'}/${meta.repo ?? meta.title}`
			),
		],
		[`${DOCS_APP}/src/theme/Navbar/MobileSidebar/SecondaryMenu/index.tsx`, MOBILE_SECONDARY_MENU],
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

	// static/img always exists (the config points at img/favicon.ico); the brand
	// assets go in when brand/ has them (#680).
	await fs.ensureDir(path.join(targetDir, DOCS_APP, 'static', 'img'))
	written.push(...(await syncBrandToDocs(targetDir)))

	const ws = await ensureWorkspace(targetDir)
	if (ws) written.push(ws)

	return written
}

/** Copy a shipped preset only when its target file is absent. */
async function copyPresetIfMissing(
	name: 'docusaurus-sync-changelog' | 'docusaurus-theme-tokens' | 'docusaurus-theme',
	targetDir: string
): Promise<string[]> {
	const rel = PRESETS[name].target
	if (await fs.pathExists(path.join(targetDir, rel))) return []
	const res = await copyPreset(name, targetDir)
	return [res.target]
}
