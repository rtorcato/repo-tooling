import { join } from 'node:path'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupProject } from '../../../src/cli/commands/setup.js'
import {
	buildPresetConfig,
	computeFileList,
	CONFIG_SCHEMA,
	PRESET_NAMES,
	validateProjectConfig,
} from '../../../src/cli/commands/setup-presets.js'
import { generateConfigs } from '../../../src/cli/generators/index.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

// #382: computeFileList is a promise about what generateConfigs writes — the
// budget has to actually land, or the `size-limit` script has nothing to run.
describe('generateConfigs size-limit budget', () => {
	it('writes the budget for a library and nothing for an app', async () => {
		const libDir = newTmpDir()
		await generateConfigs(
			{ ...buildPresetConfig('library', 'demo'), aiSetup: false, securityAutomation: false },
			libDir
		)
		expect(await fs.pathExists(join(libDir, '.size-limit.json'))).toBe(true)

		const appDir = newTmpDir()
		await generateConfigs(
			{ ...buildPresetConfig('react-app', 'demo'), aiSetup: false, securityAutomation: false },
			appDir
		)
		expect(await fs.pathExists(join(appDir, '.size-limit.json'))).toBe(false)
	})
})

describe('setup-presets', () => {
	it('builds a valid config for every preset', () => {
		for (const name of PRESET_NAMES) {
			const config = buildPresetConfig(name, 'demo')
			const { valid, errors } = validateProjectConfig(config)
			expect(valid, `${name}: ${errors.join('; ')}`).toBe(true)
		}
	})

	it('library preset enables semantic release and tsup', () => {
		const config = buildPresetConfig('library', 'demo')
		expect(config.semanticRelease).toBe(true)
		expect(config.bundler).toBe('tsup')
	})

	it('react-app preset uses vite + browser environment', () => {
		const config = buildPresetConfig('react-app', 'demo')
		expect(config.bundler).toBe('vite')
		expect(config.testing.environment).toBe('browser')
	})

	it('nextjs-app preset uses eslint + no bundler', () => {
		const config = buildPresetConfig('nextjs-app', 'demo')
		expect(config.linting.tool).toBe('eslint')
		expect(config.linting.eslintConfig).toBe('nextjs')
		expect(config.bundler).toBe('none')
	})

	it('enables aiSetup by default and lists AI files when on', () => {
		const config = buildPresetConfig('library', 'demo')
		expect(config.aiSetup).toBe(true)
		const files = computeFileList(config)
		expect(files).toContain('AGENTS.md')
		expect(files).toContain('CLAUDE.md')
		expect(files).toContain('.mcp.json.example')
	})

	it('omits AI files from the list when aiSetup is off', () => {
		const config = { ...buildPresetConfig('library', 'demo'), aiSetup: false }
		const files = computeFileList(config)
		expect(files).not.toContain('AGENTS.md')
		expect(files).not.toContain('.mcp.json.example')
	})

	it('swift-library preset records the language and picks no JS tools (#288)', () => {
		const config = buildPresetConfig('swift-library', 'demo')
		expect(config.language).toBe('swift')
		expect(config.projectType).toBe('library')
		expect(config.typescript.enabled).toBe(false)
		expect(config.bundler).toBe('none')
		// commitlint is an npm package, and every badge URL is derived from a
		// package.json this repo doesn't have. Git hooks are not — the Swift path
		// commits `.githooks/` and uses `core.hooksPath` (#309) — and
		// `semanticRelease` is the release-automation flag, which on Swift means a
		// tag-triggered workflow rather than an npm publish (#310).
		expect(config.gitHooks).toBe(true)
		expect(config.commitLint).toBe(false)
		expect(config.semanticRelease).toBe(true)
		expect(config.badges).toBe(false)
		// Security automation and the AI agent files are language-agnostic.
		expect(config.securityAutomation).toBe(true)
		expect(config.aiSetup).toBe(true)
	})
})

