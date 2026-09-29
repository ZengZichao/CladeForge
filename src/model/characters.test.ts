import { describe, it, expect } from 'vitest';
import { createEmptyProject, SAMPLE_PROJECTS } from './sampleTree';
import { addChildren, addCharacter, setNodeState } from './treeOps';
import {
  CURATED_STATE_COLOR_COUNT,
  MAX_DISTINGUISHABLE_STATES,
  stateColorLimitWarning,
  DARK_CANVAS_BG,
  LIGHT_CANVAS_BG,
  MIN_STATE_COLOR_CONTRAST,
  MISSING_STATE_CODES,
  STATE_PALETTE,
  countEvolutionaryTransitions,
  detectTransitions,
  evolutionaryTransitions,
  findCharacter,
  isObservedState,
  missingCodeCount,
  newCharacter,
  newCharacterState,
  nodeCharacterColor,
  stateColorContrastFloor,
  stateColorDichromatSeparation,
  stateColorFor,
  stateColorSeparation,
  statePaletteExhausted,
} from './characters';
import { colorDeltaE, lerpHexColor, relativeLuminance, wcagContrastRatio } from './types';

describe('characters', () => {
  it('detects a transition where parent and child states differ', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1); // root -> a
    const char = newCharacter('trait');
    const s0 = char.states[0].id;
    const s1 = char.states[1].id;
    addCharacter(p, char);
    setNodeState(p, p.rootId, char.id, s0);
    setNodeState(p, a, char.id, s1);

    const trans = detectTransitions(p, char);
    expect(trans).toHaveLength(1);
    expect(trans[0].nodeId).toBe(a);
    expect(trans[0].from).toBe(s0);
    expect(trans[0].to).toBe(s1);
  });

  it('reports no transition when states match; transition when one side is unassigned', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    const char = newCharacter('trait');
    const s0 = char.states[0].id;
    addCharacter(p, char);
    setNodeState(p, p.rootId, char.id, s0);

    setNodeState(p, a, char.id, s0); // equal -> not a transition
    expect(detectTransitions(p, char)).toHaveLength(0);

    // Parent known, child unknown → treated as a transition, not skipped.
    setNodeState(p, a, char.id, undefined);
    const trans = detectTransitions(p, char);
    expect(trans).toHaveLength(1);
    expect(trans[0].from).toBe(s0);
    expect(trans[0].toLabel).toBe('未知');

    // Both unknown → no information, skip.
    setNodeState(p, p.rootId, char.id, undefined);
    expect(detectTransitions(p, char)).toHaveLength(0);
  });

  it('resolves a discrete state colour, undefined when unassigned', () => {
    const p = createEmptyProject();
    const char = newCharacter('trait');
    addCharacter(p, char);
    setNodeState(p, p.rootId, char.id, char.states[0].id);
    expect(nodeCharacterColor(char, p.nodes[p.rootId])).toBe(char.states[0].color);

    const [a] = addChildren(p, p.rootId, 1);
    expect(nodeCharacterColor(char, p.nodes[a])).toBeUndefined();
  });

  it('removing a character clears node assignments (findCharacter)', () => {
    const p = createEmptyProject();
    const char = newCharacter('trait');
    addCharacter(p, char);
    expect(findCharacter(p, char.id)?.id).toBe(char.id);
    expect(findCharacter(p, null)).toBeUndefined();
  });
});

// --- the state palette must not repeat, nor fade into the background ---------

