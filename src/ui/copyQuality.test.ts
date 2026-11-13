// Copy-quality gate for the bilingual UI catalogue.
//
// The 2026-11 UI review found scientific mistranslations, mixed terminology,
// pseudo-plurals, raw enum leakage and untranslated shortcut group keys. These
// checks encode the fixes in docs/UI_GLOSSARY.md so a later edit cannot quietly
// reintroduce them.
//
// Scope: (1) every leaf of both catalogues, (2) the formatter values of
// `strings.ts` through a source-level pass, and (3) the one-off inline `tr()`
// calls that still live in components and model errors — the review's worst
// finds (the 协同 calque) sat in layer (3), where a catalogue-only gate is blind.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EN_STRINGS, S, setLanguage, ZH_STRINGS } from './strings';
import { SHORTCUT_GROUPS } from './ShortcutsDialog';

type Leaf = { path: string; value: string };

function leaves(node: unknown, path = ''): Leaf[] {
  if (typeof node === 'string') return [{ path, value: node }];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, path ? `${path}.${key}` : key),
  );
}

const zhLeaves = leaves(ZH_STRINGS);
const enLeaves = leaves(EN_STRINGS);

function values(list: Leaf[]): string {
  return list.map((leaf) => leaf.value).join('\n');
}

/**
 * The 避免 column of docs/UI_GLOSSARY.md, Chinese side. Every entry is a plain
 * substring check, so it has to be something no correct sentence can contain:
 * `分支` stays OUT of this list on purpose (it is legal inside the compounds
 * `二叉分支` / `多歧分支`), and so does `隔离区` (the glossary allows it as prose
 * when explaining the orphan gutter) and `年代` (correct for geological time).
 */
const FORBIDDEN_ZH = [
  '尖端',
  '叶节点',
  '支持率',
  '支持值',
  '物种化',
  '加倍',
  '损失',
  '重根',
  '多分叉',
  '多叉',
  '观感',
  '推理',
  '载入',
  '加载',
  '关联线',
  '兄弟',
  '树库',
  '快速行动',
  '数据质量',
  '基部分支',
  '未解析',
  '协同',
  // embedded-layout vocabulary reviewed 2026-11: lane / hub bar / transfer arc
  // / tube / orphan gutter / embedded view all had competing renderings.
  '嵌入式视图',
  '内嵌视图',
  '泳道',
  '轨道',
  '枢纽条',
  '弧线',
  '孤儿区',
  // outgroup, hypothesis layer, custom link, reroot, ASR
  '外类群',
  '假设层',
  '网格线',
  '交叉线',
  '移根',
  '生根',
  '概率重建',
  '概率推断',
  // `character` is 性状; 字符 only ever means a text glyph, which the UI never discusses.
  '字符',
];

/** Drop comments: they quote superseded labels and are never rendered. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

/**
 * The catalogue is not the only source of UI text: a handful of one-off
 * `tr(zh, en)` calls live in components and model errors, and a catalogue-only
 * gate cannot see them (the reviewed 协同 calque sat in three of them). Their
 * Chinese first arguments are scanned with the same term list.
 *
 * Coverage boundary, stated so nobody trusts it further than it goes: a `tr(`
 * followed by a single-quoted or template-literal first argument is captured,
 * whatever the number of lines in between; a call whose first argument is built
 * by a function or a concatenation is not. Adding the copy to `strings.ts`
 * instead is always the better answer.
 */
const INLINE_TR_FILES = [
  '../io/fileActions.ts',
  '../canvas/ReconWorkspace.tsx',
  '../ui/ReconPanel.tsx',
  '../ui/ReconInspector.tsx',
  '../model/dtl.ts',
];

