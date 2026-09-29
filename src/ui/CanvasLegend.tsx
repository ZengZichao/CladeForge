// Collapsible on-canvas colour legend: explains the functional colours
// used on the canvas (selection / MRCA / drop target / connect / transitions /
// ASR / events / eras) so a first-time user can read the layers
// without hovering every element. Docked to the top-left of the canvas,
// collapsed by default so it never blocks the view.
//
// Each swatch is drawn with the SAME primitives as the canvas element it
// describes (rings / filled dots / two-colour transition dot / event badge /
// era band) so the legend and the tree can be read one-to-one.

import { useMemo, useState } from 'react';
import { ListBulletIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import { findCharacter } from '../model/characters';
import { eventCode, eventColor, eventDisplayLabel } from '../model/events';
import { S } from './strings';

type SwatchKind =
  | 'select'
  | 'mrca'
  | 'drop'
  | 'connect'
  | 'state'
  | 'transition'
  | 'needsData'
  | 'unmeasured'
  | 'event'
  | 'era';

interface LegendItem {
  kind: SwatchKind;
  /** Primary colour (state fill / event ring). Falls back sensibly if absent. */
  color?: string;
  /** Secondary colour (transition inner dot). */
  color2?: string;
  /** Two-letter event code (for kind === 'event'). */
  code?: string;
  label: string;
  /** When set, this item only shows while the matching layer is active. */
  requires?: {
    asr?: boolean;
    transitions?: boolean;
    events?: boolean;
    eras?: boolean;
    character?: boolean;
    /** Only while the layout actually has an unmeasured branch. */
    unmeasured?: boolean;
  };
}

const C_UNKNOWN = '#9ca3af';
const C_TRANSITION_TO = 'var(--c-transition-to, #3f3f46)';

/** Renders a legend swatch using the exact same SVG primitives as the canvas. */
function LegendSwatch({ kind, color, color2, code }: { kind: SwatchKind; color?: string; color2?: string; code?: string }) {
  const svgProps = {
    className: 'legend-swatch',
    viewBox: '0 0 16 16',
    'aria-hidden': true,
    focusable: false,
  } as const;
  switch (kind) {
    case 'select':
      // Double ring (halo + focus ring) in the selection colour.
      return (
        <svg {...svgProps}>
          <circle cx="8" cy="8" r="7" fill="none" stroke="var(--c-select)" strokeWidth="3.5" opacity="0.18" />
          <circle cx="8" cy="8" r="5" fill="none" stroke="var(--c-select)" strokeWidth="1.5" opacity="0.85" />
        </svg>
      );
    case 'mrca':
      // Hollow amber ring (matches the MRCA highlight on the canvas).
      return (
        <svg {...svgProps}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--c-mrca)" strokeWidth="2.5" />
        </svg>
      );
    case 'drop':
      // Dashed double ring (matches the reparent drop-target highlight).
      return (
        <svg {...svgProps}>
          <circle cx="8" cy="8" r="7" fill="none" stroke="var(--c-drop)" strokeWidth="3.5" opacity="0.18" strokeDasharray="3 2" />
          <circle cx="8" cy="8" r="5" fill="none" stroke="var(--c-drop)" strokeWidth="1.5" opacity="0.85" strokeDasharray="3 2" />
        </svg>
      );
    case 'connect':
      // Solid clay ring (matches the connect-source highlight).
      return (
        <svg {...svgProps}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--c-connect)" strokeWidth="2" opacity="0.6" />
        </svg>
      );
    case 'state':
      // Filled coloured dot (matches a state-coloured node marker).
      return (
        <svg {...svgProps}>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            fill={color ?? 'var(--surface)'}
            stroke={color ? 'rgba(0,0,0,0.25)' : C_UNKNOWN}
            strokeWidth="1"
          />
        </svg>
      );
    case 'transition':
      // Two-colour dot: outer ring of the "from" state, inner "to" dot.
      return (
        <svg {...svgProps}>
          <circle cx="8" cy="8" r="6" fill="var(--surface)" stroke={color ?? C_UNKNOWN} strokeWidth="2" />
          <circle cx="8" cy="8" r="3.2" fill={color2 ?? C_TRANSITION_TO} />
        </svg>
      );
    case 'needsData':
      // Dashed grey ring + "?", the exact marker the canvas puts on a
      // branch whose endpoint is unassigned. Deliberately NOT the two-colour
      // dot, so a reader cannot count it as an evolutionary change.
      return (
        <svg {...svgProps}>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="var(--surface)"
            stroke={C_UNKNOWN}
            strokeWidth="1.6"
            strokeDasharray="2.6 2"
          />
          <text
            x="8"
            y="8"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="8"
            fontWeight="700"
            fill={C_UNKNOWN}
          >
            ?
          </text>
        </svg>
      );
    case 'unmeasured':
      // A grey dashed BRANCH (not a node marker), matching the overlay
      // EdgeView draws over a branch the layout could not measure.
      return (
        <svg {...svgProps}>
          <path
            d="M 1.5 12 L 1.5 5 L 8 5 L 8 1.5"
            fill="none"
            stroke={C_UNKNOWN}
            strokeWidth="1.8"
            strokeDasharray="2.6 2"
            strokeLinecap="butt"
          />
        </svg>
      );
    case 'event':
      // Event badge: surface-filled circle with a coloured ring + two-letter code.
      return (
        <svg {...svgProps}>
          <circle cx="8" cy="8" r="7" fill="var(--surface)" stroke={color} strokeWidth="2" />
          <text
            x="8"
            y="8"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="6.5"
            fontWeight={700}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {code}
          </text>
        </svg>
      );
    case 'era':
      // Geological era band.
      return (
        <svg {...svgProps}>
          <rect x="1.5" y="4" width="13" height="8" rx="1.5" fill="var(--c-warn)" opacity="0.25" stroke="var(--c-warn)" strokeWidth="1" />
        </svg>
      );
  }
}

