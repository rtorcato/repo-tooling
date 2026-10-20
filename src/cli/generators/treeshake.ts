import path from 'node:path'
import fs from '../../base/safe-fs.js'

export interface TreeshakeOptions {
	workspaceName: string
	allowedSubpath: string
	forbiddenSubpaths: string[]
	appDir?: string
}

export interface SubpathInference {
	allCandidates: string[]
	defaultAllowed: string | null
}

/**
 * Inspect package.exports and return non-root subpath candidates (e.g. './foo' → 'foo').
 * Skips '.', types-only entries, and wildcard patterns ('./*').
 */
export function inferSubpathsFromExports(pkg: Record<string, unknown> | null): SubpathInference {
	const exports = pkg?.exports as Record<string, unknown> | undefined
	if (!exports || typeof exports !== 'object') {
		return { allCandidates: [], defaultAllowed: null }
	}
	const candidates: string[] = []
	for (const key of Object.keys(exports)) {
		if (key === '.' || !key.startsWith('./')) continue
		if (key.includes('*')) continue
		const trimmed = key.replace(/^\.\//, '')
		if (!trimmed) continue
		candidates.push(trimmed)
	}
	return {
		allCandidates: candidates,
		defaultAllowed: candidates[0] ?? null,
	}
}

function renderCheckScript(opts: TreeshakeOptions): string {
	const allowed = JSON.stringify([opts.allowedSubpath])
	const forbidden = JSON.stringify(opts.forbiddenSubpaths, null, '\t')
	return `import { build } from 'esbuild'

const ALLOWED_MODULES = ${allowed}

const FORBIDDEN_MODULES = ${forbidden}

const result = await build({
\tentryPoints: ['src/entry.ts'],
\tbundle: true,
\tformat: 'esm',
\tplatform: 'browser',
\tconditions: ['import', 'browser'],
\twrite: false,
\tmetafile: true,
\tminify: false,
})

const inputs = Object.keys(result.metafile.inputs)
const distInputs = inputs.filter((p) => p.includes('/dist/'))
const leaks = distInputs.filter((p) =>
\tFORBIDDEN_MODULES.some((m) => new RegExp(\`/dist/\${m}/\`).test(p))
)
const allowed = distInputs.filter((p) =>
\tALLOWED_MODULES.some((m) => new RegExp(\`/dist/\${m}/\`).test(p))
)

const bundleBytes = result.outputFiles?.[0]?.contents.byteLength ?? 0

console.log(\`Bundle size: \${bundleBytes} bytes\`)
console.log(\`dist inputs in bundle (\${distInputs.length}):\`)
for (const p of distInputs) console.log(\`  \${p}\`)

if (leaks.length > 0) {
\tconsole.error('\\n❌ Tree-shaking leak — forbidden modules in the bundle:')
\tfor (const p of leaks) console.error(\`  \${p}\`)
\tprocess.exit(1)
}

if (allowed.length === 0) {
\tconsole.error(
\t\t'\\n❌ Expected at least one allowed-subpath input — entry may have failed to resolve.'
\t)
\tprocess.exit(1)
}

console.log('\\n✅ Tree-shaking OK — only allowed inputs present.')
`
}

function renderEntry(workspaceName: string, allowedSubpath: string): string {
	return `export * from '${workspaceName}/${allowedSubpath}'\n`
}

// The treeshake-check app lives under apps/ and depends on the root package via
// `workspace:*`, which only resolves when a pnpm-workspace.yaml declares apps/*.
// pnpm 11 fails install (ERR_PNPM_IGNORED_BUILDS) on any dependency with an
// unapproved build script, approved via the `allowBuilds` map (package →
// boolean — pnpm 11 ignores the older `onlyBuiltDependencies` list). Approve
// the ones this monorepo shape needs:
//   - esbuild: the tree-shake check builds with it
//   - sharp:   pulled in by the common apps/docs (Docusaurus) path; built
//   - core-js: also pulled by apps/docs, but its postinstall is unwanted → false
// Naming a package that isn't installed is a harmless no-op, so seeding the
// docs-path entries keeps `pnpm install` green the moment an apps/docs is added.
const WORKSPACE_YAML = `packages:
  - 'apps/*'

allowBuilds:
  esbuild: true
  sharp: true
  core-js: false
`

/**
 * Ensure a pnpm-workspace.yaml exists that globs apps/* (needed for the
 * treeshake-check app's `workspace:*` dep to resolve). Never clobbers an
 * existing file. Returns the relative path if written, else null.
 */
async function ensureWorkspaceYaml(targetDir: string): Promise<string | null> {
	const wsPath = path.join(targetDir, 'pnpm-workspace.yaml')
	if (await fs.pathExists(wsPath)) return null
	await fs.writeFile(wsPath, WORKSPACE_YAML)
	return 'pnpm-workspace.yaml'
}

export async function generateTreeshakeCheck(
	targetDir: string,
	opts: TreeshakeOptions
): Promise<string[]> {
	const appDir = opts.appDir ?? 'apps/treeshake-check'
	const root = path.join(targetDir, appDir)
	await fs.ensureDir(path.join(root, 'src'))

	const pkgName = `${opts.workspaceName.replace(/^@/, '').replace(/\//g, '-')}-treeshake-check`
	const packageJson = {
		name: pkgName,
		version: '0.0.0',
		private: true,
		type: 'module',
		scripts: {
			check: 'node check.mjs',
		},
		dependencies: {
			[opts.workspaceName]: 'workspace:*',
		},
		devDependencies: {
			esbuild: '^0.28.0',
		},
	}

	const checkPath = path.join(root, 'check.mjs')
	const entryPath = path.join(root, 'src', 'entry.ts')
	const pkgPath = path.join(root, 'package.json')

	await fs.writeJson(pkgPath, packageJson, { spaces: 2 })
	await fs.writeFile(checkPath, renderCheckScript(opts))
	await fs.writeFile(entryPath, renderEntry(opts.workspaceName, opts.allowedSubpath))

	const written = [
		path.join(appDir, 'package.json'),
		path.join(appDir, 'check.mjs'),
		path.join(appDir, 'src', 'entry.ts'),
	]

	const workspaceFile = await ensureWorkspaceYaml(targetDir)
	if (workspaceFile) written.push(workspaceFile)

	return written
}
