<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# CladeForge UI Glossary

> 中文版：[UI_GLOSSARY.md](./UI_GLOSSARY.md)

> **Normative document.** UI copy follows this table; `docs/GLOSSARY.md` is kept for historical comparison only.

> This table is the single source of truth for the wording of interface text. When adding or
> changing UI copy, consult this table first; one concept has exactly one English and one Chinese
> spelling. This table supersedes the conflicting legacy entries of `docs/GLOSSARY.md` (the latter
> is retained as a historical record).
> This English file is the mandatory companion of the Chinese original `docs/UI_GLOSSARY.md`: the
> two must stay in sync section by section, and a change on either side must be mirrored on the
> other side. If they ever disagree, `docs/UI_GLOSSARY.md` governs.

## Core Concepts

| Concept | Canonical English (UI) | Canonical 中文 | Avoid |
|---|---|---|---|
| tree | tree | 树 | — |
| tip | tip | 末端（tip） | avoid 尖端 ("pointed tip"), 叶节点 ("leaf node") when used alone |
| internal node | internal node | 内部节点 | avoid 内部 ("interior") alone as a noun |
| branch | branch | 枝 / 分支（构词：二叉、多歧） | avoid edge (for a tree's branch) |
| custom link | custom link | 自定义连线 | avoid 关联线 ("association line"), 连线 ("connector") used alone, 网格线 ("grid line"), 交叉线 ("crossing line") |
| reticulation | reticulation | 网状关系（界面上由用户画出的那条线仍称 custom link「自定义连线」） | avoid 网格关系 ("grid relation"), 网络化 ("networking"), 横向关系 ("lateral relation") |
| character | character | 性状 | avoid trait (not the master term); 字符 only ever means a text glyph |
| character state | character state | 性状状态 | avoid 状态 ("state") used alone |
| state change | state change | 状态变化 | avoid transition (except nucleotide substitution) |
| support | support | 支持度 | avoid 支持率 ("support rate"), 支持值 ("support value") |
| support kind | support kind | 支持度类型 | avoid 支持值类型 ("support-value type") |
| node age | node age | 节点年龄 | avoid 年代 except for geological ages |
| time unit | time unit | 时间单位 | avoid the raw lower-case enum value |
| hypothesis layer | hypothesis layer | 假说层 | avoid 假设层 (假设 in place of 假说) |
| hypothesis note | hypothesis note | 假说标注 | avoid 注释 ("annotation") as a generic term |
| DTL mapping assumption | DTL mapping assumption | DTL 映射假设（本行即“假设”的授权用法：指基因节点上被映射的那条可竞争假定） | avoid bare DTL 假设 (too vague) |
| scenario | scenario | 场景 | avoid rendering scenario as 假设/假说 (only this one mapping is banned; the word 假设 itself is not banned — it remains licensed in 「DTL 映射假设」) |
| reconciliation | reconciliation | 协调（名词概念，首次出现写全「基因树–物种树协调」）；协调重建 / DTL 协调（动作与算法语境的授权派生形，见下方说明） | avoid 协同重建 ("collaborative reconstruction"), 协同 (reads as multi-user collaboration), Reconcile as a noun |
| speciation | speciation | 物种形成 | avoid 物种化 ("species-ification") |
| duplication | duplication | 基因重复 | avoid 加倍 ("doubling") outside WGD contexts |
| horizontal transfer | horizontal transfer (HGT) | 水平转移 | avoid 转移 ("transfer") used alone |
| gene loss | gene loss | 基因丢失 | avoid 损失 (confusable with cost) |
| gene tree | gene tree | 基因树 | avoid 树库 ("tree library") as a panel heading |
| species tree | species tree | 物种树 | — |
| mapping | mapping | 映射 | avoid 定位 used to mean "mapping" (the locate/jump sense, as in 「定位到节点」 or 「点击定位」, is legitimate) |
| unmapped | unmapped | 未映射 | avoid 未解析 (already gated — see the Synchronisation section: no mapping ⇒ 未映射, unresolved topology ⇒ 多歧分支, mapped but with no inferred event yet ⇒ 事件未定) |
| polytomy | polytomy | 多歧分支 | avoid 多叉, 多分叉 |
| embedded view | embedded view (embedded layout) | 嵌套视图 | avoid 嵌入式视图, 内嵌视图 |
| side-by-side view | side-by-side view | 并排对照（视图） | avoid 双窗格视图 in UI strings (acceptable in descriptive prose) |
| species branch tube | species branch tube | 物种枝管道 | avoid 管道 ("tube/pipe") alone, 粗枝 ("thick branch") |
| hub bar | hub bar | 纵向枢纽 | avoid 枢纽条, 竖条 ("vertical bar") |
| lane | lane | 车道 | avoid 泳道 ("swim lane"), 轨道 ("track") |
| branch position | branch position (branchFraction) | 枝内位置 | avoid 枝上位置, 分支内位置 |
| transfer donor | transfer donor | 转移供体 | avoid 供体 ("donor") used alone |
| transfer arc | transfer arc | 转移弧 | avoid 弧线 ("arc/curve") used alone |
| loss stub | loss stub | 丢失残枝 | avoid 残枝 used alone, 损失残枝 (损失 = "loss" the wrong sense) |
| display inference | display inference (noun) / display-inferred (adjective) | 显示推断 | avoid 自动推断 ("automatic inference" — clashes with the MRCA suggestion) |
| orphan gutter | orphan gutter (unmapped gene nodes) | 未映射基因节点（孤立区） | avoid 孤儿区 ("orphan area"); 隔离区 ("quarantine area") is acceptable in prose as an explanation |
| topological sketch | topological sketch | 拓扑示意 | avoid 示意图 (too vague) |
| hard / soft polytomy | hard / soft polytomy | 硬 / 软多歧 | avoid 硬 / 软多分叉 |
| rooting | rooting | 定根（指“确定根的位置”这一概念本身；首次出现写全「定根（rooting）」） | avoid 生根 ("sprouting"), 置根 |
| reroot | reroot | 重新定根（改变已有的根；动作标签一律用此，不用裸「定根」） | avoid bare 定根 as an action label, 重根, 移根, 生根 |
| midpoint rooting | midpoint rooting (concept/algorithm name); Midpoint reroot (action-button label, see the ruling below) | 中点定根 | avoid 中点生根, 中点重根 |
| ladderize | ladderize | 阶梯化 | avoid 梯形化, 层次化, 阶梯排序 |
| outgroup | outgroup | 外群 | avoid 外类群 |
| clade | clade | 支系 | avoid 类群, 分支 (confusable with branch), 单系群 ("monophyletic group") when untested; in RF contexts use split「分裂」 |
| MRCA | most recent common ancestor (MRCA) | 最近共同祖先（MRCA） | avoid 最近共祖 used alone, and bare LCA (use MRCA in UI and prose) |
| ASR | ancestral-state reconstruction (ASR) | 祖先状态重建（ASR） | avoid 概率重建, 概率推断 |
| Mk | Mk model | Mk 模型 | avoid MK |
| ER | equal rates (ER) | 等速率（ER） | — |
| parsimony | parsimony | 简约法 | — |
| MP | maximum parsimony (MP) | 最大简约（MP） | — |
| MAP | maximum a posteriori (MAP) | 最大后验（MAP） | — |
| CI / RI | consistency index / retention index | 一致性指数 / 保留指数 | avoid 系统发育信号 (misuse) |
| phylogenetic signal | phylogenetic signal | 系统发育信号 | avoid CI/RI (misuse) |
| Brownian motion (BM) | Brownian motion (BM) | 布朗运动（BM） | — |
| Blomberg’s K | Blomberg’s K | Blomberg’s K | avoid the straight-apostrophe variant (Blomberg's K) |
| Jaccard overlap | Jaccard overlap | Jaccard 重叠 | avoid 相关性 ("correlation") when untested |
| permutation test | permutation test | 置换检验 | — |
| Holm–Bonferroni | Holm–Bonferroni | Holm–Bonferroni | avoid spellings without the en dash |
| Robinson–Foulds | Robinson–Foulds (RF) | Robinson–Foulds（RF） | avoid bare RF (unexplained) |
| split | split | 分裂（拓扑二分所诱导的末端集合划分；RF、二分分割、位点模式语境专用） | avoid clade (should be「支系」, see the clade row), 分支 (except in word-formation) |
| NEXUS | NEXUS | NEXUS | avoid Nexus |
| Newick | Newick | Newick | — |
| NeXML | NeXML | NeXML | — |
| MrBayes | MrBayes | MrBayes | avoid "MrBayes block" (gated; MrBayes is configured via NEXUS blocks), mrbayes (lower case) |
| BEAST | BEAST | BEAST | avoid "BEAST block" (gated; BEAST is configured via XML), beast (lower case) |
| ICS | International Chronostratigraphic Chart (ICS) | 国际年代地层表（ICS） | — |
| Ma | Ma (mega-annum) | Ma（百万年前） | avoid Mya, ma |
| Myr | Myr (million years) | Myr（百万年，持续时间） | avoid treating it as equivalent to Ma |
| ka / Ga | ka / Ga | ka / Ga | avoid kya / Gya (UI options) |
| subst./site | substitutions per site | 每位点替换数 | avoid s/s |
| DPI | DPI | DPI | avoid dpi at sentence start |
| sample / fixture | sample (built-in example project) | 示例 | avoid 样例 (the built-in example projects are 示例 in the shipped UI; `fixture` is test-harness vocabulary, never a UI label) |

### Notes on individual concept entries

- **midpoint rooting / Midpoint reroot (ruling)**: the concept entry, the manual and Methods prose
  all use `midpoint rooting`; the Chinese is always 「中点定根」. As an **action-button** label the
  English reads `Midpoint reroot` (`S.toolbar.rerootMidpoint`, consistent with the sibling
  `Reroot at selected node` because the button re-roots an existing tree); the Chinese button still
  reads 「中点定根」 and must not be rewritten as 「中点重根」 to match the English. The two spellings
  are one concept in two registers, not a terminology inconsistency.
- **ladderize**: always 「阶梯化」 (`S.toolbar.ladderize*`, `S.cmd.ladderize*`); 梯形化 and 层次化 are banned.
- **clade vs split**: `clade` = 支系, a group made of an ancestor and all of its 后代 (descendants),
  used for user-facing objects such as 「选中支系」 or 「提取子树」; `split` = 分裂, the bipartition of the
  tip set induced by deleting one branch, used only in computational contexts (Robinson–Foulds,
  bipartition, site patterns). They are never interchangeable: no clade in RF contexts, no split for
  user-facing objects; 类群 is not the translation of any concept.
- **reticulation**: always 「网状关系」; the line the user draws in the UI is still a 「自定义连线」
  (custom link) — `reticulation` names the biological relation it expresses (HGT, hybridisation,
  endosymbiosis, recombination, association) and never changes a control name.
- **reconciliation (ruling)**: 协调 is the one canonical Chinese noun for the concept (first mention
  in full: 「基因树–物种树协调」); 协调重建 and 「DTL 协调」 are **licensed derived forms for action and
  algorithm contexts**, used in module names, buttons, reports and view names
  (`S.nav.recon`, `S.exportItems.reconReport`, `S.review.shortcutEscExitRecon` etc.); they do not
  conflict with 协调 and are not violations. Both must never be written with 协同 — 协同 reads as
  multi-user collaboration (collaboration is a different concept).

## Action Words

| Action | English | 中文 | Usage |
|---|---|---|---|
| delete | delete | 删除 | persistent objects (nodes, events, gene trees, hypothesis layers) |
| remove | remove | 移除 | take out of a list while keeping the object |
| clear | clear | 清除 | empty contents (mappings, events, reconstruction results) |
| reset | reset | 重置 | restore defaults (view settings, local data) |
| discard | discard | 放弃 | drop an unsaved session |
| import | import | 导入 | read in from a file |
| open | open | 打开 | projects, examples |
| save | save | 保存 | write to the project file |
| autosave | autosave | 自动保存（到本地恢复区） | distinct from writing the project file |

## Rules

1. Insert one space between Chinese and Latin letters / digits; no space before Chinese punctuation
   (applies to the Chinese side only).
2. Chinese sentences use full-width punctuation; control names and paths go in 「」; concepts and
   quotations go in “”; an ASCII `"` is never a visible quote mark (applies to the Chinese side only).
3. Numeric ranges use the en dash `–`; the Chinese dash is `——`; connecting statisticians' names
   uses the en dash (Holm–Bonferroni, Robinson–Foulds). The `——` clause applies to the Chinese side only.
4. English UI text uses British spelling throughout: Colour, Licence, Centre, normalised,
   cancelled, grey, Favourite, Greyscale.
5. No pseudo-plurals `(s)` / `(es)`; English uses the correct singular or plural, Chinese uses
   measure words (量词 — the Chinese-side half of this rule).
6. No Chinese inside visible English strings (language names excepted); no untranslated enum
   values or internal key names inside visible Chinese strings (the second half applies to the
   Chinese side only).
7. Long explanations stay in the copyable Methods & limits document; the UI keeps a 1–2 sentence summary.
8. After any copy change run `npm test` (`src/ui/copyQuality.test.ts` blocks banned words,
   pseudo-plurals and CJK leakage).
9. **Language names, proper nouns, file formats and software names are never translated** in
   visible English strings and keep their original form and capitalisation: Newick, NEXUS, NeXML,
   MrBayes, BEAST, R, JSON, CSV, DPI, Robinson–Foulds, etc. Visible Chinese strings likewise keep
   these names verbatim — no transliteration (“纽厄克”, “内克西斯”) and no respelling of case
   (nexus, beast); that clause applies to the Chinese side only. Language names (中文 / English)
   follow rule 6.
10. The Avoid column of this table and the banned-word array in `src/ui/copyQuality.test.ts` are
    two views of one and the same constraint and **must be synchronised in both directions**: a
    word added or changed on either side is mirrored on the other side in the same change (see the
    next section).

## Glossary and copy-gate synchronisation

The gate (the banned-Chinese-word array in `src/ui/copyQuality.test.ts`) and the Avoid column of
the table above previously had gaps in both directions. They are now closed with formal entries,
and both sides take this section as authoritative.

### Banned by the gate, now formalised as table entries

| Gate-banned 中文 | Canonical English (UI) | Canonical 中文 | Note |
|---|---|---|---|
| 观感 | appearance | 外观 | refers to the tree's visual presentation (`S.layoutPanel.supportThresholdNoData` already uses 外观) |
| 推理 | inference | 推断 | statistical / ancestral-state contexts; 推理 is only used when describing a model's logic |
| 载入、加载 | load | 打开（文件、示例）/ 读取（数值、阈值） | distinct from import 「导入」: opening or reading creates no new object |
| 兄弟 | sibling | 同级 | `S.toolbar.addSibling` and `S.doc.vGap` already use 同级 |
| 数据质量 | Mapping validation | 映射校验 | the canonical label of `S.recon.dataQuality` (`src/ui/strings.ts` ships 映射校验 / `Mapping validation`); for the general completeness of data write 数据完备性 |
| 快速行动 | quick actions | 快速操作 | the canonical Chinese of `S.recon.quickActions` |
| 基部分支 | basal branch | 近根枝 | descriptive wording only: neither 近根枝 nor 靠近根的枝 occurs in any shipped UI string, `copyQuality.test.ts` pins that `S.notify.outgroupNoOp` carries neither 基部 nor basal, and 枝 is never written as 分支 |
| 未解析 | unresolved / unmapped | 未映射（基因节点无映射）；多歧分支（拓扑未解决）；事件未定（a mapped gene node with no inferred event yet; the name of that state in this table, not a shipped label — what ships is the legend `S.recon.legendInferred`, 「显示推断（虚线，不写入假说）」 / `Display-inferred (dashed, not stored)`, and `src/io/embeddedReconExport.ts` writes 「显示推断（虚线，不写入假说）/ display-inferred」 into exported figures; both name the display treatment, not the state） | the three senses differ; none of them may be written 未解析 |

### Banned in the table, not yet enforced by the gate

Of the terms banned in the Avoid column, only 样例 (see the sample / fixture row) still has no
counterpart in the gate array; whoever maintains `copyQuality.test.ts` adds it. The others are in
`FORBIDDEN_ZH` and enforced by the gate: 嵌入式视图 and 内嵌视图 (see the embedded view row),
泳道 and 轨道 (see the lane row), 枢纽条 (see the hub bar row), 弧线 (see the transfer arc row),
外类群 (see the outgroup row) and 字符 (see the character row).

### Sync procedure

1. Adding a banned word: first register it in the Avoid column of the relevant row, then add it to
   the gate array — both in the same change.
2. Lifting or renaming a ban: first confirm the UI strings all use the canonical terms
   (`npm test` passes), then delete the entry on both sides at once.
3. The gate only carries hard "present ⇒ fail" constraints; context-dependent cases (e.g.
   枝上位置 violating only inside certain phrases) stay in the table for reviewers to judge and are
   not forced into the gate.
4. Run `npm test` after every change; if this table and the gate disagree, the table is the
   normative source and the gate aligns to it.
