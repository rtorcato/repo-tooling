/**
 * Changesets for versioning only (#1032): the one release procedure for repos
 * that publish no npm package. Merging the Version Packages PR bumps a private
 * root package's `version` and creates its `vX.Y.Z` tag; the repo's tag-triggered
 * release workflow (in the `release` environment, #1031) does the rest. Nothing
 * else releases: no hand-pushed tag, no merge-to-publish, no dispatch.
 *
 * Imports only leaf modules (no fixers, no lockfile): the scaffolders for every
 * language call in here, and `gitignore.ts` records what a wider import graph
 * cost once.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pinActions } from './action-pins.js'
import fs from './safe-fs.js'

export const VERSION_WORKFLOW = '.github/workflows/version-packages.yml'
export const CHANGESET_CONFIG = '.changeset/config.json'

/** Kept equal to `CHANGESETS_CLI_RANGE` in the JS module; a test pins the two together. */
export const VERSIONING_CLI_RANGE = '^3.0.3'

/** `.changeset/config.json` for a repo whose only package is the private root. */
export const VERSIONING_CONFIG = {
	$schema: 'https://unpkg.com/@changesets/config@3.0.5/schema.json',
	changelog: '@changesets/cli/changelog',
	commit: false,
	fixed: [],
	linked: [],
	access: 'restricted',
	baseBranch: 'main',
	updateInternalDependencies: 'patch',
	ignore: [],
	privatePackages: { version: true, tag: true },
}

/**
 * The Version Packages workflow for a repo with no registry. Every push to main
 * opens or updates the "Version Packages" PR and releases nothing. The push that
 * merges it finds no changeset pending, so `changeset tag` creates the `vX.Y.Z`
 * tag and the action pushes it; the release workflow fires on that tag.
 *
 * ponytail: a tag pushed with GITHUB_TOKEN starts no workflow, and neither does
 * a PR it opens. Both need `RELEASE_TOKEN` (a PAT or GitHub App token), the same
 * fallback chain the npm flow uses; the first step says so when it is unset.
 */
export function renderVersionWorkflow(): string {
	return pinActions(`name: 📝 Version Packages

# Changesets for versioning only. Every push to main
# opens or updates the "Version Packages" PR and releases nothing. Merging that
# PR is the release: its push tags the new version, and the tag runs the release
# workflow, which waits for one \`release\` approval.
on:
  push:
    branches: [main]

jobs:
  # No approval gate here: it only opens the PR and pushes a tag, so it never asks for
  # an approval. The publishing job lives in release.yml.
  version:
    runs-on: ubuntu-latest
    concurrency:
      group: version-packages
      cancel-in-progress: false
    permissions:
      contents: write
      pull-requests: write
    steps:
      # GitHub runs no workflows for events a GITHUB_TOKEN causes: the Version
      # Packages PR gets no required CI check and the tag starts no release.
      - name: ⚠️ Warn when RELEASE_TOKEN is unset
        env:
          RELEASE_TOKEN: \${{ secrets.RELEASE_TOKEN }}
        run: |
          if [ -z "$RELEASE_TOKEN" ]; then
            echo "::warning title=RELEASE_TOKEN is not set::Version Packages PRs and tags pushed with GITHUB_TOKEN start no workflows, so the PR sits blocked on its required check and the tag runs no release. Set a RELEASE_TOKEN secret (PAT or GitHub App token)."
          fi

      - name: 📦 Checkout repository
        uses: actions/checkout@v7
        with:
          fetch-depth: 0
          token: \${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}

      - name: 📦 Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 24

      # Nothing here runs repo code: only @changesets/cli is installed.
      - name: 📦 Install Changesets
        run: npm install --ignore-scripts --no-audit --no-fund

      # Changesets pending: open or update the PR. None pending (this push merged
      # it): run \`changeset tag\`, then the action pushes the new tag.
      - name: 📝 Open the Version Packages PR, or tag the merged version
        uses: changesets/action@v2.1.2
        with:
          github-token: \${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}
          version-script: npx --no-install changeset version
          publish-script: npx --no-install changeset tag
          commit-message: 'chore(release): version packages'
          pr-title: 'chore(release): version packages'
`)
}

