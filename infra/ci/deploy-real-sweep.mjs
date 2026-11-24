#!/usr/bin/env node
// T-real's kept-log sweep (ruling B9, S38 c and d). Reads the step's own output, the harness's log and staging's deploy.log; only when all three are clean
// writes the one file the job uploads (the three, in that order, unchanged). It removes nothing: a hit is exit 1, the NAMES only on stderr (never a value or a line),
// and no output file (an old one is removed first). No list, a short or unparsable list, a missing github_read_token, or an input that exists and cannot be read: exit 1.
//   node infra/ci/deploy-real-sweep.mjs --secrets <json> --step-log <file> --harness-log <file> --deploy-log <file> --out <file>
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const WINDOW = 16;
const MIN_ENTRIES = 6;

function fail(lines) {
  for (const l of lines) process.stderr.write(`deploy-real-sweep: ${l}\n`);
  process.exit(1);
}

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i]] = process.argv[i + 1];
for (const k of ['--secrets', '--step-log', '--harness-log', '--deploy-log', '--out']) {
  if (!args[k]) fail([`missing ${k}`]);
}
rmSync(args['--out'], { force: true }); // an old output never survives a refusal

let secrets;
try {
  secrets = JSON.parse(readFileSync(args['--secrets'], 'utf8'));
} catch {
  fail(['the secret list is missing or unparsable']);
}
if (secrets === null || typeof secrets !== 'object' || Array.isArray(secrets)) fail(['the secret list is not an object']);
const entries = Object.entries(secrets);
if (entries.some(([, v]) => typeof v !== 'string' || v.length === 0)) fail(['the secret list holds a value that is not a non-empty string']);
if (!Object.prototype.hasOwnProperty.call(secrets, 'github_read_token')) fail(['the secret list lacks github_read_token']);
if (entries.length < MIN_ENTRIES) fail([`the secret list has ${entries.length} entries, fewer than ${MIN_ENTRIES}`]);

// each input: [label, path, may be absent]
const inputs = [
  ['step log', args['--step-log'], false],
  ['harness log', args['--harness-log'], false],
  ['deploy.log', args['--deploy-log'], true],
];
const texts = [];
for (const [label, path, optional] of inputs) {
  if (optional && !existsSync(path)) { texts.push([label, '']); continue; }
  try {
    texts.push([label, readFileSync(path, 'utf8')]);
  } catch {
    fail([`${label} cannot be read`]);
  }
}

/** The forms a secret can take in a log: as it is, percent-encoded, base64 (and url-safe), hex. */
function forms(v) {
  const b = Buffer.from(v);
  const out = new Set([v, encodeURIComponent(v), b.toString('base64'), b.toString('base64url'), b.toString('hex')]);
  return [...out].filter((f) => f.length > 0);
}
function hasPiece(text, form, lower) {
  const hay = lower ? text.toLowerCase() : text;
  const f = lower ? form.toLowerCase() : form;
  if (f.length < WINDOW) return f.length >= 8 && hay.includes(f);
  for (let i = 0; i + WINDOW <= f.length; i++) if (hay.includes(f.slice(i, i + WINDOW))) return true;
  return false;
}

const SHAPES = [
  ['a private key', /PRIVATE KEY-----/],
  ['a fine-grained token shape', /github_pat_[A-Za-z0-9_]{20,}/],
  ['a classic or installation token shape', /gh[a-z]_[A-Za-z0-9]{20,}/],
  ['a saved render', /"services"\s*:/],
  ['an environment dump', /^(PATH|HOME|GITHUB_[A-Z_]+|RUNNER_[A-Z_]+|ACTIONS_[A-Z_]+)=/m],
  ['env-file lines', /^(TLS_MODE|PUBLIC_ORIGIN|POLY_INSTANCE|MAIL_FROM)=/m],
];

const hits = [];
for (const [label, text] of texts) {
  for (const [name, value] of entries) {
    if (forms(value).some((f, i, all) => hasPiece(text, f, f === all[all.length - 1] /* the hex form is compared lower-case */))) hits.push(`${label}: secret ${name}`);
  }
  for (const [shape, re] of SHAPES) if (re.test(text)) hits.push(`${label}: ${shape}`);
}
if (hits.length) fail(hits);

writeFileSync(args['--out'], texts.map(([, t]) => t).join(''));
