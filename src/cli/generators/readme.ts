import fs from 'fs-extra'
import path from 'node:path'
import type { ProjectConfig } from '../commands/setup.js'
import { buildBadgeBlock, parseRepository } from './badges.js'

export async function generateReadme(config: ProjectConfig, targetDir: string) {
	const readmePath = path.join(targetDir, 'README.md')
	const badges = config.badges ? await buildReadmeBadgeBlock(config, targetDir) : ''

	const readme = `# ${config.projectName}
${badges ? `\n${badges}\n` : ''}
> Generated with [@rtorcato/repo-tooling](https://www.npmjs.com/package/@rtorcato/repo-tooling)

## Description

Your project description here.

## Installation

\`\`\`bash
# Using pnpm (recommended)
pnpm install

# Using npm
npm install

# Using yarn
yarn install
\`\`\`

## Development

${generateDevelopmentSection(config)}

## Testing

${generateTestingSection(config)}

## Building

${generateBuildingSection(config)}

## Scripts

${generateScriptsSection(config)}

## Project Structure

\`\`\`
${config.projectName}/
├── src/                 # Source code
${config.typescript.enabled ? '├── reset.d.ts           # TypeScript reset types' : ''}
${config.testing.framework !== 'none' ? '├── tests/              # Test files' : ''}
├── dist/               # Build output${config.projectType === 'library' ? ' (library)' : ''}
├── package.json
${config.typescript.enabled ? '├── tsconfig.json        # TypeScript configuration' : ''}
${config.linting.tool === 'biome' || config.linting.tool === 'both' ? '├── biome.json           # Biome configuration' : ''}
${config.linting.tool === 'eslint' || config.linting.tool === 'both' ? '├── eslint.config.mjs    # ESLint configuration' : ''}
${config.linting.tool === 'eslint' ? '├── prettier.config.mjs  # Prettier configuration' : ''}
${config.testing.framework === 'vitest' ? '├── vitest.config.ts     # Vitest configuration' : ''}
${config.testing.framework === 'jest' ? '├── jest.config.mjs     # Jest configuration' : ''}
${config.testing.framework === 'playwright' ? '├── playwright.config.ts # Playwright configuration' : ''}
${config.testing.framework === 'cypress' ? '├── cypress.config.ts   # Cypress configuration' : ''}
${config.bundler === 'tsup' ? '├── tsup.config.ts       # tsup configuration' : ''}
${config.bundler === 'esbuild' ? '├── build.mjs           # esbuild configuration' : ''}
${config.bundler === 'rollup' ? '├── rollup.config.mjs   # Rollup configuration' : ''}
${config.bundler === 'rolldown' ? '├── rolldown.config.mjs # Rolldown configuration' : ''}
${config.bundler === 'vite' ? '├── vite.config.ts       # Vite configuration' : ''}
${config.commitLint ? '├── commitlint.config.mjs # Commitlint configuration' : ''}
${config.gitHooks ? '├── .husky/             # Git hooks' : ''}
└── README.md
\`\`\`

## Tooling

This project uses:

${generateToolingList(config)}

## Contributing

1. Fork the repository
2. Create your feature branch (\`git checkout -b feature/amazing-feature\`)
3. Commit your changes (\`git commit -m 'feat: add amazing feature'\`)
4. Push to the branch (\`git push origin feature/amazing-feature\`)
5. Open a Pull Request

${
	config.commitLint
		? `
### Commit Convention

This project follows [Conventional Commits](https://conventionalcommits.org/):

- \`feat:\` new features
- \`fix:\` bug fixes
- \`docs:\` documentation changes
- \`style:\` formatting changes
- \`refactor:\` code refactoring
- \`test:\` adding or updating tests
- \`chore:\` maintenance tasks

Run \`pnpm commit\` for a guided prompt (commitizen) that builds a compliant
message; commitlint enforces the same rules on every commit.
`
		: ''
}

## License

[Add your license here]
`

	await fs.writeFile(readmePath, readme)
}

/**
 * Build the badge block for a generated README. URLs are derived from the
 * target's package.json (name + repository); visibility falls back to the
 * project type (libraries are public, apps private) when `private` is unset.
 */
export async function buildReadmeBadgeBlock(
	config: ProjectConfig,
	targetDir: string
): Promise<string> {
	let repository: unknown
	let isPrivate = config.projectType !== 'library'
	const pkgPath = path.join(targetDir, 'package.json')
	if (await fs.pathExists(pkgPath)) {
		const pkg = (await fs.readJson(pkgPath)) as Record<string, unknown>
		repository = pkg.repository
		if (typeof pkg.private === 'boolean') isPrivate = pkg.private
	}
	const parsed = parseRepository(repository)
	return buildBadgeBlock({
		name: config.projectName,
		owner: parsed?.owner,
		repo: parsed?.repo,
		isPrivate,
	})
}

function generateDevelopmentSection(config: ProjectConfig): string {
	const sections = []

	if (config.bundler === 'vite') {
		sections.push('```bash\npnpm dev\n```')
	} else {
		sections.push('Start development by running your preferred development server.')
	}

	if (config.linting.tool !== 'none') {
		const lintCommand =
			config.linting.tool === 'biome' || config.linting.tool === 'both'
				? 'pnpm check:fix'
				: 'pnpm lint:fix'
		sections.push(`\n### Linting & Formatting\n\n\`\`\`bash\n${lintCommand}\n\`\`\``)
	}

	if (config.typescript.enabled) {
		sections.push('\n### Type Checking\n\n```bash\npnpm typecheck\n```')
	}

	return sections.length > 0 ? sections.join('\n') : 'No specific development commands configured.'
}

