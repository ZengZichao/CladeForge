// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
import { describe, it, expect } from 'vitest';
import { buildSVG, exportSVGString } from './exportImage';
import { createSampleProject } from '../model/sampleTree';
import { serializeProject, parseProject } from './projectIO';
import { parseNewick } from './newick';
import { computeLayout } from '../layout/autoLayout';
import { EVENT_BADGE_RADIUS } from '../model/events';
import {
  planEventAnchors,
  planLabelNudges,
  timeAxisTextBoxes,
} from '../canvas/eventBadgeLayout';
import type { LayoutType, Project } from '../model/types';

describe('exportImage', () => {
  it('builds a self-contained SVG with positive dimensions', () => {
    const p = createSampleProject();
    const { svg, width, height } = buildSVG(p);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('renders taxon labels into the SVG', () => {
    const svg = exportSVGString(createSampleProject());
    expect(svg).toContain('Pakicetus');
    expect(svg).toContain('Pelagiceti');
  });

  it('adds character colouring, legend and event badges under export options', () => {
    const p = createSampleProject();
    const svg = exportSVGString(p, {
      activeCharacterId: p.characters[0].id,
      showEvents: true,
      showTransitions: true,
    });
    expect(svg).toContain('性状：栖息地'); // legend title
    expect(svg).toContain('#9ca3af'); // 陆生 state colour used as a node fill
    expect(svg).toContain('关键创新'); // event type appears in the legend
  });

  it('marks exported event badges with ASCII codes, never pictographs', () => {
    // Badges carry ASCII codes, never pictographs: nothing in this pipeline
    // embeds an emoji font, so an emoji would draw a missing-glyph box exactly
    // where the canvas drew a picture — the code has to survive as text.
    const p = createSampleProject();
    const svg = exportSVGString(p, { showEvents: true });
    expect(svg).toContain('>KI<'); // key innovation on the branch
    expect(svg).toContain('>AR<'); // adaptive radiation
    expect(svg).toContain('font-weight="700"');
    expect(svg.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE0F}]/gu)).toBeNull();
  });
});

// --- attribute escaping -------------------------------------
// Every colour and width in the scene reaches the SVG by string interpolation,
// and `escXml` was applied to element TEXT only. A project file whose canvas
// background was `red" onload="alert(1)` therefore closed the `fill` attribute
// early and added an event-handler attribute to the emitted `<rect>` — the
// exported SVG then runs that script in whatever renders it, and the Tauri shell
// renders exported previews in its own webview. Non-numeric widths did the
// quieter damage: `stroke-width="NaN"` is invalid, so the branch vanished.

describe('exportImage — user-authored colours cannot escape their attribute', () => {
  it('neutralises a payload in the canvas background', () => {
    const p = createSampleProject();
    p.canvas.background = 'red" onload="alert(1)';
    const svg = exportSVGString(p);
    expect(svg).not.toContain('onload');
    expect(svg).not.toContain('alert(1)');
    // The background still has to be painted — with the fallback, not the payload.
    expect(svg).toContain('fill="#ffffff"');
  });

  it('neutralises payloads in state, branch and event colours', () => {
    const p = createSampleProject();
    p.characters[0].states[0].color = '#000" onmouseover="fetch(1)';
    const svg = exportSVGString(p, {
      activeCharacterId: p.characters[0].id,
      showEvents: true,
      showTransitions: true,
    });
    expect(svg).not.toContain('onmouseover');
    expect(svg).not.toContain('fetch(1)');
  });

  it('never emits NaN or Infinity into a numeric attribute', () => {
    const p = createSampleProject();
    for (const id of Object.keys(p.nodes)) {
      const bs = p.nodes[id].branchStyle;
      if (bs) bs.width = Number.NaN;
    }
    const svg = exportSVGString(p);
    expect(svg).not.toMatch(/="NaN"/);
    expect(svg).not.toMatch(/="Infinity"/);
  });
});

// --- the legend must be inside the figure -------------------
// The legend is laid out from the left edge with no wrap and, until now, no
// measurement at all, while the canvas was sized from the TREE only. A long
// caption therefore fell outside the viewBox and was cropped from SVG, PNG and
// PDF alike — which also silently voids the paper's claim that every export
// carries an auto-generated legend.