describe('validateProjectConfig', () => {
	it('rejects unknown fields', () => {
		const result = validateProjectConfig({
			...buildPresetConfig('library', 'demo'),
			somethingExtra: true,
		})
		expect(result.valid).toBe(false)
		expect(result.errors).toContain('Unknown field: somethingExtra')
	})

	it('rejects missing required fields', () => {
		const config = buildPresetConfig('library', 'demo') as Record<string, unknown>
		delete config.gitHooks
		const result = validateProjectConfig(config)
		expect(result.valid).toBe(false)
		expect(result.errors).toContain('Missing required field: gitHooks')
	})

	it('rejects non-objects', () => {
		expect(validateProjectConfig('hi').valid).toBe(false)
		expect(validateProjectConfig(null).valid).toBe(false)
		expect(validateProjectConfig([]).valid).toBe(false)
	})

	it('accepts a valid preset-built config', () => {
		const config = buildPresetConfig('node-api', 'demo')
		expect(validateProjectConfig(config).valid).toBe(true)
	})
})

describe('computeFileList', () => {
	it('includes baseline + bundler + security for a library', () => {
		const files = computeFileList(buildPresetConfig('library', 'demo'))
		expect(files).toContain('package.json')
		expect(files).toContain('.editorconfig')
		expect(files).toContain('tsup.config.ts')
		expect(files).toContain('release.config.mjs')
		expect(files).toContain('.github/dependabot.yml')
	})

	// #382: the `size-limit` script getScripts() emits needs a budget to run on.
	it('lists the size-limit budget for libraries only', () => {
		expect(computeFileList(buildPresetConfig('library', 'demo'))).toContain('.size-limit.json')
		expect(computeFileList(buildPresetConfig('react-app', 'demo'))).not.toContain(
			'.size-limit.json'
		)
	})

	it('omits release.config.mjs for non-library presets', () => {
		const files = computeFileList(buildPresetConfig('node-api', 'demo'))
		expect(files).not.toContain('release.config.mjs')
	})

	it('includes vite config for react-app', () => {
		const files = computeFileList(buildPresetConfig('react-app', 'demo'))
		expect(files).toContain('vite.config.ts')
		expect(files).not.toContain('tsup.config.ts')
	})

	it('lists Swift files and no package.json for swift-library (#288)', () => {
		const files = computeFileList(buildPresetConfig('swift-library', 'my-swift-lib'))
		expect(files).toContain('Package.swift')
		expect(files).toContain('Sources/MySwiftLib/MySwiftLib.swift')
		expect(files).toContain('.swiftlint.yml')
		expect(files).toContain('.github/workflows/ci.yml')
		expect(files).not.toContain('package.json')
		expect(files).not.toContain('tsconfig.json')
	})

	it('lists bunfig.toml when targeting Bun (#225)', () => {
		expect(computeFileList({ ...buildPresetConfig('library', 'demo'), bun: true })).toContain(
			'bunfig.toml'
		)
		// Off by default — no bunfig unless opted in.
		expect(computeFileList(buildPresetConfig('library', 'demo'))).not.toContain('bunfig.toml')
	})
})

describe('setup --config-schema', () => {
	it('prints the JSON Schema to stdout and exits', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: '.', configSchema: true })
			const printed = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)
			expect(printed.title).toBe('ProjectConfig')
			expect(printed.$schema).toMatch(/json-schema/)
			expect(printed).toEqual(CONFIG_SCHEMA)
		} finally {
			logSpy.mockRestore()
		}
	})
})

describe('setup --dry-run', () => {
	it('with --preset prints the resolved config and file list, writes nothing', async () => {
		const dir = newTmpDir()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({
				directory: dir,
				preset: 'library',
				dryRun: true,
				skipInstall: true,
			})
			const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)
			expect(payload.directory).toBe(dir)
			expect(payload.config.projectType).toBe('library')
			expect(payload.files).toContain('tsup.config.ts')
		} finally {
			logSpy.mockRestore()
		}
		// Nothing should be written.
		const entries = await fs.readdir(dir)
		expect(entries).toEqual([])
	})

	it('with --config reads the file and prints it', async () => {
		const dir = newTmpDir()
		const config = buildPresetConfig('node-api', 'my-api')
		const configPath = join(dir, 'project.json')
		await fs.writeJson(configPath, config)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({
				directory: dir,
				config: configPath,
				dryRun: true,
				skipInstall: true,
			})
			const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)
			expect(payload.config.projectType).toBe('node-api')
		} finally {
			logSpy.mockRestore()
		}
	})
})