/** The highest `X.Y.Z` / `vX.Y.Z` tag in the repo, as `X.Y.Z`, or null when there is none. */
export function latestSemverTag(dir: string): string | null {
	let tags: string
	try {
		tags = execFileSync('git', ['tag', '--list'], {
			cwd: dir,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
		})
	} catch {
		return null
	}
	let best: number[] | null = null
	for (const tag of tags.split('\n')) {
		const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim())
		if (!m) continue
		const parts = [Number(m[1]), Number(m[2]), Number(m[3])]
		const newer = !best || parts.reduce((d, p, i) => d || p - (best?.[i] ?? 0), 0) > 0
		if (newer) best = parts
	}
	return best ? best.join('.') : null
}

export interface VersioningOptions {
	/** The private root package's name. */
	name: string
	/** The starting version; defaults to the latest semver tag, else `0.0.0`. */
	version?: string
}

/**
 * Scaffold Changesets-for-versioning: the private root `package.json`, the
 * `.changeset/config.json`, and the Version Packages workflow. Existing files
 * are merged, never replaced: a repo's own `package.json` keeps its keys, and a
 * `private: false` one is left alone and reported rather than flipped.
 *
 * @returns the files written, relative to `dir`.
 */
export async function scaffoldVersioning(dir: string, opts: VersioningOptions): Promise<string[]> {
	const written: string[] = []
	const pkgPath = path.join(dir, 'package.json')
	const existing = (await fs.pathExists(pkgPath))
		? ((await fs.readJson(pkgPath)) as Record<string, unknown>)
		: null
	const version = opts.version ?? latestSemverTag(dir) ?? '0.0.0'
	const scripts = { ...((existing?.scripts ?? {}) as Record<string, string>) }
	scripts.changeset ??= 'changeset'
	const devDependencies = {
		...((existing?.devDependencies ?? {}) as Record<string, string>),
	}
	devDependencies['@changesets/cli'] ??= VERSIONING_CLI_RANGE
	const next = {
		name: opts.name,
		version,
		private: true,
		...existing,
		scripts,
		devDependencies,
	}
	if (JSON.stringify(next) !== JSON.stringify(existing)) {
		await fs.outputJson(pkgPath, next, { spaces: 2 })
		written.push('package.json')
	}

	const configPath = path.join(dir, CHANGESET_CONFIG)
	if (!(await fs.pathExists(configPath))) {
		await fs.outputJson(configPath, VERSIONING_CONFIG, { spaces: 2 })
		written.push(CHANGESET_CONFIG)
	} else {
		const config = (await fs.readJson(configPath)) as Record<string, unknown>
		const priv = (config.privatePackages ?? {}) as Record<string, unknown>
		if (priv.version !== true || priv.tag !== true) {
			await fs.outputJson(
				configPath,
				{ ...config, privatePackages: { ...priv, version: true, tag: true } },
				{ spaces: 2 }
			)
			written.push(CHANGESET_CONFIG)
		}
	}

	// CI installs @changesets/cli, and so might a contributor: keep it out of git.
	const ignorePath = path.join(dir, '.gitignore')
	const ignore = (await fs.pathExists(ignorePath)) ? await fs.readFile(ignorePath, 'utf-8') : ''
	if (!/^\/?node_modules\/?\s*$/m.test(ignore)) {
		await fs.writeFile(
			ignorePath,
			`${ignore}${ignore === '' || ignore.endsWith('\n') ? '' : '\n'}node_modules/\n`
		)
		written.push('.gitignore')
	}

	const workflowPath = path.join(dir, VERSION_WORKFLOW)
	await fs.outputFile(workflowPath, renderVersionWorkflow())
	written.push(VERSION_WORKFLOW)
	return written
}

/**
 * Does the repo's `.changeset/config.json` version and tag its private root
 * package? Without that a merged Version Packages PR creates no tag, so a
 * tag-triggered release never fires from it.
 */
export async function hasVersioningConfig(dir: string): Promise<boolean> {
	const configPath = path.join(dir, CHANGESET_CONFIG)
	if (!(await fs.pathExists(configPath))) return false
	const config = (await fs.readJson(configPath).catch(() => null)) as {
		privatePackages?: { version?: unknown; tag?: unknown }
	} | null
	return config?.privatePackages?.version === true && config.privatePackages.tag === true
}
