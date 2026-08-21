export default {
	extends: ['@commitlint/config-conventional'],
	ignores: [
		(commit) => commit.includes('[skip ci]'),
		// Bot commits are machine-written end to end, including headers long
		// enough to trip header-max-length. Skipping them wholesale keeps bot
		// PRs green — squash-merge uses the PR title, which is still linted on
		// the merge commit.
		// ponytail: matches the trailer, not a bare "[bot]", so a human commit
		// that merely mentions a bot is still linted.
		(commit) => /^Signed-off-by: .*\[bot\]/m.test(commit),
	],
	rules: {
		// Enforce strict type validation
		'type-enum': [
			2,
			'always',
			[
				'build',
				'chore',
				'ci',
				'docs',
				'feat',
				'fix',
				'perf',
				'refactor',
				'revert',
				'style',
				'test',
			],
		],
		// 100 is the conventional-commits/semantic-release default. 72 was too
		// tight: GitHub appends " (#NN)" to squash commits, overflowing the
		// header on main and skipping the release.
		'header-max-length': [2, 'always', 100],
		// Body/footer length is unenforced. Machine-written commits (agents,
		// bots) don't wrap, and a `BREAKING CHANGE:` footer — the input
		// semantic-release reads to cut a major — is the worst thing to make
		// someone hand-rewrap. The subject rules below decide the release
		// type and stay enforced.
		'body-max-line-length': [0],
		'footer-max-line-length': [0],
		// Enforce case rules (allow common patterns)
		'subject-case': [0], // Disable case enforcement to allow flexibility
		'type-case': [2, 'always', 'lower-case'],
		// Enforce required elements
		'type-empty': [2, 'never'],
		'subject-empty': [2, 'never'],
		// Enforce punctuation rules
		'subject-full-stop': [2, 'never', '.'],
		// Enforce scope rules (optional but recommended)
		'scope-case': [2, 'always', 'lower-case'],
	},
}
