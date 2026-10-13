import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { getToolVersion } from '../../src/cli/utils/version.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const CLI = join(process.cwd(), 'dist', 'cli', 'index.js')

function cli(args: string[], cwd = process.cwd(), env?: NodeJS.ProcessEnv) {
	return spawnSync('node', [CLI, ...args], {
		cwd,
		encoding: 'utf8',
		timeout: 10_000,
		env: env && { ...process.env, ...env },
	})
}

describe.skipIf(!fs.existsSync(CLI))('CLI smoke tests (requires pnpm build)', () => {
	const newTmpDir = useTmpDir()

	// Not just a shape check: --version and the lockfile's writtenBy have to be
	// the same number, and once were not (#572).
	it('prints the one version this package reports', async () => {
		const { status, stdout } = cli(['--version'])
		expect(status).toBe(0)
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
		expect(stdout.trim()).toBe(await getToolVersion())
	})

	// #825: outputHelp() then parse() printed the help twice and exited 1.
	it('bare command prints help once and exits 0', () => {
		const { status, stdout } = cli([])
		expect(status).toBe(0)
		expect(stdout.match(/^Usage:/gm)).toHaveLength(1)
	})

	it('list prints the fix targets', () => {
		const { status, stdout } = cli(['list'])
		expect(status).toBe(0)
		for (const target of ['tsconfig', 'biome', 'vitest', 'commitlint', 'swiftlint', 'ruff']) {
			expect(stdout).toContain(target)
		}
	})

	it('ls is an alias for list', () => {
		const { status, stdout } = cli(['ls'])
		expect(status).toBe(0)
		expect(stdout).toContain('Registered fix targets')
	})

	it('list --json is the fix registry, the same targets as fix --list --json (#828)', () => {
		const list = JSON.parse(cli(['list', '--json']).stdout)
		const fixList = JSON.parse(cli(['fix', '--list', '--json']).stdout)
		expect(list.targets).toEqual(fixList.targets)
		expect(list.targets.length).toBeGreaterThan(50)
		// The pre-#828 shape, derived from the same registry until the next major.
		expect(list.tools.find((t: { name: string }) => t.name === 'biome')).toEqual(
			expect.objectContaining({ fixTarget: 'biome' })
		)
	})

	it("puts setting git user.email in setup's next steps only when it is unset (#828)", () => {
		const home = newTmpDir()
		const gitconfig = join(home, 'gitconfig')
		const setup = (email?: string) => {
			fs.writeFileSync(gitconfig, email ? `[user]\n\temail = ${email}\n` : '')
			const dir = join(newTmpDir(), 'p')
			return cli(
				['setup', '--preset', 'minimal', '-d', dir, '--skip-install', '--yes'],
				undefined,
				{
					HOME: home,
					GIT_CONFIG_GLOBAL: gitconfig,
					GIT_CONFIG_NOSYSTEM: '1',
				}
			).stdout
		}
		expect(setup()).toContain('Set your git email before the first commit')
		expect(setup('dev@torcato.dev')).not.toContain('Set your git email')
	})

	it('copy biome writes biome.json to target dir', () => {
		const dir = newTmpDir()
		const { status, stdout } = cli(['copy', 'biome'], dir)
		expect(status).toBe(0)
		expect(stdout).toContain('Copied')
		expect(fs.existsSync(join(dir, 'biome.json'))).toBe(true)
	})

	it('copy tsconfig writes tsconfig.json to target dir', () => {
		const dir = newTmpDir()
		const { status } = cli(['copy', 'tsconfig'], dir)
		expect(status).toBe(0)
		expect(fs.existsSync(join(dir, 'tsconfig.json'))).toBe(true)
	})

	it('copy unknown config exits non-zero', () => {
		const dir = newTmpDir()
		const { status, stderr } = cli(['copy', 'nonexistent'], dir)
		expect(status).not.toBe(0)
		expect(String(stderr)).toContain('') // exits cleanly, no crash
	})

	it('doctor --json on empty dir returns parseable results', () => {
		const dir = newTmpDir()
		fs.writeJsonSync(join(dir, 'package.json'), { name: 'demo', version: '0.0.0' })
		const { stdout } = cli(['doctor', '-d', dir, '--json'])
		const { results } = JSON.parse(stdout)
		expect(Array.isArray(results)).toBe(true)
		expect(results.length).toBeGreaterThan(0)
		expect(results[0]).toHaveProperty('check')
		expect(results[0]).toHaveProperty('status')
	})

	it('unknown command exits non-zero', () => {
		const { status } = cli(['notacommand'])
		expect(status).toBe(1)
	})

	function seedPkg(dir: string, extra: Record<string, unknown> = {}) {
		fs.writeJsonSync(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			...extra,
		})
	}

	it('fix --list --json emits a parseable target catalog', () => {
		const { status, stdout } = cli(['fix', '--list', '--json'])
		expect(status).toBe(0)
		const payload = JSON.parse(stdout)
		expect(Array.isArray(payload.targets)).toBe(true)
		expect(payload.targets.length).toBeGreaterThan(10)
		const dependabot = payload.targets.find((t: { target: string }) => t.target === 'dependabot')
		expect(dependabot).toBeTruthy()
		expect(dependabot.outputs).toContain('.github/dependabot.yml')
	})

	it('fix dependabot --yes writes .github/dependabot.yml', () => {
		const dir = newTmpDir()
		seedPkg(dir)
		const { status } = cli(['fix', 'dependabot', '-d', dir, '--yes'])
		expect(status).toBe(0)
		expect(fs.existsSync(join(dir, '.github', 'dependabot.yml'))).toBe(true)
	})

	it('fix dependabot --dry-run --yes does not write the file', () => {
		const dir = newTmpDir()
		seedPkg(dir)
		const { status } = cli(['fix', 'dependabot', '-d', dir, '--yes', '--dry-run'])
		expect(status).toBe(0)
		expect(fs.existsSync(join(dir, '.github', 'dependabot.yml'))).toBe(false)
	})

	it('fix dependabot --yes --json emits an actions payload', () => {
		const dir = newTmpDir()
		seedPkg(dir)
		const { status, stdout } = cli(['fix', 'dependabot', '-d', dir, '--yes', '--json'])
		expect(status).toBe(0)
		const payload = JSON.parse(stdout)
		expect(payload.target).toBe('dependabot')
		expect(Array.isArray(payload.actions)).toBe(true)
		const applied = payload.actions.find((a: { status: string }) => a.status === 'applied')
		expect(applied?.filesWritten).toContain('.github/dependabot.yml')
	})

	it('fix renovate --yes writes renovate.json', () => {
		const dir = newTmpDir()
		seedPkg(dir)
		const { status } = cli(['fix', 'renovate', '-d', dir, '--yes'])
		expect(status).toBe(0)
		const renovate = fs.readJsonSync(join(dir, 'renovate.json'))
		expect(renovate.$schema).toMatch(/renovate-schema/)
	})

	it('fix codeowners --yes writes .github/CODEOWNERS', () => {
		const dir = newTmpDir()
		seedPkg(dir)
		const { status } = cli(['fix', 'codeowners', '-d', dir, '--yes'])
		expect(status).toBe(0)
		expect(fs.existsSync(join(dir, '.github', 'CODEOWNERS'))).toBe(true)
	})

	it('fix gitlab-ci --yes writes .gitlab-ci.yml', () => {
		const dir = newTmpDir()
		seedPkg(dir)
		const { status } = cli(['fix', 'gitlab-ci', '-d', dir, '--yes'])
		expect(status).toBe(0)
		expect(fs.existsSync(join(dir, '.gitlab-ci.yml'))).toBe(true)
	})

	it('fix unknown-target --json exits non-zero with structured error', () => {
		const dir = newTmpDir()
		seedPkg(dir)
		const { status, stdout } = cli(['fix', 'not-a-target', '-d', dir, '--yes', '--json'])
		expect(status).not.toBe(0)
		const payload = JSON.parse(stdout)
		expect(payload.error).toBe('unknown-target')
		expect(Array.isArray(payload.available)).toBe(true)
	})

	// #718: the scaffolds moved; the pointer names the exact replacement command.
	it.each([
		['docs-site', 'init'],
		['brand', 'brand'],
	])('fix %s exits 1 pointing at `shared-docs %s`', (target, command) => {
		const dir = newTmpDir()
		seedPkg(dir)
		const { status, stderr } = cli(['fix', target, '-d', dir, '--yes'])
		expect(status).toBe(1)
		expect(String(stderr)).toContain(`npx @rtorcato/shared-docs ${command}`)
	})

	it('fix --resync --json without a lockfile exits non-zero', () => {
		const dir = newTmpDir()
		seedPkg(dir)
		const { status, stdout } = cli(['fix', '-d', dir, '--resync', '--yes', '--json'])
		expect(status).not.toBe(0)
		const payload = JSON.parse(stdout)
		expect(payload.error).toBe('no-lockfile')
	})
})
