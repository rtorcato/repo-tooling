import path from 'node:path'
import fs from '../../base/safe-fs.js'
import { detectAuditLanguage } from '../utils/detect-language.js'

const CONTRIBUTING_NEUTRAL = `# Contributing

Thanks for your interest in contributing!

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/).
Format: \`type(scope): summary\` — e.g. \`fix(api): handle empty payload\`.
Common types: \`feat\`, \`fix\`, \`docs\`, \`refactor\`, \`test\`, \`chore\`.

## Pull requests

- Keep PRs focused and small where possible.
- Make sure the project's checks (tests, lint) pass.
- Add tests for new behaviour.
- Describe what changed and why in the PR description.
`

const CONTRIBUTING = `# Contributing

Thanks for your interest in contributing!

## Local setup

\`\`\`bash
pnpm install
pnpm build
pnpm test
\`\`\`

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/).
Format: \`type(scope): summary\` — e.g. \`fix(api): handle empty payload\`.
Common types: \`feat\`, \`fix\`, \`docs\`, \`refactor\`, \`test\`, \`chore\`.
If commitizen is set up, run \`pnpm commit\` to be guided through it.

## Pull requests

- Keep PRs focused and small where possible.
- Make sure \`pnpm test\` and \`pnpm check\` (lint) pass.
- Add tests for new behaviour.
- Describe what changed and why in the PR description.
`

// Relative advisory link works from a repo-root SECURITY.md on GitHub, so the
// template stays repo-agnostic (no hardcoded owner/name) and needs no contact
// placeholder: private vulnerability reporting is the channel.
const SECURITY = `# Security Policy

## Supported versions

Only the latest major version receives security fixes.

## Reporting a vulnerability

Do **not** open a public GitHub issue for security vulnerabilities.

Instead, use [GitHub's private vulnerability reporting](../../security/advisories/new)
and include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact

You'll receive a response within 5 business days.
`

const PULL_REQUEST_TEMPLATE_NEUTRAL = `## Summary

<!-- 1-3 bullet points describing what changed and why -->
-

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Documentation
- [ ] CI / tooling

## Test plan

- [ ] The project's checks pass
- [ ] New tests added for new behaviour

## Checklist

- [ ] No debug logging left in production code
- [ ] No breaking changes (or BREAKING CHANGE footer added to commit)
- [ ] Lint passes
`

const PULL_REQUEST_TEMPLATE = `## Summary

<!-- 1-3 bullet points describing what changed and why -->
-

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Documentation
- [ ] CI / tooling

## Test plan

- [ ] Existing tests pass (\`pnpm test\`)
- [ ] New tests added for new behaviour

## Checklist

- [ ] No debug logging left in production code
- [ ] No breaking changes (or BREAKING CHANGE footer added to commit)
- [ ] Lint passes (\`pnpm check\` / \`pnpm lint\`)
`

const BUG_REPORT = `---
name: Bug report
about: Something isn't working as expected
labels: bug
---

## Describe the bug

<!-- A clear and concise description of what the bug is -->

## Steps to reproduce

1.
2.
3.

## Expected behaviour

## Actual behaviour

<!-- Paste any error output here -->

\`\`\`
\`\`\`

## Environment

- Package version:
- Node version (\`node -v\`):
- Package manager + version:
- OS:
`

const BUG_REPORT_NEUTRAL = BUG_REPORT.replace(
	'- Package version:\n- Node version (`node -v`):\n- Package manager + version:\n',
	'- Version:\n',
)

const FEATURE_REQUEST = `---
name: Feature request
about: Suggest an idea or improvement
labels: enhancement
---

## Problem

<!-- What are you trying to do that you can't do today? -->

## Proposed solution

## Alternatives considered

## Additional context
`

function filesFor(neutral: boolean): ReadonlyArray<{ rel: string; content: string }> {
	return [
		{ rel: 'CONTRIBUTING.md', content: neutral ? CONTRIBUTING_NEUTRAL : CONTRIBUTING },
		{ rel: 'SECURITY.md', content: SECURITY },
		{
			rel: '.github/PULL_REQUEST_TEMPLATE.md',
			content: neutral ? PULL_REQUEST_TEMPLATE_NEUTRAL : PULL_REQUEST_TEMPLATE,
		},
		{
			rel: '.github/ISSUE_TEMPLATE/bug_report.md',
			content: neutral ? BUG_REPORT_NEUTRAL : BUG_REPORT,
		},
		{ rel: '.github/ISSUE_TEMPLATE/feature_request.md', content: FEATURE_REQUEST },
	]
}

/**
 * Scaffold GitHub community-health files. Safe-add: existing files are left
 * untouched (the user owns them once written). Returns the list of files
 * actually created.
 */
export async function generateCommunityHealth(
	targetDir: string,
	opts: { neutral?: boolean } = {}
): Promise<string[]> {
	// A repo with no language marker gets no JS tooling assumptions (#1008).
	const neutral = opts.neutral ?? (await detectAuditLanguage(targetDir)) === 'unknown'
	const written: string[] = []
	for (const { rel, content } of filesFor(neutral)) {
		const filepath = path.join(targetDir, rel)
		if (await fs.pathExists(filepath)) continue
		await fs.ensureDir(path.dirname(filepath))
		await fs.writeFile(filepath, content)
		written.push(rel)
	}
	return written
}