describe('exportImage — the auto-generated legend is inside the viewBox', () => {
  const LONG_STATE = 'Semi-aquatic-intermediate-locomotion-hypothesis-state';

  function legendRightEdges(svg: string) {
    const m = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
    expect(m, 'the SVG declares a viewBox').not.toBeNull();
    const [minX, , w] = [Number(m![1]), Number(m![2]), Number(m![3])];
    const right = minX + w;
    // Legend rows are the <text> elements with font-size 12; the figure's origin
    // is negative, so every coordinate here must be allowed a leading minus.
    const rows = [
      ...svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)" font-size="12"[^>]*>([^<]+)<\/text>/g),
    ];
    expect(rows.length, 'the legend drew some rows').toBeGreaterThan(0);
    return rows.map(([, x, , label]) => {
      // Independent estimate: 0.6 em per character, not the 0.62 the app assumes.
      return Number(x) + label.length * 12 * 0.6 - right;
    });
  }

  it('widens the canvas for a long state label', () => {
    const p = createSampleProject();
    p.characters[0].states[1].label = LONG_STATE;
    const svg = exportSVGString(p, { activeCharacterId: p.characters[0].id });
    const over = legendRightEdges(svg);
    expect(Math.max(...over)).toBeLessThanOrEqual(0);
  });

  it('keeps the shipped event legend inside the figure', () => {
    const p = createSampleProject();
    const svg = exportSVGString(p, { activeCharacterId: p.characters[0].id, showEvents: true });
    const over = legendRightEdges(svg);
    expect(Math.max(...over)).toBeLessThanOrEqual(0);
  });

  it('grows the canvas as the legend grows, not just the tree', () => {    // The direct proof that the legend is now part of the geometry: the same
    // tree, two caption lengths. Before this fix the viewBox was derived from the
    // tree alone, so both widths came out identical and the long caption was cut.
    const widthOf = (label: string) => {
      const p = createSampleProject();
      p.characters[0].states[1].label = label;
      const { svg, width } = buildSVG(p, { activeCharacterId: p.characters[0].id });
      expect(svg).toContain(label.slice(0, 12));
      return width;
    };
    const short = widthOf('Semi');
    const long = widthOf('S'.repeat(160));
    expect(long).toBeGreaterThan(short + 100);
  });
});

// --- label cropping ------------------------------------------------
// A fixed margin around the NODE COORDINATES alone cannot cover a long taxon name
// running past the outermost node: it would fall outside the viewBox and be
// cropped — in SVG, PNG and PDF alike, because both raster formats are derived
// from this same string. `toContain('Pakicetus')` (above) cannot see a crop, so
// these tests measure the emitted label against the emitted viewBox.

const LONG = 'Ambulocetusnatanslonggenericepithetonfortestingcropping';

function treeWithLongLabel(orientation: 'LR' | 'RL'): Project {
  const p = parseNewick(`((${LONG},ShortLabel),(Third,Fourth));`, 'crop');
  p.layout.orientation = orientation;
  return p;
}

/** The figure's user-space box: [minX, minY, width, height]. */
function viewBoxOf(svg: string): [number, number, number, number] {
  const m = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
  expect(m, 'the SVG declares a viewBox').not.toBeNull();
  return [Number(m![1]), Number(m![2]), Number(m![3]), Number(m![4])];
}

/** The emitted <text> of one label: its anchor point and font size. */
function labelBox(svg: string, label: string) {
  const m = svg.match(
    new RegExp(
      `<text x="(-?[\\d.]+)" y="(-?[\\d.]+)" text-anchor="(start|middle|end)"[^>]*font-size="([\\d.]+)"[^>]*>${label}</text>`,
    ),
  );
  expect(m, `the label ${label} is drawn`).not.toBeNull();
  const [, x, , anchor, size] = m!;
  // An independent glyph estimate: ~0.6 em per character for this font stack. The
  // export assumes 0.65; 0.6 keeps this test from agreeing with its own subject.
  const width = label.length * Number(size) * 0.6;
  const px = Number(x);
  const left = anchor === 'end' ? px - width : anchor === 'middle' ? px - width / 2 : px;
  return { left, right: left + width, anchor: anchor as string, x: px, fontSize: Number(size) };
}