function inlineZhCopy(relative: string): string[] {
  const source = stripComments(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
  const quoted = [...source.matchAll(/\btr\(\s*'([^']*)'/g)].map((match) => match[1]);
  const templated = [...source.matchAll(/\btr\(\s*`([^`]*)`/g)].map((match) => match[1]);
  return [...quoted, ...templated].filter((text) => /[\u3400-\u9fff]/.test(text));
}

/**
 * Both halves of single-line `tr(zh, en)` / ``tr(`zh`, `en`)`` calls. Needed by
 * the bare-`LCA` ban below, which is about the rendered ABBREVIATION and so
 * covers the English half too — the Chinese term list above has no use for it.
 * Same coverage boundary as `inlineZhCopy`: concatenated or computed arguments
 * are not captured.
 */
function inlineTrPairCopy(relative: string): string[] {
  const source = stripComments(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
  const quoted = [...source.matchAll(/\btr\(\s*'([^']*)',\s*'([^']*)'/g)].flatMap((m) => [m[1], m[2]]);
  const templated = [...source.matchAll(/\btr\(\s*`([^`]*)`,\s*`([^`]*)`/g)].flatMap((m) => [m[1], m[2]]);
  return [...quoted, ...templated];
}

describe('UI copy quality', () => {
  it('has exactly the same key paths in both locales', () => {
    expect(enLeaves.map((leaf) => leaf.path).sort()).toEqual(zhLeaves.map((leaf) => leaf.path).sort());
  });

  it('never uses the forbidden Chinese terminology', () => {
    for (const term of FORBIDDEN_ZH) {
      expect(values(zhLeaves), `forbidden Chinese term: ${term}`).not.toContain(term);
    }
  });

  it('never uses the forbidden terminology in inline tr() copy either', () => {
    let seen = 0;
    for (const relative of INLINE_TR_FILES) {
      const copy = inlineZhCopy(relative);
      // Guard the guard: a broken reader would silently pass.
      expect(copy.length, `${relative} yields inline tr() copy`).toBeGreaterThan(0);
      seen += copy.length;
      for (const text of copy) {
        for (const term of FORBIDDEN_ZH) {
          expect(text, `${relative}: forbidden Chinese term: ${term}`).not.toContain(term);
        }
      }
    }
    expect(seen).toBeGreaterThan(50);
  });

  it('never shows the bare LCA abbreviation in visible copy', () => {
    // docs/UI_GLOSSARY.md (MRCA row): UI and prose write 最近共同祖先（MRCA）/
    // MRCA, never the bare abbreviation. Deliberately narrow — catalogue leaves
    // and inline tr() arguments only, so identifiers (`suggestLca`), comments
    // and test titles keep their algorithmic vocabulary.
    const BARE_LCA = /\bLCA\b/;
    for (const leaf of [...zhLeaves, ...enLeaves]) {
      expect(leaf.value, `${leaf.path}: ${leaf.value}`).not.toMatch(BARE_LCA);
    }
    for (const relative of INLINE_TR_FILES) {
      for (const text of inlineTrPairCopy(relative)) {
        expect(text, `${relative}: ${text}`).not.toMatch(BARE_LCA);
      }
    }
  });

  it('quotes visible copy typographically, formatters included', () => {
    // Leaf-level checks cannot reach the formatter values, so the source text
    // itself is checked once its comments are out: an ASCII `"` or `'` between
    // letters is a visible quote, and docs/UI_GLOSSARY.md rule 2 wants “ ” / ’.
    const catalogue = stripComments(readFileSync(fileURLToPath(new URL('./strings.ts', import.meta.url)), 'utf8'));
    expect(catalogue, 'ASCII " used as a visible quote').not.toMatch(/"/);
    expect(catalogue, "straight apostrophe used instead of ’").not.toMatch(/[A-Za-z]'[A-Za-z]/);
  });

  it('never uses the reviewed English anti-patterns', () => {
    const forbidden = [
      'Nexus',
      'BEAST block',
      'MrBayes block',
      'STALE',
      'LOWER',
      'TOPOLOGICAL',
      'analysis cladogram',
      'Reset both',
      'Clear ALL',
      'Report an issue',
      'this session',
      '(s)',
      '(es)',
      // `character` is the term; the module is Characters, never Traits.
      'Traits module',
      'Data quality',
    ];
    for (const term of forbidden) {
      expect(values(enLeaves), `forbidden English term: ${term}`).not.toContain(term);
    }
  });

  it('does not leak CJK into English strings (language names excepted)', () => {
    const cjk = /[\u3400-\u9fff]/;
    for (const leaf of enLeaves) {
      if (leaf.path === 'lang.toggleTitle') continue;
      expect(cjk.test(leaf.value), `${leaf.path}: ${leaf.value}`).toBe(false);
    }
  });

  it('does not use ASCII double quotes as visible Chinese quotes', () => {
    for (const leaf of zhLeaves) {
      expect(leaf.value.includes('"'), `${leaf.path}: ${leaf.value}`).toBe(false);
    }
  });

  it('does not leave literal {n} placeholders in visible copy', () => {
    for (const leaf of [...zhLeaves, ...enLeaves]) {
      expect(leaf.value.includes('{n}'), `${leaf.path}: ${leaf.value}`).toBe(false);
    }
  });

  it('localises shortcut group headings instead of rendering internal keys', () => {
    setLanguage('zh');
    expect(SHORTCUT_GROUPS().map((group) => group.title)).toEqual([
      S.shortcuts.global,
      S.shortcuts.canvas,
      S.shortcuts.palette,
    ]);
    setLanguage('en');
    expect(SHORTCUT_GROUPS().map((group) => group.title)).toEqual(['Global', 'Canvas', 'Command palette']);
    for (const group of SHORTCUT_GROUPS()) {
      expect(group.title).not.toMatch(/^(global|canvas|palette)$/);
      for (const row of group.rows) {
        if (group.title === 'Command palette') continue;
        expect(row.mode ?? '').not.toMatch(/[\u3400-\u9fff]/);
      }
    }
    setLanguage('zh');
  });

  it('pins the P0 scientific corrections', () => {
    expect(ZH_STRINGS.recon.cntDuplication).toBe('基因重复 δ');
    expect(ZH_STRINGS.recon.cntSpeciation).toBe('物种形成 σ');
    expect(ZH_STRINGS.recon.cntTransfer).toBe('水平转移 τ');
    expect(ZH_STRINGS.recon.cntLosses).toBe('基因丢失 λ');
    expect(ZH_STRINGS.recon.costDup).toBe('重复代价 δ');
    expect(ZH_STRINGS.recon.costLoss).toBe('丢失代价 λ');
    expect(ZH_STRINGS.recon.lossSplit(1, 2)).toContain('末端枝');
    expect(ZH_STRINGS.recon.lossSplit(1, 2)).not.toContain('入枝');

    expect(ZH_STRINGS.nexusExport.includeHypothesis).toContain('步矩阵');
    expect(ZH_STRINGS.nexusExport.includeBeast).toContain('非 BEAST XML');
    expect(EN_STRINGS.nexusExport.includeBeast).toContain('not BEAST XML');
    expect(ZH_STRINGS.nexusExport.includeMrBayes).toContain('命令模板');

    expect(ZH_STRINGS.analysis.signalSection).toContain('同塑性');
    expect(ZH_STRINGS.analysis.signalSection).not.toContain('系统发育信号');
    expect(EN_STRINGS.analysis.signalSection).toBe('Character fit and homoplasy (CI/RI)');

    expect(ZH_STRINGS.analysis.blombergKHint).toContain('模拟 BM 零分布');
    expect(ZH_STRINGS.analysis.blombergKHint).not.toContain('不运行');
    expect(EN_STRINGS.analysis.blombergKHint).toContain('Simulate BM null');
    expect(ZH_STRINGS.analysis.blombergKNoTest).not.toContain('无显著性检验');
    expect(EN_STRINGS.analysis.blombergKNoTest).not.toContain('No significance test');

    expect(ZH_STRINGS.review.exportGrayscale).toContain('显示文字');
    expect(ZH_STRINGS.review.exportWhiteBg).toContain('多数期刊');
    expect(EN_STRINGS.review.exportDpiHint).toContain('DPI');
    expect(ZH_STRINGS.review.clearLocalDataConfirm).toContain('主题保留');
    expect(ZH_STRINGS.layoutPanel.timeUnitHint('Ma')).toContain('66,000 ka');

    expect(ZH_STRINGS.layoutPanel.calibrationHint).toContain('按校准点拟合年龄');
    expect(ZH_STRINGS.layoutPanel.calibrationHint).not.toContain('仅随 NEXUS 导出');

    expect(ZH_STRINGS.notify.outgroupNoOp).not.toContain('基部');
    expect(EN_STRINGS.notify.outgroupNoOp).not.toContain('basal');

    expect(ZH_STRINGS.status.edges).toBe('自定义连线');
    expect(EN_STRINGS.status.edges).toBe('Custom links');
    expect(ZH_STRINGS.recon.resetBoth).toBe('重置视图设置');
    expect(ZH_STRINGS.confirm.dontAskAgain).toContain('偏好设置');
    expect(ZH_STRINGS.tabs.closeConfirmMessage('Tab')).toContain('本地恢复副本');

    expect(ZH_STRINGS.review.icsNote).toContain('4000 Ma');
    expect(ZH_STRINGS.review.icsNote).toContain('4600 Ma');
    expect(ZH_STRINGS.review.icsNote).not.toContain('4000/4600');

    expect(ZH_STRINGS.layoutPanel.timeUnitMa).toContain('百万年前');
    expect(ZH_STRINGS.layoutPanel.timeUnitMyr).toContain('持续时间');
    expect(EN_STRINGS.layoutPanel.timeUnitMa).toContain('mega-annum');
    expect(EN_STRINGS.layoutPanel.timeUnitMyr).toContain('duration');
    expect(ZH_STRINGS.layoutPanel.timeUnitMyr).not.toContain('等同');
    expect(EN_STRINGS.analysis.correlationTestHint).toContain('one-sided');
    expect(EN_STRINGS.review.analysisPermutationNote).toContain('one-sided');

    // The permutation null re-draws BOTH characters: `src/model/consistency.ts`
    // shuffles inside a `for (const side of [sideA, sideB])` loop in the replicate
    // body (:712-719), each side re-drawn over its OWN scored tips so both marginal
    // state counts and both missing-data patterns are held (`permutationSide`
    // :638-652, documented at :509-527), and `canonicalPair` (:617) makes the
    // p-value independent of argument order. The Chinese hint described a
    // one-sided re-shuffle of B — the opposite of what runs, and of the English.
    expect(ZH_STRINGS.analysis.correlationTestHint).toContain('两个性状');
    expect(ZH_STRINGS.analysis.correlationTestHint).toContain('两侧');
    expect(ZH_STRINGS.analysis.correlationTestHint).not.toContain('打乱 B 性状');

    // Mapping vocabulary: a gene node either has a species-node mapping or it has
    // none — "resolved / unresolved / data quality" is topology and dashboard
    // language, and the two locales disagreed on all three.
    expect(EN_STRINGS.recon.mappedCount).toBe('Mapped internal nodes');
    expect(EN_STRINGS.recon.filterUnresolved).toBe('Unmapped');
    expect(ZH_STRINGS.recon.dataQuality).toBe('映射校验');
    expect(EN_STRINGS.recon.dataQuality).toBe('Mapping validation');
    expect(ZH_STRINGS.layoutPanel.type).toBe('布局类型');
    expect(EN_STRINGS.layoutPanel.type).toBe('Layout type');
    expect(ZH_STRINGS.layoutPanel.branchGap).toBe('同级枝间距');
    expect(ZH_STRINGS.recon.embeddedSubtitle('g')).toContain('物种枝管道');
    expect(EN_STRINGS.recon.embeddedSubtitle('g')).toContain('species-branch tubes');
    expect(ZH_STRINGS.toolbar.addTernary).toContain('三歧');
    expect(EN_STRINGS.context.addTernary).toBe('Add ternary branch');
    expect(EN_STRINGS.review.analysisApplyParsimonyNoData).toContain('Characters module');
    expect(EN_STRINGS.reconInspector.transferDonorHint).not.toMatch(/\b[A-Z]{5,}\b/);
    expect(ZH_STRINGS.analysis.blombergK).toBe('Blomberg’s K');
    expect(EN_STRINGS.analysis.blombergK).toBe('Blomberg’s K');
    expect(ZH_STRINGS.gestures.altDragDesc).not.toContain('reparent');
    expect(ZH_STRINGS.toolbar.searchPlaceholder).toContain('末端');
    expect(EN_STRINGS.geneBuilder.mapping(2, 3)).toContain('tip names match');
    expect(EN_STRINGS.geneBuilder.mapping(1, 1)).toContain('tip name matches');
    // docs/UI_STYLE_GUIDE.md §3.3 / docs/UI_GLOSSARY.md rule 1: a modifier glued
    // straight to an ACTION word is written `Alt + 拖拽` / `Alt + drag`, while a
    // key chord keeps its tight form (`Ctrl+Shift+Z` — one letter after the `+`).
    const TIGHT_MODIFIER = /(Alt|Shift|Space)\+(?:[A-Za-z]{2,}|[\u3400-\u9fff])/;
    for (const leaf of [...zhLeaves, ...enLeaves]) {
      expect(leaf.value, `${leaf.path}: ${leaf.value}`).not.toMatch(TIGHT_MODIFIER);
    }
  });
});