function generateTestingSection(config: ProjectConfig): string {
	if (config.testing.framework === 'none') {
		return 'No testing framework configured.'
	}

	const commands = []

	if (config.testing.framework === 'vitest') {
		commands.push('pnpm test          # Run tests')
		commands.push('pnpm test:watch    # Run tests in watch mode')
		commands.push('pnpm test:ui       # Run tests with UI')
		commands.push('pnpm coverage      # Generate coverage report')
	} else if (config.testing.framework === 'jest') {
		commands.push('pnpm test          # Run tests')
		commands.push('pnpm test:watch    # Run tests in watch mode')
		commands.push('pnpm coverage      # Generate coverage report')
	} else if (config.testing.framework === 'playwright') {
		commands.push('pnpm test:e2e      # Run E2E tests')
		commands.push('pnpm test:e2e:ui   # Run E2E tests with UI')
	} else if (config.testing.framework === 'cypress') {
		commands.push('pnpm test:e2e      # Run E2E tests (headless)')
		commands.push('pnpm test:e2e:ui   # Open the Cypress runner')
	}

	return `\`\`\`bash\n${commands.join('\n')}\n\`\`\``
}

function generateBuildingSection(config: ProjectConfig): string {
	if (config.bundler === 'none') {
		return 'No build configuration set up.'
	}

	return '```bash\npnpm build\n```'
}

function generateScriptsSection(config: ProjectConfig): string {
	const scripts = []

	scripts.push('- `pnpm install` - Install dependencies')

	if (config.typescript.enabled) {
		scripts.push('- `pnpm typecheck` - Type check TypeScript')
	}

	if (config.linting.tool !== 'none') {
		if (config.linting.tool === 'biome' || config.linting.tool === 'both') {
			scripts.push('- `pnpm lint` - Lint code with Biome')
			scripts.push('- `pnpm format` - Format code with Biome')
			scripts.push('- `pnpm check:fix` - Lint and format with Biome')
		}
		if (config.linting.tool === 'eslint' || config.linting.tool === 'both') {
			scripts.push('- `pnpm lint` - Lint code with ESLint')
			scripts.push('- `pnpm lint:fix` - Fix ESLint issues')
			scripts.push('- `pnpm format` - Format code with Prettier')
		}
	}

	if (config.testing.framework !== 'none') {
		scripts.push('- `pnpm test` - Run tests')
		if (config.testing.framework === 'vitest') {
			scripts.push('- `pnpm test:watch` - Run tests in watch mode')
			scripts.push('- `pnpm coverage` - Generate test coverage')
		}
	}

	if (config.bundler !== 'none') {
		scripts.push('- `pnpm build` - Build for production')
	}

	if (config.commitLint) {
		scripts.push('- `pnpm commit` - Write a conventional commit via a guided prompt')
	}

	return scripts.join('\n')
}

function generateToolingList(config: ProjectConfig): string {
	const tools = []

	if (config.typescript.enabled) {
		tools.push('- **TypeScript** - Type-safe JavaScript')
	}

	if (config.linting.tool === 'biome') {
		tools.push('- **Biome** - Fast formatter and linter')
	} else if (config.linting.tool === 'eslint') {
		tools.push('- **ESLint** - Linting utility')
		tools.push('- **Prettier** - Code formatter')
	} else if (config.linting.tool === 'both') {
		tools.push('- **Biome** - Fast formatter and linter')
		tools.push('- **ESLint** - Additional linting rules')
	}

	if (config.testing.framework === 'vitest') {
		tools.push('- **Vitest** - Fast testing framework')
	} else if (config.testing.framework === 'jest') {
		tools.push('- **Jest** - Testing framework')
	} else if (config.testing.framework === 'playwright') {
		tools.push('- **Playwright** - End-to-end testing')
	} else if (config.testing.framework === 'cypress') {
		tools.push('- **Cypress** - End-to-end testing')
	}

	if (config.bundler === 'tsup') {
		tools.push('- **tsup** - TypeScript bundler')
	} else if (config.bundler === 'esbuild') {
		tools.push('- **esbuild** - Fast JavaScript bundler')
	} else if (config.bundler === 'vite') {
		tools.push('- **Vite** - Fast build tool')
	}

	if (config.gitHooks) {
		tools.push('- **Husky** - Git hooks')
		tools.push('- **lint-staged** - Run linters on staged files')
	}

	if (config.commitLint) {
		tools.push('- **Commitlint** - Conventional commit linting')
	}

	if (config.semanticRelease) {
		tools.push('- **Semantic Release** - Automated versioning and publishing')
	}
	if (config.releasePlease) {
		tools.push('- **Release Please** - Automated release PRs and changelogs')
	}

	return tools.join('\n')
}
