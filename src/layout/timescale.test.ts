import { describe, it, expect } from 'vitest';
import {
  niceTicks,
  buildTimeAxis,
  timeUnitToMa,
  GEO_EONS,
  GEO_PERIODS,
  estimateLabelWidth,
  placeBandLabels,
  planEraOverlay,
} from './timescale';

describe('timescale', () => {
  it('niceTicks starts at 0, keeps a uniform round step and never leaves the data domain', () => {
    const t = niceTicks(66);
    expect(t[0]).toBe(0);
    const step = t[1] - t[0];
    for (let i = 1; i < t.length; i += 1) {
      expect(Math.abs(t[i] - t[i - 1] - step)).toBeLessThan(1e-6);
    }
    // The last tick must not run up to half a step PAST the oldest node
    // (66 → 70), labelling an age no node has. It stops at
    // or below the maximum while still covering all but one step of the domain.
    expect(t[t.length - 1]).toBeLessThanOrEqual(66);
    expect(t[t.length - 1]).toBeGreaterThan(66 - step);
  });

  it('niceTicks never exceeds the domain on a deep Precambrian axis', () => {
    // max 4600 / count 6 rounds the step to 1 000, so an uncapped loop reaches
    // 5000 — a tick 400 units older than anything in the tree.
    const t = niceTicks(4600);
    expect(Math.max(...t)).toBeLessThanOrEqual(4600);
    expect(t[t.length - 1]).toBe(4000);
    expect(niceTicks(Number.NaN)).toEqual([0]);
    expect(niceTicks(Infinity)).toEqual([0]);
    expect(niceTicks(1e-9)).toEqual([0]);
  });

  it('niceTicks handles a degenerate max', () => {
    expect(niceTicks(0)).toEqual([0]);
  });

  it('timeUnitToMa converts the usual labels and rejects unknown ones', () => {
    expect(timeUnitToMa('Ma')).toBe(1);
    expect(timeUnitToMa('ka')).toBe(1e-3);
    expect(timeUnitToMa('Ga')).toBe(1e3);
    expect(timeUnitToMa(' Myr ')).toBe(1);
    expect(timeUnitToMa('furlongs')).toBeNull();
    expect(timeUnitToMa(undefined)).toBeNull();
  });

  it('buildTimeAxis converts a non-Ma axis before placing the bands', () => {
    // Identity age→coord, axis labelled in ka and spanning 4.6 million ka: the
    // Phanerozoic boundary is 538.8 Ma = 538 800 ka. Bands placed as if every unit
    // were Ma would sit three orders of magnitude off.
    const ka = buildTimeAxis(4_600_000, (age) => age, 'LR', 'ka', 0, 10);
    expect(ka.maFactor).toBe(1e-3);
    const phanerozoic = ka.eons.find((e) => e.color === '#bbf7d0');
    expect(phanerozoic).toBeDefined();
    expect(Math.max(phanerozoic!.a, phanerozoic!.b)).toBeCloseTo(538_800, 6);
    expect(ka.bandsMeaningful).toBe(true);

    // An unrecognised unit produces no bands at all rather than a plausible-
    // looking wrong chart.
    const bogus = buildTimeAxis(100, (age) => age, 'LR', 'furlongs-perfortnight', 0, 10);
    expect(bogus.maFactor).toBeNull();
    expect(bogus.eons).toEqual([]);
    expect(bogus.periods).toEqual([]);
    expect(bogus.bandsMeaningful).toBe(false);
    // Ticks are unit-blind and still stop inside the domain.
    expect(Math.max(...bogus.ticks.map((t) => t.age))).toBeLessThanOrEqual(100);
  });

  it('geological data is complete and contiguous', () => {
    // Eons tile 0..4600 without gaps or overlaps.
    const eons = [...GEO_EONS].sort((a, b) => a.start - b.start);
    expect(eons[0].start).toBe(0);
    for (let i = 1; i < eons.length; i += 1) {
      expect(eons[i].start).toBeCloseTo(eons[i - 1].end, 6);
    }
    expect(eons[eons.length - 1].end).toBe(4600);
    // Periods tile 0..2500 (Archean/Hadean have no formal periods).
    const periods = [...GEO_PERIODS].sort((a, b) => a.start - b.start);
    expect(periods[0].start).toBe(0);
    for (let i = 1; i < periods.length; i += 1) {
      expect(periods[i].start).toBeCloseTo(periods[i - 1].end, 6);
    }
    expect(periods[periods.length - 1].end).toBe(2500);
    // The Phanerozoic periods are all present.
    for (const name of ['Quaternary', 'Cambrian', 'Ordovician', 'Silurian', 'Devonian', 'Permian', 'Triassic', 'Jurassic', 'Cretaceous', 'Paleogene', 'Neogene']) {
      expect(periods.some((p) => p.labelEn === name)).toBe(true);
    }
  });

  it('buildTimeAxis clips geological bands to the age range', () => {
    // Identity age→coord; horizontal LR; maxAge 100 Ma keeps only young periods.
    const info = buildTimeAxis(100, (age) => age, 'LR', 'Ma', 0, 10);
    expect(info.horizontal).toBe(true);
    expect(info.periods.length).toBeGreaterThan(0);
    // No band should extend beyond the 100 Ma window.
    for (const e of [...info.eons, ...info.periods]) {
      expect(Math.max(e.a, e.b)).toBeLessThanOrEqual(100 + 1e-6);
      expect(Math.min(e.a, e.b)).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('estimateLabelWidth counts CJK glyphs as full em', () => {
    expect(estimateLabelWidth('寒武纪', 11)).toBeCloseTo(33, 5);
    expect(estimateLabelWidth('abc', 10)).toBeCloseTo(18.6, 5);
  });

  it('placeBandLabels stacks colliding labels into extra lanes', () => {
    const placed = placeBandLabels([
      { key: 'a', lo: 0, hi: 30, label: 'aaaa', width: 30, baseLane: 0 },
      { key: 'b', lo: 20, hi: 50, label: 'bbbb', width: 30, baseLane: 0 },
    ]);
    expect(placed.find((p) => p.key === 'a')!.lane).toBe(0);
    // 'b' overlaps 'a' in lane 0, so it moves to lane 1.
    expect(placed.find((p) => p.key === 'b')!.lane).toBe(1);
  });

  it('placeBandLabels rotates a label whose band is too narrow', () => {
    // Extent 14 is wide enough for a rotated glyph column (>= ERA_ROT_MIN)
    // but far too narrow for the 30px-wide horizontal label.
    const placed = placeBandLabels([
      { key: 'narrow', lo: 0, hi: 14, label: '长标签', width: 30, baseLane: 0, rotatable: true },
    ]);
    expect(placed[0].rotated).toBe(true);
    expect(placed[0].lane).toBe(-1);
  });

  it('placeBandLabels clamps horizontal centres into the axis span but not rotated ones', () => {
    const clampTo = { min: 100, max: 200 };
    const placed = placeBandLabels(
      [
        { key: 'out', lo: -50, hi: -40, label: 'aaaa', width: 20, baseLane: 0 },
        // Extent 14 clears ERA_ROT_MIN so this band rotates in place.
        { key: 'rot', lo: -64, hi: -50, label: 'bbbb', width: 20, baseLane: 0, rotatable: true },
      ],
      clampTo,
    );
    const horizontal = placed.find((p) => p.key === 'out')!;
    expect(horizontal.rotated).toBe(false);
    expect(horizontal.center).toBeGreaterThanOrEqual(clampTo.min);
    const rotated = placed.find((p) => p.key === 'rot')!;
    expect(rotated.rotated).toBe(true);
    expect(rotated.center).toBe(-57); // stays with its band
  });

  it('planEraOverlay honours single-rank levels and packs events alone when eras are off', () => {
    const info = buildTimeAxis(4600, (age) => age, 'LR', 'Ma', 0, 100);
    const eonOnly = planEraOverlay(info, { showEras: true, eraLevel: 'eon' }, []);
    expect(eonOnly.labels.every((l) => l.key.startsWith('eon:'))).toBe(true);
    const periodOnly = planEraOverlay(info, { showEras: true, eraLevel: 'period' }, []);
    expect(periodOnly.labels.every((l) => l.key.startsWith('period:'))).toBe(true);
    // Periods start at lane 0 when no eon row occupies it.
    const periodLanes = periodOnly.labels.filter((l) => l.lane >= 0).map((l) => l.lane);
    expect(Math.min(...periodLanes)).toBe(0);
    // Eras off: era labels vanish and event labels pack from lane 0.
    const off = planEraOverlay(
      info,
      { showEras: false, eraLevel: 'both' },
      [{ id: 'e1', label: '事件', from: 100, to: 90 }],
    );
    expect(off.labels).toHaveLength(0);
    expect(off.env[0].lane).toBe(0);
  });

  it('planEraOverlay separates eon and period rows and keeps event labels clear', () => {
    const info = buildTimeAxis(4600, (age) => age, 'LR', 'Ma', 0, 100);
    const plan = planEraOverlay(
      info,
      { showEras: true, eraLevel: 'both' },
      [{ id: 'e1', label: '大氧化事件', from: 2400, to: 2300 }],
    );
    // Eon labels never share a row with period labels.
    const eonLanes = plan.labels.filter((l) => l.key.startsWith('eon:')).map((l) => l.lane);
    const periodLanes = plan.labels.filter((l) => l.key.startsWith('period:')).map((l) => l.lane);
    expect(Math.max(...eonLanes.filter((l) => l >= 0))).toBeLessThan(
      Math.min(...periodLanes.filter((l) => l >= 0)),
    );
    // Every period of the Phanerozoic produced a label.
    expect(plan.labels.filter((l) => l.key.startsWith('period:')).length).toBeGreaterThanOrEqual(22);
    // Era labels stack outward from the band (lane >= 0); event labels keep
    // their own row just inside the band, packed from lane 0.
    expect(plan.labels.every((l) => l.lane >= -1 && l.lane <= 3)).toBe(true);
    expect(plan.env[0].lane).toBeGreaterThanOrEqual(0);
  });
});
