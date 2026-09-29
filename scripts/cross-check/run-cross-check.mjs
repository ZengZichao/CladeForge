#!/usr/bin/env node
// One-command driver for the third-party (R) leg of the correctness cross-check.
//
//   node scripts/cross-check/run-cross-check.mjs            # dump fixtures, then run R
//   node scripts/cross-check/run-cross-check.mjs --fixtures-only
//   RSCRIPT_BIN=/path/to/Rscript node scripts/cross-check/run-cross-check.mjs
//
// Plain Node, no new dependencies. It NEVER pretends the R leg ran: if no
// Rscript can be found it prints exactly what is missing and exits 3.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const fixturesDir = join(here, 'fixtures');
const args = process.argv.slice(2);
const fixturesOnly = args.includes('--fixtures-only');

const say = (...lines) => process.stdout.write(`${lines.join('\n')}\n`);

// 1. fixtures -----------------------------------------------------------------
say('[1/3] dumping fixtures with the app\'s own TypeScript modules');
const dump = spawnSync(process.execPath, [join(here, 'dump-fixtures.mjs')], { stdio: 'inherit' });
if (dump.status !== 0) {
  process.stderr.write('ERROR: the fixture dump failed; nothing to compare.\n');
  process.exit(dump.status ?? 1);
}

