import fs from 'fs-extra'
import path from 'node:path'
import { renderGitHubWorkflow } from '../../base/ci.js'
import {
	jobEnvironment,
	publishingJob,
	removeWorkflowJob,
	workflowJobs,
} from '../../base/github-settings.js'
import {
	githubJobs,
	RELEASE_WORKFLOW,
	renderReleaseWorkflow,
	usesCoverage,
} from '../../languages/js/ci.js'
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
export { RELEASE_WORKFLOW }

const readIfExists = async (p: string) =>
	(await fs.pathExists(p)) ? await fs.readFile(p, 'utf-8') : null

/** The `environment:` of the workflow's publishing job, if it has one. */
function releaseEnvironmentOf(yaml: string | null): string | null {
	const job = yaml ? publishingJob(yaml) : null
	const body = job && yaml ? workflowJobs(yaml).get(job) : undefined
	return body ? jobEnvironment(body) : null
}

/**
 * @param overwrite Replace a ci.yml (and release.yml) that no longer matches
 * the preset. Off by default: this used to write unconditionally, so a
 * consuming repo's customized workflow — an extra job, a Dependabot-bumped
 * action pin — was reverted on every sync with no diff, no prompt and no backup
 * (#349, the mechanism behind #340). Same self-enforced safe-add as
 * github-workflows.ts, widened to "or is byte-identical anyway" so a no-op
 * regeneration still reports honestly. Only a caller that has told the user
 * this workflow itself is drifting passes true.
 * @param scripts The target's package.json scripts, so the workflow only calls
 * commands that exist (#364). Omit on the `setup` path, which writes the
 * scripts itself as part of the same scaffold.
 * @returns the files actually written, relative to targetDir.
 */
export async function generateGitHubActions(
	config: ProjectConfig,
	targetDir: string,
	{
		overwrite = false,
		scripts,
		bin,
	}: { overwrite?: boolean; scripts?: Record<string, string>; bin?: boolean } = {}
): Promise<string[]> {
	const workflowsDir = path.join(targetDir, '.github', 'workflows')
	await fs.ensureDir(workflowsDir)

	// This is the JS path specifically. Swift (#287) renders its own workflow
	// from `src/languages/swift/ci.ts` rather than dispatching through here: it
	// takes no ProjectConfig at all (its jobs derive from Package.swift), so a
	// shared entry point would mean inventing a fake config to pass in. Both
	// paths meet at renderGitHubWorkflow() in src/base/ci.ts, which is the seam
	// that actually matters.
	const ciPath = path.join(targetDir, CI_WORKFLOW)
	const releasePath = path.join(targetDir, RELEASE_WORKFLOW)
	const existing = await readIfExists(ciPath)
	const existingRelease = await readIfExists(releasePath)
	const filesWritten: string[] = []

	// The release lives in its own workflow (#753). Migrating a pre-#753 ci.yml
	// carries its release job's `environment:` over, so the publish gate that
	// `fix release-environment` added survives. Never written while ci.yml still
	// publishes — two release paths would race each other to npm.
	const releaseEnvironment = releaseEnvironmentOf(existingRelease) ?? releaseEnvironmentOf(existing)
	const release = renderReleaseWorkflow(config, { scripts, releaseEnvironment })

	const workflow = renderGitHubWorkflow(githubJobs(config, { scripts, bin }))
	const releaseJob = existing === null ? null : publishingJob(existing)
	let ci = existing
	if (existing !== null && releaseJob !== null && release) {
		// A ci.yml that publishes is the drift being fixed, so move just that job
		// out — every other job, trigger and comment stays as the repo wrote it
		// (#761). Regenerating it from the preset took the repo's own jobs (and any
		// required check named after one) down with the release job.
		ci = removeWorkflowJob(existing, releaseJob)
		await fs.writeFile(ciPath, ci)
		filesWritten.push(CI_WORKFLOW)
	} else if (overwrite || existing === null || existing === workflow) {
		await fs.writeFile(ciPath, workflow)
		filesWritten.push(CI_WORKFLOW)
		ci = workflow
	}

	const ciPublishes = ci !== null && publishingJob(ci) !== null
	if (
		release &&
		!ciPublishes &&
		(overwrite || existingRelease === null || existingRelease === release)
	) {
		await fs.writeFile(releasePath, release)
		filesWritten.push(RELEASE_WORKFLOW)
	}

	// codecov.yml is the CI's coverage-upload companion — emit it alongside ci.yml
	// whenever the workflow uploads coverage, so the codecov badge isn't red. An
	// existing one is the repo's own coverage policy — never overwritten (#761).
	const codecovPath = path.join(targetDir, 'codecov.yml')
	if (usesCoverage(config) && !(await fs.pathExists(codecovPath))) {
		await fs.writeFile(codecovPath, CODECOV_YML)
		filesWritten.push('codecov.yml')
	}
	return filesWritten
}
