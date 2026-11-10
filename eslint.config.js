import fs from 'node:fs';
import { generateConfig } from './scripts/layers/generate.mjs';

// NOTE: root package.json pins typescript to 6.x because typescript-eslint (the parser this config
// loads) refuses TypeScript 7. Lift the pin when typescript-eslint supports TS >= 7.1.
// The layer rules are generated from layers.json; there is nothing to edit here (ARCH §2.1).
const layers = JSON.parse(fs.readFileSync(new URL('./layers.json', import.meta.url), 'utf8'));

export default [
  { ignores: ['**/node_modules/**', '**/.turbo/**', 'prototype/**', 'spikes/**', 'temp/**', 'test/layers/fixtures/**', 'docs/**'] },
  ...generateConfig(layers, { root: new URL('.', import.meta.url).pathname.replace(/\/$/, '') }),
];
