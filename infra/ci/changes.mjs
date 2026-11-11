// POLY-96 change filter (ruling §2). Changed paths on stdin, one per line -> `key=true|false` for all five keys.
// Empty input fails closed: an empty diff is a filter failure, never "nothing changed".
import { readFileSync } from 'node:fs';

export const TABLE = {
  node: [
    /^packages\//, /^apps\//, /^package\.json$/, /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/, /^turbo\.json$/,
    /^tsconfig[^/]*\.json$/, /^eslint\.config\.js$/, /^\.npmrc$/, /^tests\/config\//, /^tests\/image\//, /^tests\/log\//,
    /^docs\/DESIGN\/tokens\.css$/,
  ],
  layers: [
    /^layers\.json$/, /^docs\/ARCH\/index\.html$/, /^scripts\/layers\//, /^tests\/layers\//, /^eslint\.config\.js$/,
    /^packages\/[^/]+\/package\.json$/, /^apps\/[^/]+\/package\.json$/,
  ],
  // POLY-102 R5: every path a job executes or imports, transitively, triggers that job.
  db: [
    /^packages\/db\//, /^tests\/db\//, /^infra\/postgres\/Dockerfile$/, /^infra\/postgres-major$/, /^packages\/config\//, /^packages\/tenancy\//, /^packages\/auth\//, /^apps\/migrate\//,
    /^apps\/web\/src\/ops\//, /^apps\/web\/src\/main\.ts$/, /^apps\/web\/src\/startup\.ts$/, /^tests\/log\//, /^pnpm-lock\.yaml$/,
  ],
  image: [/^Dockerfile/, /^\.dockerignore$/, /^compose[^/]*\.yml$/, /^Caddyfile/, /^infra\/(?!ci\/)/, /^bin\//,
    /^infra\/ci\/(image|install-trivy)\.sh$/, /^tests\/infra\//, /^\.trivyignore$/, /^tests\/layers\/tsc\/package\.json$/,
  ],
  ci: [/^\.github\/workflows\//, /^infra\/ci\//, /^tests\/ci\//],
};

export function classify(paths) {
  const out = {};
  for (const [k, res] of Object.entries(TABLE)) out[k] = paths.some((p) => res.some((re) => re.test(p)));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const paths = readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  if (paths.length === 0) {
    console.error('changes.mjs: no changed paths on stdin; failing closed');
    process.exit(1);
  }
  const out = classify(paths);
  for (const k of Object.keys(TABLE)) console.log(`${k}=${out[k]}`);
}
