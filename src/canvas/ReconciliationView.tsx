// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Side-by-side reconciliation canvas: species tree (left) and gene tree
// (right), joined by a mapping BRIDGE instead of lines painted across both
// trees. This component composes the canvas only — the workspace grid, left
// rail/panel, inspector, toolbar and status bar live in `ReconWorkspace`.
//
// Structure (the 2026-10-31 reconciliation review, §5.2/§5.6):
//   ┌─ optional "no mappings yet" banner (layout row) ─┐
//   ├─ panes row: [species pane][bridge][gene pane] ───┤
//   └─ legend row (layout row, never overlays the tree)┘
// The gene side is deliberately READ-ONLY: assumptions key by node id, and an
// editable topology would silently invalidate them. Editing happens through
// selection + the inspector, plus Alt+click mapping a selected gene node onto
// a species node.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../model/store';
import { computeLayout } from '../layout/autoLayout';
import type { GeneNodeAssumption, NodeId, Project } from '../model/types';
import { SAMPLE_PROJECTS } from '../model/sampleTree';
import { openSample } from '../ui/sampleOpener';
import * as file from '../io/fileActions';
import { S } from '../ui/strings';
import { notify } from '../ui/toast';
import { isImeComposing } from '../ui/imeGuard';
import { geneTreeRows } from '../ui/reconStats';
import {
  ReconPane,
  RECON_HEADER_H,
  fitTransformFor,
  clampTransform,
  reconPaneBounds,
  stubsFromLines,
  type PaneNodeMeta,
  type PaneTransform,
} from './ReconPane';
import { collectMappingAnchors, projectMappingAnchors, type PaneView } from './reconMapping';
import { ReconMappingLayer } from './ReconMappingLayer';
import { Cross1Icon } from '@radix-ui/react-icons';

/** Visual language for DTL event classes — colours are THEME variables. */
export const DTL_STYLE = {
  speciation: { color: 'var(--recon-map-sigma)', glyph: 'σ' },
  duplication: { color: 'var(--recon-map-dup)', glyph: 'δ' },
  transfer: { color: 'var(--recon-map-transfer)', glyph: 'τ' },
} as const;

const IDENTITY: PaneTransform = { tx: 40, ty: 40, scale: 1 };

/** Force predictable horizontal cladogram geometry inside this view. The two
 *  panes face each other: species grows rightwards (LR), gene leftwards (RL). */
function horizontalCladogram(doc: Project, orientation: 'LR' | 'RL'): Project {
  return { ...doc, layout: { ...doc.layout, type: 'rectangular-cladogram', orientation } };
}

