// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Safe, minimal Markdown → React renderer for the in-app manual (S18,
// UI_UX_REVIEW 2026-11-15 / Sonus S18): the manual used to render as raw text
// in a <pre> — HTML comments, # marks and table pipes visible to the reader.
//
// Security contract: NO dangerouslySetInnerHTML anywhere — every token becomes
// a React element with string children, so markup in the manual (or a poisoned
// build input) can never execute. Links accept http(s) and anchors only;
// relative paths become readable label + path text, and other schemes expose
// only the label. Pure string processing: no eval, Function or dynamic HTML.

import type { ReactNode } from 'react';

/** One block-level element of the parsed document. */
type Block =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'hr' };

/** ASCII slug from a heading text, built with plain string ops (no regex). */
function slugify(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase()) {
    const isAsciiWord = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    const isCjk = ch >= '\u4e00' && ch <= '\u9fff';
    if (isAsciiWord || isCjk) out += ch;
    else if (out !== '' && !out.endsWith('-')) out += '-';
  }
  while (out.endsWith('-')) out = out.slice(0, -1);
  return out;
}

/** Anchor id for a heading — stable, derived from the text + ordinal. */
function headingId(text: string, index: number): string {
  const slug = slugify(text);
  return slug ? `manual-${slug}-${index}` : `manual-section-${index}`;
}

/** Split a markdown table row into trimmed cells (no regex). */
function splitCells(row: string): string[] {
  let body = row.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map((c) => c.trim());
}

/** True when the line starts a fenced code block. */
function isFence(line: string): boolean {
  return line.trim().startsWith('```');
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length >= 2;
}

function isDelimiterRow(line: string): boolean {
  const t = line.trim();
  if (!isTableRow(t)) return false;
  const inner = t.slice(1, -1);
  for (const ch of inner) {
    if (ch !== ':' && ch !== '-' && ch !== '|' && ch !== ' ') return false;
  }
  return inner.includes('-');
}

function isListItem(line: string): boolean {
  const t = line.trim();
  if (t.startsWith('- ') || t.startsWith('* ')) return true;
  const dot = t.indexOf('. ');
  if (dot > 0 && /^\d+$/.test(t.slice(0, dot))) return true;
  return false;
}

function isHeading(line: string): boolean {
  const t = line.trimStart();
  let i = 0;
  while (i < t.length && t[i] === '#') i += 1;
  return i >= 1 && i <= 4 && t[i] === ' ';
}

function isHr(line: string): boolean {
  const t = line.trim();
  if (t.length < 3) return false;
  const ch = t[0];
  if (ch !== '-' && ch !== '*' && ch !== '_') return false;
  for (const c of t) {
    if (c !== ch) return false;
  }
  return true;
}

/** Parse the document into blocks. Block-level only; inline pass runs later. */
export function parseMarkdown(src: string): Block[] {
  // Comments are metadata, not manual content. Remove them before block parsing
  // so multiline comment bodies cannot become headings, lists or paragraphs.
  // An unterminated comment is hidden through EOF, matching HTML comment rules.
  const withoutComments = src.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const lines = withoutComments.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  let headingCounter = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isFence(line)) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !isFence(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence (or EOF)
      blocks.push({ kind: 'code', text: buf.join('\n') });
      continue;
    }
    if (isHeading(line)) {
      const marks = line.trimStart().indexOf('# ');
      let level = 0;
      const t = line.trimStart();
      while (level < t.length && t[level] === '#') level += 1;
      blocks.push({
        kind: 'heading',
        level,
        text: t.slice(marks + 2).trim(),
        id: headingId(t.slice(marks + 2).trim(), ++headingCounter),
      });
      i += 1;
      continue;
    }
    if (isHr(line)) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }
    // Table: a header row followed by a delimiter row.
    if (isTableRow(line) && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      const header = splitCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitCells(lines[i]));
        i += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    if (isListItem(line)) {
      const ordered = line.trim().indexOf('. ') === 1 || /^\d+\. /.test(line.trim());
      const items: string[] = [];
      while (i < lines.length && isListItem(lines[i])) {
        const t = lines[i].trim();
        const cut = t.startsWith('- ') || t.startsWith('* ') ? 2 : t.indexOf('. ') + 2;
        items.push(t.slice(cut));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    // Paragraph: consecutive plain lines joined with spaces.
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isFence(lines[i]) && !isHeading(lines[i]) && !isListItem(lines[i]) && !isTableRow(lines[i]) && !isHr(lines[i])) {
      buf.push(lines[i].trim());
      i += 1;
    }
    if (buf.length) blocks.push({ kind: 'para', text: buf.join(' ') });
  }
  return blocks;
}

