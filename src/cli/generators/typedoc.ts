import path from 'node:path'
import fs from 'fs-extra'

type Pkg = Record<string, unknown> | null

const DOCS_WORKFLOW = `name: 📚 Docs
on:
  push:
    branches: [main]
jobs:
  docs:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm docs
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: \${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./docs
`

export async function generateTypedocConfig(pkg: Pkg, targetDir: string) {
	const name = (pkg?.name as string | undefined) ?? 'My Library'
	const config = {
		extends: ['@rtorcato/repo-tooling/typedoc'],
		entryPoints: ['./src/index.ts'],
		name,
	}
	await fs.writeJson(path.join(targetDir, 'typedoc.json'), config, { spaces: 2 })
}

/** The path written, or null when a docs.yml already exists — never replaced (#629). */
export async function generateTypedocWorkflow(targetDir: string): Promise<string | null> {
	const rel = '.github/workflows/docs.yml'
	const workflowPath = path.join(targetDir, rel)
	if (await fs.pathExists(workflowPath)) return null
	await fs.outputFile(workflowPath, DOCS_WORKFLOW)
	return rel
}
