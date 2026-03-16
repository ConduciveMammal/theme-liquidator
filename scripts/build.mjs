import { chmod, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outFile = resolve(rootDir, 'dist/cli.js');

await mkdir(dirname(outFile), {recursive: true});

await build({
	entryPoints: [resolve(rootDir, 'src/index.js')],
	outfile: outFile,
	bundle: true,
	packages: 'external',
	platform: 'node',
	target: 'node20',
	format: 'esm',
	jsx: 'automatic',
	banner: {
		js: '#!/usr/bin/env node'
	},
	define: {
		__APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0')
	}
});

await chmod(outFile, 0o755);
