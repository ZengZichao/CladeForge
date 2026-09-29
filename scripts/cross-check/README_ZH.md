# CladeForge 与 ape / phangorn 的交叉验证

> English version: [README.md](./README.md)

三种重建算法的正确性由两类互相独立的证据支撑：

1. **自足式真值检验** — TypeScript 实现算出的是不是*正确答案*：以每个算法的定义写出的穷举枚举作为参照来核对，外加 Mk 边际后验对固定速率 `r = 1/mean(branch length)` 的敏感性；
2. **第三方对照** — 一个成熟实现在同样数据上是否给出同样的数值。

## 两半分别在哪里

| | 自足式真值检验 | 第三方对照工具链（本目录） |
| --- | --- | --- |
| 代码 | `src/model/independentReference.test.ts` | `dump-fixtures.ts` + `dump-fixtures.mjs` + `ape_agreement.R` + `run-cross-check.mjs` |
| 命令 | `npx vitest run src/model/independentReference.test.ts` | `node scripts/cross-check/run-cross-check.mjs` |
| 依赖要求 | Node 加上仓库自带的开发依赖 | 装有 `ape` 与 `phangorn` 包的 R；下文各支线数字是以 R 4.5.3、ape 5.8.1、phangorn 2.12.1 核对的 |

## 1. 导出算例数据（仅需 Node，不引入新依赖）

```sh
cd CladeForge
node scripts/cross-check/dump-fixtures.mjs                  # → scripts/cross-check/fixtures/
node scripts/cross-check/dump-fixtures.mjs /tmp/cf-fixtures # or an explicit directory
```

`dump-fixtures.mjs` 是一个纯 Node 包装器：它用仓库自带的 `vite-node`（本就随 `vitest` 依赖安装）执行 `dump-fixtures.ts`，因此这些算例数据是由应用*所用的同一批模块*（`sampleTree`、`parsimony`、`asr`、`scriptExport`、`io/newick`）产出的，而不是一份重新实现的替身。若 `vite-node` 不存在，它会直接说明原因并以 2 退出，且不写出任何文件。

对每个项目——六个内置样例（`archaea`、`bacteria`、`virus`、`cetacean`、`plant`、`animal`），再加下文"`er-control` 对照文档"一节说明的 `er-control`——各写出十个文件，另外在顶层写出 `manifest.tsv` 与 `names.tsv`：

| 文件 | 内容 | R 支线如何使用它 |
| --- | --- | --- |
| `tree.nwk` | 与应用导出完全一致的 Newick（`serializeNewick`），含内部节点标签 | 仅作参考留存；**不是**工具链实际解析的对象（见下文"ape 与 phangorn 的行为说明"） |
| `tree_rescaled.nwk` | 同一棵树，每条枝长都除以枝长均值 | 工具链并不消费它（ape 自己拟合速率）；保留它是为了让读者能复核 CladeForge 的尺度不变性主张 |
| `characters.tsv` | 性状 id、名称、类型、状态序号、状态标签、颜色 | 状态字母表 |
| `matrix.tsv` | 末端 × 性状矩阵；`?` = 无观测（未设置、`?` 或 `-`） | 待重建的数据 |
| `costs.tsv` | 项目声明了代价矩阵时的桑科夫步矩阵 | 告诉工具链哪些性状是按均匀代价计价的 |
| `nodes.tsv` | `node_key`、标签、父节点 key、原始与重缩放枝长、末端计数 | **工具链据此重建树拓扑的节点表** |
| `asr_posteriors.tsv` | CladeForge 的 ER-Mk 边际后验，按节点 × 状态 | 边际状态比较 |
| `parsimony.tsv` | 所选状态、**两种**并列集合——`tie_state_indexes`（在已定当的祖先路径下仍等价的状态）与 `mp_state_indexes`（出现在任一最优重建中的状态，即 `phangorn::MPR` 给出的那个集合）——以及逐节点变化枝标记；最小代价见 `summary.tsv` | 简约法比较 |
| `summary.tsv` | 平均枝长、`r = 1/mean`、最小简约代价 | 代价比较 |
| `cladeforge_analysis.R` | **应用自己导出的可复现脚本**（`buildRScript`），原样保留 | 可在 `Rscript` 下独立运行；作为"第二实现"的证据留存 |

