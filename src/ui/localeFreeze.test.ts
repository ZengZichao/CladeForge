import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guard: no translated string may be captured in a module-level constant.
 *
 * The app's locale design relies on live bindings: `S` is a `let` reassigned by
 * `setLanguage()`, so a component that reads `S.node.name` *while rendering*
 * sees the current language. Storing the result in a module-level `const`
 * severs that — the value freezes in whichever language was active the first
 * time the module was imported, and switching language leaves the frozen text
 * on screen. That is how a narrative report exported in English can still carry
 * `(confidence: 高)`.
 *
 * Two shapes freeze: a direct `tr(...)` / `S.x` read, and a map whose *keys* are
 * translated strings — after a language switch every lookup returns `undefined`,
 * which silently disables section search. This test walks the whole source tree,
 * so a new site fails CI rather than waiting for a human to notice
 * mixed-language output.
 */

const SRC = join(__dirname, '..');

/** Files that define the catalogues themselves, so they must be module-level. */
const SKIP = new Set([relative(SRC, join(__dirname, 'strings.ts')).replace(/\\/g, '/')]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('no module-level capture of translated strings', () => {
  const files = sourceFiles(SRC).filter(
    (f) => !SKIP.has(relative(SRC, f).replace(/\\/g, '/')),
  );

  it('scans a non-trivial part of the source tree', () => {
    // Guard the guard: a broken walker would find nothing and pass.
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(files.map((f) => [relative(SRC, f).replace(/\\/g, '/'), f] as const))(
    '%s freezes no translated text at module scope',
    (_rel, abs) => {
      const lines = readFileSync(abs, 'utf8').split('\n');
      const offenders: string[] = [];
      const DECL = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/;

      for (let i = 0; i < lines.length; i += 1) {
        const decl = DECL.exec(lines[i]);
        // Only module scope: any indented line is inside a function or block,
        // where evaluating once per call is exactly what we want.
        if (!decl || /^\s/.test(lines[i])) continue;
        const body = statementBody(lines, i);
        const eq = topEquals(body);
        if (eq < 0) continue;
        const rhs = body.slice(eq + 1).trimStart();
        // Everything after the first `=>` belongs to a function body, which runs
        // per call and therefore sees the live language — that is the required
        // shape, not the defect (components are `export const Foo = memo((p) =>
        // … S.x …)`, and `const confLabel = (c) => S.confidence[c]` is exactly
        // how a translated lookup should be written).
        // Known blind spot, deliberately accepted: a literal that mixes a
        // closure with a frozen sibling (`{ a: () => {}, b: S.x }`) reads as a
        // function. Frozen-then-arrow order is the shape that severs the binding.
        const evaluated = rhs.split('=>')[0];
        const frozen = /\btr\(/.test(evaluated) || /\bS\.[a-zA-Z]/.test(evaluated);
        if (frozen) offenders.push(`${decl[1]} (line ${i + 1})`);
        i += body.split('\n').length - 1;
      }
      expect(offenders, `${_rel}: module-level translated constants`).toEqual([]);
    },
  );
});

/** The declaration's full text, from its first line to the line whose depth returns to 0. */
function statementBody(lines: string[], start: number): string {
  let depth = 0;
  let seen = false;
  const out: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    out.push(line);
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') {
        depth += 1;
        seen = true;
      } else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    }
    if (seen && depth <= 0) break;
    if (!seen && /;\s*$/.test(line)) break;
    if (!seen && i > start) break;
  }
  return out.join('\n');
}

/** Index of the `=` that assigns the declaration, ignoring those in a type annotation. */
function topEquals(body: string): number {
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    else if (ch === '=' && depth === 0 && body[i + 1] !== '=' && body[i - 1] !== '=') {
      // `const X: Record<string, number> = {}` — the `<`/`>` annotation carries no
      // braces, so a depth-0 `=` is still the assignment. `==`/`===`/`=>` are not.
      if (body[i + 1] === '>') continue;
      return i;
    }
  }
  return -1;
}
