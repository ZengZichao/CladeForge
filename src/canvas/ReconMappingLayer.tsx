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

import { useMemo } from 'react';
import { bridgeCurve, type ReconMappingLine } from './reconMapping';
import { S, tr } from '../ui/strings';

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

export function ReconMappingLayer({ lines, width, height, showSelectedLabels }: ReconMappingLayerProps) {
  const labelLines = useMemo(
    () => (showSelectedLabels ? lines.filter((l) => l.state === 'selected') : []),
    [lines, showSelectedLabels],
  );
  if (width <= 0 || height <= 0) return null;
  return (
    <div className="recon-bridge-layer" aria-hidden="true">
      <svg width={width} height={height}>
        {lines.map((l) => (
          <path
            key={l.id}
            d={bridgeCurve(l.from, l.to)}
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
        ))}
        {labelLines.map((l) => {
          const mx = (l.from.x + l.to.x) / 2;
          const my = (l.from.y + l.to.y) / 2;
          return (
            <text
              key={`t${l.id}`}
              x={mx}
              y={my - 6}
              textAnchor="middle"
              className="recon-map-label"
            >
              {`${tokenGlyph(l.event)} ${tr('→', '→')}`}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