describe('setup --preset', () => {
	it('scaffolds a library project without prompts', async () => {
		const dir = newTmpDir()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({
				directory: dir,
				preset: 'library',
				skipInstall: true,
			})
		} finally {
			logSpy.mockRestore()
		}
		expect(await fs.pathExists(join(dir, 'package.json'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'tsup.config.ts'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.editorconfig'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.github', 'dependabot.yml'))).toBe(true)
	})

	it('scaffolds a Swift package and records the language in the lockfile (#288)', async () => {
		const dir = newTmpDir()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, preset: 'swift-library', skipInstall: true })
		} finally {
			logSpy.mockRestore()
		}
		expect(await fs.pathExists(join(dir, 'Package.swift'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.swiftlint.yml'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.github', 'workflows', 'ci.yml'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'package.json'))).toBe(false)

		const lock = await fs.readJson(join(dir, '.repo-tooling.json'))
		expect(lock.record.config.language).toBe('swift')
	})

	it('rejects unknown preset names', async () => {
		const dir = newTmpDir()
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			await expect(
				setupProject({
					directory: dir,
					preset: 'not-a-preset',
					skipInstall: true,
				})
			).rejects.toThrow('exit')
		} finally {
			exitSpy.mockRestore()
			errSpy.mockRestore()
		}
	})
})

// #461: BASE hardcoded git hooks, commitlint, security automation, badges and
// the AI agent files, and every preset only ever added to it — so no preset
// could produce a small repo. `minimal` is built without spreading BASE.
describe('setup --preset minimal', () => {
	it('turns off every opinionated extra', () => {
		const config = buildPresetConfig('minimal', 'demo')
		expect(config.gitHooks).toBe(false)
		expect(config.commitLint).toBe(false)
		expect(config.semanticRelease).toBe(false)
		expect(config.securityAutomation).toBe(false)
		expect(config.badges).toBe(false)
		expect(config.aiSetup).toBe(false)
		expect(config.bundler).toBe('none')
		expect(validateProjectConfig(config).valid).toBe(true)
	})

	it('lists tsconfig + biome + vitest and nothing else', () => {
		const files = computeFileList(buildPresetConfig('minimal', 'demo'))
		expect(files).toContain('tsconfig.json')
		expect(files).toContain('biome.json')
		expect(files).toContain('vitest.config.ts')
		for (const unwanted of [
			'.husky/pre-commit',
			'.husky/commit-msg',
			'commitlint.config.mjs',
			'release.config.mjs',
			'.github/dependabot.yml',
			'.github/workflows/codeql.yml',
			'AGENTS.md',
			'CLAUDE.md',
			'tsup.config.ts',
			'.size-limit.json',
		]) {
			expect(files, unwanted).not.toContain(unwanted)
		}
	})

	it('scaffolds only those files', async () => {
		const dir = newTmpDir()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, preset: 'minimal', skipInstall: true })
		} finally {
			logSpy.mockRestore()
		}
		expect(await fs.pathExists(join(dir, 'tsconfig.json'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'biome.json'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'vitest.config.ts'))).toBe(true)
		// A scaffold with no .gitignore commits node_modules on the first push.
		expect(await fs.pathExists(join(dir, '.gitignore'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.husky'))).toBe(false)
		expect(await fs.pathExists(join(dir, 'AGENTS.md'))).toBe(false)
		expect(await fs.pathExists(join(dir, '.github', 'dependabot.yml'))).toBe(false)

		// The library shape would add publint/attw/size-limit scripts plus a
		// dist/-rooted exports map that `bundler: 'none'` never builds.
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(Object.keys(pkg.scripts)).not.toContain('publint')
		expect(Object.keys(pkg.scripts)).not.toContain('attw')
		expect(Object.keys(pkg.scripts)).not.toContain('size-limit')
		expect(Object.keys(pkg.scripts)).not.toContain('release')
		expect(Object.keys(pkg.scripts)).not.toContain('prepare')
		expect(pkg.exports).toBeUndefined()
		for (const dep of [
			'husky',
			'lint-staged',
			'@commitlint/cli',
			'semantic-release',
			'size-limit',
			'@arethetypeswrong/cli',
		]) {
			expect(Object.keys(pkg.devDependencies ?? {}), dep).not.toContain(dep)
		}
	})
})