export function ReconciliationView({
  onBuildGeneTree,
  onCopySpeciesTree,
  onZoomChange,
}: {
  onBuildGeneTree: () => void;
  onCopySpeciesTree: () => void;
  /** Reported when a pane's zoom scale changes (status-bar readouts). */
  onZoomChange?: (species: number, gene: number) => void;
}) {
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const geneSelection = useStore((s) => s.geneSelection);
  const speciesSelection = useStore((s) => s.selection);
  const options = useStore((s) => s.reconViewOptions);
  const hoveredGeneId = useStore((s) => s.reconHoverGeneId);
  const focusTarget = useStore((s) => s.reconFocusTarget);
  const setActiveGeneTree = useStore((s) => s.setActiveGeneTree);
  const setReconHoverGene = useStore((s) => s.setReconHoverGene);
  const setReconMode = useStore((s) => s.setReconMode);

  const entry = project.geneTrees?.find((g) => g.id === activeGeneTreeId);

  // Layouts are computed ONCE here and shared by both panes + the mapping
  // layer (the old code computed each layout twice: pane + overlay).
  const speciesLayout = useMemo(() => computeLayout(horizontalCladogram(project, 'LR')), [project]);
  const geneLayout = useMemo(
    () => (entry ? computeLayout(horizontalCladogram(entry.doc, 'RL')) : null),
    [entry],
  );

  // --- panes-row measurement (one ResizeObserver drives bridge + fit) --------
  const panesRef = useRef<HTMLDivElement | null>(null);
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  const [speciesBox, setSpeciesBox] = useState({ w: 0, h: 0, top: RECON_HEADER_H });
  const [geneBox, setGeneBox] = useState({ w: 0, h: 0, top: RECON_HEADER_H });
  const [bannerClosed, setBannerClosed] = useState(false);

  // STABLE size handlers: a fresh arrow here would re-render the panes forever
  // (their size-report effect keys off the callback), and the identity-
  // preserving setState keeps an unchanged measurement from dirtying anything.
  const onSpeciesSize = useCallback((w: number, h: number, top: number) => {
    setSpeciesBox((prev) => (prev.w === w && prev.h === h && prev.top === top ? prev : { w, h, top }));
  }, []);
  const onGeneSize = useCallback((w: number, h: number, top: number) => {
    setGeneBox((prev) => (prev.w === w && prev.h === h && prev.top === top ? prev : { w, h, top }));
  }, []);

  // Keyed on the entry id, NOT []: `.recon-panes` does not exist while the
  // empty state is up, so an always-on effect would observe nothing on the
  // first render and never re-arm after the sample/gene tree appears.
  useEffect(() => {
    const el = panesRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setHostSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [entry?.id]);

  const bridge = hostSize.w >= 1200 ? 96 : 64;
  const paneW = Math.max(0, (hostSize.w - bridge) / 2);

  // --- transforms + fit mode --------------------------------------------------
  const [speciesT, setSpeciesTState] = useState<PaneTransform>(IDENTITY);
  const [geneT, setGeneTState] = useState<PaneTransform>(IDENTITY);
  // `fitMode` = the view is auto-fitted; any manual pan/zoom leaves the mode,
  // and a resize re-fits only while the mode holds (§5.6.4).
  const fitMode = useRef(true);

  const speciesPane: PaneView = useMemo(
    () => ({ left: 0, top: speciesBox.top, width: paneW, height: Math.max(0, hostSize.h - speciesBox.top), transform: speciesT }),
    [paneW, hostSize.h, speciesBox.top, speciesT],
  );
  const genePane: PaneView = useMemo(
    () => ({ left: paneW + bridge, top: geneBox.top, width: paneW, height: Math.max(0, hostSize.h - geneBox.top), transform: geneT }),
    [paneW, bridge, hostSize.h, geneBox.top, geneT],
  );

  const setSpeciesT = useCallback((t: PaneTransform, userAction = false) => {
    if (userAction) fitMode.current = false;
    setSpeciesTState(t);
  }, []);
  const setGeneT = useCallback((t: PaneTransform, userAction = false) => {
    if (userAction) fitMode.current = false;
    setGeneTState(t);
  }, []);

  const fitBoth = useCallback(() => {
    fitMode.current = true;
    if (!speciesLayout) return;
    const sb = reconPaneBounds(project, speciesLayout, options, 'species');
    const s1 = fitTransformFor(sb, Math.max(1, speciesBox.w), Math.max(1, speciesBox.h));
    let sScale = s1.scale;
    let sT = s1;
    let gT: PaneTransform | null = null;
    if (geneLayout && entry) {
      const gb = reconPaneBounds(entry.doc, geneLayout, options, 'gene');
      const f2 = fitTransformFor(gb, Math.max(1, geneBox.w), Math.max(1, geneBox.h));
      if (options.syncZoom) {
        // Shared scale = the SMALLER of the two fits, so neither side overflows.
        sScale = Math.min(s1.scale, f2.scale);
        sT = { ...s1, scale: sScale };
        gT = { ...f2, scale: sScale };
      } else {
        gT = f2;
      }
    }
    setSpeciesTState(sT);
    if (gT) setGeneTState(gT);
  }, [project, entry, speciesLayout, geneLayout, options, speciesBox.w, speciesBox.h, geneBox.w, geneBox.h]);

  const resetBoth = useCallback(() => {
    fitMode.current = false;
    const reset = (bounds: ReturnType<typeof reconPaneBounds> | null, box: { w: number; h: number }): PaneTransform => {
      if (!bounds) return { ...IDENTITY };
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      return { scale: 1, tx: box.w / 2 - cx, ty: box.h / 2 - cy };
    };
    setSpeciesTState(reset(reconPaneBounds(project, speciesLayout, options, 'species'), speciesBox));
    if (entry && geneLayout) setGeneTState(reset(reconPaneBounds(entry.doc, geneLayout, options, 'gene'), geneBox));
  }, [project, entry, speciesLayout, geneLayout, options, speciesBox, geneBox]);

  // Sync zoom: a manual zoom on one pane mirrors its SCALE to the other (pan
  // stays independent) so the two trees stay size-comparable (§5.6.4).
  const speciesTransform = useCallback(
    (t: PaneTransform, userAction: boolean) => {
      if (userAction && options.syncZoom && Math.abs(t.scale - speciesT.scale) > 1e-9) {
        const k = t.scale / speciesT.scale;
        const gScale = Math.max(0.15, Math.min(4, geneT.scale * k));
        setGeneTState((g: PaneTransform) => {
          const cx = geneBox.w / 2;
          const cy = geneBox.h / 2;
          const kk = gScale / g.scale;
          return { scale: gScale, tx: cx - (cx - g.tx) * kk, ty: cy - (cy - g.ty) * kk };
        });
      }
      setSpeciesT(t, userAction);
    },
    [options.syncZoom, speciesT.scale, geneT, geneBox.w, geneBox.h, setSpeciesT],
  );
  const geneTransform = useCallback(
    (t: PaneTransform, userAction: boolean) => {
      if (userAction && options.syncZoom && Math.abs(t.scale - geneT.scale) > 1e-9) {
        const k = t.scale / geneT.scale;
        const sScale = Math.max(0.15, Math.min(4, speciesT.scale * k));
        setSpeciesTState((sp: PaneTransform) => {
          const cx = speciesBox.w / 2;
          const cy = speciesBox.h / 2;
          const kk = sScale / sp.scale;
          return { scale: sScale, tx: cx - (cx - sp.tx) * kk, ty: cy - (cy - sp.ty) * kk };
        });
      }
      setGeneT(t, userAction);
    },
    [options.syncZoom, geneT.scale, speciesT, speciesBox.w, speciesBox.h, setGeneT],
  );

  // Fit once per document / gene-tree switch, after first paint.
  useEffect(() => {
    const t = requestAnimationFrame(() => fitBoth());
    return () => cancelAnimationFrame(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, entry?.id]);

  // Zoom readouts for the workspace status bar (only on real scale changes).
  useEffect(() => {
    onZoomChange?.(speciesT.scale, geneT.scale);
  }, [speciesT.scale, geneT.scale, onZoomChange]);

  // Resize (window drag, panel drag): re-fit while in fit mode, otherwise only
  // clamp so the tree can never be lost entirely (§5.6.4).
  useEffect(() => {
    if (hostSize.w <= 0 || hostSize.h <= 0) return;
    if (fitMode.current) {
      const t = requestAnimationFrame(() => fitBoth());
      return () => cancelAnimationFrame(t);
    }
    setSpeciesTState((t: PaneTransform) => clampTransform(t, reconPaneBounds(project, speciesLayout, options, 'species'), speciesBox.w, speciesBox.h));
    if (entry && geneLayout) {
      setGeneTState((t: PaneTransform) => clampTransform(t, reconPaneBounds(entry.doc, geneLayout, options, 'gene'), geneBox.w, geneBox.h));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostSize.w, hostSize.h, speciesBox.w, speciesBox.h, geneBox.w, geneBox.h]);

  // ⌘⇧F (global) reaches the recon canvas through this event.
  useEffect(() => {
    const onFitEvt = () => fitBoth();
    window.addEventListener('cladeforge:recon-fit', onFitEvt);
    return () => window.removeEventListener('cladeforge:recon-fit', onFitEvt);
  }, [fitBoth]);

  // Escape leaves the reconciliation workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === 'Escape') setReconMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setReconMode]);

  // Left-panel "locate": centre the gene pane on the requested node (and the
  // species pane on its mapping target when one exists).
  const focusSeq = focusTarget?.seq ?? 0;
  const lastFocusSeq = useRef(0);
  useEffect(() => {
    if (!focusTarget || focusSeq === lastFocusSeq.current || !entry || !geneLayout) return;
    lastFocusSeq.current = focusSeq;
    const p = geneLayout.positions.get(focusTarget.id);
    if (!p) return;
    const s = geneT.scale;
    setGeneTState({
      scale: s,
      tx: geneBox.w / 2 - p.x * s,
      ty: geneBox.h / 2 - p.y * s,
    });
    fitMode.current = false;
    const target = entry.assumptions[focusTarget.id]?.speciesNode;
    if (target && speciesLayout) {
      const sp = speciesLayout.positions.get(target);
      if (sp) {
        const ss = speciesT.scale;
        setSpeciesTState({
          scale: ss,
          tx: speciesBox.w / 2 - sp.x * ss,
          ty: speciesBox.h / 2 - sp.y * ss,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq]);

  // --- derived display metadata ----------------------------------------------
  // The panel, inspector and status bar share this cached row set; the summary
  // and the label-matched tip mappings are reused below instead of running
  // scenarioSummary/mapTipsByLabel a second and third time per edit.
  const activeRow = useMemo(
    () => geneTreeRows(project).find((r) => r.id === activeGeneTreeId) ?? null,
    [project, activeGeneTreeId],
  );
  const geneSelectionSet = useMemo(() => new Set(geneSelection), [geneSelection]);

  const geneMeta = useMemo(() => {
    const map = new Map<NodeId, PaneNodeMeta>();
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
        fill: style ? style.color : 'var(--recon-tip)',
        glyph: internal && a ? style?.glyph : undefined,
        dashedRed: internal && (!a || !a.event),
        selected: geneSelectionSet.has(n.id),
        hovered: hoveredGeneId === n.id,
        losses: a?.losses,
      });
    }
    return map;
  }, [entry, geneSelectionSet, hoveredGeneId]);

  // Mapping lines (pure) + per-pane stubs + species-side highlights.
  // Tip mappings come from LABEL matching even where no explicit assumption
  // exists — they are the anchors of the reconciliation (§5.6.2), so the
  // default tips-only view must show them, not just the hand/DP-written rows.
  const mappingAssumptions = useMemo(() => {
    if (!entry || !activeRow) return {} as Record<NodeId, GeneNodeAssumption>;
    const merged: Record<NodeId, GeneNodeAssumption> = { ...entry.assumptions };
    for (const [gid, target] of Object.entries(activeRow.tipMappings)) {
      if (target && !merged[gid]) merged[gid] = { speciesNode: target };
    }
    return merged;
  }, [entry, activeRow]);

  // The rules (filter / emphasis / bundling) run once per document/view-option
  // or hover change; pan/zoom only re-runs the pure projection below.
  const mappingAnchors = useMemo(() => {
    if (!entry || !geneLayout) return [];
    return collectMappingAnchors({
      speciesDoc: project,
      geneDoc: entry.doc,
      assumptions: mappingAssumptions,
      speciesLayout,
      geneLayout,
      options,
      selectedGeneIds: geneSelection,
      hoveredGeneId,
    });
  }, [entry, geneLayout, project, speciesLayout, mappingAssumptions, options, geneSelection, hoveredGeneId]);

  const mappingLines = useMemo(
    () => projectMappingAnchors(mappingAnchors, speciesPane, genePane),
    [mappingAnchors, speciesPane, genePane],
  );

  const speciesStubs = useMemo(() => stubsFromLines(mappingAnchors, 'species'), [mappingAnchors]);
  const geneStubs = useMemo(() => stubsFromLines(mappingAnchors, 'gene'), [mappingAnchors]);

  const speciesMeta = useMemo(() => {
    const map = new Map<NodeId, PaneNodeMeta>();
    for (const id of speciesSelection) map.set(id, { fill: 'var(--recon-tip)', selected: true });
    for (const id of speciesStubs) {
      if (id.emphasized && !map.has(id.nodeId)) {
        map.set(id.nodeId, { fill: 'var(--recon-tip)', hovered: true });
      }
    }
    return map;
  }, [speciesSelection, speciesStubs]);

  const speciesNodeCount = Object.keys(project.nodes).length;
  const geneNodeCount = entry ? Object.keys(entry.doc.nodes).length : 0;

  // --- interactions -----------------------------------------------------------
  // Stable callbacks: the memoised pane rows receive these as props, so they
  // must not change identity on hover/selection re-renders. Dynamic state is
  // read from the store at call time instead of being closed over.
  const assignSelectedToSpecies = useCallback((speciesNodeId: NodeId) => {
    const st = useStore.getState();
    const entryId = st.activeGeneTreeId;
    const gid = st.geneSelection[0];
    if (!entryId) return;
    if (st.geneSelection.length !== 1) {
      // R-15: Alt+click with no selected gene node must not fail silently.
      notify.info(S.recon.mapSelectedHereNeedGene);
      return;
    }
    st.apply((d) => {
      const g = d.geneTrees?.find((x) => x.id === entryId);
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
  }, []);

  const onSpeciesNodeClick = useCallback(
    (id: NodeId, e: React.MouseEvent) => {
      if (e.altKey) {
        e.stopPropagation();
        assignSelectedToSpecies(id);
        return;
      }
      // One active selection system at a time: a species click retires the gene
      // selection so the inspector's four states switch cleanly (§5.4).
      const st = useStore.getState();
      st.select(id);
      st.clearGeneSelection();
    },
    [assignSelectedToSpecies],
  );

  const onGeneNodeClick = useCallback((id: NodeId, e: React.MouseEvent) => {
    const st = useStore.getState();
    st.selectGeneNode(id, e.shiftKey || e.metaKey);
    if (st.selection.length > 0) st.clearSelection();
  }, []);

  // The active row's cached summary replaces the per-render scenarioSummary.
  const summary = activeRow?.summary ?? null;

  // Screen-reader announcement of selection changes (§5.6.8).
  const announcement = useMemo(() => {
    if (geneSelection.length === 1 && entry) {
      const n = entry.doc.nodes[geneSelection[0]];
      const a = entry.assumptions[geneSelection[0]];
      const label = n?.label || geneSelection[0].slice(0, 6);
      const targetLabel = a ? project.nodes[a.speciesNode]?.label || '' : S.recon.tipUnmapped;
      const eventLabel =
        a?.event === 'speciation'
          ? S.recon.legendSigma
          : a?.event === 'duplication'
            ? S.recon.legendDup
            : a?.event === 'transfer'
              ? S.recon.legendTransfer
              : '';
      return S.recon.ariaGeneNode(label, targetLabel, eventLabel, a?.losses ?? 0);
    }
    if (geneSelection.length > 1) return S.recon.multiTitle(geneSelection.length);
    return '';
  }, [geneSelection, entry, project]);

  // --- empty state (no gene tree) ---------------------------------------------
  if (!entry || !geneLayout) {
    return (
      <div className="recon-empty-stage">
        <div className="recon-empty-card">
          <div className="recon-empty-title">{S.recon.emptyReconTitle}</div>
          <div className="hint">{S.recon.emptyReconHint}</div>
          <div className="recon-empty-actions">
            <button className="btn primary" onClick={onBuildGeneTree}>
              {S.recon.emptyBuild}
            </button>
            <button className="btn" onClick={onCopySpeciesTree}>
              {S.recon.emptyCopy}
            </button>
            <button className="btn" onClick={() => void file.actionImportGeneTree()}>
              {S.recon.emptyImport}
            </button>
            <button
              className="btn"
              title={S.recon.loadReconSampleTitle}
              onClick={() => openSample(SAMPLE_PROJECTS.find((d) => d.id === 'recon-family')!)}
            >
              {S.recon.loadReconSample}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hasAssumptions = Object.keys(entry.assumptions).length > 0;

  return (
    <div className="recon-canvas">
      {!hasAssumptions && !bannerClosed && (
        <div className="recon-banner" role="status">
          <span>{S.recon.unmappedBanner}</span>
          <button
            className="btn icon tiny"
            aria-label={S.tabs.close}
            onClick={() => setBannerClosed(true)}
          >
            <Cross1Icon />
          </button>
        </div>
      )}
      <div className="recon-panes" ref={panesRef} style={{ ['--recon-bridge-w' as string]: `${bridge}px` }}>
        <ReconPane
          doc={project}
          layout={speciesLayout}
          transform={speciesT}
          onTransform={speciesTransform}
          onSizeChange={onSpeciesSize}
          onFit={fitBoth}
          onResetZoom={resetBoth}
          title={S.recon.paneSpecies}
          subtitle={S.recon.analysisCladogram}
          nodeCount={speciesNodeCount}
          zoomPercent={Math.round(speciesT.scale * 100)}
          nodeMeta={speciesMeta}
          stubs={speciesStubs}
          side="species"
          ariaLabel={S.recon.ariaSpeciesPane}
          options={options}
          onNodeClick={onSpeciesNodeClick}
        />
        <div className="recon-bridge" aria-hidden="true">
          <span className="recon-bridge-count">
            {S.recon.mapCount(mappingLines.reduce((n, l) => n + l.bundleCount, 0))}
          </span>
        </div>
        <ReconPane
          doc={entry.doc}
          layout={geneLayout}
          transform={geneT}
          onTransform={geneTransform}
          onSizeChange={onGeneSize}
          onFit={fitBoth}
          onResetZoom={resetBoth}
          title={S.recon.paneGene}
          subtitle={`${entry.name} · ${summary ? `${summary.mappedInternal}/${summary.totalInternal}` : ''}`}
          badge={S.recon.readonlyPane}
          badgeTone="readonly"
          nodeCount={geneNodeCount}
          zoomPercent={Math.round(geneT.scale * 100)}
          nodeMeta={geneMeta}
          stubs={geneStubs}
          side="gene"
          ariaLabel={S.recon.ariaGenePane}
          options={options}
          onNodeClick={onGeneNodeClick}
          onNodeHover={setReconHoverGene}
        />
        <ReconMappingLayer
          lines={mappingLines}
          width={hostSize.w}
          height={hostSize.h}
          showSelectedLabels
        />
      </div>
      {/* Legend: a layout row, never an overlay — the colour language of the
          mapping lines must be readable without guessing (§5.6.2). */}
      <div className="recon-legend" aria-label={S.recon.legendTitle}>
        <span className="legend-item"><span className="legend-swatch sw-sigma" />{S.recon.legendSigma}</span>
        <span className="legend-item"><span className="legend-swatch sw-dup" />{S.recon.legendDup}</span>
        <span className="legend-item"><span className="legend-swatch sw-transfer" />{S.recon.legendTransfer}</span>
        <span className="legend-item"><span className="legend-swatch sw-unresolved" />{S.recon.legendUnresolved}</span>
        <span className="legend-item"><span className="legend-swatch sw-tip" />{S.recon.legendTipLine}</span>
        <span className="legend-item"><span className="legend-swatch sw-internal" />{S.recon.legendInternalLine}</span>
        <span className="legend-item"><span className="legend-swatch sw-loss" />{S.recon.legendLoss}</span>
      </div>
      <div className="visually-hidden" aria-live="polite">{announcement}</div>
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
