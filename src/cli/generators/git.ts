import fs from 'fs-extra'
import path from 'node:path'
import type { ProjectConfig } from '../commands/setup.js'

export const PRE_PUSH_HOOK_CONTENT = `echo "🔍 Running pre-push verify..."
pnpm verify
STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo "❌ Verify failed — push aborted."
  exit 1
fi
echo "✅ Verify passed — pushing."
`

export async function generateGitConfigs(config: ProjectConfig, targetDir: string) {
	if (config.gitHooks) {
		await generateHuskyConfig(config, targetDir)
	}

	if (config.commitLint) {
		await generateCommitlintConfig(targetDir)
	}

	// Generate .gitignore
	await generateGitignore(config, targetDir)
}

export async function generateHuskyConfig(config: ProjectConfig, targetDir: string) {
	const huskyDir = path.join(targetDir, '.husky')
	await fs.ensureDir(huskyDir)

	// Pre-commit hook. husky v10 format: just the command — the v9 shebang +
	// `. "$(dirname ...)/_/husky.sh"` bootstrap is deprecated (warns on every
	// hook run in v9, fails outright in v10).
	const preCommitPath = path.join(huskyDir, 'pre-commit')
	const preCommitContent = 'npx lint-staged\n'
	await fs.writeFile(preCommitPath, preCommitContent)
	await fs.chmod(preCommitPath, 0o755)

	// Pre-push hook — only when the package.json already has a `verify` script.
	// In the setup flow, generatePackageJson runs before this and writes verify
	// when 2+ tools are enabled. In the `fix husky` path, a pre-existing verify
	// script is what unlocks the hook.
	const pkgPath = path.join(targetDir, 'package.json')
	if (await fs.pathExists(pkgPath)) {
		const pkg = (await fs.readJson(pkgPath)) as Record<string, unknown>
		const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
		if (scripts.verify) {
			await generatePrePushHook(targetDir)
		}
	}

	// The commit-msg hook is NOT written here (#362). It runs commitlint via
	// `npx --no`, which refuses to install a missing binary, so emitting it
	// without also installing @commitlint/cli rejected every commit in the repo.
	// It belongs to generateCommitlintConfig, which owns both halves.

	// lint-staged configuration in package.json
	const packageJsonPath = path.join(targetDir, 'package.json')
	const packageJson = await fs.readJson(packageJsonPath)

	// No explicit `git add` — lint-staged stages tool output itself, and the
	// extra add races its index lock. `--no-errors-on-unmatched` keeps biome
	// from failing a commit when every matched file is biome-ignored.
	const useBiome = config.linting.tool === 'biome' || config.linting.tool === 'both'
	packageJson['lint-staged'] = {
		'*.{js,ts,jsx,tsx}': useBiome ? 'biome check --fix --no-errors-on-unmatched' : 'eslint --fix',
		'*.{json,md,yml,yaml}': useBiome
			? 'biome format --write --no-errors-on-unmatched'
			: 'prettier --write',
	}

	await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 })
}

export async function generatePrePushHook(targetDir: string) {
	const huskyDir = path.join(targetDir, '.husky')
	await fs.ensureDir(huskyDir)
	const prePushPath = path.join(huskyDir, 'pre-push')
	await fs.writeFile(prePushPath, PRE_PUSH_HOOK_CONTENT)
	await fs.chmod(prePushPath, 0o755)
}

/** Package versions the commit-msg hook needs on disk to run at all. */
export const COMMITLINT_DEPS: Record<string, string> = {
	'@commitlint/cli': '^20.0.0',
	'@commitlint/config-conventional': '^20.0.0',
}

/** True when husky owns this repo's hooks — the only case where .husky/commit-msg runs. */
async function usesHusky(targetDir: string): Promise<boolean> {
	if (await fs.pathExists(path.join(targetDir, '.husky'))) return true
	const pkgPath = path.join(targetDir, 'package.json')
	if (!(await fs.pathExists(pkgPath))) return false
	const pkg = (await fs.readJson(pkgPath)) as Record<string, unknown>
	const deps = {
		...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
		...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
	}
	return 'husky' in deps
}

/**
 * commitlint's config *and* the hook that runs it, as one unit (#362).
 *
 * These used to be split across two targets: `fix husky` wrote
 * `.husky/commit-msg`, `fix commitlint` wrote the config, and neither installed
 * `@commitlint/cli`. Since the hook body is `npx --no -- commitlint --edit $1`
 * and `--no` refuses to install anything, a repo that ran only `fix husky` had
 * every `git commit` rejected — discovered at the worst possible moment, and
 * looking like a broken repo rather than a missing opt-in.
 *
 * The hook is only written when husky owns the repo's hooks. The Swift path
 * uses `core.hooksPath` and deliberately wires no commit-msg hook, so a
 * `.husky/` file there would simply never run.
 *
 * @returns the files written, relative to targetDir.
 */
export async function generateCommitlintConfig(targetDir: string): Promise<string[]> {
	const filesWritten = ['commitlint.config.mjs']
	await fs.writeFile(
		path.join(targetDir, 'commitlint.config.mjs'),
		`export { default } from '@rtorcato/repo-tooling/commitlint/config'\n`
	)

	if (await usesHusky(targetDir)) {
		// husky v10 format — no v9 bootstrap. $1 is the commit-message file path
		// git passes through.
		const huskyDir = path.join(targetDir, '.husky')
		await fs.ensureDir(huskyDir)
		const commitMsgPath = path.join(huskyDir, 'commit-msg')
		await fs.writeFile(commitMsgPath, 'npx --no -- commitlint --edit $1\n')
		await fs.chmod(commitMsgPath, 0o755)
		filesWritten.push('.husky/commit-msg')
	}

	// @commitlint/cli is an *optional* peer of repo-tooling, so it never arrives
	// transitively — without this the hook we just wrote cannot run.
	const pkgPath = path.join(targetDir, 'package.json')
	if (await fs.pathExists(pkgPath)) {
		const pkg = (await fs.readJson(pkgPath)) as Record<string, unknown>
		const devDeps = { ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}) }
		let added = false
		for (const [name, range] of Object.entries(COMMITLINT_DEPS)) {
			if (!devDeps[name]) {
				devDeps[name] = range
				added = true
			}
		}
		if (added) {
			pkg.devDependencies = devDeps
			await fs.writeJson(pkgPath, pkg, { spaces: 2 })
			filesWritten.push('package.json')
		}
	}

	return filesWritten
}

async function generateGitignore(config: ProjectConfig, targetDir: string) {
	const gitignorePath = path.join(targetDir, '.gitignore')

	let gitignoreContent = `# Dependencies
node_modules/
.pnpm-store

# Build outputs
dist/
build/
out/

# Environment files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# Claude Code (worktrees + local settings are per-machine; agents/commands are shared)
.claude/worktrees/
.claude/settings.local.json

# OS
.DS_Store
Thumbs.db

# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# TypeScript
*.tsbuildinfo
`

	// Add framework-specific ignores
	if (config.projectType === 'nextjs-app') {
		gitignoreContent += `
# Next.js
.next/
.vercel
`
	}

	if (config.bundler === 'vite') {
		gitignoreContent += `
# Vite
.vite/
`
	}

	if (config.testing.framework === 'playwright') {
		gitignoreContent += `
# Playwright
/test-results/
/playwright-report/
/playwright/.cache/
`
	}

	if (config.testing.framework === 'cypress') {
		gitignoreContent += `
# Cypress
/cypress/videos/
/cypress/screenshots/
/cypress/downloads/
`
	}

	await fs.writeFile(gitignorePath, gitignoreContent)
}