// #461: in a terminal a preset now shows its file list and lets the user
// deselect. Non-TTY is CI — the case --preset was added for — and must keep the
// exact one-shot behaviour.
describe('setup --preset review prompt', () => {
	/** Pretend both ends of the pipe are a terminal; returns the undo. */
	function fakeTTY(): () => void {
		const saved = [process.stdin, process.stdout].map(
			(stream) => [stream, Object.getOwnPropertyDescriptor(stream, 'isTTY')] as const
		)
		for (const [stream] of saved) {
			Object.defineProperty(stream, 'isTTY', { value: true, configurable: true })
		}
		return () => {
			for (const [stream, descriptor] of saved) {
				if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor)
				else delete (stream as unknown as { isTTY?: boolean }).isTTY
			}
		}
	}

	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it('does not prompt when stdin/stdout are not a terminal', async () => {
		const dir = newTmpDir()
		const spy = vi.spyOn(inquirer, 'prompt')
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, preset: 'library', skipInstall: true })
		} finally {
			logSpy.mockRestore()
		}
		expect(spy).not.toHaveBeenCalled()
		// The one-shot scaffold is unchanged: everything BASE turns on still lands.
		expect(await fs.pathExists(join(dir, '.husky', 'pre-commit'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'AGENTS.md'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.github', 'dependabot.yml'))).toBe(true)
	})

	it('offers a checkbox of the preset extras, all pre-checked', async () => {
		const dir = newTmpDir()
		const restoreTTY = fakeTTY()
		const spy = vi
			.spyOn(inquirer, 'prompt')
			.mockImplementation((async () => ({ features: [] })) as never)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, preset: 'library', skipInstall: true })
		} finally {
			logSpy.mockRestore()
			restoreTTY()
		}

		expect(spy).toHaveBeenCalledTimes(1)
		const [questions] = spy.mock.calls[0] as [Array<Record<string, unknown>>]
		expect(questions).toHaveLength(1)
		const question = questions[0]
		// inquirer v14 has no `list`; a multi-select is `checkbox` (#463).
		expect(Object.keys(inquirer.createPromptModule().prompts)).toContain(question.type)
		expect(question.type).toBe('checkbox')
		const choices = question.choices as Array<{ value: string; checked: boolean }>
		expect(choices.map((c) => c.value)).toEqual([
			'gitHooks',
			'commitLint',
			'semanticRelease',
			'securityAutomation',
			'badges',
			'aiSetup',
		])
		expect(choices.every((c) => c.checked)).toBe(true)
	})

	it('writes nothing for the features the user unchecks', async () => {
		const dir = newTmpDir()
		const restoreTTY = fakeTTY()
		vi.spyOn(inquirer, 'prompt').mockImplementation((async () => ({
			features: ['semanticRelease', 'badges'],
		})) as never)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, preset: 'library', skipInstall: true })
		} finally {
			logSpy.mockRestore()
			restoreTTY()
		}
		expect(await fs.pathExists(join(dir, '.husky'))).toBe(false)
		expect(await fs.pathExists(join(dir, 'commitlint.config.mjs'))).toBe(false)
		expect(await fs.pathExists(join(dir, 'AGENTS.md'))).toBe(false)
		expect(await fs.pathExists(join(dir, '.github', 'dependabot.yml'))).toBe(false)
		// Kept, so still written.
		expect(await fs.pathExists(join(dir, 'release.config.mjs'))).toBe(true)

		const lock = await fs.readJson(join(dir, '.repo-tooling.json'))
		expect(lock.record.config.gitHooks).toBe(false)
		expect(lock.record.config.aiSetup).toBe(false)
		expect(lock.record.config.semanticRelease).toBe(true)
	})

	it('prints the resolved file list before asking', async () => {
		const dir = newTmpDir()
		const restoreTTY = fakeTTY()
		vi.spyOn(inquirer, 'prompt').mockImplementation((async () => ({ features: [] })) as never)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		let output = ''
		try {
			await setupProject({ directory: dir, preset: 'library', skipInstall: true })
			output = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
		} finally {
			logSpy.mockRestore()
			restoreTTY()
		}
		for (const file of computeFileList(buildPresetConfig('library', 'demo'))) {
			expect(output, file).toContain(file)
		}
	})

	it('skips the review with --yes even in a terminal', async () => {
		const dir = newTmpDir()
		const restoreTTY = fakeTTY()
		const spy = vi.spyOn(inquirer, 'prompt')
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, preset: 'library', skipInstall: true, yes: true })
		} finally {
			logSpy.mockRestore()
			restoreTTY()
		}
		expect(spy).not.toHaveBeenCalled()
		expect(await fs.pathExists(join(dir, 'AGENTS.md'))).toBe(true)
	})

	it('skips the review with --dry-run even in a terminal', async () => {
		const dir = newTmpDir()
		const restoreTTY = fakeTTY()
		const spy = vi.spyOn(inquirer, 'prompt')
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, preset: 'library', skipInstall: true, dryRun: true })
		} finally {
			logSpy.mockRestore()
			restoreTTY()
		}
		expect(spy).not.toHaveBeenCalled()
		expect(await fs.readdir(dir)).toEqual([])
	})
})

