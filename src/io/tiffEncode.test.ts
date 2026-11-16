// TIFF encoder tests (A6, 2026-11-15 review): the encoder is hand-written byte
// surgery, so the layout is pinned here — a future edit that breaks the header,
// the IFD ordering or the strip offsets goes red instead of producing a file
// every image viewer rejects.

import { describe, expect, it } from 'vitest';
import { encodeTiff, type TiffPixels } from './exportImage';

function twoByTwo(): TiffPixels {
  const data = new Uint8ClampedArray(2 * 2 * 4);
  // Pixel (0,0) opaque red; the rest transparent black.
  data[0] = 255; data[1] = 0; data[2] = 0; data[3] = 255;
  return { width: 2, height: 2, data };
}

describe('encodeTiff', () => {
  it('writes the little-endian baseline header and IFD offset', () => {
    const bytes = encodeTiff(twoByTwo());
    expect(bytes[0]).toBe(0x49); // 'I'
    expect(bytes[1]).toBe(0x49); // 'I'
    expect(bytes[2]).toBe(0x2a); // '*'
    expect(bytes[3]).toBe(0);
    const dv = new DataView(bytes.buffer);
    expect(dv.getUint16(2, true)).toBe(42);
    expect(dv.getUint32(4, true)).toBe(8); // IFD follows the header directly
  });

  it('carries dimensions, RGBA samples and the unassociated-alpha tag', () => {
    const bytes = encodeTiff(twoByTwo());
    const dv = new DataView(bytes.buffer);
    const nEntries = dv.getUint16(8, true);
    expect(nEntries).toBe(13);
    // Walk the IFD: tags must be ascending and the known ones present.
    let prev = 0;
    const tags = new Map<number, { type: number; count: number; value: number }>();
    for (let i = 0; i < nEntries; i += 1) {
      const at = 8 + 2 + i * 12;
      const tag = dv.getUint16(at, true);
      expect(tag).toBeGreaterThan(prev);
      prev = tag;
      tags.set(tag, {
        type: dv.getUint16(at + 2, true),
        count: dv.getUint32(at + 4, true),
        value: dv.getUint16(at + 8, true),
      });
    }
    expect(dv.getUint32(8 + 2 + nEntries * 12, true)).toBe(0); // no next IFD
    expect(tags.get(256)?.value).toBe(2); // ImageWidth
    expect(tags.get(257)?.value).toBe(2); // ImageLength
    expect(tags.get(277)?.value).toBe(4); // SamplesPerPixel = RGBA
    expect(tags.get(338)?.value).toBe(2); // ExtraSamples = unassociated alpha
    expect(tags.get(296)?.value).toBe(2); // ResolutionUnit = inch
  });

  it('stores the DPI in both resolution tags', () => {
    const bytes = encodeTiff(twoByTwo(), 300);
    const dv = new DataView(bytes.buffer);
    const nEntries = dv.getUint16(8, true);
    const valueOf = (tagWanted: number): number => {
      for (let i = 0; i < nEntries; i += 1) {
        const at = 8 + 2 + i * 12;
        if (dv.getUint16(at, true) === tagWanted) return dv.getUint32(at + 8, true);
      }
      return -1;
    };
    const xAt = valueOf(282);
    const yAt = valueOf(283);
    expect(xAt).toBeGreaterThan(0);
    expect(dv.getUint32(xAt, true)).toBe(300);
    expect(dv.getUint32(xAt + 4, true)).toBe(1);
    expect(dv.getUint32(yAt, true)).toBe(300);
  });

  it('round-trips the first pixel RGBA and the strip length', () => {
    const px = twoByTwo();
    const bytes = encodeTiff(px, 96);
    const dv = new DataView(bytes.buffer);
    const nEntries = 13;
    // Layout: header 8, IFD 2+13*12+4 = 162 → BitsPerSample(8) + XRes(8) +
    // YRes(8) = 24 external bytes → strip at 194.
    const stripAt = 8 + 2 + nEntries * 12 + 4 + 8 + 8 + 8;
    expect(dv.getUint32(8 + 2 + 5 * 12 + 8, true)).toBe(stripAt); // StripOffsets tag 273
    // First pixel: opaque red.
    expect(bytes[stripAt]).toBe(255);
    expect(bytes[stripAt + 1]).toBe(0);
    expect(bytes[stripAt + 2]).toBe(0);
    expect(bytes[stripAt + 3]).toBe(255);
    // The strip holds exactly w*h*4 bytes.
    expect(bytes.length).toBe(stripAt + px.width * px.height * 4);
  });
});
