import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { GH_WORKFLOWS, generateGhWorkflow } from '../../../src/cli/generators/github-workflows.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

describe('generateGhWorkflow', () => {
	it.each(GH_WORKFLOWS)('scaffolds %s into .github/workflows', async (name) => {
		const dir = newTmpDir()
		const written = await generateGhWorkflow(name, dir)
		expect(written).toBe(`.github/workflows/${name}.yml`)

		const yaml = await fs.readFile(join(dir, written), 'utf-8')
		// Every workflow declares a name, a trigger, and least-privilege perms.
		expect(yaml).toMatch(/^name:/m)
		expect(yaml).toMatch(/^on:/m)
		expect(yaml).toMatch(/^permissions:/m)
		expect(yaml).toMatch(/^jobs:/m)
	})

	it('docker-publish uses GHCR + GITHUB_TOKEN and triggers on tags', async () => {
		const dir = newTmpDir()
		await generateGhWorkflow('docker-publish', dir)
		const yaml = await fs.readFile(join(dir, '.github/workflows/docker-publish.yml'), 'utf-8')
		expect(yaml).toContain('ghcr.io')
		expect(yaml).toContain('secrets.GITHUB_TOKEN')
		expect(yaml).toContain("tags: ['v*']")
		expect(yaml).toContain('packages: write')
	})

	it('vercel-deploy references the Vercel secrets', async () => {
		const dir = newTmpDir()
		await generateGhWorkflow('vercel-deploy', dir)
		const yaml = await fs.readFile(join(dir, '.github/workflows/vercel-deploy.yml'), 'utf-8')
		for (const secret of ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']) {
			expect(yaml).toContain(secret)
		}
	})

	it('cloudflare-pages references the Cloudflare secrets', async () => {
		const dir = newTmpDir()
		await generateGhWorkflow('cloudflare-pages', dir)
		const yaml = await fs.readFile(join(dir, '.github/workflows/cloudflare-pages.yml'), 'utf-8')
		expect(yaml).toContain('CLOUDFLARE_API_TOKEN')
		expect(yaml).toContain('CLOUDFLARE_ACCOUNT_ID')
	})

	it('preview-deployments triggers on pull_request', async () => {
		const dir = newTmpDir()
		await generateGhWorkflow('preview-deployments', dir)
		const yaml = await fs.readFile(join(dir, '.github/workflows/preview-deployments.yml'), 'utf-8')
		expect(yaml).toContain('pull_request:')
		expect(yaml).toContain('pull-requests: write')
	})

	it('is safe-add: does not clobber an existing workflow', async () => {
		const dir = newTmpDir()
		await fs.ensureDir(join(dir, '.github/workflows'))
		// Simulate a user-customized workflow already in place, then run the fixer
		// through the fix command path (which enforces safe-add).
		const path = join(dir, '.github/workflows/docker-publish.yml')
		await fs.writeFile(path, 'name: mine\n')
		const { fixCommand } = await import('../../../src/cli/commands/fix.js')
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo' })
		await fixCommand('docker-publish', { directory: dir, yes: true, silent: true })
		expect(await fs.readFile(path, 'utf-8')).toBe('name: mine\n')
	})
})
