/**
 * Immutable pins for the GitHub Actions the generators emit (#985).
 *
 * A mutable tag such as `actions/checkout@v7` can be moved, so a compromised
 * tag runs attacker code in a consumer's CI, and in a release workflow that job
 * holds an OIDC token. Every generated `uses:` is therefore rewritten to the
 * tag's commit SHA with a `# vX.Y.Z` comment, which is the form Dependabot
 * keeps current. The templates keep the readable tag and `pinActions` swaps it
 * on the way out, so there is one table to refresh instead of a SHA per call site.
 *
 * Dependabot cannot see this table: bump the entries by hand when an action's
 * major moves. Consumers' own Dependabot then updates what they scaffolded.
 */
export const PINS: Record<string, string> = {
	'actions/checkout@v7': '3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
	'actions/setup-node@v7': '949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
	'pnpm/action-setup@v6': 'ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0',
	'actions/cache@v6': '55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
	'actions/upload-artifact@v7': 'cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2',
	'actions/configure-pages@v5': '983d7736d9b0ae728b81ab479565c72886d7745b # v5.0.0',
	'actions/upload-pages-artifact@v3': '56afc609e74202658d3ffba0e8f6dda462b719fa # v3.0.1',
	'actions/deploy-pages@v4': 'd6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4.0.5',
	'dependabot/fetch-metadata@v3': '25dd0e34f4fe68f24cc83900b1fe3fe149efef98 # v3.1.0',
	'changesets/action@v2.1.2': 'ae32849d5ba541f9ae29e40e22a623bc13562f51 # v2.1.2',
	'actions/setup-python@v6': 'ece7cb06caefa5fff74198d8649806c4678c61a1 # v6.3.0',
	'actions/github-script@v7': 'f28e40c7f34bde8b3046d885e986cb6290c5673b # v7.1.0',
	'github/codeql-action/init@v3': '9418214df1f2c4b8128c770156c409013b07d6b9 # v3.39.3',
	'github/codeql-action/analyze@v3': '9418214df1f2c4b8128c770156c409013b07d6b9 # v3.39.3',
	'googleapis/release-please-action@v4': '5c625bfb5d1ff62eadeeb3772007f7f66fdcf071 # v4.4.1',
	'peaceiris/actions-gh-pages@v4': '84c30a85c19949d7eee79c4ff27748b70285e453 # v4.1.0',
	'shogo82148/actions-setup-perl@v1': '3b59bd33efdae98406a9bc4b75a4aa041e11993a # v1.44.4',
	'maxim-lobanov/setup-xcode@v1': 'ed7a3b1fda3918c0306d1b724322adc0b8cc0a90 # v1.7.0',
	'docker/setup-buildx-action@v3': '8d2750c68a42422c14e847fe6c8ac0403b4cbd6f # v3.12.0',
	'docker/login-action@v3': 'c94ce9fb468520275223c153574b00df6fe4bcc9 # v3.7.0',
	'docker/metadata-action@v5': 'c299e40c65443455700f0fdfc63efafe5b349051 # v5.10.0',
	'docker/build-push-action@v6': '10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6.19.2',
	'cloudflare/wrangler-action@v3': '9acf94ace14e7dc412b076f2c5c20b8ce93c79cd # v3.15.0',
}

const USES = /(uses:\s*['"]?)([\w.-]+\/[\w./-]+@v[\w.]+)(?=['"]?(?:\s|$))/g

/** Rewrite every known `uses: owner/repo@tag` in a workflow to its commit SHA. */
export function pinActions(workflow: string): string {
	return workflow.replace(USES, (match, lead: string, ref: string) => {
		const pin = PINS[ref]
		return pin ? `${lead}${ref.slice(0, ref.indexOf('@'))}@${pin}` : match
	})
}
