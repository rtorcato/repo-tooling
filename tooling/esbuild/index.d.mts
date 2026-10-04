import type { BuildOptions, BuildResult, Plugin } from 'esbuild'

export declare function buildCode(
	entryPoints?: string[],
	options?: Partial<BuildOptions>
): Promise<BuildResult | undefined>

export declare function externalsPlugins(cwd?: string): Promise<Plugin[]>
