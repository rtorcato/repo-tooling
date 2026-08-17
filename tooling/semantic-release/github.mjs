export default {
	branches: [
		'+([0-9])?(.{+([0-9]),x}).x',
		'main', // → stable
		'next',
		'release',
		'next-major', // → next-major branch = next-major tag
		{ name: 'dev', prerelease: true }, // → dev branch = dev tag
		{ name: 'beta', prerelease: true }, // → beta branch = beta tag
		{ name: 'alpha', prerelease: true }, // → alpha branch = alpha tag
	],
	repositoryUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}.git`,
	plugins: [
		[
			'@semantic-release/commit-analyzer',
			{
				preset: 'conventionalcommits',
				releaseRules: [
					{ breaking: true, release: 'major' }, // Major release for breaking changes
					{ type: 'feat', release: 'minor' }, // Minor release for features
					{ type: 'fix', release: 'patch' }, // Patch release for bug fixes
					{
						type: 'docs', // Documentation changes
						scope: 'README', // Specific scope for README changes
						release: false, // no Patch release for README changes
					},
					// { type: 'chore', release: 'patch' }, // Chore changes
					{ type: 'update', release: 'patch' },
					{ type: 'refactor', release: 'patch' },
					{ type: 'revert', release: 'patch' },
					{ type: 'style', release: false },
					{ type: 'test', release: false },
				],
				parserOpts: {
					noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING'],
				},
			},
		],
		'@semantic-release/release-notes-generator',
		// Release notes generator plugin to generate release notes
		[
			'@semantic-release/github',
			{
				// README.md only. CHANGELOG.md and package.json are frozen on the
				// default branch (see the note at the bottom of this file), so
				// attaching them to each release would ship stale artifacts.
				assets: ['README.md'],
				message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
				// Don't label the "release is failing" issue. The default is
				// ['semantic-release'], and GitHub rejects issue creation outright when
				// the label doesn't exist on the repo — so a failed release fails *again*
				// with a 422 that buries the real error under an octokit stack trace.
				// false keeps the issue (and its post-mortem) without requiring every
				// consuming repo to pre-create a label.
				labels: false,
			},
		],
		// npm publishing goes through OIDC trusted publishing — no NPM_TOKEN. The
		// release job runs with `id-token: write` and npm (>=11.5.1) authenticates
		// via the GitHub Actions trusted publisher configured on the package, and
		// gets provenance for free. Private packages are skipped automatically by
		// @semantic-release/npm; a public repo that only wants GitHub releases can
		// opt out with NPM_PUBLISH=false (the version in package.json is still bumped).
		['@semantic-release/npm', { npmPublish: process.env.NPM_PUBLISH !== 'false', pkgRoot: '.' }],
	],
}

// Two plugins are deliberately absent, and the second follows from the first.
//
// @semantic-release/git — it committed package.json + CHANGELOG.md and pushed
// them straight to the default branch. `fix github-settings` installs a
// `code-scanning-main` ruleset requiring CodeQL results on that branch, and a
// commit created seconds earlier can never have them: the push fails with
// GH013. Unwinnable rather than flaky — the commit must exist to be scanned,
// and be scanned to exist. See rtorcato/repo-tooling#417.
//
// @semantic-release/changelog — it writes CHANGELOG.md, which only
// @semantic-release/git ever committed back. Without that push it regenerates
// the file inside the CI workspace and throws it away every release, implying
// CHANGELOG.md is still maintained when it is frozen. The two are one feature
// in two plugins; shipping one without the other is the trap, not the fix.
//
// The consequence, stated plainly because it is easy to miss: **CHANGELOG.md
// and the `version` field in package.json stop moving on the default branch.**
// The git tag, the npm publish and the GitHub Release are unaffected and are
// the source of truth for what shipped. Build any user-facing changelog from
// GitHub Releases — `repo-tooling copy docusaurus-sync-changelog` does exactly
// that — never from the frozen file.
//
// Adding a bypass actor to the ruleset would also make the push succeed. It is
// not the answer: it exempts the one commit nobody reviews.

// [
// 	'@semantic-release/exec',
// 	{
// 		prepareCmd: 'pnpm exec biome format',
// 	},
// ],
