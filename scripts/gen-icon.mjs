// Generates src-tauri/icons/source.png (1024x1024) — a warm bone rounded-square
// with an ink phylogenetic-tree glyph. Matches the app's minimalist warm
// monochrome palette. Pure Node (zlib), no dependencies.
// After running this, use `npx tauri icon` to produce the full icon set.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const S = 1024;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'src-tauri', 'icons');

// --- geometry ---------------------------------------------------------------
const root = [250, 512];
const iA = [480, 340];
const iB = [480, 684];
const leaves = [
  [760, 240],
  [760, 440],
  [760, 584],
  [760, 784],
];
const segments = [
  [[140, 512], [250, 512]], // trunk
  [[250, 512], [250, 340]], [[250, 340], [480, 340]], // root -> iA
  [[250, 512], [250, 684]], [[250, 684], [480, 684]], // root -> iB
  [[480, 340], [480, 240]], [[480, 240], [760, 240]], // iA -> l1
  [[480, 340], [480, 440]], [[480, 440], [760, 440]], // iA -> l2
  [[480, 684], [480, 584]], [[480, 584], [760, 584]], // iB -> l3
  [[480, 684], [480, 784]], [[480, 784], [760, 784]], // iB -> l4
];
const HALF = 13;

function distToSeg(px, py, [[x1, y1], [x2, y2]]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function insideRounded(px, py, r) {
  const dx = Math.abs(px - S / 2) - (S / 2 - r);
  const dy = Math.abs(py - S / 2) - (S / 2 - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r <= 0;
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// --- render RGBA ------------------------------------------------------------
// Warm monochrome palette — Bone (#f7f6f3) to a slightly deeper warm grey
// (#e8e6e0), matching the app's editorial ink aesthetic. The tree glyph is
// rendered in near-black ink (#1a1a1a) for strong contrast.
const c0 = [247, 246, 243]; // #f7f6f3 (bone)
const c1 = [232, 230, 224]; // #e8e6e0 (warm light grey)
const raw = Buffer.alloc((S * 4 + 1) * S);
let o = 0;
for (let y = 0; y < S; y += 1) {
  raw[o++] = 0; // filter type: none
  for (let x = 0; x < S; x += 1) {
    if (!insideRounded(x, y, 180)) {
      raw[o++] = 0;
      raw[o++] = 0;
      raw[o++] = 0;
      raw[o++] = 0;
      continue;
    }
    let white = false;
    for (const seg of segments) {
      if (distToSeg(x, y, seg) <= HALF) {
        white = true;
        break;
      }
    }
    if (!white) {
      for (const p of [root, iA, iB]) {
        if (Math.hypot(x - p[0], y - p[1]) <= 34) {
          white = true;
          break;
        }
      }
    }
    if (!white) {
      for (const p of leaves) {
        if (Math.hypot(x - p[0], y - p[1]) <= 30) {
          white = true;
          break;
        }
      }
    }
    if (white) {
      // Ink glyph (#1a1a1a) — off-black, subtly warm.
      raw[o++] = 26;
      raw[o++] = 26;
      raw[o++] = 26;
      raw[o++] = 255;
    } else {
      const t = (x + y) / (2 * S);
      raw[o++] = lerp(c0[0], c1[0], t);
      raw[o++] = lerp(c0[1], c1[1], t);
      raw[o++] = lerp(c0[2], c1[2], t);
      raw[o++] = 255;
    }
  }
}

// --- PNG encode -------------------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'source.png');
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