describe('setup --config', () => {
	it('reads a JSON ProjectConfig and uses it instead of prompts', async () => {
		const dir = newTmpDir()
		const config = buildPresetConfig('node-api', 'my-api')
		const configPath = join(dir, 'project.json')
		await fs.writeJson(configPath, config)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({
				directory: dir,
				config: configPath,
				skipInstall: true,
			})
		} finally {
			logSpy.mockRestore()
		}
		expect(await fs.pathExists(join(dir, 'package.json'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'build.mjs'))).toBe(true)
	})

	it('accepts a .repo-tooling.json lockfile and unwraps its config (#271)', async () => {
		const dir = newTmpDir()
		const config = buildPresetConfig('node-api', 'my-api')
		// A lockfile wraps the config alongside version/writtenBy/etc — those extra
		// keys would fail validation if not unwrapped.
		const lockfile = {
			$schema: 'https://rtorcato.github.io/repo-tooling/schemas/lockfile.json',
			version: 2,
			config,
			writtenBy: '@rtorcato/repo-tooling@0.0.0',
			writtenAt: '2026-01-01T00:00:00.000Z',
		}
		const configPath = join(dir, '.repo-tooling.json')
		await fs.writeJson(configPath, lockfile)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, config: configPath, dryRun: true, skipInstall: true })
			const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)
			expect(payload.config.projectType).toBe('node-api')
			expect(payload.config.version).toBeUndefined()
		} finally {
			logSpy.mockRestore()
		}
	})

	it('rejects configs with unknown fields', async () => {
		const dir = newTmpDir()
		const configPath = join(dir, 'project.json')
		await fs.writeJson(configPath, {
			...buildPresetConfig('library', 'demo'),
			somethingExtra: true,
		})
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			await expect(
				setupProject({
					directory: dir,
					config: configPath,
					skipInstall: true,
				})
			).rejects.toThrow('exit')
		} finally {
			exitSpy.mockRestore()
			errSpy.mockRestore()
		}
	})
})

