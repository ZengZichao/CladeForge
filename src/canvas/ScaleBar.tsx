// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Branch-length scale bar for the phylogram. A horizontal bar labelled with a
// "nice" branch-length value (1/2/5 × 10ⁿ) sized to ~90 px on screen, so readers
// can gauge distances — a standard expectation for published phylograms.

import { useStore } from '../model/store';
import type { TimeAxisInfo } from '../layout/timescale';
import { timeUnitSymbol } from '../ui/units';

const TARGET_PX = 90;

function niceNumber(x: number): number {
  if (!(x > 0)) return 1;
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  const nf = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return nf * 10 ** exp;
}

export function ScaleBar({ depthScale }: { depthScale: number }) {
  // Subscribed here (a leaf) rather than passed from the canvas: the canvas
  // commits the view at low frequency during a wheel burst, so the bar follows
  // without being re-rendered per wheel tick.
  const viewScale = useStore((s) => s.view.scale);
  const pxPerUnit = depthScale * viewScale;
  if (!Number.isFinite(pxPerUnit) || pxPerUnit <= 0) return null;
  const value = niceNumber(TARGET_PX / pxPerUnit);
  const width = value * pxPerUnit;
  if (!Number.isFinite(width) || width <= 0) return null;
  return (
    <div className="scale-bar" style={{ width }}>
      <div className="scale-bar-line" />
      <div className="scale-bar-label">{+value.toFixed(3)} subst./site</div>
    </div>
  );
}

/**
 * Time-scale bar for the time-calibrated layout. Shows a labelled bar
 * representing a "nice" time value (e.g. 100 Ma) sized to ~90 px on screen,
 * so readers can gauge geological time distances — the standard expectation
 * for published chronograms.
 */
export function TimeScaleBar({ timeAxis }: { timeAxis: TimeAxisInfo }) {
  // Same low-frequency leaf subscription as ScaleBar above.
  const viewScale = useStore((s) => s.view.scale);
  // The ageToCoord function maps an age to a world coordinate. We compute
  // px-per-time-unit from the tick spacing.
  if (!timeAxis || timeAxis.ticks.length < 2) return null;
  const t0 = timeAxis.ticks[0];
  const t1 = timeAxis.ticks[1];
  const ageDelta = Math.abs(t1.age - t0.age);
  const coordDelta = Math.abs(t1.coord - t0.coord);
  if (ageDelta <= 0 || coordDelta <= 0) return null;
  const pxPerUnit = coordDelta / ageDelta * viewScale;
  if (!Number.isFinite(pxPerUnit) || pxPerUnit <= 0) return null;
  const value = niceNumber(TARGET_PX / pxPerUnit);
  const width = value * pxPerUnit;
  if (!Number.isFinite(width) || width <= 0) return null;
  return (
    <div className="scale-bar" style={{ width }}>
      <div className="scale-bar-line" />
      <div className="scale-bar-label">{+value.toFixed(3)} {timeUnitSymbol(timeAxis.unit)}</div>
    </div>
  );
}
