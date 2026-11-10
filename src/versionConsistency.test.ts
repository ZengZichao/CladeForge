// Version-consistency assertion (C#21): the version lives in four places
// (package.json, Cargo.toml, tauri.conf.json, CITATION.cff) and used to have
// no CI guard — a release bump could silently skip one of them. The CITATION
// entry also carried a "v" prefix the other three do not.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