// The interactive path (#284). `prompt` is called once for the language, then
// once for the JS question list — queue an answer per call.
describe('setup language prompt', () => {
	function mockPrompt(...answers: Array<Record<string, unknown>>) {
		const spy = vi.spyOn(inquirer, 'prompt')
		for (const answer of answers) {
			spy.mockImplementationOnce((async () => answer) as never)
		}
		return spy
	}

	/** The language question, as it was actually handed to inquirer. */
	function languageQuestion(spy: ReturnType<typeof mockPrompt>): Record<string, unknown> {
		const [questions] = spy.mock.calls[0] as [Array<Record<string, unknown>>]
		return questions[0]
	}

	const JS_ANSWERS = {
		projectName: 'demo',
		projectType: 'library',
		useTypeScript: true,
		tsConfig: 'base',
		lintingTool: 'biome',
		testingFramework: 'vitest',
		gitHooks: false,
		commitLint: false,
		releaseTool: 'none',
		securityAutomation: false,
		aiSetup: false,
		badges: false,
		bundler: 'none',
	}

	beforeEach(() => {
		vi.restoreAllMocks()
	})

	// #475: the greeting was still "JS Tooling Setup" months after the rename
	// because nothing pinned it. It is the first thing a user ever sees.
	it('greets with the current product name, not the pre-rename one', async () => {
		const dir = newTmpDir()
		mockPrompt({ language: 'js' }, JS_ANSWERS)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, skipInstall: true })
			const greeting = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
			expect(greeting).toContain('Welcome to repo-tooling setup!')
			expect(greeting).not.toMatch(/JS Tooling/i)
		} finally {
			logSpy.mockRestore()
		}
	})

	it('defaults to the language detected in the target directory', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), '// swift-tools-version:6.0\n')
		const spy = mockPrompt({ language: 'swift' }, { projectName: 'demo' })
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, skipInstall: true })
			const question = languageQuestion(spy)
			expect(question.name).toBe('language')
			expect(question.default).toBe('swift')
		} finally {
			logSpy.mockRestore()
		}
	})

	it('falls back to js for a directory with no language marker', async () => {
		const dir = newTmpDir()
		const spy = mockPrompt({ language: 'perl' })
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, skipInstall: true })
			const question = languageQuestion(spy)
			expect(question.default).toBe('js')
		} finally {
			logSpy.mockRestore()
		}
	})

	it('offers every registered language, flagging the ones without a setup preset', async () => {
		const dir = newTmpDir()
		const spy = mockPrompt({ language: 'js' }, JS_ANSWERS)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, skipInstall: true })
			const question = languageQuestion(spy)
			const choices = question.choices as Array<{ name: string; value: string }>
			expect(choices.map((c) => c.value)).toEqual(['js', 'swift', 'python', 'perl'])
			expect(choices.find((c) => c.value === 'js')?.name).toBe('JavaScript/TypeScript')
			// Swift is fully scaffoldable since #288, so it gets a bare label like JS.
			expect(choices.find((c) => c.value === 'swift')?.name).toBe('Swift')
			// Python (#290) and Perl (#289) audit and fix, but neither scaffolds yet.
			for (const id of ['python', 'perl']) {
				expect(choices.find((c) => c.value === id)?.name).toMatch(/no setup preset yet/)
			}
		} finally {
			logSpy.mockRestore()
		}
	})

	it('writes nothing and points at doctor when the language has no module yet', async () => {
		const dir = newTmpDir()
		mockPrompt({ language: 'python' })
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, skipInstall: true })
			const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
			expect(output).toMatch(/Python scaffolding isn't available yet/)
			expect(output).toMatch(/doctor/)
		} finally {
			logSpy.mockRestore()
		}
		expect(await fs.readdir(dir)).toEqual([])
	})

	// Swift's only real choice is the package name — SwiftLint, Periphery and
	// `swift test` are the standard, not options (#288).
	it('asks Swift only for a name, then scaffolds the swift-library preset', async () => {
		const dir = newTmpDir()
		const spy = mockPrompt({ language: 'swift' }, { projectName: 'my-swift-lib' })
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, skipInstall: true })
		} finally {
			logSpy.mockRestore()
		}
		expect(spy).toHaveBeenCalledTimes(2)
		const [swiftQuestions] = spy.mock.calls[1] as [Array<Record<string, unknown>>]
		expect(swiftQuestions.map((q) => q.name)).toEqual(['projectName'])

		expect(await fs.pathExists(join(dir, 'Sources/MySwiftLib/MySwiftLib.swift'))).toBe(true)
		const lock = await fs.readJson(join(dir, '.repo-tooling.json'))
		expect(lock.record.config.language).toBe('swift')
	})

	it('records the chosen language in the lockfile instead of a hardcoded js', async () => {
		const dir = newTmpDir()
		mockPrompt({ language: 'js' }, JS_ANSWERS)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, skipInstall: true })
		} finally {
			logSpy.mockRestore()
		}
		const lock = await fs.readJson(join(dir, '.repo-tooling.json'))
		expect(lock.record.config.language).toBe('js')
	})

	// #463: every test above spies on `inquirer.prompt`, which replaces the
	// dispatcher wholesale — so they all passed against a wizard that could not
	// ask a single question. inquirer v10 renamed `list` to `select`, v14 shipped
	// in this repo, and `npx repo-tooling setup` died on its first prompt with
	// `UnknownPromptTypeError` while this suite stayed green.
	//
	// The fix is to check the questions against the *installed* inquirer's own
	// registry rather than a list written down here, so the next rename fails at
	// the dependency bump instead of in a user's terminal.
	it('only uses prompt types the installed inquirer registers', async () => {
		const registered = new Set(Object.keys(inquirer.createPromptModule().prompts))
		// Guard the oracle itself: an empty registry would pass everything.
		expect(registered.has('select')).toBe(true)

		const dir = newTmpDir()
		const spy = mockPrompt({ language: 'js' }, JS_ANSWERS)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await setupProject({ directory: dir, skipInstall: true })
		} finally {
			logSpy.mockRestore()
		}

		const asked = spy.mock.calls.flatMap(
			([questions]) => questions as Array<{ type?: string; name?: string }>
		)
		// Without this the assertion below passes vacuously on zero questions.
		expect(asked.length).toBeGreaterThan(5)
		expect(
			asked.filter((q) => q.type && !registered.has(q.type)).map((q) => `${q.name}: ${q.type}`)
		).toEqual([])
	})
})
