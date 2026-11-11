<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# CladeForge 术语表 / Glossary

> **历史对照（非规范性）。** 界面文案以 `docs/UI_GLOSSARY.md` 为准；本表仅保留领域/手册用词的历史对照。

One concept, one word — in the UI, the manual and the exports. The review round
found the same object called 枝/边/连线/入边 in different places, and "二分分支"
vs "二叉分支" for the SAME operation; this table is the fix and the rule.

## 中英对照（唯一用词）

> **界面文字以 `docs/UI_GLOSSARY.md` 为准。** 本表保留为领域/手册用词的历史对照；两者冲突时，以 UI_GLOSSARY 为唯一事实来源。

| 概念 | 唯一中文 | 唯一英文 | 禁用语 |
|---|---|---|---|
| branch | **枝** | branch | 边、连线、分支（仅用于构词：二叉/多歧） |
| 进入某节点的枝 | 该节点的枝 | incoming branch | 入边 |
| 用户自画的关联线 | **自定义连线** | custom link | 关联线、连线（避免与枝混淆） |
| tip | **末端（tip）** | tip | 尖端、叶节点 |
| 分类单元 | **分类单元** | taxon (pl. taxa) | — |
| node | **节点** | node | — |
| character | **性状** | character | 特征、trait（主术语） |
| state | **状态** | state | — |
| polymorphic set | **多态集合** | polymorphic set | — |
| hypothesis layer | **假说层** | hypothesis layer | 层（单独使用时） |
| reconciliation (DTL) | **协调（基因树–物种树协调）** | reconciliation | 协同重建、协同（会被读成“多人协作”）、Reconcile（名词） |
| 多人协作（未来项） | **协作** | collaboration | 协同 |
| rooting | **重新定根** | reroot | 定根（单独动作）、重根、移根 |
| MRCA | **最近共同祖先（MRCA）** | MRCA | 裸缩写 MRCA（首次出现须带全称） |
| binary / polytomy | **二叉 / 多歧分支** | binary / polytomy | 二分、多叉、多分叉 |
| support value | **支持度** | support | 支持率、支持值 |
| calibration point | **校准点（化石约束注记）** | calibration point | 校准（它参与拟合窗口与一致性校验，但不会自动改写节点年龄） |
| branch length | **枝长** | branch length | 分支长度 |
| event | **演化事件** | evolutionary event | — |
| assumption (gene node) | **（基因节点的）映射假设** | mapping assumption | — |
| embedded reconciliation layout | **嵌入式协调布局（嵌套视图）** | embedded reconciliation layout | 嵌入式协调（缩略） |
| species branch tube | **物种枝管道** | species branch tube | 管道（单独使用） |
| branch position | **枝内位置**（宿主枝内 0–1 的相对落点） | branch position | 枝上位置 |
| transfer donor | **转移供体** | transfer donor | 供体枝（指节点时） |
| display inference | **显示推断**（不写入假设的布局占位） | display inference | 自动推断 |
| loss stub | **丢失残枝** | loss stub | 损失残枝 |
| change branch | **变化枝** | change branch | — |

## 规则

1. 新增文案必须进 `strings.ts`（zh/en 类型强制同形）；`tr('…','…')` 仅用于
   数据插值与一次性提示，禁止承载术语。
2. 引用界面元素时统一加「」，并优先引用 `S.nav.*` / `S.toolbar.*` 的常量，
   避免改名后指路文案失效。
3. “错误/警告必须含一个行动”——只描述状态的文案不发布。
4. 事件的“同塑/回复”措辞跟随性状模型：无序模型不说“可能违反不可逆性”。