结果的连接依据是拓扑 key，而不是标签：末端用 `T:<tip label>`，内部节点用 `N:<排序后的末端集合>|<该子树内的节点数>`。子树规模这一项不是冗余装饰：在鲸类项目中 *Basilosauridae* 与 *Neoceti* 恰好覆盖同样两个末端，只靠末端集合作 key 会悄无声息地拿错配的一对节点去比较。由于 `nodes.tsv` 已经带上这些 key，树是从节点表重建的，而不是解析 Newick 得到的——这也顺带绕开了下文提到的 ape 那两个读取缺陷。

## 2. 运行第三方对照（需要 R + ape + phangorn）

```sh
Rscript scripts/cross-check/ape_agreement.R
# or end to end (re-dumps fixtures, verifies them, then calls R):
node scripts/cross-check/run-cross-check.mjs
# non-PATH binary:
RSCRIPT_BIN=/opt/R/4.4.2/bin/Rscript node scripts/cross-check/run-cross-check.mjs
```

`run-cross-check.mjs` 不会伪造后半段：它重新导出算例数据，核对每个项目目录的十类文件是否齐备、每个 Newick 是否解析出 ≥ 2 个末端，然后寻找 `Rscript`——依次看 `$RSCRIPT_BIN`、`PATH`、常见的 framework/homebrew 位置，然后是用户主目录下的 env 管理器前缀（mamba / miniconda / anaconda / miniforge / mambaforge / pixi 的 `envs` 目录）：R 若不是用 CRAN 安装包装的，通常就藏在那里。找不到能 `library(ape)` 且 `library(phangorn)` 的安装就报"不可用"而不选用它，因为这条支线的先决条件不是"存在某个 R"。若没有任何可用候选，它会写出明确的 "R LEG NOT RUN"，列出搜索过的位置、拒绝过哪些以及原因，然后以 **3** 退出；`--fixtures-only` 则是有意在第一步之后停下。显式给出的 `$RSCRIPT_BIN` 是要求而不是提示：那个二进制跑不了这条支线时，驱动就停下，不会悄悄换一个 R。它还会给 R 子进程一个 UTF-8 的 `LC_ALL`；`ape_agreement.R` 并不依赖这一点（见该文件里 `read_tsv` 的注释），但子进程要把中文标签回显到自己的输出里仍然需要它。

`ape_agreement.R` 按"项目 × 性状 × 支线"各写一行到 `fixtures/ape-agreement.tsv`，并同时回显：

| `leg` | 外部参照 | 与之比较的对象 | 容差 |
| --- | --- | --- | --- |
| `step-count(phangorn::parsimony)` | phangorn 的 Fitch 得分，无序性状的单位代价（与枝长无关） | `summary.tsv` 中均匀代价矩阵下的最小代价 | **判据**：要求精确相等 |
| `ER-marginals(ape::ace)` | `ape::ace(model = "ER", method = "ML")$lik.anc`，按分支丛 key 连接 | `asr_posteriors.tsv` | **仅度量**：`compared` 恒为 0 |
| `exported-R-script-Sankoff` | 应用自己的 `cladeforge_analysis.R`，在临时目录里用 `Rscript` 重跑 | `manifest.tsv` 的最小代价，逐项目 | **判据**：要求精确相等 |

ER 这条支线做不了一致性判据，原因出在 ape 而不是措辞：`ace(model = "ER")` 只有一个自由速率参数，并且**按最大似然拟合它**（文档里的返回值含 `rates` 与 `se`），而 CladeForge 把速率固定为 `1/mean(枝长)`。后验依赖速率，所以这里的差值把"实现差异"和"模型选择差异"混在一起，无论打分都是打错了对象。因此该行只报告 ape 拟合出的速率、最差与平均后验偏差、最大似然状态重合的次数——并把 `compared` 记为 0，使其不进入任何一致率。真正不依赖速率、因而可判据化的第三方对照是 phangorn 的 Fitch 简约法，即支线 1。

ER 支线按分支丛 key 连接，而不是按行位置，并且宁可不给数字也不猜：`ape::ace` 可能在工作树的二分重排副本上运算，所以它的每一行都要用"该节点之下的末端集合 + 该子树的节点数"重新认定一次。只要出现 key 无法一一对应、矩阵的行和不等于 1、或某个状态在末端上从未出现（ape 因此少一列）这些情况，比较就带着原因终止，而不是给出一个数值。`lik.anc` 是 ape 文档里对离散型 ML 祖先似然的称呼；`states` 与 `probs` 作为其他 ape 构建版本的备选被接受，实际用的是哪个分量会写进输出，覆盖的是仅内部节点还是全部节点同样会写明。

