<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# CladeForge 术语表 / Glossary

> **历史对照（非规范性）。** 界面文案以 `docs/UI_GLOSSARY.md` 为准；本表仅保留领域/手册用词的历史对照。

一个概念只对应一个词——界面、手册与导出件都统一。那一轮评审发现同一对象在
不同地方被写成 枝/边/连线/入边，同一个操作又同时被写作“二分分支”与“二叉分支”；
本表记录那一轮的裁定，凡本表与 `docs/UI_GLOSSARY.md` 有出入之处，一律以
`docs/UI_GLOSSARY.md` 为准。

## 中英对照（唯一用词）

> **界面文字以 `docs/UI_GLOSSARY.md` 为准。** 本表保留为领域/手册用词的历史对照；两者冲突时，以 UI_GLOSSARY 为唯一事实来源。

| 概念 | 唯一中文 | 唯一英文 | 禁用语 |
|---|---|---|---|
| branch | **枝**（历史写法；现行规范见 UI_GLOSSARY:21——「枝」为唯一主译名，「分支」仅用于构词：二叉、多歧） | branch | 边、连线（单独使用）、分支（仅用于构词：二叉/多歧） |
| 进入某节点的枝 | 该节点的枝 | incoming branch | 入边 |
| 用户自画的关联线 | **自定义连线** | custom link | 关联线、连线（单独使用，避免与枝混淆） |
| tip | **末端（tip）** | tip | 尖端、叶节点 |
| 分类单元 | **分类单元** | taxon (pl. taxa) | — |
| node | **节点** | node | — |
| character | **性状** | character | 特征、trait（主术语） |
| state | **状态**（历史写法；现行规范见 UI_GLOSSARY:25「性状状态」，裸「状态」作名词已禁，见 UI_GLOSSARY:26「状态变化」） | state | 状态（单独使用，按现行规范禁用） |
| polymorphic set | **多态集合** | polymorphic set | — |
| hypothesis layer | **假说层** | hypothesis layer | 层（单独使用时） |
| reconciliation (DTL) | **协调（基因树–物种树协调）**（名词概念）；「协调重建 / DTL 协调」为动作与算法语境的授权派生形（现行规范见 UI_GLOSSARY:35） | reconciliation | 协同重建、协同（会被读成“多人协作”）、Reconcile（名词） |
| 多人协作（未来项） | **协作** | collaboration | 协同 |
| rooting（概念本身） | **定根**（指“确定根的位置”这一概念，首次出现写全「定根（rooting）」；现行规范见 UI_GLOSSARY:58） | rooting | 生根、置根 |
| reroot（动作） | **重新定根** | reroot | 定根（单独作动作标签）、重根、移根、生根 |
| midpoint rooting / 按钮 | **中点定根**（概念名 midpoint rooting，动作按钮标签 Midpoint reroot；裁决见 UI_GLOSSARY:60） | midpoint rooting / Midpoint reroot | 中点生根、中点重根 |
| MRCA | **最近共同祖先（MRCA）** | most recent common ancestor (MRCA) | 裸缩写 MRCA（首次出现须带全称） |
| clade | **支系**（历史表原缺条目；现行规范见 UI_GLOSSARY:63，禁「类群」，「分支」让给 branch） | clade | 类群、分支（构词除外）、单系群（未经检验时） |
| split | **分裂**（RF、二分分割语境专用；与 clade「支系」不得互换，见 UI_GLOSSARY:79） | split | clade（RF 语境误用） |
| ladderize | **阶梯化**（历史表原缺条目；现行规范见 UI_GLOSSARY:61） | ladderize | 梯形化、层次化、阶梯排序 |
| reticulation | **网状关系**（历史表原缺条目；用户画出的那条线仍叫「自定义连线」，见 UI_GLOSSARY:23） | reticulation | 网格关系、网络化、横向关系 |
| binary / polytomy | **二叉 / 多歧分支** | binary / polytomy | 二分分支、多叉、多分叉 |
| support value | **支持度** | support | 支持率、支持值 |
| calibration point | **校准点（化石约束注记）** | calibration point | 校准（单独使用）；它参与 NEXUS 导出、时间一致性校验与「按校准点拟合年龄」，但不会自动改写节点年龄 |
| branch length | **枝长** | branch length | 分支长度 |
| event | **演化事件** | evolutionary event | — |
| assumption (gene node) | **（基因节点的）映射假设** | mapping assumption | — |
| embedded reconciliation layout | **嵌套视图**（历史写法“嵌入式协调布局”已废；现行规范见 UI_GLOSSARY:45） | embedded reconciliation layout / embedded view | 嵌入式协调（缩略）、嵌入式视图、内嵌视图 |
| species branch tube | **物种枝管道** | species branch tube | 管道（单独使用） |
| branch position | **枝内位置**（宿主枝内 0–1 的相对落点） | branch position | 枝上位置 |
| transfer donor | **转移供体** | transfer donor | 供体枝（指节点时） |
| display inference | **显示推断**（不写入假设的布局占位） | display inference | 自动推断 |
| loss stub | **丢失残枝** | loss stub | 损失残枝 |
| change branch | **变化枝** | change branch | — |

## 规则

1. 新增文案必须进 `src/ui/strings.ts`（zh/en 类型强制同形）；`tr('…','…')` 仅用于
   数据插值与一次性提示，禁止承载术语。
2. 引用界面元素时统一加「」，并优先引用 `S.nav.*` / `S.toolbar.*` 的常量，
   避免改名后指路文案失效。
3. “错误/警告必须含一个行动”——只描述状态的文案不发布。
4. 事件的“同塑/回复”措辞跟随性状模型：无序模型不说“可能违反不可逆性”。
5. 本表只作历史对照：凡与 `docs/UI_GLOSSARY.md` 冲突处，一律以 UI_GLOSSARY 为准；
   带“（历史写法；现行规范见 UI_GLOSSARY:…）”或“（历史表原缺条目；…）”标注的行，
   不得按本表用词落地。
6. 语言名称、专有名词、文件格式与软件名（Newick、NEXUS、NeXML、MrBayes、BEAST、
   Robinson–Foulds 等）在中英文可见字符串中均不翻译、不音译、不改大小写；
   详见 `docs/UI_GLOSSARY.md` 规则 9。
7. 禁用词须与 `src/ui/copyQuality.test.ts` 的闸门保持双向同步，流程要求见
   `docs/UI_GLOSSARY.md`「术语表与禁用词闸门的同步」一节。
