// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Two-state icon with a cross-fade instead of a hard swap.
//
// A conditional glyph (`open ? <Down/> : <Right/>`) replaces one SVG with
// another between frames. Here both glyphs stay mounted, stacked, and the
// change is a 140 ms opacity cross-fade with a small scale and blur — the same
// "soft swap" used for replacing content, and it can be reversed mid-flight
// because it is a transition, not an animation.

import type { ReactNode } from 'react';

export function IconSwap({
  active,
  on,
  off,
}: {
  /** true → the `on` glyph is visible; false → the `off` glyph. */
  active: boolean;
  on: ReactNode;
  off: ReactNode;
}) {
  return (
    <span className="icon-xfade" data-state={active ? 'on' : 'off'} aria-hidden="true">
      <span className="icon-xfade-layer" data-layer="on">
        {on}
      </span>
      <span className="icon-xfade-layer" data-layer="off">
        {off}
      </span>
    </span>
  );
}