describe('exportImage — long labels are inside the figure', () => {
  it('LR: the name overhangs the node coordinates, and the canvas grew to fit it', () => {
    const p = treeWithLongLabel('LR');
    const { svg, width } = buildSVG(p);
    const [minX, , w] = viewBoxOf(svg);
    expect(w).toBeCloseTo(width, 6);
    const label = labelBox(svg, LONG);
    const rightEdge = minX + w;
    // The fixed-margin reference box: bounds.maxX + 48.
    const oldRightEdge = computeLayout(p).bounds.maxX + 48;
    expect(label.right).toBeGreaterThan(oldRightEdge); // i.e. the overhang is real
    expect(label.right).toBeLessThanOrEqual(rightEdge); // …and this one is inside
    expect(rightEdge - label.right).toBeGreaterThanOrEqual(10); // breathing room
  });

  it('RL: the leftward overhang is inside the viewBox too', () => {
    const p = treeWithLongLabel('RL');
    const { svg } = buildSVG(p);
    const [minX, , w] = viewBoxOf(svg);
    const label = labelBox(svg, LONG);
    const leftEdge = minX;
    const oldLeftEdge = computeLayout(p).bounds.minX - 48;
    expect(label.left).toBeLessThan(oldLeftEdge); // the overhang is real
    expect(label.left).toBeGreaterThanOrEqual(leftEdge);
    expect(label.right).toBeLessThanOrEqual(leftEdge + w);
  });

  it('the short sibling label does not blow up the canvas on its own', () => {
    const p = treeWithLongLabel('LR');
    const withLong = buildSVG(p).svg;
    const bounds = computeLayout(p).bounds;
    const [, , w] = viewBoxOf(withLong);
    // Width is the node span plus the pad on both sides plus what the labels need.
    expect(w).toBeGreaterThan(bounds.maxX - bounds.minX);
  });

  it('a rotated label is measured in every direction, not just along x', () => {
    const p = treeWithLongLabel('LR');
    const id = Object.keys(p.nodes).find((k) => p.nodes[k].label === LONG)!;
    p.nodes[id].style = { ...(p.nodes[id].style ?? {}), labelRotation: 90 };
    const { svg } = buildSVG(p);
    const [minX, minY, w, h] = viewBoxOf(svg);
    const label = labelBox(svg, LONG);
    // Rotated text sweeps max(width, height) around its anchor: it must stay in
    // the box vertically as well as horizontally.
    expect(label.right).toBeLessThanOrEqual(minX + w);
    expect(label.left).toBeGreaterThanOrEqual(minX);
    expect(Number.isFinite(minY + h)).toBe(true);
  });
});

describe('projectIO', () => {
  it('round-trips a project through JSON', () => {
    const p = createSampleProject();
    const restored = parseProject(serializeProject(p));
    expect(restored.rootId).toBe(p.rootId);
    expect(Object.keys(restored.nodes)).toHaveLength(Object.keys(p.nodes).length);
    expect(restored.defaults.node.shape).toBe(p.defaults.node.shape);
  });

  it('rejects invalid project files', () => {
    expect(() => parseProject('{"foo":1}')).toThrow();
  });
});

// --- one font stack, on screen and in the export --------------------------------
// The exporter writes `font-family` from its own constant while the UI reads
// `--font` from the stylesheet, and neither stack is embedded in the emitted SVG:
// if the two named different families, a viewer that resolved them differently
// would measure the same label two ways, and a crop would be invisible on screen
// while present in the file.

