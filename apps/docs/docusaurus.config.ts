import type * as Preset from '@docusaurus/preset-classic'
import type { Config } from '@docusaurus/types'
import { GITHUB_PROFILE, projectFamilyItems } from '@rtorcato/shared-docs'
import { themes as prismThemes } from 'prism-react-renderer'

// The @rtorcato open-source family, from the shared single source of truth
// (@rtorcato/shared-docs). Surfaced as a navbar "Projects" dropdown (Docusaurus
// renders navbar items in the mobile menu too) and in the footer, so every
// sibling site cross-links to the rest.
const PROJECT_FAMILY = projectFamilyItems()

const config: Config = {
	title: 'repo-tooling',
	tagline:
		"One CLI to scaffold, audit and fix your repo's whole toolchain — linting, tests, commits, releases & CI.",
	favicon: 'img/favicon.ico',

	url: 'https://rtorcato.github.io',
	baseUrl: '/repo-tooling/',

	organizationName: 'rtorcato',
	projectName: 'repo-tooling',

	onBrokenLinks: 'warn',

	markdown: {
		format: 'detect',
		hooks: {
			onBrokenMarkdownLinks: 'warn',
		},
	},

	i18n: {
		defaultLocale: 'en',
		locales: ['en'],
	},

	headTags: [
		{
			tagName: 'link',
			attributes: { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
		},
		{
			tagName: 'link',
			attributes: {
				rel: 'preconnect',
				href: 'https://fonts.gstatic.com',
				crossorigin: 'anonymous',
			},
		},
	],

	presets: [
		[
			'classic',
			{
				docs: {
					sidebarPath: './sidebars.ts',
					routeBasePath: '/docs',
					editUrl: 'https://github.com/rtorcato/repo-tooling/edit/main/apps/docs/',
				},
				blog: false,
				theme: {
					customCss: './src/css/custom.css',
				},
			} satisfies Preset.Options,
		],
	],

	plugins: [
		[
			'@easyops-cn/docusaurus-search-local',
			{
				hashed: true,
				indexDocs: true,
				indexBlog: false,
				docsRouteBasePath: '/docs',
				highlightSearchTermsOnTargetPage: true,
				searchBarShortcutHint: false,
			},
		],
	],

	themeConfig: {
		colorMode: {
			defaultMode: 'dark',
			respectPrefersColorScheme: true,
		},
		navbar: {
			title: 'repo-tooling',
			logo: {
				alt: 'repo-tooling',
				src: 'img/logo.svg',
				srcDark: 'img/logo-dark.svg',
			},
			items: [
				{ to: '/docs', position: 'left', label: 'Docs' },
				{ to: '/docs/guides', position: 'left', label: 'Guides' },
				{ to: '/docs/reference', position: 'left', label: 'Reference' },
				{
					type: 'dropdown',
					label: 'Projects',
					position: 'left',
					items: [{ label: 'All on GitHub →', href: GITHUB_PROFILE }, ...PROJECT_FAMILY],
				},
				{
					href: 'https://github.com/rtorcato/repo-tooling',
					label: 'GitHub',
					position: 'right',
				},
				{
					href: 'https://www.npmjs.com/package/@rtorcato/repo-tooling',
					label: 'npm',
					position: 'right',
				},
			],
		},
		footer: {
			style: 'dark',
			links: [
				{
					title: 'Documentation',
					items: [
						{ label: 'Getting Started', to: '/docs/guides/getting-started' },
						{ label: 'CLI', to: '/docs/guides/cli' },
						{ label: 'For AI Agents', to: '/docs/guides/for-ai-agents' },
						{ label: 'Library style guide', to: '/docs/guides/library-style' },
						{ label: 'Changelog', to: '/docs/changelog' },
					],
				},
				{
					title: 'Resources',
					items: [
						{ label: 'GitHub', href: 'https://github.com/rtorcato/repo-tooling' },
						{ label: 'npm', href: 'https://www.npmjs.com/package/@rtorcato/repo-tooling' },
						{ label: 'Issues', href: 'https://github.com/rtorcato/repo-tooling/issues' },
					],
				},
				{
					title: 'Projects',
					items: PROJECT_FAMILY,
				},
				{
					title: 'Community',
					items: [
						{ label: 'Issues', href: 'https://github.com/rtorcato/repo-tooling/issues' },
						{
							label: 'License (MIT)',
							href: 'https://github.com/rtorcato/repo-tooling/blob/main/LICENSE',
						},
						{ label: '@rtorcato', href: GITHUB_PROFILE },
					],
				},
			],
			copyright: `Copyright © ${new Date().getFullYear()} Richard Torcato. Built with Docusaurus.`,
		},
		// `theme` is the LIGHT-mode Prism theme, `darkTheme` the dark one (#324).
		prism: {
			theme: prismThemes.vsLight,
			darkTheme: prismThemes.vsDark,
			additionalLanguages: ['bash', 'json', 'typescript'],
		},
	} satisfies Preset.ThemeConfig,
}

export default config
