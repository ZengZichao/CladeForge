// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The mapping bridge renderer: paints the collected mapping lines between the
// two panes. Pure painting — the line set comes from `reconMapping.ts` (pure),
// and the geometry comes from the caller's measured pane rects, so this layer
// never reads the DOM itself.
//
// Layering: the bridge area between the panes is empty background, so the lines
// can paint here without ever covering pane content; the in-pane guide stubs
// are drawn inside each pane's SVG UNDER the nodes (see ReconPane). Selected
// lines get end-point rings painted by the panes themselves (screen-space), and
// a mid-line label so the correspondence is readable.

import { memo, useMemo } from 'react';
import { bridgeLine, type ReconMappingLine } from './reconMapping';
import { S } from '../ui/strings';

export function tokenLabel(token: ReconMappingLine['token']): string {
  switch (token) {
    case 'sigma':
      return S.recon.legendSigma;
    case 'dup':
      return S.recon.legendDup;
    case 'transfer':
      return S.recon.legendTransfer;
    default:
      return S.recon.legendUnresolved;
  }
}

export function tokenGlyph(event: ReconMappingLine['event']): string {
  switch (event) {
    case 'speciation':
      return 'σ';
    case 'duplication':
      return 'δ';
    case 'transfer':
      return 'τ';
    default:
      return '?';
  }
}

interface ReconMappingLayerProps {
  lines: ReconMappingLine[];
  width: number;
  height: number;
  /** Mid-line labels only for emphasised lines (never a wall of text). */
  showSelectedLabels: boolean;
}

/** Does this path paint exactly the same thing? The projection pass builds
 *  fresh objects every frame, so identity cannot be used. */
function samePath(a: ReconMappingLine, b: ReconMappingLine): boolean {
  return (
    a.from.x === b.from.x &&
    a.from.y === b.from.y &&
    a.to.x === b.to.x &&
    a.to.y === b.to.y &&
    a.token === b.token &&
    a.state === b.state
  );
}

const BridgePath = memo(
  function BridgePath({ l }: { l: ReconMappingLine }) {
    return (
      <path
        d={bridgeLine(l.from, l.to)}
        fill="none"
        stroke={`var(--recon-map-${l.token})`}
        strokeWidth={l.state === 'selected' ? 2.4 : l.state === 'hovered' ? 2 : 1.3}
        strokeOpacity={
          l.state === 'muted' ? 0.18 : l.state === 'normal' ? 0.75 : 0.95
        }
        strokeDasharray={l.token === 'unresolved' ? '5 4' : undefined}
        strokeLinecap="round"
        className={`recon-map-line recon-map-${l.state}`}
      />
    );
  },
  (a, b) => samePath(a.l, b.l),
);

const BridgeLabel = memo(
  function BridgeLabel({ line }: { line: ReconMappingLine }) {
    const mx = (line.from.x + line.to.x) / 2;
    const my = (line.from.y + line.to.y) / 2;
    return (
      <text x={mx} y={my - 6} textAnchor="middle" className="recon-map-label">
        {`${tokenGlyph(line.event)} →`}
      </text>
    );
  },
  (a, b) => samePath(a.line, b.line) && a.line.event === b.line.event,
);

export const ReconMappingLayer = memo(function ReconMappingLayer({
  lines,
  width,
  height,
  showSelectedLabels,
}: ReconMappingLayerProps) {
  // Bridge lines whose endpoints are both far outside the host are invisible:
  // skip their DOM cost during vertical pans of large trees (one viewport of
  // buffer, mirroring the pane culling).
  const visibleLines = useMemo(() => {
    if (height <= 0) return lines;
    return lines.filter((l) => {
      const maxY = Math.max(l.from.y, l.to.y);
      const minY = Math.min(l.from.y, l.to.y);
      return maxY >= -height && minY <= height * 2;
    });
  }, [lines, height]);

  const labelLines = useMemo(
    () => (showSelectedLabels ? visibleLines.filter((l) => l.state === 'selected') : []),
    [visibleLines, showSelectedLabels],
  );
  if (width <= 0 || height <= 0) return null;
  return (
    <div className="recon-bridge-layer" aria-hidden="true">
      <svg width={width} height={height}>
        {visibleLines.map((l) => (
          <BridgePath key={l.id} l={l} />
        ))}
        {labelLines.map((l) => (
          <BridgeLabel key={`t${l.id}`} line={l} />
        ))}
      </svg>
    </div>
  );
});