// 2. integrity of the dumped set (this part runs without R) --------------------
say('');
say('[2/3] checking the fixture set');
const expected = ['tree.nwk', 'tree_rescaled.nwk', 'characters.tsv', 'matrix.tsv', 'costs.tsv', 'nodes.tsv', 'asr_posteriors.tsv', 'parsimony.tsv', 'summary.tsv', 'cladeforge_analysis.R'];
const projects = readdirSync(fixturesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const problems = [];
if (projects.length === 0) problems.push('no per-project fixture directories');
for (const p of projects) {
  for (const f of expected) if (!existsSync(join(fixturesDir, p, f))) problems.push(`${p}/${f} missing`);
  const nwkPath = join(fixturesDir, p, 'tree.nwk');
  if (existsSync(nwkPath)) {
    const nwk = readFileSync(nwkPath, 'utf8').trim();
    const tips = (nwk.match(/[^(),;:0-9.'\s]+/g) ?? []).length;
    if (!nwk.endsWith(';')) problems.push(`${p}/tree.nwk is not terminated`);
    if (tips < 2) problems.push(`${p}/tree.nwk has fewer than two tips`);
  }
}
say(`      ${projects.length} projects: ${projects.join(', ')}`);
if (problems.length) {
  process.stderr.write(`ERROR: fixture set is incomplete:\n  ${problems.join('\n  ')}\n`);
  process.exit(2);
}
say('      fixture set is complete');

if (fixturesOnly) {
  say('');
  say('[3/3] --fixtures-only given: the R leg was NOT attempted.');
  say(`      Fixtures are in ${fixturesDir}; run ape_agreement.R there to get the third-party table.`);
  process.exit(0);
}

// 3. the R leg ----------------------------------------------------------------
const candidates = [];
if (process.env.RSCRIPT_BIN) candidates.push(process.env.RSCRIPT_BIN);
candidates.push('Rscript');
candidates.push('/Library/Frameworks/R.framework/Resources/bin/Rscript');
candidates.push('/usr/local/bin/Rscript');
candidates.push('/opt/homebrew/bin/Rscript');
candidates.push('/usr/bin/Rscript');
candidates.push('/usr/local/lib/R/bin/Rscript');
candidates.push('/opt/homebrew/opt/r/bin/Rscript');
candidates.push('/usr/local/opt/r/bin/Rscript');

/**
 * Env managers install R outside PATH and outside every framework location, so
 * search the usual user-level prefixes before concluding that no R is available.
 * `RSCRIPT_BIN` still wins.
 */
const envRoots = (() => {
  const home = homedir();
  return [
    join(home, '.local/share/mamba/envs'),
    join(home, '.local/share/miniconda3/envs'),
    join(home, 'miniconda3/envs'),
    join(home, 'anaconda3/envs'),
    join(home, 'opt/anaconda3/envs'),
    join(home, 'opt/miniconda3/envs'),
    join(home, 'miniforge3/envs'),
    join(home, 'mambaforge/envs'),
    join(home, '.pixi/envs'),
  ];
})();
const discovered = [];
for (const root of envRoots) {
  let names = [];
  try {
    names = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    continue; // that root is not in use on this machine
  }
  for (const name of names) {
    const p = join(root, name, 'bin', 'Rscript');
    if (existsSync(p)) discovered.push(p);
  }
}
// Newest first: several envs commonly hold an R, and the one the user touched
// last is the better guess. Every match is printed below so the choice is visible.
discovered.sort((a, b) => {
  const mtime = (f) => {
    try {
      return statSync(f).mtimeMs;
    } catch {
      return 0;
    }
  };
  return mtime(b) - mtime(a) || a.localeCompare(b);
});
candidates.push(...discovered);

let found = null;
// "An R exists" is not the precondition — the leg needs ape AND phangorn in it, and
// a machine with several env-manager R installs can easily satisfy the first and not
// the second. Probe both, and keep the refusals on the record so the message says
// what was actually missing.
const refused = [];
const usable = (c) => {
  if (spawnSync(c, ['--version'], { encoding: 'utf8' }).status !== 0) return 'absent';
  const pkgs = spawnSync(c, ['-e', 'suppressMessages({library(ape); library(phangorn)})'],
                         { encoding: 'utf8' });
  return pkgs.status === 0 ? null
    : `without ape/phangorn (${(pkgs.stderr || pkgs.stdout || '').split('\n').find((l) => /there is no package|unable to load|error/i.test(l))?.trim().slice(0, 70) ?? 'packages failed to load'})`;
};
const explicit = process.env.RSCRIPT_BIN;
for (const c of candidates) {
  const why = usable(c);
  if (why === null) {
    found = c;
    break;
  }
  // A path that simply is not there is not worth reporting; one that holds an R
  // without the two packages is exactly what the caller needs to hear.
  if (why !== 'absent' || existsSync(c)) refused.push(`${c}: ${why}`);
  // An explicitly named binary is a request, not a hint: if it cannot run the leg,
  // say so rather than quietly substituting a different R installation.
  if (explicit && c === explicit) break;
}
say('');
if (found && discovered.length && found !== process.env.RSCRIPT_BIN) {
  say(`      R found outside PATH: ${found}`);
  if (discovered.length > 1) {
    say(`      ${discovered.length} env-manager R installs matched (${discovered.join(', ')})`);
    say('      set RSCRIPT_BIN to choose one explicitly.');
  }
}
if (!found) {
  process.stderr.write(
    [
      '[3/3] R LEG NOT RUN — no `Rscript` with ape + phangorn was found on PATH, in',
      '      the usual install locations, or in the user-level env-manager prefixes.',
      '',
      '      Searched: ' + candidates.join(', '),
      ...(refused.length ? ['', '      Found but unusable:', '        ' + refused.join('\n        ')] : []),
      '',
      '      The third-party comparison is therefore NOT part of the evidence produced',
      '      here. To obtain it, install R (https://cran.r-project.org) plus the ape',
      '      package (optionally phangorn) and run:',
      '',
      '        Rscript scripts/cross-check/ape_agreement.R',
      '      or point at a binary that is not on PATH:',
      '',
      '        RSCRIPT_BIN=/path/to/Rscript node scripts/cross-check/run-cross-check.mjs',
      '',
      '      The fixtures it consumes are already written under scripts/cross-check/fixtures/.',
      '      Do not quote any third-party agreement number until that run succeeds.',
    ].join('\n') + '\n',
  );
  process.exit(3);
}

say(`[3/3] running ape_agreement.R with ${found}`);
// The fixtures carry the sample projects' own state labels, which are Chinese in
// three of the six projects. Under an LC_CTYPE of "C", read.table aborts with
// "invalid input found on input connection" before it ever reaches the comparison,
// so the child is given a UTF-8 locale explicitly.
const env = { ...process.env };
if (!/UTF-?8/i.test(env.LC_CTYPE || env.LC_ALL || env.LANG || '')) {
  env.LC_ALL = 'en_US.UTF-8';
}
const run = spawnSync(found, [join(here, 'ape_agreement.R')],
                      { stdio: 'inherit', env });
process.exit(run.status === null ? 1 : run.status);
