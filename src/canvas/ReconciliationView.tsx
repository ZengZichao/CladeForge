// Side-by-side reconciliation view: species tree (left) and gene tree (right),
// each laid out with the standard computeLayout engine (forced to rectangular
// LR for predictable geometry) inside independently pannable / zoomable panes.
// Mapping lines are drawn on a full-view overlay between the screen positions
// of corresponding nodes.
//
// The gene side is deliberately READ-ONLY (assumptions key by node id; an
// editable topology would silently invalidate them). Editing happens through
// selection + the right-hand inspector, plus the Alt+click shortcut that maps
// the selected gene node onto a clicked species node.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../model/store';
import { computeLayout, type LayoutResult } from '../layout/autoLayout';
import { elbowPath } from './paths';
import type { GeneNodeAssumption, NodeId, Project } from '../model/types';
import { S, tr } from '../ui/strings';
import { isImeComposing } from '../ui/imeGuard';

interface PaneTransform {
  tx: number;
  ty: number;
  scale: number;
}

const PAD = 28;

/** Force predictable horizontal cladogram geometry inside this view. */
function horizontalCladogram(doc: Project): Project {
  return { ...doc, layout: { ...doc.layout, type: 'rectangular-cladogram', orientation: 'LR' } };
}

/** Visual language for DTL event classes. */
export const DTL_STYLE = {
  speciation: { color: '#0e9f6e', glyph: 'σ' },
  duplication: { color: '#2563eb', glyph: 'δ' },
  transfer: { color: '#ec4899', glyph: 'τ' },
} as const;

function fitTransform(bounds: LayoutResult['bounds'], w: number, h: number): PaneTransform {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((w - PAD * 2) / bw, (h - PAD * 2) / bh);
  const s = Math.max(0.05, Math.min(4, Number.isFinite(scale) ? scale : 1));
  return {
    scale: s,
    tx: (w - bw * s) / 2 - bounds.minX * s,
    ty: (h - bh * s) / 2 - bounds.minY * s,
  };
}

/**
 * One pane: renders the given layout + assignment state.
 * `onNodeClick` receives clicks on node hits (after stopPropagation).
 */
interface PaneProps {
  doc: Project;
  transform: PaneTransform;
  setTransform: (t: PaneTransform) => void;
  paneRef: React.RefObject<HTMLDivElement>;
  tagLabel: string;
  nodeMeta?: Map<NodeId, { fill: string; glyph?: string; dashedRed?: boolean; selected?: boolean; losses?: number }>;
  tipLabelsFromPins?: boolean;
  onNodeClick?: (id: NodeId, e: React.MouseEvent) => void;
}

