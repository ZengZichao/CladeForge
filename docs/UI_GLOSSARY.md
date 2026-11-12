<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# CladeForge UI 术语表 / UI Glossary

> English version: [UI_GLOSSARY_EN.md](./UI_GLOSSARY_EN.md)

> **规范性文件。** 界面文案以本表为准；`docs/GLOSSARY.md` 为历史对照。

> 本表是界面文字的唯一事实来源。新增或修改 UI 文案时，先查此表；同一概念只能有一个中英文写法。
> 本表取代 `docs/GLOSSARY.md` 中与本表冲突的旧条目（后者保留为历史记录）。
> 英文对照文件 `docs/UI_GLOSSARY_EN.md` 是本表的必备配套：两份文件须逐节保持一致，任一侧有改动时，
> 必须在同一次改动中同步到另一侧；两者若有出入，一律以本表 `docs/UI_GLOSSARY.md` 为准。

## 核心概念

| 概念 | 规范 English | 规范中文 | 避免 |
|---|---|---|---|
| tree | tree | 树 | — |
| tip | tip | 末端（tip） | 尖端、叶节点（单独使用） |
| internal node | internal node | 内部节点 | 内部（单独作名词） |
| branch | branch | 枝 / 分支（构词：二叉、多歧） | edge（树的枝） |
| custom link | custom link | 自定义连线 | 关联线、连线（单独使用）、网格线、交叉线 |
| reticulation | reticulation | 网状关系（界面上由用户画出的那条线仍称 custom link「自定义连线」） | 网格关系、网络化、横向关系 |
| character | character | 性状 | trait（主术语）、字符（仅指文本字形） |
| character state | character state | 性状状态 | 状态（单独使用） |
| state change | state change | 状态变化 | transition（仅核苷酸替换） |
| support | support | 支持度 | 支持率、支持值 |
| support kind | support kind | 支持度类型 | 支持值类型 |
| node age | node age | 节点年龄 | 年代（仅地质年代） |
| time unit | time unit | 时间单位 | 原始小写枚举 |
| hypothesis layer | hypothesis layer | 假说层 | 假设层 |
| hypothesis note | hypothesis note | 假说标注 | 注释（泛称） |
| DTL mapping assumption | DTL mapping assumption | DTL 映射假设（本行即“假设”的授权用法：指基因节点上被映射的那条可竞争假定） | DTL 假设（过泛） |
| scenario | scenario | 场景 | 把 scenario 译作“假设/假说”（本栏只禁止这一种对应译法；“假设”二字本身未被禁用，仍用于「DTL 映射假设」） |
| reconciliation | reconciliation | 协调（名词概念，首次出现写全「基因树–物种树协调」）；协调重建 / DTL 协调（动作与算法语境的授权派生形，见下方说明） | 协同重建、协同（会被读成多人协作）、Reconcile（名词） |
| speciation | speciation | 物种形成 | 物种化 |
| duplication | duplication | 基因重复 | 加倍（WGD 语境除外） |
| horizontal transfer | horizontal transfer (HGT) | 水平转移 | 转移（单独使用） |
| gene loss | gene loss | 基因丢失 | 损失（与 cost 混淆） |
| gene tree | gene tree | 基因树 | 树库（作为栏目标题） |
| species tree | species tree | 物种树 | — |
| mapping | mapping | 映射 | 定位（作 mapping 义时；「定位到节点」一类 locate 义合法） |
| unmapped | unmapped | 未映射 | 未解析（闸门已禁，见「同步」节：无映射写「未映射」，拓扑未解决写「多歧分支」，已映射但无推断事件写「事件未定」） |
| polytomy | polytomy | 多歧分支 | 多叉、多分叉 |
| embedded view | embedded view (embedded layout) | 嵌套视图 | 嵌入式视图、内嵌视图 |
| side-by-side view | side-by-side view | 并排对照（视图） | 双窗格视图（描述性文字可用） |
| species branch tube | species branch tube | 物种枝管道 | 管道（单独使用）、粗枝 |
| hub bar | hub bar | 纵向枢纽 | 枢纽条、竖条 |
| lane | lane | 车道 | 泳道、轨道 |
| branch position | branch position (branchFraction) | 枝内位置 | 枝上位置、分支内位置 |
| transfer donor | transfer donor | 转移供体 | 供体（单独使用） |
| transfer arc | transfer arc | 转移弧 | 弧线（单独使用） |
| loss stub | loss stub | 丢失残枝 | 残枝（单独使用）、损失残枝 |
| display inference | display inference（名词）/ display-inferred（形容词） | 显示推断 | 自动推断（会与 MRCA 建议混淆） |
| orphan gutter | orphan gutter (unmapped gene nodes) | 未映射基因节点（孤立区） | 孤儿区、隔离区（文字可用“隔离区”作解释） |
| topological sketch | topological sketch | 拓扑示意 | 示意图（过泛） |
| hard / soft polytomy | hard / soft polytomy | 硬 / 软多歧 | 硬 / 软多分叉 |
| rooting | rooting | 定根（指“确定根的位置”这一概念本身；首次出现写全「定根（rooting）」） | 生根、置根 |
| reroot | reroot | 重新定根（改变已有的根；动作标签一律用此，不用裸「定根」） | 定根（单独作动作标签）、重根、移根、生根 |
| midpoint rooting | midpoint rooting（概念/算法名）；Midpoint reroot（动作按钮标签，见下方裁决） | 中点定根 | 中点生根、中点重根 |
| ladderize | ladderize | 阶梯化 | 梯形化、层次化、阶梯排序 |
| outgroup | outgroup | 外群 | 外类群 |
| clade | clade | 支系 | 类群、分支（与 branch 混淆）、单系群（未经检验时）；RF 语境应作 split「分裂」 |
| MRCA | most recent common ancestor (MRCA) | 最近共同祖先（MRCA） | 最近共祖（单独使用）、LCA（裸缩写，界面与正文统一写 MRCA） |
| ASR | ancestral-state reconstruction (ASR) | 祖先状态重建（ASR） | 概率重建、概率推断 |
| Mk | Mk model | Mk 模型 | MK |
| ER | equal rates (ER) | 等速率（ER） | — |
| parsimony | parsimony | 简约法 | — |
| MP | maximum parsimony (MP) | 最大简约（MP） | — |
| MAP | maximum a posteriori (MAP) | 最大后验（MAP） | — |
| CI / RI | consistency index / retention index | 一致性指数 / 保留指数 | 系统发育信号（误用） |
| phylogenetic signal | phylogenetic signal | 系统发育信号 | CI/RI（误用） |
| Brownian motion (BM) | Brownian motion (BM) | 布朗运动（BM） | — |
| Blomberg’s K | Blomberg’s K | Blomberg’s K | 直撇号变体（Blomberg's K） |
| Jaccard overlap | Jaccard overlap | Jaccard 重叠 | 相关性（未检验时） |
| permutation test | permutation test | 置换检验 | — |
| Holm–Bonferroni | Holm–Bonferroni | Holm–Bonferroni | 无 en dash |
| Robinson–Foulds | Robinson–Foulds (RF) | Robinson–Foulds（RF） | RF（不解释） |
| split | split | 分裂（拓扑二分所诱导的末端集合划分；RF、二分分割、位点模式语境专用） | clade（应作「支系」，见 clade 行）、分支（构词除外） |
| NEXUS | NEXUS | NEXUS | Nexus |
| Newick | Newick | Newick | — |
| NeXML | NeXML | NeXML | — |
| MrBayes | MrBayes | MrBayes | MrBayes block（闸门禁；MrBayes 用 NEXUS 块配置）、mrbayes（小写） |
| BEAST | BEAST | BEAST | BEAST block（闸门禁；BEAST 用 XML 配置）、beast（小写） |
| ICS | International Chronostratigraphic Chart (ICS) | 国际年代地层表（ICS） | — |
| Ma | Ma (mega-annum) | Ma（百万年前） | Mya、ma |
| Myr | Myr (million years) | Myr（百万年，持续时间） | 与 Ma 等同 |
| ka / Ga | ka / Ga | ka / Ga | kya / Gya（界面选项） |
| subst./site | substitutions per site | 每位点替换数 | s/s |
| DPI | DPI | DPI | dpi（句首） |
| sample / fixture | sample (built-in example project) | 示例 | 样例（内置示例项目在界面中一律写作「示例」；`fixture` 是测试代码用语，不是界面标签） |

