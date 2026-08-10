import path from 'node:path'
import fs from 'fs-extra'
import { renderGitLabCI } from '../../base/ci.js'
import { gitlabSpec } from '../../languages/js/ci.js'
import type { ProjectConfig } from '../commands/setup.js'

/**
 * @param scripts The target's package.json scripts, so the pipeline only calls
 * commands that exist (#386). Omit on the `setup` path, which writes the
 * scripts itself as part of the same scaffold.
 */
export async function generateGitLabCI(
	config: ProjectConfig,
	targetDir: string,
	{ scripts }: { scripts?: Record<string, string> } = {}
) {
	const yamlPath = path.join(targetDir, '.gitlab-ci.yml')
	// ponytail: direct JS import until a second language module ships CI (#287).
	await fs.writeFile(yamlPath, renderGitLabCI(gitlabSpec(config, { scripts })))
	return '.gitlab-ci.yml'
}
