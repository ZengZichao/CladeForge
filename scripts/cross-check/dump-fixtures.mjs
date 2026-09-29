#!/usr/bin/env node
// Plain-node entry for the fixture dumper of the ape / phangorn cross-check.
//
//   node scripts/cross-check/dump-fixtures.mjs [output-dir]
//
// No new dependencies: the repository already ships `vite-node` (a vitest
// dependency), and this script just runs `dump-fixtures.ts` through it so the
// fixtures are produced by the *same* TypeScript modules the application uses
// (sampleTree / parsimony / asr / scriptExport), not by a re-implementation.
//
// The artefacts it writes are consumed by ape_agreement.R; see README.md.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const candidates = [
  join(repoRoot, 'node_modules', 'vite-node', 'vite-node.mjs'),
  join(repoRoot, 'node_modules', '.bin', 'vite-node'),
];
const runner = candidates.find((p) => existsSync(p));

if (!runner) {
  console.error(
    [
      'ERROR: vite-node is not installed, so the TypeScript fixtures cannot be dumped.',
      'It is a dependency of vitest, which this repository already uses — run',
      '',
      `  cd "${repoRoot}" && npm install`,
      '',
      'and then re-run this script. Nothing was written.',
    ].join('\n'),
  );
  process.exit(2);
}

const target = join(here, 'dump-fixtures.ts');
if (!existsSync(target)) {
  console.error(`ERROR: ${target} is missing.`);
  process.exit(2);
}

// vite-node ships a plain ESM CLI (`vite-node.mjs` → `dist/cli.mjs`): run it with
// this same node binary. A `.bin` shim, if that is what was found, is executable.
const useSelf = runner.endsWith('.mjs');
const cmd = useSelf ? process.execPath : runner;
const args = [...(useSelf ? [runner] : []), target, ...process.argv.slice(2)];
const res = spawnSync(cmd, args, { cwd: repoRoot, stdio: 'inherit' });
if (res.error) {
  console.error(`ERROR: could not start ${cmd}: ${res.error.message}`);
  process.exit(2);
}
process.exit(res.status === null ? 1 : res.status);
