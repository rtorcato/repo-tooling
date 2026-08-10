import base from '@rtorcato/repo-tooling/vitest/config'
import react from '@vitejs/plugin-react'
import { defineConfig, mergeConfig } from 'vitest/config'

// Same reason as the base preset: an alias built from this file's `__dirname`
// points inside node_modules, never at the consumer's `src`.
export default mergeConfig(
	base,
	defineConfig({
		plugins: [react()],
		test: {
			environment: 'jsdom',
			include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
			css: true, // ← Vitest will stub every *.css / *.module.css import
			exclude: ['OLD/**'],
			setupFiles: ['./vitest.setup.ts'],
		},
	})
)
