<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# CladeForge UI 术语表 / UI Glossary

> **规范性文件。** 界面文案以本表为准；`docs/GLOSSARY.md` 为历史对照。

> 本表是界面文字的唯一事实来源。新增或修改 UI 文案时，先查此表；同一概念只能有一个中英文写法。
> 本表取代 `docs/GLOSSARY.md` 中与本表冲突的旧条目（后者保留为历史记录）。

## 核心概念

| 概念 | 推荐 English | 推荐中文 | 避免 |
|---|---|---|---|
| tree | tree | 树 | — |
| tip | tip | 末端（tip） | 尖端、叶节点（单独使用） |
| internal node | internal node | 内部节点 | 内部（单独作名词） |
| branch | branch | 枝 / 分支（构词：二叉、多歧） | edge（树的枝） |
| custom link | custom link | 自定义连线 | 关联线、连线（单独使用） |
| character | character | 性状 | trait（主术语）、字符（仅指文本字形） |
| character state | character state | 性状状态 | 状态（单独使用） |
| state change | state change | 状态变化 | transition（仅核苷酸替换） |
| support | support | 支持度 | 支持率、支持值 |
| support kind | support kind | 支持度类型 | 支持值类型 |
| node age | node age | 节点年龄 | 年代（仅地质年代） |
| time unit | time unit | 时间单位 | 原始小写枚举 |
| hypothesis layer | hypothesis layer | 假说层 | 假设层 |
| hypothesis note | hypothesis note | 假说标注 | 注释（泛称） |
| DTL mapping assumption | DTL mapping assumption | DTL 映射假设 | DTL 假设（过泛） |
| scenario | scenario | 场景 | 假设、假说 |
| reconciliation | reconciliation | 协调（基因树–物种树协调） | 协同重建、Reconcile（名词） |
| speciation | speciation | 物种形成 | 物种化 |
| duplication | duplication | 基因重复 | 加倍（WGD 语境除外） |
| horizontal transfer | horizontal transfer (HGT) | 水平转移 | 转移（单独使用） |
| gene loss | gene loss | 基因丢失 | 损失（与 cost 混淆） |
| gene tree | gene tree | 基因树 | 树库（作为栏目标题） |
| species tree | species tree | 物种树 | — |
| mapping | mapping | 映射 | 定位（混用） |
| unmapped | unmapped | 未映射 | 未解析（留给拓扑多歧） |
| polytomy | polytomy | 多歧分支 | 多叉、多分叉 |
| hard / soft polytomy | hard / soft polytomy | 硬 / 软多歧 | 硬 / 软多分叉 |
| reroot | reroot | 重新定根 | 定根、重根、移根、生根 |
| midpoint rooting | midpoint rooting | 中点定根 | 中点生根 |
| outgroup | outgroup | 外群 | 外类群 |
| MRCA | most recent common ancestor (MRCA) | 最近共同祖先（MRCA） | 最近共祖（单独使用） |
| ASR | ancestral-state reconstruction (ASR) | 祖先状态重建（ASR） | 概率重建、概率推断 |
| Mk | Mk model | Mk 模型 | MK |
| ER | equal rates (ER) | 等速率（ER） | — |
| parsimony | parsimony | 简约法 | — |
| MP | maximum parsimony (MP) | 最大简约（MP） | — |
| MAP | maximum a posteriori (MAP) | 最大后验（MAP） | — |
| CI / RI | consistency index / retention index | 一致性指数 / 保留指数 | 系统发育信号（误用） |
| phylogenetic signal | phylogenetic signal | 系统发育信号 | CI/RI（误用） |
| Brownian motion (BM) | Brownian motion (BM) | 布朗运动（BM） | — |
| Blomberg's K | Blomberg’s K | Blomberg’s K | 直撇号变体 |
| Jaccard overlap | Jaccard overlap | Jaccard 重叠 | 相关性（未检验时） |
| permutation test | permutation test | 置换检验 | — |
| Holm–Bonferroni | Holm–Bonferroni | Holm–Bonferroni | 无 en dash |
| Robinson–Foulds | Robinson–Foulds (RF) | Robinson–Foulds（RF） | RF（不解释） |
| split | split | 分裂 | clade（RF 语境误用） |
| NEXUS | NEXUS | NEXUS | Nexus |
| Newick | Newick | Newick | — |
| NeXML | NeXML | NeXML | — |
| MrBayes | MrBayes | MrBayes | — |
| BEAST | BEAST | BEAST | “BEAST block”（BEAST 用 XML 配置） |
| ICS | International Chronostratigraphic Chart (ICS) | 国际年代地层表（ICS） | — |
| Ma | Ma (mega-annum) | Ma（百万年前） | Mya、ma |
| Myr | Myr (million years) | Myr（百万年，持续时间） | 与 Ma 等同 |
| ka / Ga | ka / Ga | ka / Ga | kya / Gya（界面选项） |
| subst./site | substitutions per site | 每位点替换数 | s/s |
| DPI | DPI | DPI | dpi（句首） |

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

1. 中文与拉丁字母/数字之间加一个空格；中文标点前不加空格。
2. 中文句子使用全角标点；控件名/路径用「」；概念/引文用“”；禁止 ASCII `"` 作为可见引号。
3. 数值范围用 en dash `–`；中文破折号用 `——`；统计人名连接用 en dash（Holm–Bonferroni、Robinson–Foulds）。
4. 英文界面统一英式拼写：Colour、Licence、Centre、normalised、cancelled、grey、Favourite、Greyscale。
5. 禁止伪复数 `(s)` / `(es)`；英文用正确单复数，中文用量词。
6. 禁止在英文可见字符串中出现中文（语言名称除外）；禁止在中文可见字符串中出现未翻译的枚举或内部键名。
7. 长说明保留在可复制的 Methods & limits 文档中；界面只保留 1–2 句摘要。
8. 修改文案后运行 `npm test`（`src/ui/copyQuality.test.ts` 会拦截禁用词、伪复数与 CJK 泄漏）。
