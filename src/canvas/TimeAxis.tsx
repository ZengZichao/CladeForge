// Time-axis overlay for the geological time chart (time-calibrated layout).
// Drawn in world coordinates inside the pan/zoom group so ticks and geological
// bands stay aligned with the tree. Numeric ticks always render; era bands and
// labels render when enabled, with collision-free label placement computed by
// planEraOverlay() (shared with the exporters so figures match the screen).

import { memo } from 'react';
import { tr } from '../ui/strings';
import { timeUnitSymbol } from '../ui/units';
import type { CalibrationPoint, EnvironmentalEvent, NodeId, Point, TreeNode } from '../model/types';
import {
  ERA_LANE_HEIGHT,
  planEraOverlay,
  type EraLevel,
  type TimeAxisInfo,
} from '../layout/timescale';

const PAD = 24; // world-unit margin around the tree's breadth extent
const FONT = 11;

export const TimeAxis = memo(function TimeAxis({
  info,
  showEras,
  eraLevel,
  envEvents,
}: {
  info: TimeAxisInfo;
  showEras: boolean;
  eraLevel: EraLevel;
  envEvents: EnvironmentalEvent[];
}) {
  const b0 = info.breadthMin - PAD;
  const b1 = info.breadthMax + PAD;
  const span = b1 - b0;
  const unit = timeUnitSymbol(info.unit);

  const plan = planEraOverlay(info, { showEras, eraLevel }, envEvents, FONT);

  // Era label rows stack OUTWARD from the band edge — above the bands for
  // LR/RL trees (lane 0 = baseline b0-6), left of them for TB/BT — staying
  // clear of the tree's own node labels, which sit just inside the edge.
  // Rotated labels (lane -1) run along the band just inside its edge, so
  // narrow neighbours never touch. Displaced lane-packed labels get a thin
  // leader line down to their band.
  const eraLabel = (l: (typeof plan.labels)[number]) => {
    const displaced = l.lane > l.baseLane;
    if (info.horizontal) {
      if (l.rotated) {
        const ax = l.center;
        const ay = b0 + 5;
        return (
          <text
            key={l.key}
            x={ax}
            y={ay}
            textAnchor="end"
            fontSize={FONT}
            fill="var(--muted-foreground)"
            transform={`rotate(-90 ${ax} ${ay})`}
          >
            {l.label}
          </text>
        );
      }
      const y = b0 - 6 - l.lane * ERA_LANE_HEIGHT;
      return (
        <g key={l.key}>
          {displaced && (
            <line
              x1={l.center}
              y1={b0 - 3}
              x2={l.center}
              y2={y + 4}
              stroke="var(--border)"
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.7}
            />
          )}
          <text x={l.center} y={y} textAnchor="middle" fontSize={FONT} fill="var(--muted-foreground)">
            {l.label}
          </text>
        </g>
      );
    }
    if (l.rotated) {
      const ax = b0 + 11;
      const ay = l.center;
      return (
        <text
          key={l.key}
          x={ax}
          y={ay}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={FONT}
          fill="var(--muted-foreground)"
          transform={`rotate(-90 ${ax} ${ay})`}
        >
          {l.label}
        </text>
      );
    }
    const x = b0 - 6 - l.lane * ERA_LANE_HEIGHT;
    return (
      <g key={l.key}>
        {displaced && (
          <line
            x1={b0 - 3}
            y1={l.center}
            x2={x + 4}
            y2={l.center}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray="2 2"
            opacity={0.7}
          />
        )}
        <text x={x} y={l.center} textAnchor="end" dominantBaseline="central" fontSize={FONT} fill="var(--muted-foreground)">
          {l.label}
        </text>
      </g>
    );
  };

  return (
    // The axis chrome stays hover-transparent, but a dedicated transparent hit
    // band below re-enables the environmental-event tooltips: the whole group
    // used to carry pointerEvents:'none', which made the `<title>` notes in the
    // event marks unreachable — documented behaviour, dead in practice.
    <g className="time-axis" style={{ pointerEvents: 'none' }}>
      {showEras && envEvents.length > 0 && (
        <g style={{ pointerEvents: 'all' }}>
          {envEvents.map((e) => {
            const a = info.ageToCoord(e.from);
            const b = info.ageToCoord(e.to);
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            const h = Math.max(10, Math.abs(b1 - b0));
            return info.horizontal ? (
              <rect key={`hit-${e.id}`} x={lo} y={b0} width={Math.max(6, hi - lo)} height={h} fill="transparent">
                <title>{e.note ? `${e.label}
${e.note}` : e.label}</title>
              </rect>
            ) : (
              <rect key={`hit-${e.id}`} x={b0} y={lo} width={h} height={Math.max(6, hi - lo)} fill="transparent">
                <title>{e.note ? `${e.label}
${e.note}` : e.label}</title>
              </rect>
            );
          })}
        </g>
      )}
      {showEras &&
        plan.bands.map((e) => {
          /* V13: theme-aware opacity — dark theme keeps the pastel bands from
             becoming the brightest blocks on the canvas (light 0.45, dark 0.3
             via --era-band-opacity). */
          return info.horizontal ? (
            <rect
              key={e.key}
              x={e.lo}
              y={b0}
              width={e.hi - e.lo}
              height={span}
              fill={e.color}
              style={{ opacity: 'var(--era-band-opacity, 0.45)' }}
            />
          ) : (
            <rect
              key={e.key}
              x={b0}
              y={e.lo}
              width={span}
              height={e.hi - e.lo}
              fill={e.color}
              style={{ opacity: 'var(--era-band-opacity, 0.45)' }}
            />
          );
        })}

      {showEras && plan.labels.map((l) => eraLabel(l))}

      {info.ticks.map((t, i) => {
        const label = t.age === 0 ? `${tr('现今', 'Present')} (0 ${unit})` : `${t.age} ${unit}`;
        return info.horizontal ? (
          <g key={`tick-${i}`}>
            <line
              x1={t.coord}
              y1={b0}
              x2={t.coord}
              y2={b1}
              stroke="var(--border)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text x={t.coord} y={b1 + 13} textAnchor="middle" fontSize={FONT} fill="var(--muted-foreground)">
              {label}
            </text>
          </g>
        ) : (
          <g key={`tick-${i}`}>
            <line
              x1={b0}
              y1={t.coord}
              x2={b1}
              y2={t.coord}
              stroke="var(--border)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {/* Vertical layouts put the numerals on the band-far side (right)
                so they never share a column with the era label rows. */}
            <text
              x={b1 + 4}
              y={t.coord}
              textAnchor="start"
              dominantBaseline="central"
              fontSize={FONT}
              fill="var(--muted-foreground)"
            >
              {label}
            </text>
          </g>
        );
      })}

      {(() => {
        // Environmental events: bands/lines as before, but their labels reuse
        // the lane plan so they never sit on top of an era label.
        const byId = new Map(plan.env.map((e) => [e.id, e]));
        return envEvents.map((e) => {
          const a = info.ageToCoord(e.from);
          const b = info.ageToCoord(e.to);
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const point = Math.abs(hi - lo) < 0.5;
          const placed = byId.get(e.id);
          const lane = placed?.lane ?? 0;
          const center = placed?.center ?? (lo + hi) / 2;
          if (info.horizontal) {
            const labelY = b0 - 6 - lane * ERA_LANE_HEIGHT;
            return (
              <g key={`env-${e.id}`}>
                {point ? (
                  <line x1={lo} y1={b0} x2={lo} y2={b1} stroke={e.color} strokeWidth={2} />
                ) : (
                  <rect
                    x={lo}
                    y={b0}
                    width={hi - lo}
                    height={b1 - b0}
                    fill={e.color}
                    opacity={0.18}
                    stroke={e.color}
                    strokeDasharray="4 3"
                  />
                )}
                <text x={center} y={labelY} textAnchor="middle" fontSize={FONT} fill="var(--text)">
                  {e.label}
                </text>
                <title>{e.note ? `${e.label}\n${e.note}` : e.label}</title>
              </g>
            );
          }
          const labelX = b0 - 6 - lane * ERA_LANE_HEIGHT;
          return (
            <g key={`env-${e.id}`}>
              {point ? (
                <line x1={b0} y1={lo} x2={b1} y2={lo} stroke={e.color} strokeWidth={2} />
              ) : (
                <rect
                  x={b0}
                  y={lo}
                  width={b1 - b0}
                  height={hi - lo}
                  fill={e.color}
                  opacity={0.18}
                  stroke={e.color}
                  strokeDasharray="4 3"
                />
              )}
              <text x={labelX} y={center} textAnchor="end" dominantBaseline="central" fontSize={FONT} fill="var(--text)">
                {e.label}
              </text>
              <title>{e.note ? `${e.label}\n${e.note}` : e.label}</title>
            </g>
          );
        });
      })()}
    </g>
  );
});