describe('the figure and the interface agree on one font stack', () => {
  it('app.css --font equals FONT_FAMILY', async () => {
    const [{ FONT_FAMILY_FOR_TEST }, css] = await Promise.all([
      import('./exportImage'),
      import('node:fs/promises').then((fs) =>
        fs.readFile(new URL('../styles/app.css', import.meta.url), 'utf8'),
      ),
    ]);
    const declared = css.match(/--font:\s*([^;]+);/);
    expect(declared, 'app.css declares --font').not.toBeNull();
    expect(declared![1].trim()).toBe(FONT_FAMILY_FOR_TEST);
  });

  it('ships no font the export cannot rely on', async () => {
    // A named family that is neither a system generic nor bundled is a promise
    // the host may not keep. There is no @font-face and no font file in the repo.
    const fs = await import('node:fs/promises');
    const css = await fs.readFile(new URL('../styles/app.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/@font-face/);
    const stack = css.match(/--font:\s*([^;]+);/)![1];
    const named = [...stack.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
    const SYSTEM = /^(Segoe UI|Roboto|Helvetica|Arial|Times|Georgia|Menlo|SF Mono)$/;
    for (const family of named) {
      expect(SYSTEM.test(family), `named family ${family} must be a system font`).toBe(true);
    }
  });
});

// --- BUG-4 follow-up: exports share the canvas annotation planner ------------
// The screen resolves the KI/AR × "Basilosauridae" collision (and the
// Basilosauridae × Neoceti label collision) with `eventBadgeLayout`. The exporter
// must make the same choices or the figure (SVG/PNG/PDF) would disagree with what
// the user saw. These tests parse the emitted SVG and assert the geometry rather
// than trusting the code path.

interface ParsedText {
  text: string;
  x: number;
  y: number;
  anchor: string;
  fontSize: number;
}

/** Node labels: `<text ... dominant-baseline>` excludes legend/axis/transition text. */
function parseLabelTexts(svg: string): ParsedText[] {
  const re =
    /<text x="(-?[\d.]+)" y="(-?[\d.]+)" text-anchor="(start|middle|end)" dominant-baseline="(?:central|hanging|auto)" font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g;
  const out: ParsedText[] = [];
  for (const m of svg.matchAll(re)) {
    out.push({ text: m[5], x: Number(m[1]), y: Number(m[2]), anchor: m[3], fontSize: Number(m[4]) });
  }
  return out;
}

/** Event badge circles: r == EVENT_BADGE_RADIUS and a white fill. */
function parseBadgeCircles(svg: string): { x: number; y: number }[] {
  const re = new RegExp(
    `<circle cx="(-?[\\d.]+(?:e[-+]?\\d+)?)" cy="(-?[\\d.]+(?:e[-+]?\\d+)?)" r="${EVENT_BADGE_RADIUS}" fill="#ffffff"`,
    'g',
  );
  return [...svg.matchAll(re)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}

/** CJK-aware glyph estimate, independent of the exporter's own 1.05 factor. */
function estimateWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e7f ? fontSize : fontSize * 0.62;
  return w;
}

/** Box the text glyphs actually occupy (14px text is ≈17px tall, half ≈0.68em). */
function textBox(t: ParsedText): { minX: number; minY: number; maxX: number; maxY: number } {
  const w = estimateWidth(t.text, t.fontSize);
  const half = t.fontSize * 0.68;
  const x0 = t.anchor === 'end' ? t.x - w : t.anchor === 'middle' ? t.x - w / 2 : t.x;
  return { minX: x0, minY: t.y - half, maxX: x0 + w, maxY: t.y + half };
}

function intersects(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function projectWithLayout(type: LayoutType): Project {
  const p = createSampleProject();
  p.layout.type = type;
  return p;
}

describe('exportImage — event badges reuse the canvas collision planner (BUG-4)', () => {
  const LAYOUTS: LayoutType[] = [
    'rectangular-cladogram',
    'rectangular-phylogram',
    'time-calibrated',
    'circular',
  ];

  for (const type of LAYOUTS) {
    it(`${type}: badge circles do not intersect label text`, () => {
      const svg = buildSVG(projectWithLayout(type), { showEvents: true }).svg;
      const labels = parseLabelTexts(svg);
      const badges = parseBadgeCircles(svg);
      expect(labels.length).toBeGreaterThan(5);
      expect(badges.length).toBe(2); // KI + AR on Neoceti
      const half = EVENT_BADGE_RADIUS + 1.5;
      for (const b of badges) {
        const badgeBox = { minX: b.x - half, minY: b.y - half, maxX: b.x + half, maxY: b.y + half };
        for (const t of labels) {
          expect(intersects(badgeBox, textBox(t)), `${t.text} × badge at ${b.x},${b.y}`).toBe(false);
        }
      }
    });
  }

  it('phylogram: the staggered parent/child labels no longer overlap', () => {
    for (const type of ['rectangular-phylogram', 'time-calibrated'] as LayoutType[]) {
      const svg = buildSVG(projectWithLayout(type), { showEvents: true }).svg;
      const labels = parseLabelTexts(svg);
      const basilo = labels.find((t) => t.text === 'Basilosauridae')!;
      const neoceti = labels.find((t) => t.text === 'Neoceti')!;
      expect(intersects(textBox(basilo), textBox(neoceti)), `${type}: still overlapping`).toBe(false);
      // The child yields (moves up one stagger step); the parent keeps its row.
      expect(neoceti.y).toBeLessThan(basilo.y);
    }
  });

  it('ships the leader line and branch anchor dot for a displaced stack', () => {
    const svg = buildSVG(projectWithLayout('rectangular-cladogram'), { showEvents: true }).svg;
    expect(svg).toContain('stroke-width="1" opacity="0.7"'); // thin leader
    expect(svg).toContain('r="1.6"'); // dot on the natural branch anchor
  });

  it('emits exactly the anchors planEventAnchors computes', () => {
    const project = projectWithLayout('rectangular-phylogram');
    const opts = { showEras: false, eraLevel: 'both' as const };
    const layout = computeLayout(project, opts);
    const axisBoxes = timeAxisTextBoxes(project, layout, opts);
    const labelNudges = planLabelNudges(project, layout.positions, layout.visible, axisBoxes);
    const plan = planEventAnchors({
      project,
      events: project.events,
      positions: layout.positions,
      nodes: project.nodes,
      culled: layout.visible,
      orientation: project.layout.orientation,
      layoutType: project.layout.type,
      labelNudges,
      axisBoxes,
    });
    const svg = buildSVG(project, { showEvents: true }).svg;
    expect(plan.anchors.size).toBe(2);
    for (const a of plan.anchors.values()) {
      expect(svg).toContain(`<circle cx="${a.x}" cy="${a.y}" r="${EVENT_BADGE_RADIUS}" fill="#ffffff"`);
    }
    // And the badges really did move off the branch line (not the old anchors).
    const natural = plan.anchors.get(project.events[0].id)!;
    expect(natural.y).not.toBe(layout.positions.get(project.events[0].nodeId)!.y);
  });
});
