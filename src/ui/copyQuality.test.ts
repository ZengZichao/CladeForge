// Copy-quality gate for the bilingual UI catalogue.
//
// The 2026-11 UI review found scientific mistranslations, mixed terminology,
// pseudo-plurals, raw enum leakage and untranslated shortcut group keys. These
// checks encode the fixes in docs/UI_GLOSSARY.md so a later edit cannot quietly
// reintroduce them.

import { describe, expect, it } from 'vitest';
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

describe('UI copy quality', () => {
  it('has exactly the same key paths in both locales', () => {
    expect(enLeaves.map((leaf) => leaf.path).sort()).toEqual(zhLeaves.map((leaf) => leaf.path).sort());
  });

  it('never uses the forbidden Chinese terminology', () => {
    const forbidden = [
      '尖端',
      '叶节点',
      '支持率',
      '支持值',
      '物种化',
      '加倍',
      '损失',
      '重根',
      '多分叉',
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
    ];
    for (const term of forbidden) {
      expect(values(zhLeaves), `forbidden Chinese term: ${term}`).not.toContain(term);
    }
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
  });
});
