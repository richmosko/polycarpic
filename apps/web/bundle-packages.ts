// Records every module id of the client and the server build (POLY-161 R14), so the package list of what ships is read from the
// build itself and not from source maps alone (28 of 81 server files have no map and the client has none). infra/ci/bundle-packages.mjs
// takes the union of these ids and the server maps before the maps are deleted. The file is merged across the builds of one run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

export const MODULES_FILE = '.svelte-kit/bundle-modules.json';

// One `vite build` runs the client and the server build in one process; the first buildStart of the process starts the file afresh.
let started = false;

export function bundlePackages(root: string = process.cwd()): Plugin {
  const file = resolve(root, MODULES_FILE);
  return {
    name: 'poly-bundle-packages',
    apply: 'build',
    buildStart() {
      if (started) return;
      started = true;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, '[]\n');
    },
    generateBundle(_options, bundle) {
      const ids = new Set<string>(existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as string[]) : []);
      for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') for (const id of Object.keys(chunk.modules)) ids.add(id);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify([...ids].sort(), null, 1)}\n`);
    },
  };
}
