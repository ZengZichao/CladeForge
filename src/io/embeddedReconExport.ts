// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// SVG export for the EMBEDDED reconciliation view (plan §8).
//
// The exporter reuses `computeEmbeddedReconLayout` — the SAME scene the canvas
// paints — and serialises it to a standalone .svg string: tubes/hubs, the
// masked gene lineages, transfer arcs, loss stubs, labels, an optional legend
// and version/timestamp metadata. Colours are resolved to concrete hex values
// (a standalone file cannot rely on the app's CSS variables), using the same
// palette the light/dark themes define.

import type { GeneTreeEntry, Project, ReconViewOptions } from '../model/types';
import { APP_VERSION } from '../model/types';
import { computeLayout } from '../layout/autoLayout';
import {
  computeEmbeddedReconLayout,
  defaultEmbeddedLayoutOptions,
  prepareEmbeddedSpeciesDoc,
} from '../layout/embeddedRecon';

export interface EmbeddedExportOptions {
  includeLegend?: boolean;
  includeMetadata?: boolean;
  background?: string;
  marginPx?: number;
  /** Resolve colours from the dark palette instead of the light one. */
  dark?: boolean;
}

export interface EmbeddedExportResult {
  svg: string;
  width: number;
  height: number;
}

/** The theme palettes, mirrored from src/styles/app.css (light + dark). */
const PALETTES = {
  light: {
    background: '#ffffff',
    text: '#18181b',
    tube: '#e4e4e7',
    tubeBorder: '#a1a1aa',
    nodeFill: '#ffffff',
    nodeStroke: '#18181b',
    tip: '#0d9488',
    sigma: '#0e9f6e',
    dup: '#2563eb',
    transfer: '#ec4899',
    unresolved: '#71717a',
    loss: '#78716c',
    select: '#18181b',
    unmapped: '#71717a',
  },
  dark: {
    background: '#1c1c1f',
    text: '#e4e4e7',
    tube: '#3f3f46',
    tubeBorder: '#71717a',
    nodeFill: '#1c1c1f',
    nodeStroke: '#e4e4e7',
    tip: '#2dd4bf',
    sigma: '#34d399',
    dup: '#60a5fa',
    transfer: '#f472b6',
    unresolved: '#a1a1aa',
    loss: '#a1a1aa',
    select: '#f4f4f5',
    unmapped: '#a1a1aa',
  },
} as const;

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FONT = `system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`;

type Palette = (typeof PALETTES)[keyof typeof PALETTES];

function eventColor(palette: Palette, event: string | null, kind: 'tip' | 'internal'): string {
  if (event === 'speciation') return palette.sigma;
  if (event === 'duplication') return palette.dup;
  if (event === 'transfer') return palette.transfer;
  return kind === 'tip' ? palette.tip : palette.unresolved;
}

/**
 * Build a standalone SVG of the embedded reconciliation figure for ONE gene
 * tree. Shares the canvas geometry by construction (same layout call), so a
 * figure exported for a hypothesis document matches what the user authored.
 */
