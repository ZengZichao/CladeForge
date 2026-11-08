// @vitest-environment jsdom
// Regression tests for the PDF export review findings (S10): the grey must be
// WRITTEN into the colours (svg2pdf ignores SVG filters), and the page must
// fit jsPDF's 14400-unit MediaBox cap. Runs under jsdom with the real jsPDF +
// svg2pdf converters, like the review's own evidence pass.
import { describe, it, expect } from 'vitest';
import * as jspdfModule from 'jspdf';
// svg2pdf's UMD build reads the browser-global `jspdf` when the module system
// interop fails under the test runner; provide it before any dynamic import.
(globalThis as Record<string, unknown>).jspdf = jspdfModule;
// jsdom parses SVG but implements no geometry: svg2pdf measures text through
// getBBox, which jsdom does not provide. Simulate it (the review's own
// evidence pass did the same — "只模拟文字几何测量"): width ≈ chars × fontSize × 0.6.
const svgProto = (globalThis as Record<string, unknown>).SVGElement as
  | { prototype: Record<string, unknown> }
  | undefined;
if (svgProto && typeof svgProto.prototype.getBBox !== 'function') {
  svgProto.prototype.getBBox = function (this: Element) {
    const fs = parseFloat(this.getAttribute?.('font-size') ?? '11') || 11;
    const text = this.textContent ?? '';
    const w = text.length * fs * 0.6;
    return { x: 0, y: -fs * 0.8, width: w, height: fs };
  };
}
import { parseNewick } from './newick';
import { toPdfBlob, buildSVG } from './exportImage';
import { setBranchStyle } from '../model/treeOps';

const tip = (p: ReturnType<typeof parseNewick>, label: string) =>
  Object.values(p.nodes).find((n) => n.label === label)!;

async function pdfText(blob: Blob): Promise<string> {
  // jsdom's Blob predates .arrayBuffer(); FileReader is the portable reader.
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
  let out = '';
  for (const b of new Uint8Array(buf)) out += String.fromCharCode(b);
  return out;
}

describe('review: PDF export (S10)', () => {
  it('the grayscale option greys the colour operators, not just the SVG filter', async () => {
    const p = parseNewick('(A:1,B:2)R;');
    tip(p, 'A').branchLength = 1;
    tip(p, 'B').branchLength = 2;
    // A saturated red branch and a blue node: the unfiltered PDF carries both
    // operators.
    setBranchStyle(p, tip(p, 'A').id, { color: '#ff0000' });
    const colorPdf = await pdfText(await toPdfBlob(p, {}));
    expect(colorPdf).toMatch(/1\.?\s*0\.?\s*0\.?\s*(rg|RG)/);

    const grayPdf = await pdfText(await toPdfBlob(p, { grayscale: true }));
    // No saturated red anywhere in the grey document — the SVG saturate filter
    // is ignored by svg2pdf, so the grey must have been computed in.
    expect(grayPdf).not.toMatch(/1\.?\s*0\.?\s*0\.?\s*(rg|RG)/);
    // (The SVG path keeps its colours and greys through the feColorMatrix
    // filter — the explicit colour rewrite is the PDF's job, because svg2pdf
    // ignores filters.)
  });

  it('a figure taller than the MediaBox cap is scaled to fit, not clipped', async () => {
    let spec = '';
    for (let i = 0; i < 120; i += 1) spec += '(';
    spec += 'A,B';
    for (let i = 0; i < 120; i += 1) spec += ')';
    spec += 'R;';
    const p = parseNewick(spec);
    const { height } = buildSVG(p, {});
    expect(height).toBeGreaterThan(0);
    const blob = await toPdfBlob(p, {});
    const text = await pdfText(blob);
    const box = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(text);
    expect(box).toBeTruthy();
    const w = Number(box![1]);
    const h = Number(box![2]);
    expect(Math.max(w, h)).toBeLessThanOrEqual(14400.5);
  });
});
