import { describe, it, expect } from 'vitest';
import { assertNativePath } from './native';

/**
 * The client assertion and `validate_path` in src-tauri/src/lib.rs are the same
 * rules expressed twice, in two languages, so their agreement has to be enforced:
 * a rule can otherwise be documented on one side (e.g. rejecting `.`) and applied
 * on the other, with the client silent about it.
 *
 * This table is mirrored by `path_rule_table_matches_the_client` in lib.rs, so a
 * rule change on one side shows up as a failure on the other. The Windows-shaped
 * cases are asserted there only when the test binary runs on Windows, because
 * `Path::is_absolute()` — unlike this cheap client pre-check — is platform-aware.
 *
 * Scope: what the CLIENT rejects. The Rust side additionally canonicalises,
 * resolves symlinks and enforces the root allow-list, none of which is reachable
 * from a unit test here — those are covered by the Rust tests.
 */
const CASES: Array<{ path: string; accept: boolean; note: string }> = [
  { path: '', accept: false, note: 'empty' },
  { path: '   ', accept: false, note: 'whitespace only' },
  { path: 'tree.nwk', accept: false, note: 'relative' },
  { path: './tree.nwk', accept: false, note: 'relative with leading dot' },
  { path: '../tree.nwk', accept: false, note: 'relative traversal' },
  { path: '/home/u/tree.nwk', accept: true, note: 'absolute POSIX' },
  { path: '/home/u/../etc/passwd', accept: false, note: 'absolute with traversal' },
  { path: '/etc/../etc/passwd', accept: false, note: 'system path with traversal' },
  // Both sides accept this: `.` carries no traversal risk, and Rust's
  // Path::components() normalises it away so it cannot even be observed there.
  { path: '/home/u/./tree.nwk', accept: true, note: 'dot component is normalised, not rejected' },
  { path: 'C:\\Users\\u\\tree.nwk', accept: true, note: 'absolute Windows drive' },
  { path: 'C:\\Users\\u\\..\\windows\\x', accept: false, note: 'Windows traversal' },
  { path: '\\\\server\\share\\tree.nwk', accept: true, note: 'Windows UNC' },
  { path: '\\\\server\\share\\..\\x', accept: false, note: 'UNC traversal' },
];

describe('assertNativePath matches the Rust command rules', () => {
  for (const c of CASES) {
    it(`${c.accept ? 'accepts' : 'rejects'} ${JSON.stringify(c.path)} — ${c.note}`, () => {
      if (c.accept) {
        expect(() => assertNativePath(c.path)).not.toThrow();
        expect(assertNativePath(c.path)).toBe(c.path);
      } else {
        expect(() => assertNativePath(c.path)).toThrow();
      }
    });
  }

  it('the table is not vacuous', () => {
    expect(CASES.filter((c) => c.accept).length).toBeGreaterThan(0);
    expect(CASES.filter((c) => !c.accept).length).toBeGreaterThan(0);
  });
});
