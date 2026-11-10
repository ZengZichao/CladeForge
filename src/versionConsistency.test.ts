// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Version-consistency assertion (C#21): the version lives in four places
// (package.json, Cargo.toml, tauri.conf.json, CITATION.cff) and used to have
// no CI guard — a release bump could silently skip one of them. The CITATION
// entry also carried a "v" prefix the other three do not.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function versionOf(file: string, pattern: RegExp): string {
  const m = pattern.exec(readFileSync(`${root}/${file}`, 'utf-8'));
  if (!m) throw new Error(`No version match in ${file}`);
  return m[1];
}

describe('release metadata', () => {
  it('declares the same version in package.json, Cargo.toml, tauri.conf.json and CITATION.cff', () => {
    const pkg = versionOf('package.json', /"version":\s*"([^"]+)"/);
    const cargo = versionOf('src-tauri/Cargo.toml', /^version\s*=\s*"([^"]+)"/m);
    const conf = versionOf('src-tauri/tauri.conf.json', /"version":\s*"([^"]+)"/);
    const citation = versionOf('CITATION.cff', /^version:\s*"([^"]+)"/m);
    expect(cargo).toBe(pkg);
    expect(conf).toBe(pkg);
    // CFF wants a BARE version: no "v" prefix, matching the other three files.
    expect(citation).toBe(pkg);
  });
});

describe('AI provenance markers', () => {
  it('marks every existing, applicable file in the current provenance row', () => {
    const provenance = readFileSync(`${root}/docs/AI_PROVENANCE.md`, 'utf-8');
    const row = provenance.split('\n').find((line) => line.includes('review round A/B/C fix session, 2026-11-10'));
    expect(row).toBeDefined();
    const files = [...row!.matchAll(/`?([\w./-]+\.(?:tsx|ts|rs|md|json|cff))`?/g)].map((m) => m[1]);
    // Strict JSON and CFF have no marker syntax in the project convention.
    const exempt = new Set(['src-tauri/tauri.conf.json', 'CITATION.cff']);
    const missing = [...new Set(files)]
      .filter((f) => !exempt.has(f) && existsSync(`${root}/${f}`))
      .filter((f) => !readFileSync(`${root}/${f}`, 'utf-8').includes('AI-PROVENANCE'));
    expect(missing).toEqual([]);
  });
});