### 概念条目补充说明

- **midpoint rooting / Midpoint reroot（裁决）**：概念条目与手册、Methods 文字统一用
  `midpoint rooting`，中文一律「中点定根」。作为**动作按钮**标签时英文用
  `Midpoint reroot`（`S.toolbar.rerootMidpoint`，与同族的 `Reroot at selected node` 保持
  reroot 动词一致，因为按钮执行的是“在已有树上重新定根”这一动作）；中文按钮仍写
  「中点定根」，不得因英文改写为「中点重根」。两种写法是同一概念在不同语体下的形式，
  不视为术语不一致。
- **ladderize**：统一「阶梯化」（`S.toolbar.ladderize*`、`S.cmd.ladderize*`）；禁止「梯形化」「层次化」。
- **clade 与 split 的分工**：`clade`＝支系，指一个共同祖先及其全部后代，用于
  「选中支系」「提取子树」等面向用户的对象；`split`＝分裂，指一条枝删除后末端
  集合产生的二分划分，只在 Robinson–Foulds、二分分割、位点模式等计算语境出现。
  两者不得互换：RF 语境不得写 clade，面向用户的对象不得写 split；「类群」不作为任何
  概念的译名。
- **reticulation**：统一「网状关系」；界面上由用户手工画出的那条线仍叫「自定义连线」
  （custom link），`reticulation` 指其表达的生物学关系类型（HGT、杂交、内共生、重组、
  关联），不改变控件名称。
