import path from 'node:path'
import fs from '../../base/safe-fs.js'
import { getPackageRoot } from '../utils/copy-preset.js'

/**
 * Optional GitHub Actions deploy workflows, scaffolded on demand via
 * `fix <name>`. They're static templates (no config-driven branching) copied
 * verbatim from tooling/, unlike the config-aware ci.yml generator. Setup does
 * not scaffold these — they're too deploy-target-specific to assume.
 */
export const GH_WORKFLOWS = [
	'docker-publish',
	'vercel-deploy',
	'cloudflare-pages',
	'preview-deployments',
] as const

export type GhWorkflow = (typeof GH_WORKFLOWS)[number]

export async function generateGhWorkflow(name: GhWorkflow, targetDir: string): Promise<string> {
	const source = path.join(getPackageRoot(), 'tooling/github-actions/workflows', `${name}.yml`)
	const relTarget = path.join('.github', 'workflows', `${name}.yml`)
	// Self-enforced safe-add: these fixers have no doctor check, so the fix
	// command's own safe-add guard (which keys off an `ok` check) can't kick in.
	// overwrite:false keeps a user-customized workflow of the same name intact.
	await fs.copy(source, path.join(targetDir, relTarget), { overwrite: false, errorOnExist: false })
	return relTarget
}
