// Usage: node packages/db/scripts/check-migrations.ts [folder]   (exit 1 on any problem)
import { checkFolder } from '../src/check-files.ts';
import { DEFAULT_FOLDER } from '../src/journal.ts';

const problems = checkFolder(process.argv[2] ?? DEFAULT_FOLDER);
for (const p of problems) console.error(`${p.check}: ${p.file}: ${p.detail}`);
process.exit(problems.length ? 1 : 0);
