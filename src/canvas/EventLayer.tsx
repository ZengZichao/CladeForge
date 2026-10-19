// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Renders evolutionary-event badges on nodes / branches plus the causal-chain
// arrows between linked events.
//
// Anchors are derived from layout positions: node events sit on the branch
// entering the node, branch events on the branch midpoint; events sharing an
// anchor stack along the branch. Because that natural position can land on a
// neighbouring node's label (BUG-4: KI / AR sat on "Basilosauridae"), the
// anchors go through `planEventAnchors()`, which moves a whole stack to the
// nearest position that intersects no node label, node marker, time-axis text or
// already-placed badge. Stacks pushed clearly off their branch get a thin leader
// line back to the natural anchor so the badge still reads as belonging to its
// node. Clicking a badge selects its node (which opens the event editor in the
// inspector).

import { memo, useMemo } from 'react';
import type { EvolutionaryEvent, LayoutType, NodeId, Orientation, Point, TreeNode } from '../model/types';
import {
  EVENT_BADGE_RADIUS,
  EVENT_CODE_FONT_SIZE,
  eventCode,
  eventColor,
  eventDisplayLabel,
} from '../model/events';
import { curvedPath } from './paths';
import { getCanvasCollisionPlan, getLastCanvasCollisionPlan, planEventAnchors } from './eventBadgeLayout';
import { useStore } from '../model/store';
import { S } from '../ui/strings';

interface EventLayerProps {
  events: EvolutionaryEvent[];
  positions: Map<NodeId, Point>;
  nodes: Record<NodeId, TreeNode>;
  culled: Set<NodeId>;
  orientation: Orientation;
  layoutType: LayoutType;
}

/** Shared empty collections so the hooks below stay referentially stable. */
const EMPTY_NUDGES: ReadonlyMap<NodeId, number> = new Map();
const EMPTY_BOXES = [] as const;

/**
 * Confidence label for a node/branch annotation.
 *
 * Must be a FUNCTION: `S` is re-assigned by setLanguage() and relies on ES-module
 * live bindings, so capturing `S.confidence.high` into a module-level constant
 * froze the language at import time and left English canvases reading
 * "Confidence:中" after a language switch.
 */
function confLabel(conf: string): string {
  return conf === 'high' || conf === 'medium' || conf === 'low' ? S.confidence[conf] : '';
}

export const EventLayer = memo(function EventLayer({
  events,
  positions,
  nodes,
  culled,
  orientation,
  layoutType,
}: EventLayerProps) {
  // The collision plan needs the document styles (label font sizes / placement),
  // the time-axis options and the layout itself, none of which TreeCanvas passes
  // down — read them from the store. The plan is computed once per project
  // revision and shared with every NodeView (see eventBadgeLayout).
  const project = useStore((s) => s.project);
  const showEras = useStore((s) => s.showEras);
  const eraLevel = useStore((s) => s.eraLevel);
  const interacting = useStore((s) => s.interactionBase !== null);

  const collisionPlan = useMemo(() => {
    const opts = { showEras, eraLevel };
    // While a drag is open TreeCanvas overlays live positions instead of
    // re-laying-out; reuse the last plan so a pointermove frame does not trigger
    // a full computeLayout() through every NodeView.
    return (interacting ? getLastCanvasCollisionPlan(opts) : null) ?? getCanvasCollisionPlan(project, opts);
  }, [project, showEras, eraLevel, interacting]);

  const anchorPlan = useMemo(
    () =>
      planEventAnchors({
        project,
        events,
        positions,
        nodes,
        culled,
        orientation,
        layoutType,
        labelNudges: collisionPlan?.nudges ?? EMPTY_NUDGES,
        axisBoxes: collisionPlan?.axisBoxes ?? EMPTY_BOXES,
      }),
    [project, events, positions, nodes, culled, orientation, layoutType, collisionPlan],
  );

  const { anchors, leaders } = anchorPlan;

  const links = useMemo(() => {
    const out: { id: string; from: Point; to: Point; color: string }[] = [];
    for (const e of events) {
      const from = anchors.get(e.id);
      if (!from) continue;
      for (const targetId of e.triggers) {
        const to = anchors.get(targetId);
        if (to) out.push({ id: `${e.id}->${targetId}`, from, to, color: eventColor(e) });
      }
    }
    return out;
  }, [events, anchors]);

  if (anchors.size === 0) return null;

  return (
    <g className="event-layer">
      <defs>
        <marker
          id="cf-causal-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
        </marker>
      </defs>

      {links.map((l) => (
        <path
          key={l.id}
          d={curvedPath(l.from, l.to, 0.25)}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={1.25}
          strokeDasharray="4 3"
          markerEnd="url(#cf-causal-arrow)"
          opacity={0.85}
        />
      ))}

      {/* Leader lines for stacks displaced off their branch: a thin solid link
          plus a dot on the branch point keeps the badge readable as belonging to
          that node/branch even when a label forced it a line away. */}
      {leaders.map((l, i) => (
        <g key={`leader-${i}`} pointerEvents="none">
          <line
            x1={l.from.x}
            y1={l.from.y}
            x2={l.to.x}
            y2={l.to.y}
            stroke="var(--muted)"
            strokeWidth={1}
            opacity={0.7}
          />
          <circle cx={l.to.x} cy={l.to.y} r={1.6} fill="var(--muted)" />
        </g>
      ))}

      {events.map((e) => {
        const a = anchors.get(e.id);
        if (!a) return null;
        const color = eventColor(e);
        const conf = e.confidence;
        const title =
          eventDisplayLabel(e) +
          (conf ? ` · ${S.confidence.label}:${confLabel(conf)}` : '') +
          (e.note ? `\n${e.note}` : '');
        return (
          <g key={e.id}>
            <circle
              cx={a.x}
              cy={a.y}
              r={EVENT_BADGE_RADIUS}
              fill="var(--surface)"
              stroke={color}
              strokeWidth={conf === 'high' ? 2.5 : 2}
              strokeDasharray={conf === 'low' ? '2 2' : undefined}
              data-role="node"
              data-node-id={e.nodeId}
            />
            <text
              x={a.x}
              y={a.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={EVENT_CODE_FONT_SIZE}
              fontWeight={700}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {eventCode(e)}
            </text>
            <title>{title}</title>
          </g>
        );
      })}
    </g>
  );
});
