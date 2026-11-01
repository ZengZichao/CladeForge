# CladeForge 术语表 / Glossary

One concept, one word — in the UI, the manual and the exports. The review round
found the same object called 枝/边/连线/入边 in different places, and "二分分支"
vs "二叉分支" for the SAME operation; this table is the fix and the rule.

## 中英对照（唯一用词）

| 概念 | 唯一中文 | 唯一英文 | 禁用语 |
|---|---|---|---|
| branch | **枝** | branch | 边、连线、分支（仅用于构词：二叉/多叉） |
| 进入某节点的枝 | 该节点的枝 | incoming branch | 入边 |
| 用户自画的关联线 | **关联线** | custom edge / link | 连线（避免与枝混淆） |
| tip | **末端（tip）** | tip | 尖端 |
| 分类单元 | **分类单元** | taxon (pl. taxa) | — |
| node | **节点** | node | — |
| character | **性状** | character | 特征 |
| state | **状态** | state | — |
| polymorphic set | **多态集合** | polymorphic set | — |
| hypothesis layer | **假说层** | hypothesis layer | 层（单独使用时） |
| reconciliation (DTL) | **协同重建（DTL）** | reconciliation | 协同（单独使用——会被读成“多人协作”） |
| 多人协作（未来项） | **协作** | collaboration | 协同 |
| rooting | **定根** | rooting | 换根 |
| MRCA | **最近共同祖先（MRCA）** | MRCA | 裸缩写 MRCA（首次出现须带全称） |
| binary / polytomy | **二叉 / 多叉** | binary / polytomy | 二分、多分叉 |
| support value | **支持值** | support value | 支持率（刻度不明时） |
| calibration point | **校准点（化石约束注记）** | calibration point | 校准（它不参与定年计算——只注记与校验） |
| branch length | **枝长** | branch length | 分支长度 |
| event | **演化事件** | evolutionary event | — |
| assumption (gene node) | **（基因节点的）映射假设** | mapping assumption | — |
| change branch | **变化枝** | change branch | — |

## 规则

1. 新增文案必须进 `strings.ts`（zh/en 类型强制同形）；`tr('…','…')` 仅用于
   数据插值与一次性提示，禁止承载术语。
2. 引用界面元素时统一加「」，并优先引用 `S.nav.*` / `S.toolbar.*` 的常量，
   避免改名后指路文案失效。
3. “错误/警告必须含一个行动”——只描述状态的文案不发布。
4. 事件的“同塑/回复”措辞跟随性状模型：无序模型不说“可能违反不可逆性”。