- **reconciliation（裁决）**：「协调」是名词概念的唯一规范译名（首次出现写全
  「基因树–物种树协调」）；「协调重建」「DTL 协调」是**动作与算法语境下的授权派生形**，
  用于模块名、按钮、报告与视图名（`S.nav.recon`、`S.exportItems.reconReport`、
  `S.review.shortcutEscExitRecon` 等），与「协调」不构成冲突，不判为违规。
  两者都禁止写作「协同」——「协同」会被读成多人协作（collaboration 是另一概念）。

## 动作词

| 动作 | English | 中文 | 用途 |
|---|---|---|---|
| delete | delete | 删除 | 持久对象（节点、事件、基因树、假说层） |
| remove | remove | 移除 | 从列表移除但保留对象 |
| clear | clear | 清除 | 清空内容（映射、事件、重建结果） |
| reset | reset | 重置 | 恢复默认（视图设置、本地数据） |
| discard | discard | 放弃 | 丢弃未保存会话 |
| import | import | 导入 | 从文件读入 |
| open | open | 打开 | 项目、示例 |
| save | save | 保存 | 写入项目文件 |
| autosave | autosave | 自动保存（到本地恢复区） | 与写入项目文件区分 |

## 规则

1. 中文与拉丁字母 / 数字之间加一个空格；中文标点前不加空格。
2. 中文句子使用全角标点；控件名 / 路径用「」；概念 / 引文用“”；禁止 ASCII `"` 作为可见引号。
3. 数值范围用 en dash `–`；中文破折号用 `——`；统计人名连接用 en dash（Holm–Bonferroni、Robinson–Foulds）。
4. 英文界面统一英式拼写：Colour、Licence、Centre、normalised、cancelled、grey、Favourite、Greyscale。
5. 禁止伪复数 `(s)` / `(es)`；英文用正确单复数，中文用量词。
6. 禁止在英文可见字符串中出现中文（语言名称除外）；禁止在中文可见字符串中出现未翻译的枚举或内部键名。
7. 长说明保留在可复制的 Methods & limits 文档中；界面只保留 1–2 句摘要。
8. 修改文案后运行 `npm test`（`src/ui/copyQuality.test.ts` 会拦截禁用词、伪复数与 CJK 泄漏）。
9. 英文可见字符串中的**语言名称、专有名词、文件格式与软件名不翻译**，保持原形与原有
   大小写：Newick、NEXUS、NeXML、MrBayes、BEAST、R、JSON、CSV、DPI、Robinson–Foulds
   等；中文可见字符串中同样保留其原形，不得音译（“纽厄克”“内克西斯”）或改写大小写
   （nexus、beast）。语言名称（中文 / English）按本表规则 6 处理。