退出码：`0` 所有已尝试的比较均一致；`1` 有行 FAILED 或结果不一致；`2` 算例数据缺失，或没有任何可比较的内容。被排除、不可比较、或尚未比较的行都会连同原因一并记录，且**绝不**计入一致。

## 关于速率

CladeForge 把 ER 速率固定在 `r = 1/mean(branch length)`，这让它的后验对树的绝对尺度不变。`ape::ace(model = "ER")` 做的是另一件事：它有一个自由速率参数，并且**按最大似然拟合**。由此得出两点：

* 把所有枝长乘同一个常数不会改变 ape 的答案——拟合出的速率会把这个常数吸收掉——所以喂给它按均值重缩放的树并不带来任何东西。支线 2 因此直接在原始树上跑。
* 两侧**因此不是同一个模型**，任何重缩放都不能让它们成为同一个。这正是 ER 那行只度量、不作判据的原因。

`tree_rescaled.nwk` 与 `rescaled_length` 列仍然导出：它们是读者复核 CladeForge 尺度不变性主张时要用的东西。

至于边际后验在 `r = 1/mean` 与 ML 拟合的 `r` 之间会移动多少，是另一个不需要 ape 参与的问题，由 `src/model/independentReference.test.ts` 中那条关于速率敏感性的支线在这些项目上度量。

## 每条支线证明了什么，又没证明什么

* 真值支线证明的是 TypeScript 实现与*定义*相符（桑科夫最小代价与并列最优集合、精确的 ER-Mk 边际后验、有根共识分支丛的选取与支持率、最小代价的 DTL 定标），所用数据包括固定、随机与内置三类。它们完全不涉及这些定义与已发表工具的差别——那正是本工具链的职责。
* `cladeforge_analysis.R` 检查的是 CladeForge 与*它自己的*第二实现之间的一致性；`ape_agreement.R` 检查的是应用与第三方库之间的一致性。
* DTL 支线是在"仅依赖拓扑"的转移约束下做的*简约*协同重建。它的对照对象是同一模型的穷举枚举，**不是** RIANA / Treerecon / CaSpec：这些程序在根与到达代价、逐物种节点的损失计数、以及基于年代的时序可行性上都有差异（见 `src/model/dtl.ts` 的文件头）。引用其计数时只能表述为"本模型下的事件数"。

## 从干净检出复现

```sh
npm install                                              # vite-node comes with vitest
node scripts/cross-check/dump-fixtures.mjs               # regenerate fixtures
npx vitest run src/model/independentReference.test.ts    # oracle legs
Rscript scripts/cross-check/ape_agreement.R              # third-party leg (needs R)
```

`fixtures/` 是生成的产物；保留它是为了让只有 R 环境的读者也能直接运行第 2 步。重新生成它是**逐字节一致**的：样例性状的 id 在 `src/model/sampleTree.ts` 里被固定为 `sample-char:<项目>-<性状>`（并有测试守住），因为 id 正是五个算例文件与 `manifest.tsv` 里的 `character` 列——若仍随机生成，每次重新生成都会改写约 1 500 行已提交的数据，却不改变任何一个可度量的值。节点 id 与状态 id 仍是随机的，因为没有任何算例列会用到它们。

## 如何读输出

随版的 `manifest.tsv` 在七份算例文档下共有 14 行"项目 × 性状"。各支线的合计是：

```
step-count(phangorn::parsimony)   compared 10  agreed 10
exported-R-script-Sankoff         compared 14  agreed 14
ER-marginals(ape::ace)            compared 0   agreed 0   （4 行度量）
```

退出码 **0**：工具链尝试过的每一项比较都一致。

