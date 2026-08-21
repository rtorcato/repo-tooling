import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
	docs: [
		{
			type: 'category',
			label: 'Start here',
			collapsed: false,
			items: ['index', 'guides/getting-started'],
		},
		{
			type: 'category',
			label: 'Guides',
			collapsed: false,
			// Landing page at /docs/guides (the nav "Guides" link) — lists every
			// guide as a card so the menu link lands on an index, not the first page.
			link: {
				type: 'generated-index',
				title: 'Guides',
				description:
					'How to set up, audit, and keep a project in sync with the repo-tooling standard.',
				slug: '/guides',
			},
			items: [
				'guides/cli',
				'guides/for-ai-agents',
				'guides/ai-setup',
				'guides/ai-issue-loop',
				'guides/library-style',
				'guides/swift',
				'guides/dependabot-strategy',
				'guides/git-flow',
				'guides/public-repo-issue-safety',
				'guides/docs-site',
				'guides/brand-assets',
			],
		},
		{
			type: 'category',
			label: 'Configuration Reference',
			collapsed: false,
			// Landing page at /docs/reference (the nav "Reference" link) — lists
			// every tool config as a card instead of jumping straight to Biome.
			link: {
				type: 'generated-index',
				title: 'Configuration Reference',
				description: 'The base config for each tool repo-tooling ships. Pick a tool below.',
				slug: '/reference',
			},
			items: [
				'reference/biome',
				'reference/bun',
				'reference/changesets',
				'reference/commitlint',
				'reference/cypress',
				'reference/docusaurus',
				'reference/esbuild',
				'reference/eslint',
				'reference/github-actions',
				'reference/jest',
				'reference/nx',
				'reference/oxlint',
				'reference/perl',
				'reference/postcss',
				'reference/prettier',
				'reference/publint',
				'reference/python',
				'reference/release-please',
				'reference/rolldown',
				'reference/rollup',
				'reference/semantic-release',
				'reference/swift',
				'reference/tailwind',
				'reference/tsup',
				'reference/turborepo',
				'reference/typescript',
				'reference/vitest',
			],
		},
		{
			type: 'category',
			label: 'Releases',
			items: ['changelog'],
		},
	],
}

export default sidebars