10. 本表的「避免」列与 `src/ui/copyQuality.test.ts` 的禁用词表是同一份约束的两个视图，
    **必须双向同步**：新增或删改任一侧的词，须在同一改动中同步另一侧（见下节）。

## 术语表与禁用词闸门的同步

闸门（`src/ui/copyQuality.test.ts` 的中文禁用词数组）与上表「避免」列此前存在双向缺口。
现补齐为正式条目，两侧以本节为准。

### 闸门已拦截、现补为正式条目

| 闸门禁词 | 规范 English | 规范中文 | 说明 |
|---|---|---|---|
| 观感 | appearance | 外观 | 指树的可视呈现（`S.layoutPanel.supportThresholdNoData` 已用「外观」） |
| 推理 | inference | 推断 | 统计 / 祖先状态语境；「推理」只在描述模型逻辑时使用 |
| 载入、加载 | load | 打开（文件、示例）/ 读取（数值、阈值） | 与 import「导入」区分：打开或读取不新建对象 |
| 兄弟 | sibling | 同级 | `S.toolbar.addSibling`、`S.doc.vGap` 已用「同级」 |
| 数据质量 | Mapping validation | 映射校验 | 界面 `S.recon.dataQuality` 的规范中文（`src/ui/strings.ts` 实装即为「映射校验」，英文 `Mapping validation`）；泛指数据本身完备时写「数据完备性」 |
| 快速行动 | quick actions | 快速操作 | `S.recon.quickActions` 的规范中文 |
| 基部分支 | basal branch | 近根枝 | 描述性用语；近根枝与靠近根的枝都未出现在任何界面字符串中，`copyQuality.test.ts` 另钉住 `S.notify.outgroupNoOp` 既不含基部也不含 basal，且“枝”不写作“分支” |
| 未解析 | unresolved / unmapped | 未映射（基因节点无映射）；多歧分支（拓扑未解决）；事件未定（本表对该状态的称呼，并非界面实装文字；实装的是图例 `S.recon.legendInferred` 的「显示推断（虚线，不写入假说）」 / `Display-inferred (dashed, not stored)`，`src/io/embeddedReconExport.ts` 在导出图中写「显示推断（虚线，不写入假说）/ display-inferred」，二者说的都是绘制方式而非状态名） | 三者语义各不相同，一律不得写作「未解析」 |

### 表中已禁、闸门尚未拦截

「避免」列已禁止、但闸门数组尚无对应项的词现在只剩样例一个（见 sample / fixture 行），
由维护 `copyQuality.test.ts` 的一方补入；其余各词都已进入 `FORBIDDEN_ZH`，由闸门拦截：
嵌入式视图、内嵌视图（见 embedded view 行）、泳道、轨道（见 lane 行）、枢纽条（见 hub bar 行）、
弧线（见 transfer arc 行）、外类群（见 outgroup 行）、字符（见 character 行）。

### 同步流程要求

1. 新增禁用词：先在本表相应行的「避免」列登记，再补进闸门数组，两处同一次改动完成。
2. 解禁或改名：先确认界面字符串已全部改用规范译名（`npm test` 通过），再同时删除表与闸门两侧条目。
3. 闸门只负责“出现即失败”的硬约束；带语境条件的（如「枝上位置」仅在某些词组中违规）留在表里，
   由审校判断，不强行进闸门。
4. 每次改动后运行 `npm test`；若本表与闸门不一致，以本表为规范来源，闸门须向本表对齐。