* **简约步数 — 与 `phangorn::parsimony()` 10/10 精确一致**，范围为那些完全已赋值、且以均匀代价计价的性状。这条支线会考察 12 个性状，其中 10 个符合条件：`archaea` 的两个性状含 `?` 编码，而 phangorn 的 `phyDat` 会丢弃这类位点并返回 0，所以它们被记为 `EXCLUDED`，而不是被报成不一致；鲸类的两个性状声明了显式的桑科夫步矩阵，本就不属于均匀代价这一类。工具链会核对这种排除是真的：状态标签查表命中的末端数少于算例自身声明的缺失数时，那是一次 `join` 故障，不是缺失数据。
* **边际状态 — 度量了 4 行，有意不计入任何一致率。** `ape::ace()` 拒绝任何不是**既**有根**又**完全二分的树，而 bacteria、virus、cetacean、animal 按设计带有干枝（stem lineage），这八行因此记为 NOT-COMPARABLE；`archaea` 的两行同理（含缺失编码）。收缩干节点确实能让 `ace()` 跑起来，但那会改变被比较的*是哪一个*节点，所以工具链不这样做。`plant`（三个性状）与 `er-control` 是完全二分的，于是拿到四行度量：CladeForge 固定的速率在 plant 上是 `1/mean = 0.004806`、在 er-control 上是 `2.642`，而 ape 拟合出的速率在 plant 的三个性状上都是 `0.1000`（那是优化器的下界——对与树一致的性状它希望完全不要变化）、在 er-control 上是 `15.1913`（饱和）。随后最大似然状态只在 6/13、5/13、10/13、6/7 个内部节点上重合。这个差距正是重点：它是模型之差，不是实现之差，拿它作判据就是在给错误的对象打分。
* **应用自己导出的脚本 — 14/14。** 在 `Rscript` 下重跑 `cladeforge_analysis.R`，打印出的 Sankoff 最小代价与 `manifest.tsv` 为七份算例记录的逐个相同，包括鲸类那两个非对称矩阵——那里导出脚本付的是 3 而不是 Fitch 的 5，说明步矩阵确实被使用。也就是说，这项导出所承诺的可复现性是被执行过的，而不是推断出来的。

## `er-control` 对照文档

`ape::ace` 拒绝任何非完全二分的有根树，而多数内置样例都带干枝。因此 `dump-fixtures.ts` 额外产出 **`er-control/`**：一棵有根、完全二分、8 末端，且所有末端对一个二态性状全部赋值、不含 `?` 的文档。它有意不进应用的 `SAMPLE_PROJECTS` 画廊，存在的唯一理由是让 `ace(model = "ER", method = "ML")` 有东西可跑。

`buildErControlProject()` 会断言这些性质（末端数、无未赋值末端、无非二分节点、无单孩子节点），一旦改动破坏它们就抛错，因此这条支线不可能悄悄退回 0 次比较。

## ape 与 phangorn 的行为说明

工具链之所以写成现在这样，理由是这几条：

* **`ace()` 的默认 `type` 是 `"continuous"`**，而 `ace.continuous` 不认识离散模型名 `"ER"`：它返回一个只有 `call` 分量的列表，不报错也不告警，于是每一次边际查表都悄悄失败。
* **在 `LC_CTYPE=C` 下 `read.delim(fileEncoding = "UTF-8")`** 会把带中文状态标签的行改坏并丢弃，于是一次覆盖十个性状的比较会悄悄退化成只剩一个。`ape_agreement.R` 里的 `read_tsv` 按字节读入再打标签，两种 locale 下都正确。
* **`system2()` 无法构造含"当前原生编码无法表示的路径"的命令行**，所以仓库放在非 ASCII 目录下时，导出脚本支线会报"0 行代价"。这条支线现在从会话临时目录里的副本运行，且计数不符时把子进程的输出一并写进报告。
* **两个读取缺陷**（在 ape 一侧，不在导出文件一侧）：带空格的引号标签会被读得面目全非，`"Gracilicutes (GN)"` 会被读成 `GN`，也就是说 ape 无法往返自己写出器的这类名字。因此本对照的每一条支线都从 `nodes.tsv` 构树。应用自己导出的脚本同样不走 `read.tree()`，理由一致：它是用标签向量重建树的——因为被读坏的末端标签会在那段脚本自己的分析里悄悄变成缺失数据。
* **被截断的管道不等于图画坏了。** 把 `cladeforge_analysis.R` 的运行输出接进 `head` 这类管道会让 R 收到 `SIGPIPE` 而死，写了一半的 `cairo_pdf` 看上去就是一片空白（约 1 kB、不含字体资源）；同样的命令不加管道会写出约 42 kB。把空白图当成缺陷之前，先确认是不是管道截断。