/** Inline token: inline code, bold, italic, or a link. */
interface InlineToken {
  kind: 'code' | 'bold' | 'italic' | 'link' | 'text';
  text: string;
  href?: string;
}

const INLINE_TOKEN_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((?:[^()\s]|\([^()\s]*\))+\))/g;

/** Inline pass: tokenise once with matchAll (no exec loop, no HTML output). */
function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) tokens.push({ kind: 'text', text: text.slice(last, idx) });
    const tok = m[0];
    if (tok.startsWith('`')) tokens.push({ kind: 'code', text: tok.slice(1, -1) });
    else if (tok.startsWith('**')) tokens.push({ kind: 'bold', text: tok.slice(2, -2) });
    else if (tok.startsWith('*')) tokens.push({ kind: 'italic', text: tok.slice(1, -1) });
    else {
      const open = tok.indexOf('](');
      const label = tok.slice(1, open);
      const href = tok.slice(open + 2, -1);
      const safe = href.startsWith('https://') || href.startsWith('http://') || href.startsWith('#');
      // Manual-relative files are not served beside the app, so show readable
      // label + path text instead of creating a broken navigation link. Other
      // non-allow-listed schemes (including javascript:) expose only the label.
      const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(href);
      tokens.push(safe
        ? { kind: 'link', text: label, href }
        : { kind: 'text', text: hasScheme ? label : `${label} (${href})` });
    }
    last = idx + tok.length;
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) });
  return tokens;
}

function renderInline(text: string): ReactNode[] {
  return tokenizeInline(text).map((t, i) => {
    switch (t.kind) {
      case 'code':
        return <code key={i}>{t.text}</code>;
      case 'bold':
        return <strong key={i}>{renderInline(t.text)}</strong>;
      case 'italic':
        return <em key={i}>{renderInline(t.text)}</em>;
      case 'link':
        // t.href is allow-listed to http(s)/anchors in tokenizeInline.
        return t.href && t.href.startsWith('#') ? (
          <a key={i} href={t.href} onClick={(e) => e.preventDefault()}>
            {t.text}
          </a>
        ) : (
          <a key={i} href={t.href} target="_blank" rel="noreferrer noopener">
            {t.text}
          </a>
        );
      default:
        return t.text;
    }
  });
}

/** Render parsed blocks. */
export function renderBlocks(blocks: Block[]): ReactNode[] {
  return blocks.map((b, key) => {
    switch (b.kind) {
      case 'heading': {
        const level = Math.min(b.level + 3, 6);
        const Tag = level <= 3 ? 'h3' : level <= 4 ? 'h4' : 'h5';
        return <Tag key={key} id={b.id}>{renderInline(b.text)}</Tag>;
      }
      case 'para':
        return <p key={key}>{renderInline(b.text)}</p>;
      case 'list': {
        const items = b.items.map((t, i) => <li key={i}>{renderInline(t)}</li>);
        return b.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
      }
      case 'code':
        return (
          <pre key={key} className="manual-code">
            <code>{b.text}</code>
          </pre>
        );
      case 'table':
        return (
          <table key={key} className="manual-table">
            <thead>
              <tr>
                {b.header.map((c, i) => (
                  <th key={i}>{renderInline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{renderInline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'hr':
        return <hr key={key} />;
    }
  });
}

/** Extract headings (up to level 3) for the clickable table of contents. */
export function tocOf(blocks: Block[]): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const b of blocks) {
    if (b.kind === 'heading' && b.level <= 3) out.push({ id: b.id, text: b.text });
  }
  return out;
}
