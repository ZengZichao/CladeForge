// Renders evolutionary-event badges on nodes / branches plus the causal-chain
// arrows between linked events. Anchors are derived from layout positions:
// node events sit just below-right of the node, branch events above the branch
// midpoint; events sharing an anchor are stacked. Clicking a badge selects its
// node (which opens the event editor in the inspector).

import { memo, useMemo } from 'react';
import type { EvolutionaryEvent, LayoutType, NodeId, Orientation, Point, TreeNode } from '../model/types';
import {
  EVENT_BADGE_RADIUS,
  EVENT_CODE_FONT_SIZE,
  eventCode,
  eventColor,
  eventDisplayLabel,
} from '../model/events';
import { curvedPath, branchMidpointOn } from './paths';
import { S } from '../ui/strings';

interface EventLayerProps {
  events: EvolutionaryEvent[];
  positions: Map<NodeId, Point>;
  nodes: Record<NodeId, TreeNode>;
  culled: Set<NodeId>;
  orientation: Orientation;
  layoutType: LayoutType;
}

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
  const anchors = useMemo(() => {
    const map = new Map<string, Point>();
    const groupIndex = new Map<string, number>();
    for (const e of events) {
      if (!culled.has(e.nodeId)) continue;
      const p = positions.get(e.nodeId);
      if (!p) continue;
      const key = `${e.nodeId}:${e.target}`;
      const idx = groupIndex.get(key) ?? 0;
      groupIndex.set(key, idx + 1);
      if (e.target === 'branch') {
        // Anchor the badge ON the branch segment (branchMidpointOn) so it
        // reads as attached to the branch instead of floating beside it.
        // Multiple badges on the same branch stack ALONG the segment
        // (horizontal layouts: along x; vertical: along y; circular: along
        // the radius) so stacked badges stay on the branch line too.
        const parentId = nodes[e.nodeId]?.parentId ?? null;
        const pp = parentId ? positions.get(parentId) : undefined;
        const b = pp ? branchMidpointOn(pp, p, orientation, layoutType) : p;
        if (layoutType === 'circular' && pp) {
          const rc = Math.hypot(p.x, p.y) || 1;
          const ux = p.x / rc;
          const uy = p.y / rc;
          map.set(e.id, { x: b.x + ux * idx * 16, y: b.y + uy * idx * 16 });
        } else {
          const horizontal = orientation === 'LR' || orientation === 'RL';
          map.set(
            e.id,
            horizontal
              ? { x: b.x + idx * 16, y: b.y }
              : { x: b.x, y: b.y + idx * 16 },
          );
        }
      } else {
        // target === 'node'. Anchor the badge ON the branch entering the
        // node, OFFSET ALONG the branch toward the node — never off the line.
        // The old perpendicular offset made e.g. the "adaptive radiation" dot
        // beside the Vertebrata branch float in empty space, unattached to any
        // branch, which was confusing to read.
        const parentId = nodes[e.nodeId]?.parentId ?? null;
        const pp = parentId ? positions.get(parentId) : undefined;
        if (pp) {
          const m = branchMidpointOn(pp, p, orientation, layoutType);
          if (layoutType === 'circular') {
            const rc = Math.hypot(p.x, p.y) || 1;
            const ux = p.x / rc;
            const uy = p.y / rc;
            map.set(e.id, { x: m.x + ux * (18 + idx * 16), y: m.y + uy * (18 + idx * 16) });
          } else {
            const horizontal = orientation === 'LR' || orientation === 'RL';
            const dir = horizontal ? Math.sign(p.x - m.x) || 1 : Math.sign(p.y - m.y) || 1;
            map.set(
              e.id,
              horizontal
                ? { x: m.x + dir * (18 + idx * 16), y: m.y }
                : { x: m.x, y: m.y + dir * (18 + idx * 16) },
            );
          }
        } else {
          // Root node has no parent — keep the simple near-node offset.
          map.set(e.id, { x: p.x + 14 + idx * 16, y: p.y + 16 });
        }
      }
    }
    return map;
  }, [events, positions, nodes, culled, orientation, layoutType]);

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
