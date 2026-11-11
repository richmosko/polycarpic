// Generates the ESLint flat config for the layer map from layers.json (ARCH §2.1).
// Nothing here is a hand-copied list of packages: every per-package block is derived from the file.
import boundaries from 'eslint-plugin-boundaries';
import importX from 'eslint-plugin-import-x';
import comments from '@eslint-community/eslint-plugin-eslint-comments';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import poly from './plugin.mjs';

const RESOLVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'resolver.cjs');
const SRC = '**/*.{ts,tsx,js,mjs,cjs,svelte}';
const TESTS = ['**/*.test.{ts,tsx,js,mjs}', '**/*.spec.{ts,tsx,js,mjs}'];

const PG_DRIVERS = ['pg', 'pg-pool', 'postgres', '@neondatabase/serverless'];
const DRIZZLE_PG = ['node-postgres', 'postgres-js', 'neon-serverless', 'neon-http', 'pg-proxy'].map((s) => `drizzle-orm/${s}`);
const CRYPTO_NAMES = ['createCipheriv', 'createDecipheriv', 'publicEncrypt', 'privateDecrypt', 'subtle', 'webcrypto'];
const HPKE = ['@hpke/*', 'hpke-js'];
const SVELTEKIT = ['@sveltejs/kit', '$app/*', '$env/*'];
const DISABLE_PROOFED = ['boundaries/*', 'no-restricted-imports', 'poly/*', 'import-x/*', 'eslint-comments/*'];

export function generateConfig(layers, opts = {}) {
  const root = opts.root ?? process.cwd();
  const pk = layers.packages;
  const names = Object.keys(pk);
  const base = (n) => `${pk[n].dir}/**/${SRC}`;

  const elements = names.map((n) => ({ type: n, pattern: `${pk[n].dir}/**`, partialMatch: false }));
  const policies = names.map((n) => ({
    from: { element: { type: n } },
    allow: { to: { element: { type: [n, ...new Set(pk[n].allow.map((a) => a.split('/')[0]))] } } },
  }));

  const cfg = [
    {
      name: 'poly/layers',
      files: names.map(base),
      languageOptions: { parser: tseslint.parser },
      plugins: { boundaries, poly, 'import-x': importX, 'eslint-comments': comments },
      settings: {
        'boundaries/elements': elements,
        'import/resolver': { [RESOLVER]: { root, layers: opts.layersFile } },
        'import-x/resolver': { [RESOLVER]: { root, layers: opts.layersFile } },
      },
      linterOptions: { reportUnusedDisableDirectives: 'off' },
      rules: {
        'boundaries/dependencies': [2, { default: 'disallow', policies }],
        'poly/no-computed-import': 2,
        'poly/no-session-user-id-cast': 2,
        'eslint-comments/no-unlimited-disable': 2,
        'eslint-comments/no-use': [2, { allow: ['eslint-disable', 'eslint-disable-line', 'eslint-disable-next-line', 'eslint-enable'] }],
        'eslint-comments/no-restricted-disable': [2, ...DISABLE_PROOFED],
      },
    },
  ];

  for (const n of names) {
    const e = pk[n];
    const isDb = n === 'db';
    const isSecrets = n === 'secrets';
    const inPackages = e.dir.startsWith('packages/');
    const allowedSubs = e.allow.filter((a) => a.includes('/')).map((a) => `@poly/${a}`);

    const paths = [];
    const patterns = [];
    const banned = [];
    if (!isDb) {
      for (const d of PG_DRIVERS) paths.push({ name: d, message: 'Only packages/db opens a Postgres connection (ARCH §2.1).' });
      patterns.push({ group: DRIZZLE_PG, message: 'Only packages/db imports a Postgres driver (ARCH §2.1).' });
      paths.push({ name: 'kysely', importNames: ['PostgresDialect'], message: 'PostgresDialect is for packages/db only (ARCH §2.1).' });
      banned.push(...PG_DRIVERS, ...DRIZZLE_PG);
    }
    if (!isSecrets) {
      for (const c of ['crypto', 'node:crypto']) {
        paths.push({ name: c, importNames: CRYPTO_NAMES, message: `Sealing primitives are for packages/secrets only (SECURITY A-39).` });
      }
      patterns.push({ group: HPKE, message: 'The HPKE library is for packages/secrets only (SECURITY A-39).' });
      banned.push(...HPKE);
    }
    if (inPackages) {
      for (const s of SVELTEKIT.filter((x) => !x.endsWith('*'))) paths.push({ name: s, message: 'Nothing under packages/ imports SvelteKit (ARCH §2.1).' });
      patterns.push({ group: SVELTEKIT.filter((x) => x.endsWith('*')), message: 'Nothing under packages/ imports SvelteKit (ARCH §2.1).' });
    }
    // Every subpath is restricted by construction: only an explicit allow entry (db/auth) grants it.
    patterns.push({
      group: ['@poly/*/*', ...allowedSubs.map((s) => `!${s}`)],
      message: 'Deep or restricted @poly subpath: not on this package\'s allow-list in layers.json.',
    });

    // import() and require() bypass no-restricted-imports, so the subpath and SvelteKit bans repeat there.
    banned.push('@poly/*/*', ...allowedSubs.map((x) => `!${x}`));
    if (inPackages) banned.push(...SVELTEKIT);
    const rules = {
      'no-restricted-imports': [2, { paths, patterns }],
      // 'all' is keyed on the names db and auth: a rename would weaken it to 'sql' rather than fail closed.
      'poly/no-session-set': [2, { mode: n === 'db' || n === 'auth' ? 'all' : 'sql' }],
    };
    const namedOnly = [...(isDb ? [] : ['kysely']), ...(isSecrets ? [] : ['crypto', 'node:crypto'])];
    if (namedOnly.length) rules['poly/named-imports-only'] = [2, { specifiers: namedOnly }];
    if (banned.length) rules['poly/no-banned-specifier'] = [2, { specifiers: banned, message: 'not allowed in this package (dynamic import or require).' }];
    if (!isSecrets) rules['poly/no-webcrypto-members'] = 2;
    rules['import-x/no-extraneous-dependencies'] = [2, { packageDir: [path.join(root, e.dir), root], devDependencies: true }];
    cfg.push({ name: `poly/restrictions/${n}`, files: [base(n)], plugins: { poly }, rules });
  }

  // POLY-128 R7 (SECURITY C-41, A-39): {@html} is refused in every .svelte file. noInlineConfig makes every inline
  // directive inert in these files, so no eslint-disable comment can lift it. The one sanitizing component, when it
  // lands, is exempted by a block that names its single path; there is none now.
  cfg.push({
    name: 'poly/svelte',
    files: ['**/*.svelte'],
    languageOptions: { parser: svelteParser, parserOptions: { parser: tseslint.parser } },
    plugins: { svelte },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
    rules: { 'svelte/no-at-html-tags': 2 },
  });

  // Exceptions, each one named in layers.json or fixed by the rule itself.
  cfg.push({ name: 'poly/cast-exempt', files: [`${layers.packages.db.dir}/src/session.ts`, ...TESTS], plugins: { poly }, rules: { 'poly/no-session-user-id-cast': 0 } });
  if (layers.sessionSetExempt) {
    cfg.push({ name: 'poly/session-set-exempt', files: [layers.sessionSetExempt], plugins: { poly }, rules: { 'poly/no-session-set': 0 } });
  }
  return cfg;
}
