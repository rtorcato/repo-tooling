import fs from 'fs-extra'
import path from 'node:path'
import { renderGitHubWorkflow } from '../../base/ci.js'
import { githubJobs, usesCoverage } from '../../languages/js/ci.js'
import type { ProjectConfig } from '../commands/setup.js'

// Minimal Codecov config — auto targets keep it from failing a fresh repo that
// has no baseline yet, while the 1% threshold tolerates rounding noise.
// https://docs.codecov.com/docs/codecov-yaml
const CODECOV_YML = `coverage:
  status:
    project:
      default:
        target: auto
        threshold: 1%
    patch:
      default:
        target: auto
        threshold: 1%
`

/** Matches the fixer's declared output, so `fix` reports the same path it lists. */
export const CI_WORKFLOW = '.github/workflows/ci.yml'

/**
 * @param overwrite Replace a ci.yml that no longer matches the preset. Off by
 * default: this used to write unconditionally, so a consuming repo's customized
 * workflow — an extra job, a Dependabot-bumped action pin — was reverted on
 * every sync with no diff, no prompt and no backup (#349, the mechanism behind
 * #340). Same self-enforced safe-add as github-workflows.ts, widened to "or is
 * byte-identical anyway" so a no-op regeneration still reports honestly. Only a
 * caller that has told the user this workflow itself is drifting passes true.
 * @param scripts The target's package.json scripts, so the workflow only calls
 * commands that exist (#364). Omit on the `setup` path, which writes the
 * scripts itself as part of the same scaffold.
 * @returns the files actually written, relative to targetDir.
 */
export async function generateGitHubActions(
	config: ProjectConfig,
	targetDir: string,
	{ overwrite = false, scripts }: { overwrite?: boolean; scripts?: Record<string, string> } = {}
): Promise<string[]> {
	const workflowsDir = path.join(targetDir, '.github', 'workflows')
	await fs.ensureDir(workflowsDir)

	// This is the JS path specifically. Swift (#287) renders its own workflow
	// from `src/languages/swift/ci.ts` rather than dispatching through here: it
	// takes no ProjectConfig at all (its jobs derive from Package.swift), so a
	// shared entry point would mean inventing a fake config to pass in. Both
	// paths meet at renderGitHubWorkflow() in src/base/ci.ts, which is the seam
	// that actually matters.
	const workflow = renderGitHubWorkflow(githubJobs(config, { scripts }))
	const ciPath = path.join(workflowsDir, 'ci.yml')
	const existing = (await fs.pathExists(ciPath)) ? await fs.readFile(ciPath, 'utf-8') : null
	const filesWritten: string[] = []
	if (overwrite || existing === null || existing === workflow) {
		await fs.writeFile(ciPath, workflow)
		filesWritten.push(CI_WORKFLOW)
	}

	// codecov.yml is the CI's coverage-upload companion — emit it alongside ci.yml
	// whenever the workflow uploads coverage, so the codecov badge isn't red.
	if (usesCoverage(config)) {
		await fs.writeFile(path.join(targetDir, 'codecov.yml'), CODECOV_YML)
		filesWritten.push('codecov.yml')
	}
	return filesWritten
}