export function CanvasLegend({ unmeasuredBranches = false }: { unmeasuredBranches?: boolean }) {
  const [open, setOpen] = useState(false);
  const asr = useStore((s) => s.asr);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const showTransitions = useStore((s) => s.showTransitions);
  const showEvents = useStore((s) => s.showEvents);
  const showEras = useStore((s) => s.showEras);
  const layoutType = useStore((s) => s.project.layout.type);
  const projectEvents = useStore((s) => s.project.events);
  const activeCharacter = findCharacter(useStore.getState().project, activeCharacterId ?? '');
  // The state-colouring swatch mirrors the first state colour so the legend
  // matches the actual coloured dots on the canvas.
  const stateColor = activeCharacter?.states[0]?.color ?? 'var(--accent)';

  const items: LegendItem[] = [
    { kind: 'select', label: S.legend.selection },
    { kind: 'mrca', label: S.legend.mrca },
    { kind: 'drop', label: S.legend.dropTarget },
    { kind: 'connect', label: S.legend.connectSource },
    // State colouring: shown whenever a character is active — the sample tree
    // colours leaf markers by state (e.g. 陆行 / 飞行), and users found those
    // coloured dots unexplained because this entry only appeared with ASR.
    {
      kind: 'state',
      color: stateColor,
      label: S.legend.stateMarker,
      requires: { character: true },
    },
    {
      kind: 'transition',
      color: activeCharacter?.states[0]?.color,
      color2: activeCharacter?.states[1]?.color,
      label: S.legend.transition,
      requires: { transitions: true },
    },
    // The branch the canvas marks with a dashed "?" is a request for data,
    // not a change — without this row the on-screen dots read as "N transitions".
    {
      kind: 'needsData',
      label: S.legend.needsData,
      requires: { transitions: true },
    },
    // The same grey dashed mark the canvas puts over a branch with no
    // recorded length. Without this row "dashed grey" reads as a style the user
    // chose, not as missing data.
    {
      kind: 'unmeasured',
      label: S.layoutPanel.branchLengthUnknownLegend,
      requires: { unmeasured: true },
    },
    { kind: 'event', color: 'var(--c-info)', label: S.legend.event, requires: { events: true } },
    { kind: 'era', label: S.legend.era, requires: { eras: true } },
  ];

  const visibleItems = items.filter((it) => {
    if (!it.requires) return true;
    if (it.requires.unmeasured) return unmeasuredBranches;
    if (it.requires.transitions) return Boolean(activeCharacterId) && showTransitions;
    if (it.requires.events) return showEvents;
    if (it.requires.eras) return showEras && layoutType === 'time-calibrated';
    if (it.requires.asr) return Boolean(asr);
    if (it.requires.character) return Boolean(activeCharacterId);
    return true;
  });

  // Concrete event-type entries so users can read what each badge code means
  // without hovering every badge on the canvas.
  const eventLegendItems = useMemo(() => {
    if (!showEvents || projectEvents.length === 0) return [] as { id: string; color: string; code: string; label: string }[];
    const seen = new Set<string>();
    const out: { id: string; color: string; code: string; label: string }[] = [];
    for (const e of projectEvents) {
      if (seen.has(e.typeId)) continue;
      seen.add(e.typeId);
      out.push({ id: e.typeId, color: eventColor(e), code: eventCode(e), label: eventDisplayLabel(e) });
    }
    return out;
  }, [showEvents, projectEvents]);

  if (!open) {
    return (
      <button className="legend-toggle" onClick={() => setOpen(true)} title={S.legend.toggleTitle}>
        <ListBulletIcon />
        <span>{S.legend.toggle}</span>
      </button>
    );
  }

  return (
    <div className="legend-card">
      <div className="legend-header">
        <span>{S.legend.title}</span>
        <button
          className="legend-close"
          onClick={() => setOpen(false)}
          title={S.legend.toggleTitle}
          aria-label={S.legend.title}
        >
          ×
        </button>
      </div>
      <div className="legend-body">
        {visibleItems.map((it) => (
          <div className="legend-item" key={it.label}>
            <LegendSwatch kind={it.kind} color={it.color} color2={it.color2} />
            <span className="legend-label">{it.label}</span>
          </div>
        ))}
        {eventLegendItems.map((it) => (
          <div className="legend-item" key={it.id}>
            <LegendSwatch kind="event" color={it.color} code={it.code} />
            <span className="legend-label">{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
