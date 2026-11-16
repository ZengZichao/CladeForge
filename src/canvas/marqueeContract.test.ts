// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// B1 (UI_UX_REVIEW 2026-11-15) regression guard: the rubber-band (marquee)
// selection rect is drawn in SCREEN space — it must sit AFTER the world
// transform group's closing tag in TreeCanvas.tsx, never inside it. The review
// found the rect merged into the world <g>, so at 126% zoom the visible
// rectangle drifted 63/257 px from the pointer box and scaled 1.26×.
//
// A full render test of TreeCanvas needs the whole store + layout pipeline;
// a source contract on the JSX structure is the cheapest reliable guard, and
// the UI_UX review's own suggestion was exactly this shape of assertion.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('./TreeCanvas.tsx', import.meta.url)),
  'utf8',
);

describe('B1: the marquee rect renders outside the world transform', () => {
  it('the {marquee && <rect…/>} block follows the world </g>', () => {
    const rect = source.indexOf('{marquee && (');
    expect(rect, 'TreeCanvas renders a marquee rect').toBeGreaterThan(-1);
    const svgClose = source.indexOf('</svg>', rect);
    expect(svgClose, 'the marquee lives inside the canvas svg').toBeGreaterThan(-1);
    // Between the rect and </svg> no group closes again — i.e. the rect is a
    // direct child of <svg>, not of the transformed world group.
    const between = source.slice(rect, svgClose);
    expect(between, 'no group closer between marquee and </svg>').not.toContain('</g>');
    // And the rect uses the primary ink, not the surface token.
    const rectBlock = source.slice(rect, rect + 500);
    expect(rectBlock).toContain('var(--primary)');
    expect(rectBlock).not.toContain('var(--accent)');
  });
});
