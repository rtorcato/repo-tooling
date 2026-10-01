const { builtinModules } = require('node:module')
const pkg = require('./package.json')

// Node built-ins never reach a consumer's bundle, and size-limit's bundler
// fails on them ("Could not resolve node:fs"), so one Node-only subpath would
// otherwise break the whole run.
const NODE_BUILTINS = builtinModules.flatMap((m) => [m, `node:${m}`])

// Per-subpath budget overrides, e.g. { './clipboard': '500 B' }.
const OVERRIDES = {}
const DEFAULT_LIMIT = '10 kB'

// Resolve the ESM entry file for an exports condition (string, or an object
// with a string `import`, or a nested `import.default`).
function importPath(cond) {
	if (typeof cond === 'string') return cond
	if (cond && typeof cond === 'object') {
		if (typeof cond.import === 'string') return cond.import
		if (cond.import && typeof cond.import === 'object') return cond.import.default
	}
	return undefined
}

module.exports = Object.entries(pkg.exports || {})
	.filter(([sub]) => sub !== '.' && sub !== './package.json')
	.map(([sub, cond]) => [sub, importPath(cond)])
	.filter(([, file]) => typeof file === 'string')
	.map(([sub, file]) => ({
		name: `${pkg.name}${sub.slice(1)}`,
		path: file.replace(/^\.\//, ''),
		limit: OVERRIDES[sub] || DEFAULT_LIMIT,
		ignore: NODE_BUILTINS,
	}))