export function buildEmbeddedReconSVG(
  project: Project,
  entry: GeneTreeEntry,
  viewOptions: ReconViewOptions,
  exportOptions: EmbeddedExportOptions = {},
): EmbeddedExportResult {
  const palette = exportOptions.dark ? PALETTES.dark : PALETTES.light;
  const margin = exportOptions.marginPx ?? 24;
  const speciesLayout = computeLayout(prepareEmbeddedSpeciesDoc(project));
  const scene = computeEmbeddedReconLayout({
    speciesDoc: project,
    speciesLayout,
    geneDoc: entry.doc,
    assumptions: entry.assumptions,
    options: defaultEmbeddedLayoutOptions(
      Math.max(10, Math.min(32, viewOptions.embeddedTubeWidth)),
      Math.max(1.5, Math.min(6, viewOptions.embeddedLaneGap)),
    ),
  });

  const includeLegend = exportOptions.includeLegend ?? true;
  const legendRows = includeLegend
    ? [
        [palette.tube, '物种枝管道 / species branch tube'],
        [palette.tip, '基因谱系（末端）/ gene lineage (tip)'],
        [palette.sigma, '物种形成 σ / speciation'],
        [palette.dup, '基因重复 δ / duplication'],
        [palette.transfer, '水平转移 τ / transfer（虚线 = 时间不可行/拓扑转移）'],
        [palette.loss, '基因丢失 λ / loss（空心 = 推断结构丢失）'],
        [palette.unresolved, '显示推断·未解析（虚线，未写入假设）/ display-inferred'],
      ]
    : [];

  const b = scene.bounds;
  const legendH = legendRows.length > 0 ? legendRows.length * 16 + 26 : 0;
  const width = Math.max(1, Math.ceil(b.maxX - b.minX)) + margin * 2;
  const height = Math.ceil(b.maxY - b.minY) + margin * 2 + legendH;
  const ox = margin - b.minX;
  const oy = margin - b.minY;
  const maskId = 'er-export-mask';

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`,
  );
  if (exportOptions.includeMetadata !== false) {
    out.push(
      `<metadata>CladeForge ${APP_VERSION} · embedded reconciliation · ${escXml(entry.name)} · ${new Date().toISOString()}</metadata>`,
    );
  }
  out.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${exportOptions.background ?? palette.background}" />`);
  out.push(`<g transform="translate(${ox},${oy})">`);

  // --- mask ------------------------------------------------------------------
  out.push(`<defs><mask id="${maskId}" maskUnits="userSpaceOnUse" x="${b.minX - 400}" y="${b.minY - 400}" width="${b.maxX - b.minX + 800}" height="${b.maxY - b.minY + 800}">`);
  out.push(`<rect x="${b.minX - 400}" y="${b.minY - 400}" width="${b.maxX - b.minX + 800}" height="${b.maxY - b.minY + 800}" fill="black" />`);
  for (const t of scene.tubes.values()) {
    out.push(`<path d="${t.path}" fill="none" stroke="white" stroke-width="${t.width}" stroke-linecap="round" />`);
  }
  for (const h of scene.hubs.values()) {
    out.push(`<path d="${h.path}" fill="none" stroke="white" stroke-width="${h.width}" stroke-linecap="round" />`);
    out.push(`<circle cx="${h.x}" cy="${h.y}" r="${h.nodeRadius}" fill="white" />`);
  }
  out.push(`</mask></defs>`);

  // --- species skeleton --------------------------------------------------------
  for (const t of scene.tubes.values()) {
    out.push(`<path d="${t.path}" fill="none" stroke="${palette.tubeBorder}" stroke-width="${t.width + 2}" stroke-linecap="round" />`);
    out.push(`<path d="${t.path}" fill="none" stroke="${palette.tube}" stroke-width="${t.width}" stroke-linecap="round" />`);
  }
  for (const h of scene.hubs.values()) {
    out.push(`<path d="${h.path}" fill="none" stroke="${palette.tube}" stroke-width="${h.width}" stroke-linecap="round" />`);
  }
  for (const id of scene.speciesLayout.visible) {
    const n = project.nodes[id];
    const p = scene.speciesLayout.positions.get(id);
    if (!n || !p) continue;
    const isTip = n.childrenIds.length === 0;
    out.push(
      `<circle cx="${p.x}" cy="${p.y}" r="${isTip ? 4.5 : 5.5}" fill="${palette.nodeFill}" stroke="${palette.nodeStroke}" stroke-width="1.5" />`,
    );
    if (n.label) {
      out.push(
        `<text x="${isTip ? p.x + 9 : p.x - 9}" y="${p.y + 4}" text-anchor="${isTip ? 'start' : 'end'}" font-size="${isTip ? 11.5 : 10.5}" fill="${palette.text}"${isTip ? '' : ' opacity="0.65"'}>${escXml(n.label)}</text>`,
      );
    }
  }

  // --- gene segments (masked) ---------------------------------------------------
  out.push(`<g mask="url(#${maskId})">`);
  for (const s of scene.segments) {
    out.push(
      `<path d="${s.d}" fill="none" stroke="${eventColor(palette, s.event, s.kind)}" stroke-width="${s.dashed ? 1.1 : 1.25}"${s.dashed ? ' stroke-dasharray="4 3"' : ''} stroke-linecap="round" opacity="0.92" />`,
    );
  }
  out.push(`</g>`);

  // --- transfer arcs --------------------------------------------------------------
  if (viewOptions.embeddedShowTransfers) {
    for (const arc of scene.transfers) {
      const c2y = arc.to.y + (arc.to.y >= arc.from.y ? 12 : -12);
      const ang = Math.atan2(arc.to.y - c2y, arc.to.x - (arc.from.x + arc.to.x) / 2);
      const L = 9;
      const p1 = `${arc.to.x},${arc.to.y}`;
      const p2 = `${arc.to.x - L * Math.cos(ang - 0.5)},${arc.to.y - L * Math.sin(ang - 0.5)}`;
      const p3 = `${arc.to.x - L * Math.cos(ang + 0.5)},${arc.to.y - L * Math.sin(ang + 0.5)}`;
      out.push(
        `<path d="${arc.d}" fill="none" stroke="${palette.transfer}" stroke-width="1.5"${arc.timeFeasible === false ? ' stroke-dasharray="5 4"' : ''} stroke-linecap="round" />`,
      );
      out.push(`<polygon points="${p1} ${p2} ${p3}" fill="${palette.transfer}" />`);
    }
  }

  // --- gene nodes + labels --------------------------------------------------------
  for (const p of scene.placements.values()) {
    if (p.unmapped) continue;
    const n = entry.doc.nodes[p.geneNodeId];
    const r = p.kind === 'tip' ? 2.6 : 3.2;
    const inferredish = p.inferred || p.unresolved;
    out.push(
      `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${inferredish ? palette.nodeFill : eventColor(palette, p.event, p.kind)}" stroke="${inferredish ? palette.unresolved : palette.nodeStroke}" stroke-width="1.2"${inferredish ? ' stroke-dasharray="2 1.6"' : ''} />`,
    );
    if (p.event) {
      const glyph = p.event === 'speciation' ? 'σ' : p.event === 'duplication' ? 'δ' : 'τ';
      out.push(
        `<text x="${p.x}" y="${p.y - r - 5}" text-anchor="middle" font-size="11" font-weight="700" fill="${eventColor(palette, p.event, p.kind)}">${glyph}</text>`,
      );
    }
    if (n?.label && (p.kind === 'tip' || p.inferred)) {
      out.push(
        `<text x="${p.x}" y="${p.y - r - 3.5}" text-anchor="middle" font-size="9.5" fill="${palette.text}" stroke="${palette.background}" stroke-width="2" paint-order="stroke">${escXml(n.label)}</text>`,
      );
    }
  }

  // --- losses ------------------------------------------------------------------------
  if (viewOptions.embeddedShowLossStubs) {
    const seen = new Map<string, number>();
    for (const l of scene.losses) {
      const key = `${Math.round(l.x)},${Math.round(l.y)}`;
      const idx = seen.get(key) ?? 0;
      seen.set(key, idx + 1);
      const x = l.x + idx * 7;
      out.push(
        `<line x1="${x}" y1="${l.y}" x2="${x}" y2="${l.y - 9}" stroke="${palette.loss}" stroke-width="1.6" stroke-linecap="round"${l.inferred ? ' stroke-dasharray="2 2"' : ''} />`,
      );
      out.push(
        `<circle cx="${x}" cy="${l.y - 10}" r="${l.inferred ? 1.4 : 1.8}" fill="${l.inferred ? palette.background : palette.loss}" stroke="${palette.loss}" stroke-width="1" />`,
      );
      out.push(`<text x="${x + 3}" y="${l.y - 11}" font-size="9" fill="${palette.loss}">${l.shortfall ? 'λ!' : `λ${l.count}`}</text>`);
    }
  }

  // --- orphans --------------------------------------------------------------------------
  for (const o of scene.orphans) {
    const n = entry.doc.nodes[o.geneNodeId];
    const parent = o.parentGeneNodeId ? scene.placements.get(o.parentGeneNodeId) : undefined;
    if (parent && !parent.unmapped) {
      out.push(
        `<line x1="${parent.x}" y1="${parent.y}" x2="${o.x}" y2="${o.y}" stroke="${palette.unmapped}" stroke-width="1" stroke-dasharray="3 3" opacity="0.6" />`,
      );
    }
    out.push(
      `<circle cx="${o.x}" cy="${o.y}" r="3" fill="${palette.nodeFill}" stroke="${palette.unmapped}" stroke-width="1.2" stroke-dasharray="2 1.6" />`,
    );
    out.push(
      `<text x="${o.x + 7}" y="${o.y + 3.5}" font-size="9.5" fill="${palette.unmapped}">${escXml(n?.label || o.geneNodeId.slice(0, 6))}</text>`,
    );
  }

  out.push(`</g>`);

  // --- legend ---------------------------------------------------------------------------
  if (legendRows.length > 0) {
    const ly = height - legendH + 10;
    out.push(`<g transform="translate(${margin},${ly})">`);
    legendRows.forEach(([color, label], i) => {
      const y = i * 16;
      out.push(`<rect x="0" y="${y - 4}" width="16" height="4" rx="2" fill="${color}" />`);
      out.push(`<text x="24" y="${y}" font-size="10" fill="${palette.text}">${escXml(label)}</text>`);
    });
    out.push(`</g>`);
  }

  out.push(`</svg>`);
  return { svg: out.join('\n'), width, height };
}