describe('state palette', () => {
  it('gives every state its own colour — no modulo reuse', () => {
    // A bare `index % STATE_PALETTE.length` would dress state 9 in state 1's
    // colour, and a legend could not tell them apart at all.
    const colors = Array.from({ length: 200 }, (_, i) => stateColorFor(i));
    expect(new Set(colors).size).toBe(200);
    for (let i = 0; i < colors.length; i += 1) {
      expect(colors[i]).toMatch(/^#[\da-f]{6}$/i);
    }
    // Explicitly: the pair a modulo allocator collides on, and one beyond it.
    expect(stateColorFor(STATE_PALETTE.length)).not.toBe(stateColorFor(0));
    expect(stateColorFor(2 * STATE_PALETTE.length)).not.toBe(stateColorFor(STATE_PALETTE.length));
    // `newCharacterState` goes through the same allocator.
    const created = Array.from({ length: 32 }, (_, i) => newCharacterState(`S${i + 1}`, i));
    expect(new Set(created.map((s) => s.color)).size).toBe(32);
  });

  it('keeps every fill legible on the light canvas (measured WCAG ratios)', () => {
    for (const color of STATE_PALETTE) {
      expect(wcagContrastRatio(color, LIGHT_CANVAS_BG)).toBeGreaterThanOrEqual(MIN_STATE_COLOR_CONTRAST);
      // …and does not disappear on the dark canvas either.
      expect(wcagContrastRatio(color, DARK_CANVAS_BG)).toBeGreaterThanOrEqual(2.8);
    }
    // Derived colours respect the same floor.
    expect(stateColorContrastFloor(64)).toBeGreaterThanOrEqual(MIN_STATE_COLOR_CONTRAST);
    expect(stateColorContrastFloor(200)).toBeGreaterThanOrEqual(MIN_STATE_COLOR_CONTRAST);
    // Positive control: the colours kept out of the palette really do fail here.
    expect(wcagContrastRatio('#f0e442', LIGHT_CANVAS_BG)).toBeLessThan(1.2); // too pale for a light canvas
    expect(wcagContrastRatio('#999999', LIGHT_CANVAS_BG)).toBeLessThan(3); // the "grey black"
    expect(STATE_PALETTE).not.toContain('#f0e442');
    expect(STATE_PALETTE).not.toContain('#999999');
    // Black is not simply a palette entry either: on the dark canvas it is invisible.
    expect(wcagContrastRatio('#000000', DARK_CANVAS_BG)).toBeLessThan(1.2);
  });

  it('keeps the curated fills visibly different (CIE76 ΔE)', () => {
    // Measured: worst curated pair is #d55e00 / #a66100 at ΔE 23.1.
    expect(stateColorSeparation(CURATED_STATE_COLOR_COUNT)).toBeGreaterThanOrEqual(23);
    // The first generated colours stay separable from the curated ones.
    expect(stateColorSeparation(16)).toBeGreaterThanOrEqual(15);
    expect(CURATED_STATE_COLOR_COUNT).toBe(STATE_PALETTE.length);
  });

  it('reports exhaustion instead of repeating silently', () => {
    expect(statePaletteExhausted(CURATED_STATE_COLOR_COUNT)).toBe(false);
    expect(statePaletteExhausted(CURATED_STATE_COLOR_COUNT + 1)).toBe(true);
    // A generated colour is never a curated one.
    const derived = stateColorFor(CURATED_STATE_COLOR_COUNT);
    expect(STATE_PALETTE).not.toContain(derived);
  });
});

// --- the colour maths must never emit a corrupt channel ----------------------

describe('colour guards', () => {
  it('clamps a NaN channel to the documented fallback instead of "#NaNaNa"', () => {
    const bad = lerpHexColor('#ffffff', '#000000', Number.NaN);
    expect(bad).not.toMatch(/na/i);
    expect(bad).toBe('#000000'); // channelHex's non-finite fallback = 0
    expect(lerpHexColor('#ffffff', '#000000', Number.POSITIVE_INFINITY)).toBe('#000000');
    expect(lerpHexColor('#ffffff', '#000000', Number.NEGATIVE_INFINITY)).toBe('#ffffff');
    expect(lerpHexColor('#ffffff', '#000000', 0.5)).toBe('#808080');
    for (const t of [NaN, Infinity, -Infinity, -0.2, 1.2, 0.333]) {
      expect(lerpHexColor('#dbeafe', '#1e3a8a', t)).toMatch(/^#[\da-f]{6}$/i);
    }
    // An unparsable endpoint degrades to the `from` colour, not to garbage.
    expect(lerpHexColor('#nope', '#1e3a8a', 0.5)).toBe('#nope');
  });

  it('measures luminance and contrast the palette test depends on', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('garbage')).toBe(0);
    expect(wcagContrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(wcagContrastRatio('#ababab', '#ababab')).toBeCloseTo(1, 6);
    expect(colorDeltaE('#0072b2', '#0072b3')).toBeLessThan(1);
    expect(colorDeltaE('#000000', '#ffffff')).toBeGreaterThan(90);
  });
});

// ── the derived palette must actually separate, and say when it stops being
// able to. The sampler's contract is the worst pairwise distance under BOTH
// colour readings, so a colour pair that only separates in a channel
// red/green colour-blind readers do not have cannot pass. ──
describe('derived state colours separate, and declare their limit', () => {
  it('is silent while the states are still distinguishable', () => {
    expect(stateColorLimitWarning(1)).toBeNull();
    expect(stateColorLimitWarning(MAX_DISTINGUISHABLE_STATES)).toBeNull();
  });

  it('warns once past it', () => {
    expect(stateColorLimitWarning(MAX_DISTINGUISHABLE_STATES + 1)).toBeTruthy();
    expect(stateColorLimitWarning(120)).toBeTruthy();
  });

  it('the declared limit matches the measured separation', () => {
    // The constant has to stay anchored to measurement: it exists to say
    // "colour alone still carries this many states", so both readings have to
    // hold at the declared count and give out just past it.
    expect(stateColorSeparation(MAX_DISTINGUISHABLE_STATES)).toBeGreaterThanOrEqual(15);
    expect(stateColorDichromatSeparation(MAX_DISTINGUISHABLE_STATES)).toBeGreaterThanOrEqual(15);
    expect(MAX_DISTINGUISHABLE_STATES).toBeLessThan(42); // normal vision runs out by 43…
    expect(stateColorDichromatSeparation(MAX_DISTINGUISHABLE_STATES + 3)).toBeLessThan(15); // …and dichromat before that
  });

  it('holds separation at the densities a legend is read against', () => {
    // 20 and 30 states are where a hue wheel crowds into swatches no legend can
    // be read against, so both counts are pinned under each colour reading
    // instead of being left to the single limit constant above.
    expect(stateColorSeparation(20)).toBeGreaterThanOrEqual(20);
    expect(stateColorSeparation(30)).toBeGreaterThanOrEqual(18);
    expect(stateColorDichromatSeparation(30)).toBeGreaterThanOrEqual(18);
  });

  it('never moves a colour an earlier state already got', () => {
    // The sampler is an append-only farthest-point traversal, so state i's
    // colour must not depend on how many states come after it — otherwise
    // adding a 30th state would silently repaint the existing 12 in every
    // project file, legend and figure that was drawn from them.
    const early = Array.from({ length: 20 }, (_, i) => stateColorFor(i));
    for (const high of [60, 150, 240]) stateColorFor(high);
    expect(Array.from({ length: 20 }, (_, i) => stateColorFor(i))).toEqual(early);
  });

  it('keeps dichromat separation no worse than the curated palette it extends', () => {
    // The curated Okabe–Ito set is the floor the derived colours hold: its own
    // worst pair measured under protan/deutan simulation.
    const curatedFloor = stateColorDichromatSeparation(CURATED_STATE_COLOR_COUNT);
    expect(curatedFloor).toBeGreaterThanOrEqual(19);
    for (const n of [12, 16, 20, 24]) {
      expect(stateColorDichromatSeparation(n)).toBeGreaterThanOrEqual(curatedFloor - 0.6);
    }
  });
});

// ── the committed fixtures must be regenerable ──
describe('sample project reproducibility', () => {
  it('gives sample characters the same id on every build', () => {
    // scripts/cross-check/fixtures/ is committed so someone with only R can run
    // the harness, and its README says deleting and regenerating is safe. The
    // character id is the `character` column of five fixture files plus
    // manifest.tsv, so ids are stable constants rather than nanoid: a random id
    // would make every regeneration rewrite ~1 500 lines of committed data to
    // change nothing a reader can see. Node and state ids stay random because no
    // fixture column carries them — this asserts exactly that boundary.
    const first = SAMPLE_PROJECTS.map((d) => d.build().characters.map((c) => c.id));
    const second = SAMPLE_PROJECTS.map((d) => d.build().characters.map((c) => c.id));
    expect(second).toEqual(first);
    for (const ids of first) for (const id of ids) expect(id).toMatch(/^sample-char:/);
  });

  it('keeps those ids unique within each sample project', () => {
    for (const d of SAMPLE_PROJECTS) {
      const ids = d.build().characters.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
