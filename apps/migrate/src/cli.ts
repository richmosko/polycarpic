// The migrate entrypoint (ARCH §8.1):  migrate | migrate --plan | migrate check-config. The body is in run.ts.
import { run } from './run.ts';

run(process.argv.slice(2), process.env).then((code) => process.exit(code));
