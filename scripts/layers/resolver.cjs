// import-x / boundaries resolver (interface v2) for @poly/* specifiers.
// Resolves by name against the layer map, not through node_modules, so the layer rules
// see every workspace edge even when the importer has not declared the dependency
// (strict pnpm linking would leave it unresolved and the rule blind).
const path = require('node:path');
const fs = require('node:fs');

exports.interfaceVersion = 2;
exports.resolve = (source, _file, config) => {
  const m = /^@poly\/([^/]+)(?:\/(.+))?$/.exec(source);
  if (!m) return { found: false };
  const root = config?.root ?? process.cwd();
  const layers = JSON.parse(fs.readFileSync(path.join(root, config?.layers ?? 'layers.json'), 'utf8'));
  const entry = layers.packages[m[1]];
  if (!entry) return { found: false };
  const file = m[2] ? `${m[2]}.ts` : 'index.ts';
  return { found: true, path: path.join(root, entry.dir, 'src', file) };
};