function ReconPane({ doc, transform, setTransform, paneRef, tagLabel, nodeMeta, onNodeClick }: PaneProps) {
  const layout = useMemo(() => computeLayout(horizontalCladogram(doc)), [doc]);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = paneRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setTransform({
      scale: transform.scale * k,
      tx: mx - (mx - transform.tx) * k,
      ty: my - (my - transform.ty) * k,
    });
  };

  const bgDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('[data-node-id]')) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: transform.tx, ty: transform.ty };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const bgMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setTransform({
      ...transform,
      tx: drag.current.tx + (e.clientX - drag.current.x),
      ty: drag.current.ty + (e.clientY - drag.current.y),
    });
  };
  const bgUp = () => {
    drag.current = null;
  };

  const branchColor = '#3f3f46';

  return (
    <div className="recon-pane" ref={paneRef} onWheel={onWheel} onPointerDown={bgDown} onPointerMove={bgMove} onPointerUp={bgUp} onPointerCancel={bgUp}>
      <span className="recon-pane-tag">{tagLabel}</span>
      <svg>
        <g transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}>
          {/* edges */}
          {layout.visible.size > 0 &&
            [...layout.visible].map((id) => {
              const n = doc.nodes[id];
              if (!n || !n.parentId) return null;
              if (!layout.visible.has(n.parentId)) return null;
              const from = layout.positions.get(id)!;
              const to = layout.positions.get(n.parentId)!;
              return (
                <path
                  key={`e${id}`}
                  d={elbowPath(from, to, 'LR')}
                  fill="none"
                  stroke={branchColor}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
              );
            })}
          {/* nodes */}
          {[...layout.visible].map((id) => {
            const n = doc.nodes[id];
            if (!n) return null;
            const p = layout.positions.get(id)!;
            const meta = nodeMeta?.get(id);
            const isTip = n.childrenIds.length === 0;
            const r = isTip ? 5 : 6.5;
            const fill = meta?.dashedRed ? 'var(--surface)' : meta?.fill ?? '#ffffff';
            const stroke =
              meta?.selected ? '#18181b' : meta?.dashedRed ? '#dc2626' : meta?.fill ?? '#18181b';
            return (
              <g key={id} data-node-id={id} onClick={(e) => onNodeClick?.(id, e)} style={{ cursor: onNodeClick ? 'pointer' : undefined }}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + (meta?.selected ? 2 : 0)}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={meta?.selected ? 2.5 : 1.5}
                  strokeDasharray={meta?.dashedRed ? '3 2' : undefined}
                />
                {meta?.glyph && (
                  <text
                    x={p.x}
                    y={p.y - r - 3}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={700}
                    fill={meta.fill}
                  >
                    {meta.glyph}
                  </text>
                )}
                {typeof meta?.losses === 'number' && meta.losses > 0 && (
                  <text x={p.x} y={p.y + r + 10} textAnchor="middle" fontSize={9.5} fill="#78716c">
                    λ{meta.losses}
                  </text>
                )}
                {isTip && n.label && (
                  <text x={p.x + 9} y={p.y + 4} fontSize={11.5} fill="currentColor">
                    {n.label}
                  </text>
                )}
                {!isTip && n.label && (
                  <text
                    x={p.x - r - 4}
                    y={p.y + 4}
                    textAnchor="end"
                    fontSize={10.5}
                    opacity={0.65}
                    fill="currentColor"
                  >
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export function ReconciliationView() {
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const geneSelection = useStore((s) => s.geneSelection);
  const setActiveGeneTree = useStore((s) => s.setActiveGeneTree);
  const selectGeneNode = useStore((s) => s.selectGeneNode);
  const clearGeneSelection = useStore((s) => s.clearGeneSelection);
  const setReconMode = useStore((s) => s.setReconMode);
  const apply = useStore((s) => s.apply);

  const entry = project.geneTrees?.find((g) => g.id === activeGeneTreeId);

  const speciesPaneRef = useRef<HTMLDivElement | null>(null);
  const genePaneRef = useRef<HTMLDivElement | null>(null);
  const [speciesT, setSpeciesT] = useState<PaneTransform>({ tx: 40, ty: 40, scale: 1 });
  const [geneT, setGeneT] = useState<PaneTransform>({ tx: 40, ty: 40, scale: 1 });

  const fitBoth = useCallback(() => {
    const sb = speciesPaneRef.current?.getBoundingClientRect();
    const gb = genePaneRef.current?.getBoundingClientRect();
    const spLayout = computeLayout(horizontalCladogram(project));
    if (sb) setSpeciesT(fitTransform(spLayout.bounds, sb.width, sb.height));
    if (gb && entry) {
      const gpLayout = computeLayout(horizontalCladogram(entry.doc));
      setGeneT(fitTransform(gpLayout.bounds, gb.width, gb.height));
    }
  }, [project, entry]);

  // Fit once per active document / gene switch, after first paint.
  useEffect(() => {
    const t = requestAnimationFrame(fitBoth);
    return () => cancelAnimationFrame(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, entry?.id]);

  // Escape leaves reconciliation mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape during a composition cancels the candidate list, not the view.
      if (isImeComposing(e)) return;
      if (e.key === 'Escape') setReconMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setReconMode]);

  /** Derived display metadata for gene nodes (event colour/glyph, losses…). */
  const geneMeta = useMemo(() => {
    const map = new Map<NodeId, { fill: string; glyph?: string; dashedRed?: boolean; selected?: boolean; losses?: number }>();
    if (!entry) return map;
    const tipAssumed = new Set(
      Object.values(entry.doc.nodes)
        .filter((n) => n.childrenIds.length === 0 && entry.assumptions[n.id])
        .map((n) => n.id),
    );
    for (const n of Object.values(entry.doc.nodes)) {
      const a: GeneNodeAssumption | undefined = entry.assumptions[n.id];
      const internal = n.childrenIds.length > 0;
      if (!internal && !tipAssumed.has(n.id)) continue; // unlabelled-mapping tips stay plain
      const style = internal && a ? DTL_STYLE[a.event ?? ('speciation' as const)] : null;
      map.set(n.id, {
        fill: style ? style.color : '#0ea5a3',
        glyph: internal && a ? style?.glyph : undefined,
        dashedRed: internal && (!a || !a.event),
        selected: geneSelection.includes(n.id),
        losses: a?.losses,
      });
    }
    return map;
  }, [entry, geneSelection]);

  /** Alt+click on a species node: map the currently selected single gene node
   *  here and auto-classify the event from its children's placements. */
  const assignSelectedToSpecies = (speciesNodeId: NodeId) => {
    if (!entry || geneSelection.length !== 1) return;
    const gid = geneSelection[0];
    apply((d) => {
      const g = d.geneTrees?.find((x) => x.id === entry.id);
      if (!g || !d.nodes[speciesNodeId]) return;
      const n = g.doc.nodes[gid];
      if (!n) return;
      const next: GeneNodeAssumption = {
        ...(g.assumptions[gid] ?? {}),
        speciesNode: speciesNodeId,
      };
      if (n.childrenIds.length > 0) {
        // Auto-classify: any child sharing the mapping ⇒ duplication; two
        // children in distinct direct branches ⇒ speciation; else unresolved.
        const kidPlacements = n.childrenIds.map((cid) =>
          cid === gid ? speciesNodeId : g.assumptions[cid]?.speciesNode,
        );
        const placed = kidPlacements.filter((x): x is NodeId => Boolean(x));
        if (placed.length === n.childrenIds.length && placed.length >= 2) {
          if (new Set(placed).size === 1) next.event = 'duplication';
          else if (placed.includes(speciesNodeId)) next.event = 'duplication';
          else {
            const branches = placed.map((p) => childBranchOf(d, speciesNodeId, p));
            if (
              branches.every(Boolean) &&
              new Set(branches as string[]).size === branches.length
            ) {
              next.event = 'speciation';
            } else {
              delete next.event;
            }
          }
        }
      }
      g.assumptions[gid] = next;
    });
  };

  /** Species-pane click: Alt+click assigns the selected gene node. */
  const onSpeciesNodeClick = (id: NodeId, e: React.MouseEvent) => {
    if (e.altKey) {
      e.stopPropagation();
      assignSelectedToSpecies(id);
    } else {
      useStore.getState().select(id);
    }
  };

  const onGeneNodeClick = (id: NodeId, e: React.MouseEvent) => {
    selectGeneNode(id, e.shiftKey || e.metaKey);
  };

  if (!entry) {
    return (
      <div className="recon-view" style={{ gridTemplateColumns: '1fr' }}>
        <div className="hint" style={{ padding: 24 }}>{S.recon.empty}</div>
      </div>
    );
  }

  return (
    <div className="recon-view">
      {/* top chrome */}
      <div className="recon-chrome-top">
        <select
          value={activeGeneTreeId ?? ''}
          onChange={(e) => {
            setActiveGeneTree(e.target.value || null);
            clearGeneSelection();
          }}
          title={S.recon.activeGene}
        >
          {(project.geneTrees ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => { fitBoth(); }}>
          {S.canvasControls.fit}
        </button>
        <button className="btn primary" onClick={() => setReconMode(false)}>
          {S.recon.exitView}
        </button>
      </div>

      <ReconPane
        doc={project}
        transform={speciesT}
        setTransform={setSpeciesT}
        paneRef={speciesPaneRef as React.RefObject<HTMLDivElement>}
        tagLabel={tr('物种树', 'Species tree')}
        nodeMeta={undefined}
        onNodeClick={onSpeciesNodeClick}
      />
      <ReconPane
        doc={entry.doc}
        transform={geneT}
        setTransform={setGeneT}
        paneRef={genePaneRef as React.RefObject<HTMLDivElement>}
        tagLabel={tr('基因树', 'Gene tree')}
        nodeMeta={geneMeta}
        onNodeClick={onGeneNodeClick}
      />

      {/* mapping lines overlay */}
      <MappingOverlay
        project={project}
        entryDoc={entry.doc}
        assumptions={entry.assumptions}
        speciesT={speciesT}
        geneT={geneT}
        speciesPaneRef={speciesPaneRef}
        genePaneRef={genePaneRef}
      />
    </div>
  );
}

// --- helpers -------------------------------------------------------------------

/** Direct species-child branch of `s` containing `v`, or null when outside/equal. */
function childBranchOf(project: Project, s: NodeId, v: NodeId): NodeId | null {
  const sNode = project.nodes[s];
  if (!sNode) return null;
  for (const cid of sNode.childrenIds) {
    if (cid === v) return cid;
    let cur: NodeId | null = v;
    while (cur) {
      if (cur === cid) return cid;
      cur = project.nodes[cur]?.parentId ?? null;
    }
  }
  return null;
}

/**
 * Bezier mapping lines between matched gene nodes and their species targets.
 * Recomputes whenever transforms or layouts change; pointer-events none so it
 * never blocks pan/zoom gestures underneath.
 */
function MappingOverlay({
  project,
  entryDoc,
  assumptions,
  speciesT,
  geneT,
  speciesPaneRef,
  genePaneRef,
}: {
  project: Project;
  entryDoc: Project;
  assumptions: Record<NodeId, GeneNodeAssumption>;
  speciesT: PaneTransform;
  geneT: PaneTransform;
  speciesPaneRef: React.RefObject<HTMLDivElement | null>;
  genePaneRef: React.RefObject<HTMLDivElement | null>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [, bumpSize] = useState(0);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => bumpSize((v) => v + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const spLayout = useMemo(() => computeLayout(horizontalCladogram(project)), [project]);
  const gLayout = useMemo(() => computeLayout(horizontalCladogram(entryDoc)), [entryDoc]);

  const spRect = speciesPaneRef.current?.getBoundingClientRect();
  const gRect = genePaneRef.current?.getBoundingClientRect();
  const hostRect = hostRef.current?.getBoundingClientRect();
  const lines: { d: string; color: string; key: string }[] = [];
  if (spRect && gRect && hostRect) {
    for (const [gid, a] of Object.entries(assumptions)) {
      const target = a.speciesNode;
      const spPos = spLayout.positions.get(target);
      const gPos = gLayout.positions.get(gid);
      if (!spPos || !gPos || !gLayout.visible.has(gid) || !spLayout.visible.has(target)) continue;
      const sx = spRect.left - hostRect.left + spPos.x * speciesT.scale + speciesT.tx;
      const sy = spRect.top - hostRect.top + spPos.y * speciesT.scale + speciesT.ty;
      const gx = gRect.left - hostRect.left + gPos.x * geneT.scale + geneT.tx;
      const gy = gRect.top - hostRect.top + gPos.y * geneT.scale + geneT.ty;
      const ev = a.event ? DTL_STYLE[a.event].color : '#94a3b8';
      const mid = (sx + gx) / 2;
      lines.push({
        key: `${gid}`,
        color: ev,
        d: `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${gy}, ${gx} ${gy}`,
      });
    }
  }

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 15 }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {lines.map((l) => (
          <path
            key={l.key}
            d={l.d}
            fill="none"
            stroke={l.color}
            strokeWidth={1.6}
            strokeOpacity={0.85}
            strokeLinecap="round"
          />
        ))}
      </svg>
    </div>
  );
}