/**
 * A14 (review §4.2): calibration intervals drawn as node-anchored error bars.
 * Each bar spans the node's [minAge, maxAge] interval along the DEPTH axis and
 * sits at the node's own position on the breadth axis — the standard way a
 * calibrated node is drawn in a chronogram. Off by default (the 时间 module
 * owns the toggle); purely an overlay, it never touches layout or data.
 */
export const CalibrationBars = memo(function CalibrationBars({
  info,
  points,
  nodes,
  positions,
}: {
  info: TimeAxisInfo;
  points: CalibrationPoint[];
  nodes: Record<string, TreeNode>;
  positions: Map<NodeId, Point>;
}) {
  const unit = timeUnitSymbol(info.unit);
  const TICK = 5; // world-unit end-tick half-height
  return (
    <g className="calibration-bars" style={{ pointerEvents: 'none' }}>
      {points.map((c) => {
        const node = nodes[c.nodeId];
        const pos = positions.get(c.nodeId);
        if (!node || !pos) return null;
        const a = info.ageToCoord(Math.min(c.minAge, c.maxAge));
        const b = info.ageToCoord(Math.max(c.minAge, c.maxAge));
        const label = node.label || node.id.slice(0, 6);
        const title = tr(
          `校准区间：${c.minAge}–${c.maxAge} ${unit}（${label}）`,
          `Calibrated range: ${c.minAge}–${c.maxAge} ${unit} (${label})`,
        );
        if (info.horizontal) {
          return (
            <g key={c.id}>
              <line x1={a} y1={pos.y} x2={b} y2={pos.y} stroke="var(--primary)" strokeWidth={1.5} opacity={0.9} />
              <line x1={a} y1={pos.y - TICK} x2={a} y2={pos.y + TICK} stroke="var(--primary)" strokeWidth={1.5} />
              <line x1={b} y1={pos.y - TICK} x2={b} y2={pos.y + TICK} stroke="var(--primary)" strokeWidth={1.5} />
              <title>{title}</title>
            </g>
          );
        }
        return (
          <g key={c.id}>
            <line x1={pos.x} y1={a} x2={pos.x} y2={b} stroke="var(--primary)" strokeWidth={1.5} opacity={0.9} />
            <line x1={pos.x - TICK} y1={a} x2={pos.x + TICK} y2={a} stroke="var(--primary)" strokeWidth={1.5} />
            <line x1={pos.x - TICK} y1={b} x2={pos.x + TICK} y2={b} stroke="var(--primary)" strokeWidth={1.5} />
            <title>{title}</title>
          </g>
        );
      })}
    </g>
  );
});
