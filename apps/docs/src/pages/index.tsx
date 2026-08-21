import Link from '@docusaurus/Link'
import CodeBlock from '@theme/CodeBlock'
import Layout from '@theme/Layout'
import TabItem from '@theme/TabItem'
import Tabs from '@theme/Tabs'
import { siblings } from '@rtorcato/shared-docs'
import clsx from 'clsx'
import type { ReactElement } from 'react'
import InstallTabs from '@site/src/components/InstallTabs'
import styles from './index.module.css'

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

type IconKey = 'spark' | 'wand' | 'stethoscope' | 'bot'

type IconProps = {
	icon: IconKey
	title: string
	className?: string
	size?: number
}

function Icon({ icon, title, className, size = 22 }: IconProps): ReactElement {
	return (
		<svg
			className={className}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.6}
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
		>
			<title>{title}</title>
			{ICONS[icon]}
		</svg>
	)
}

const ICONS: Record<IconKey, ReactElement> = {
	spark: (
		<>
			<path d="M12 3v3" />
			<path d="M12 18v3" />
			<path d="m5.6 5.6 2.1 2.1" />
			<path d="m16.3 16.3 2.1 2.1" />
			<path d="M3 12h3" />
			<path d="M18 12h3" />
			<path d="m5.6 18.4 2.1-2.1" />
			<path d="m16.3 7.7 2.1-2.1" />
		</>
	),
	wand: (
		<>
			<path d="m3 21 9-9" />
			<path d="M15 6h.01" />
			<path d="M20 12h.01" />
			<path d="M15 18h.01" />
			<path d="m12 3 2 2-2 2-2-2z" />
		</>
	),
	stethoscope: (
		<>
			<path d="M6 4v6a5 5 0 0 0 10 0V4" />
			<path d="M4 4h4" />
			<path d="M14 4h4" />
			<circle cx="11" cy="19" r="2" />
			<path d="M11 17v-2" />
		</>
	),
	bot: (
		<>
			<rect x="4" y="8" width="16" height="12" rx="2" />
			<path d="M12 4v4" />
			<circle cx="9" cy="13" r="1" />
			<circle cx="15" cy="13" r="1" />
			<path d="M9 17h6" />
		</>
	),
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

type Pillar = {
	title: string
	desc: string
	icon: IconKey
}

const PILLARS: Pillar[] = [
	{
		title: 'Full dev lifecycle',
		desc: 'TypeScript, Biome/ESLint, Vitest/Jest, commitlint, Husky, semantic-release, CI, and security — wired together and validated against each other.',
		icon: 'spark',
	},
	{
		title: 'Setup wizard',
		desc: 'One `npx` command scaffolds a complete project. Interactive prompts pick the right stack for libraries, Next.js apps, Node APIs, and more.',
		icon: 'wand',
	},
	{
		title: 'Doctor + fix',
		desc: 'Audit existing repos for drift; apply missing pieces incrementally with `fix` — your customisations are preserved unless you opt in.',
		icon: 'stethoscope',
	},
	{
		title: 'AI-agent ready',
		desc: 'Every command emits structured JSON via `--json` and accepts `--yes` for non-interactive runs. Built for autonomous coding agents and CI bots.',
		icon: 'bot',
	},
]

type Category = {
	name: string
	desc: string
	chips: string[]
	href: string
}

const CATEGORIES: Category[] = [
	{
		name: 'TypeScript',
		desc: 'Base configs for library, React, Next.js, Node and Express projects.',
		chips: ['base', 'react', 'next', 'node', 'express'],
		href: '/docs/reference/typescript',
	},
	{
		name: 'Linting & formatting',
		desc: 'Biome (recommended) replaces ESLint + Prettier in one fast tool. ESLint config still available for edge cases.',
		chips: ['biome', 'eslint', 'prettier'],
		href: '/docs/reference/biome',
	},
	{
		name: 'Testing',
		desc: 'Vitest config + presets, plus Jest browser/node presets for legacy projects.',
		chips: ['vitest', 'jest', 'playwright'],
		href: '/docs/reference/vitest',
	},
	{
		name: 'Commits & releases',
		desc: 'Conventional commits via commitlint + Husky, automated versioning and npm publish via semantic-release.',
		chips: ['commitlint', 'husky', 'semantic-release'],
		href: '/docs/reference/commitlint',
	},
	{
		name: 'Build & bundle',
		desc: 'tsup for TypeScript libraries, esbuild helpers for custom pipelines.',
		chips: ['tsup', 'esbuild'],
		href: '/docs/reference/tsup',
	},
	{
		name: 'CI workflows',
		desc: 'GitHub Actions templates for CI, docs deploy and dependency review — scaffolded on demand.',
		chips: ['github-actions', 'gitlab-ci', 'docs'],
		href: '/docs/guides/cli',
	},
	{
		name: 'Supply-chain security',
		desc: 'Opt-in Dependabot and CodeQL workflows. Renovate available as an alternative.',
		chips: ['dependabot', 'codeql', 'renovate'],
		href: '/docs/guides/cli',
	},
	{
		name: 'Repo baseline',
		desc: '.editorconfig, .nvmrc, knip, lint-staged, CODEOWNERS — the boring-but-important defaults every repo needs.',
		chips: ['editorconfig', 'nvmrc', 'knip', 'lint-staged'],
		href: '/docs/guides/getting-started',
	},
]

type Example = {
	label: string
	file: string
	language: string
	code: string
}

// Hand-transcribed from the real CLI. When you change what these commands
// print, update the matching entry here — the source of truth for each tab is
// src/cli/commands/{setup,doctor,fix}.ts. Lines marked `…` are truncated on
// purpose (a real run prints the full list); nothing else here is invented.
const EXAMPLES: Example[] = [
	{
		label: 'setup',
		file: 'npx @rtorcato/repo-tooling setup --preset library',
		language: 'bash',
		code: `$ npx @rtorcato/repo-tooling setup --preset library

📄 This preset writes 32 files:

   package.json
   .repo-tooling.json
   .editorconfig
   .nvmrc
   .gitignore
   knip.json
   .vscode/extensions.json
   tsconfig.json
   … and 24 more

? 🧹 Uncheck anything you do not want:
❯◉ Git hooks (Husky + lint-staged)
 ◉ Conventional commit linting (commitlint)
 ◉ Automated releases (semantic-release)
 ◉ Security automation (Dependabot + CodeQL)
 ◯ README status badges
 ◯ AI agent rules (AGENTS.md, CLAUDE.md, Cursor, Copilot)

🛠️  Scaffolding library in ~/my-lib

📝 Generating configuration files...

📦 Installing dependencies...

✅ Setup completed successfully!`,
	},
	{
		label: 'doctor',
		file: 'npx @rtorcato/repo-tooling doctor',
		language: 'bash',
		code: `$ npx @rtorcato/repo-tooling doctor

🩺 Diagnosing ~/my-lib against @rtorcato/repo-tooling presets...

  ❌ TypeScript — missing
     no tsconfig.json found
  ⚠️  Release token — drift
     release.yml runs semantic-release with bare GITHUB_TOKEN
  ✅ EditorConfig — ok
     .editorconfig found
  ✅ GitHub Actions — ok
     2 workflows in .github/workflows/
  ➖ Dependabot — not configured
     no Dependabot or Renovate config
  … 47 more checks

  Summary: 48 ok, 1 drift, 1 missing, 2 not configured

  Next steps:
    - Run \`npx @rtorcato/repo-tooling fix tsconfig\` to scaffold TypeScript
    - Run \`npx @rtorcato/repo-tooling fix dependabot\` to scaffold Dependabot
    - Run \`npx @rtorcato/repo-tooling fix\` to walk all findings interactively`,
	},
	{
		label: 'fix',
		file: 'npx @rtorcato/repo-tooling fix --yes',
		language: 'bash',
		code: `$ npx @rtorcato/repo-tooling fix --yes

🔧 4 item(s) to address

  TypeScript (missing) → tsconfig
  ✅ wrote tsconfig.json, package.json
     ↻ .repo-tooling.json updated to reflect the new choice
  — Release token: no fixer registered
  Dependabot (optional-missing) → dependabot
  ✅ wrote .github/dependabot.yml, .github/workflows/dependabot-automerge.yml
     ↻ .repo-tooling.json updated to reflect the new choice
  Claude skills (optional-missing) → claude-skills
    skipped — run \`fix claude-skills\` explicitly

  Summary: 2 applied, 1 skipped, 1 unsupported`,
	},
]

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function Hero(): ReactElement {
	return (
		<header className={styles.hero}>
			<div className={styles.heroGlow} aria-hidden />
			<div className={styles.heroInner}>
				<div className={styles.wordmark}>
					<span className={styles.wmJs}>repo</span>
					<span className={styles.wmDash}>-</span>
					<span className={styles.wmTooling}>tooling</span>
				</div>
				<p className={styles.tagline}>
					One package, full dev toolchain. TypeScript, linting, testing, commits, releases — wired
					together and validated against each other.
				</p>

				<div className={styles.heroBody}>
					<CodeWindow />
				</div>

				<div className={styles.heroActions}>
					<div className={styles.heroButtons}>
						<Link
							className={clsx('button button--primary button--lg', styles.cta)}
							to="/docs/guides/getting-started"
						>
							Get started →
						</Link>
						<Link className={clsx('button button--lg', styles.ctaSecondary)} to="/docs/guides/cli">
							CLI reference
						</Link>
					</div>
					<InstallTabs pkg="@rtorcato/repo-tooling" />
				</div>
			</div>
		</header>
	)
}

function CodeWindow(): ReactElement {
	return (
		<div className={styles.codeWindow}>
			<Tabs className={styles.codeTabs} groupId="hero-command">
				{EXAMPLES.map((ex) => (
					<TabItem key={ex.label} value={ex.label} label={ex.label}>
						<div className={styles.codeFile}>{ex.file}</div>
						<CodeBlock language={ex.language} className={styles.codePre}>
							{ex.code}
						</CodeBlock>
					</TabItem>
				))}
			</Tabs>
		</div>
	)
}

function Pillars(): ReactElement {
	return (
		<section className={styles.section}>
			<div className={styles.pillarGrid}>
				{PILLARS.map((p) => (
					<div key={p.title} className={styles.pillar}>
						<div className={styles.pillarIcon}>
							<Icon icon={p.icon} title={p.title} size={20} className={styles.pillarIconSvg} />
						</div>
						<div className={styles.pillarTitle}>{p.title}</div>
						<div className={styles.pillarDesc}>{p.desc}</div>
					</div>
				))}
			</div>
		</section>
	)
}

function Categories(): ReactElement {
	return (
		<section className={styles.section}>
			<div className={styles.sectionHead}>
				<div>
					<h2 className={styles.h2}>What's in the box</h2>
					<p className={styles.sub}>
						Eight focused areas. Pick what you need with the wizard, audit drift with{' '}
						<code>doctor</code>, scaffold individual configs with <code>fix</code>.
					</p>
				</div>
				<Link className={styles.viewAll} to="/docs/guides/cli">
					CLI reference →
				</Link>
			</div>
			<div className={styles.catGrid}>
				{CATEGORIES.map((c) => (
					<Link key={c.name} to={c.href} className={styles.card}>
						<div className={styles.cardHead}>
							<div className={styles.cardName}>{c.name}</div>
						</div>
						<p className={styles.cardDesc}>{c.desc}</p>
						<div className={styles.chips}>
							{c.chips.map((ch) => (
								<span key={ch} className={styles.chip}>
									{ch}
								</span>
							))}
						</div>
					</Link>
				))}
			</div>
		</section>
	)
}

// Sibling projects from the shared single source of truth
// (@rtorcato/shared-docs), excluding repo-tooling itself.
const SIBLINGS = siblings('@rtorcato/repo-tooling')

function Siblings(): ReactElement {
	return (
		<section className={styles.section}>
			<div className={styles.sectionHead}>
				<div>
					<h2 className={styles.h2}>Sibling projects</h2>
					<p className={styles.sub}>
						More from <code>@rtorcato</code> — same conventions, same release pipeline.
					</p>
				</div>
			</div>
			<div className={styles.siblingGrid}>
				{SIBLINGS.map((s) => (
					<Link key={s.name} href={s.href} className={styles.card}>
						<div className={styles.cardHead}>
							<div className={styles.cardName} style={{ color: s.accent }}>
								{s.name}
							</div>
							<div className={styles.cardCount}>{s.dest} ↗</div>
						</div>
						<p className={styles.cardDesc}>{s.tagline}</p>
					</Link>
				))}
			</div>
		</section>
	)
}

export default function Home(): ReactElement {
	return (
		<Layout
			title="repo-tooling"
			description="One package, full dev toolchain. TypeScript, linting, testing, commits, releases — wired together and validated against each other."
		>
			<main>
				<Hero />
				<Pillars />
				<Categories />
				<Siblings />
			</main>
		</Layout>
	)
}
