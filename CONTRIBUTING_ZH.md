<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# 为 CladeForge 贡献代码（中文）

> English version: [CONTRIBUTING.md](./CONTRIBUTING.md)

感谢你有兴趣为 CladeForge 做贡献。本文档介绍开发环境搭建与我们遵循的约定。

## 开发环境

- **Node.js ≥ 20.19**（`package.json` 中 `engines` 声明的下限）和 **Rust 工具链**（桌面外壳需要）。CI 使用 Node 20 系列（`.github/workflows/ci.yml` 中的 `node-version: 20`），满足该下限；`vite 8` 在低于 20.19 的版本上无法运行。
- 安装依赖：`npm install`
- 开始开发：`npm run dev`（Web 版）或 `npm run tauri dev`（桌面版）。

## 约定

- **TypeScript 严格模式** — `npm run typecheck` 必须零错误通过。
- **测试** — 我们使用 Vitest。所有新的纯模型逻辑（见 `src/model`、`src/io`）都必须附带测试。运行 `npm test`。
  - 组件测试的文件名必须是 `*.test.ts`（不是 `.test.tsx`）：`vite.config.ts` 只收集 `src/**/*.test.ts`，`.test.tsx` 永远不会被执行。请用 `createElement` 与 `createRoot` 渲染，并在首行写 `// @vitest-environment jsdom`。
  - 任何测试都不得对墙钟时间作出断言。关于复杂性的结论请用工作量计数器（节点访问数、height 写入数、祖先跳数）证明。为性能分析而保留的少量计时守卫位于 `CLADEFORGE_TIMING_GATE=1` 之后，常规运行会报告为跳过（skipped）——请在本地设置该变量来运行它们，CI 中永远不设。
- **界面文案** — 所有面向用户的文本集中在 `src/ui/strings.ts` + `src/ui/i18n.ts`，必须同时提供英文和中文两个版本。
- **提交信息** — 描述性、祈使语气（“Add reconciliation validation”、“Fix layout overflow”）。

## Pull Request（PR）

1. 先 fork 本仓库，再从 `main` 创建分支。
2. 保持改动聚焦；如适用请引用相关 issue。
3. 提交 PR 前，在本地跑完 CI 的完整序列——见下。
4. 较大的设计改动请先开 issue 讨论方案。

### CI 实际执行什么，以及如何复现

CI 运行四个任务（job）：`web`、`desktop`、`cross-check` 与 `audit`。前三个在每次推送（push）和 PR 时运行；`audit` 在每周定时或手动触发时运行。CodeQL 是独立工作流。推送前请复现相关任务：

```bash
# web job
npm ci
npm run typecheck
npm test
npm run build

# desktop job —— 改动了 src-tauri/ 下的任何内容时需要跑
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# cross-check job —— 示例数据或算例数据（fixtures）改动时需要（R + ape/phangorn）
node scripts/cross-check/run-cross-check.mjs
```

`cargo clippy` 这一行不是可选项。CI 用 `-D warnings` 运行 clippy，因此 lint 在那里是硬失败，
尽管看起来只是建议性检查。若 `cargo clippy` 报 `no such command: clippy`，说明工具链缺少该组件：

```bash
rustup component add clippy
```

`npm run build` 的重要性独立于 `npm run typecheck`：前者产出生产构建包，而类型检查加单元测试
无法发现仅在构建阶段出现的问题。

## 生成式 AI 的使用说明

在本软件的开发过程中，生成式 AI 助手用于两类工作：（1）辅助编写、修改与重构代码；
（2）润色文档与本仓库自身的文字。所有 AI 产出的改动都经过审阅、并通过测试套件验证，其所有权归维护者，
维护者对结果负全责。

**工具名称、版本与逐文件的辅助范围记录在 [`docs/AI_PROVENANCE.md`](./docs/AI_PROVENANCE.md) 中，
每个发布版本一行；未提交的工作区改动批次另有“Unreleased working tree …”行。** 无法从历史中追溯
归属的文件，该记录会直接写明“not attributed”，而不是猜测。由此产生两条规则：

- 被该记录列为 AI 辅助的文件，在模块头部带一行标记（TypeScript/Rust 用
  `// AI-PROVENANCE: …`，Markdown 用 `<!-- AI-PROVENANCE: … -->`）。
  `src-tauri/tauri.conf.json` 这类严格 JSON 不带标记——它没有注释语法，写了会让桌面端在编译期
  构建失败（`tauri_build` 与 `tauri::generate_context!` 按严格 JSON 解析该文件）——
  其记录只存在于表格中。
- 若本次改动有 AI 参与，请在同一个 PR 里为 `docs/AI_PROVENANCE.md` 新增或更新对应行，
  写清实际使用的工具名称与版本。

CladeForge 内部不运行任何生成式 AI。应用执行的每一项计算——Sankoff 简约法、Mk/ER 祖先状态重建、
DTL 协调、共识树、布局与导出——都是 `src/model`、`src/layout`、`src/io` 中的确定性本地代码，
且工具全程离线运行。

贡献者请在 PR 描述中说明本次改动是否有生成式 AI 参与，以及参与的部分。

## 发布（Releasing）

被打标签的提交才是被归档与被引用的对象，所以它必须是自包含的。打标签之前，请在**即将承载该标签
的那个提交上**（而不是事后在 `main` 上）逐项核对：

1. `npm run typecheck` 与 `npm test` 通过；把摘要行原文（测试文件数与用例数）写进发布说明，
   并把 README 或论文中的相关数字钉到**标签**——`main` 上的后续提交可能改变用例数。
2. `CITATION.cff` **在该标签所指提交中存在**，且其中的 `version` / `doi` / `date-released`
   与本次发布一致。`CITATION.cff` 是在 `v0.1.0` 之后才加入的，因此归档的 `v0.1.0` 树里并没有它；
   新发布不得重演此事，因为归档件是标签的机器快照。
3. `docs/AI_PROVENANCE.md` 为本次发布新增一行，写出工具名称与版本、AI 辅助的文件清单，
   且每个被列出的文件都带上模块头部标记。
4. `src-tauri/tauri.conf.json` 的 `version`、`README.md` / `README_ZH.md` 与
   `docs/MANUAL_EN.md` / `docs/MANUAL_ZH.md` 所述的平台支持下限与架构，必须与本次**实际产出**的
   构件一致——只写了能力但未构建过的，要明确标注（见 README 中的 macOS arm64 架构说明，以及用户手册里关于通用 `.dmg` 的脚注）。
5. Zenodo 的概念 DOI 与版本 DOI 均可解析，且写入 `CITATION.cff`、`README.md`、`README_ZH.md`
   的版本 DOI 就是本次标签申请到的那一个。

## 范围说明

**协调（reconciliation，基因树–物种树协调）** 模块已经完成并随本版本提供，但它仍是 CladeForge 中交互设计尚未收敛的部分（见 [README_ZH.md](./README_ZH.md) 路线图中的“协调优化”一条）。改动该模块之前请先开 issue，以免把精力花在还会变动的方案上。

## 用户文档

完整的功能详解见[用户手册（中文）](./docs/MANUAL_ZH.md)和 [User Manual (English)](./docs/MANUAL_EN.md)。各发布版本的 AI 辅助文件记录见 [docs/AI_PROVENANCE.md](./docs/AI_PROVENANCE.md)。安全问题不走公开 issue，私下报送方式见 [SECURITY.md](./SECURITY.md)。

## 文档语言政策

中英双语交付是 CladeForge 文档的硬性要求，不是事后补充。此前这条规则只是惯例——只能从成对文件页首的
互链里看出来——因此审阅时无据可依。本节把规则写成明文：哪些文档必须双语交付、“双语”究竟要求到什么
程度、哪些文件刻意只以单一语言维护（只以中文，或只以英文）。

### 文档语言矩阵

| 中文文件 | 英文文件 | 交付形态 | 状态 |
|---|---|---|---|
| `README_ZH.md` | `README.md` | 双文件，各一种语言 | 须中英配对 |
| `CONTRIBUTING_ZH.md` | `CONTRIBUTING.md` | 双文件，各一种语言 | 须中英配对 |
| `docs/MANUAL_ZH.md` | `docs/MANUAL_EN.md` | 双文件，各一种语言 | 须中英配对 |
| `scripts/cross-check/README_ZH.md` | `scripts/cross-check/README.md` | 双文件，各一种语言 | 须中英配对 |
| `docs/UI_GLOSSARY.md` | `docs/UI_GLOSSARY_EN.md` | 双文件，各一种语言 | 须中英配对（英文版须与中文术语表逐条同步） |
| `docs/EMBEDDED_RECON_LAYOUT_PLAN_ZH.md` | `docs/EMBEDDED_RECON_LAYOUT_PLAN_EN.md` | 双文件，各一种语言 | 须中英配对 |
| `docs/GLOSSARY.md` | — | 仅中文维护 | 政策豁免——历史对照表 |
| `docs/UI_STYLE_GUIDE.md` | — | 仅中文维护 | 政策豁免——现行规范，仅中文维护 |
| `docs/UI_FIX_REPORT.md` | — | 仅中文维护 | 政策豁免——带日期的验收报告 |
| — | `docs/AI_PROVENANCE.md` | 仅英文维护 | 政策豁免——逐发布版本的 AI 辅助记录本身（机器可读表格加说明文字），以英文维护；仓库中不存在中文对应件 |
| — | `docs/FORMAT.md` | 仅英文维护 | 政策豁免——`.cladeforge.json` 文件格式参考（见规则 5）；以英文维护，仓库中不存在中文对应件 |
| `.github/PULL_REQUEST_TEMPLATE.md`、`.github/ISSUE_TEMPLATE/bug_report.md`、`.github/ISSUE_TEMPLATE/feature_request.md` | 同一文件 | 单文件内中英并列 | 模板许可形态 |
| — | `SECURITY.md` | 仅英文维护 | 政策豁免——现行英文规范：它本身就是私下报送的操作说明（写明报告必须送往的唯一网址与唯一邮箱地址），在这段文字里混用两种语言有误送报告的风险；仓库中不存在中文对应件，README 两个语言版本链接的都是这同一份文件 |
| — | `CITATION.cff` | 仅英文维护 | 性质豁免——机器可读的文献记录：CFF 规范对记录本身没有语言字段，再译一份只会让同一次发布出现两条可引用记录 |
| — | `LICENSE` | 仅英文维护 | 性质豁免——SPDX MIT 文本必须逐字保持，其版权行已同时带有两种语言署名（`曾子超 (Zichao Zeng)`） |
| — | `CHANGELOG.md` | 仅英文维护 | 政策豁免——Keep a Changelog 1.1.0 格式的发布记录，以英文维护；仓库中不存在中文对应件 |
| `.github/ISSUE_TEMPLATE/config.yml` | 同一文件 | 单文件内中英并列 | 须中英配对：`name:` 与 `about:` 是 GitHub 在 issue 选择器里展示的可见文字，因此各自在同一字符串内并列两种语言（即规则 4 的形态）；`url:` 与 `blank_issues_enabled` 属仓库配置，保持原样 |

矩阵中的文件名一律写成行内代码而非 Markdown 链接，这样文档新增、改名或停用时表格不会腐烂；读者真正
要点的链接在每个配对文件页首的互链里（`> 中文版：…` / `> English version: …`）。
`docs/UI_GLOSSARY_EN.md` 与 `docs/EMBEDDED_RECON_LAYOUT_PLAN_EN.md` 由本政策一并新增——前者是规范性
UI 术语表的英文版，后者是那条约 1,500 行的嵌套视图算法契约设计文档的英文版，该文档被 5 处源码头注释
当作规范引用（`src/model/reconPlacements.ts`、`src/model/reconPlacements.test.ts`、
`src/layout/embeddedRecon.ts`、`src/layout/embeddedRecon.test.ts`、
`src/canvas/EmbeddedReconCanvas.tsx`）。两份文件均已入库，且各自已带上页首互链，上表已经覆盖它们。

### 规则

1. **一组配对文档是“一份文档、两种语言交付”。** 上表中任何标记为“须中英配对”的文件，只要改了其中
   一侧，就必须在同一个 PR 内同步另一侧；而且“对等”是结构层面的，不只是意思到位：章节数量与顺序
   一致、表格的行与列一致、数字一致（测试用例数、版本下限、DOI、DPI、阈值）、命令与参数一致、术语
   一致、限定条件与例外也一致。只改一侧属于未完成改动，应当退回而不是合并。两侧还各自在页首链接
   另一侧；新增一组配对文档时两条链接都要写。
2. **规范性界面术语的唯一事实来源是 `docs/UI_GLOSSARY.md`。** 一个概念在界面里怎么写，只由这份文件
   决定，所有配对文档的中英用词都以它为准。其英文版 `docs/UI_GLOSSARY_EN.md` 必须逐条同步——相同的
   概念、相同的推荐英文与中文写法、相同的“避免”列。两者一旦出现分歧，以 `docs/UI_GLOSSARY.md` 为准，
   并在同一个 PR 内修正英文版。`src/ui/copyQuality.test.ts` 只是把术语表对界面文案串的要求编成测试，
   不能替代术语表本身。
3. **`docs/GLOSSARY.md`、`docs/UI_STYLE_GUIDE.md`、`docs/UI_FIX_REPORT.md` 按政策只以中文维护。**
   这是决定而非疏漏，但三份文件的豁免理由各不相同，改它们时理由很要紧。`docs/GLOSSARY.md` 属于
   **“因为是记录而豁免”**：它页首自述为“历史对照（非规范性）”，界面用词的规范性职责已移交
   `docs/UI_GLOSSARY.md`。`docs/UI_STYLE_GUIDE.md` 则相反，它是一份**现行规范文档**：它管的是
   `src/ui/strings.ts`、组件内联 `tr()` 文案、通知、导出图与 NEXUS 注释的写法
   （`docs/UI_STYLE_GUIDE.md`:5），其 :37 与 :44 明确写着现存代码与本文档冲突时以本文档为准修改代码文案，
   且不得反向放宽本节；它只以中文维护，是因为项目就用中文维护它、服务的是审界面文案的人，与其内容是否
   属于历史无关。`docs/UI_FIX_REPORT.md` 属于**“因为是记录而豁免”**：那是一份带日期（2026-10-19）、
   只反映某一时点的验收报告，说的是“当时如何”，不是“现在承诺什么”，它页首也是这样自述的。三份文件都
   不承担翻译义务，审阅者不应要求为它们补英文版。改动 `docs/GLOSSARY.md` 或 `docs/UI_FIX_REPORT.md`
   时，请把文件里“历史／非规范”的说明保持准确；`docs/UI_STYLE_GUIDE.md` 没有这类说明，也不得新增。
   上表中“仅英文维护”的几行是同一套理由的另一面：`SECURITY.md`、`docs/AI_PROVENANCE.md`、
   `docs/FORMAT.md`、`CHANGELOG.md`、`CITATION.cff`、`LICENSE` 同样不承担翻译义务——各自的豁免理由
   写在其矩阵行内。
4. **模板类文件采用另一种同样被许可的形态。** 矩阵中三份 `.github/` 模板，连同
   `.github/ISSUE_TEMPLATE/config.yml` 里由 GitHub 展示给用户的文字（`name:`、`about:`），都把中英并列
   写在同一个文件里，因为 GitHub 每类模板只读取一个文件，无法提供与它配对的 `*_ZH` 文件。新增模板沿用这一
   “单文件双语并列”形态；新增 `contact_links` 条目也沿用中英并列的 `name:` / `about:` 写法。仓库中其他
   文档不得援引它作为“只交付一种语言”的先例；上表中标为仅英文维护的几行各有各的理由（写在各自的
   矩阵行内），与本条无关。
5. **`docs/FORMAT.md` 讲的是 `.cladeforge.json` 数据文件的格式**——应用读写的数据模式——**与文档使用
   哪种语言无关。** 它不能作为双语交付的依据；引用它时应写明它所记录的对象（“项目文件格式见
   docs/FORMAT.md”），以免它再次被当成文档语言规范来读。
6. **执行靠审阅，本矩阵就是清单。** 目前没有 CI 任务比对文档配对，因此 PR 检查项“Docs updated if
   needed”的含义是：凡改动了配对文档，同一个 PR 内已同步另一侧。请在 PR 描述中写明同步了哪几组、
   有意未动矩阵中的哪几行。新增、改名或停用文档时，必须在同一次改动里同时更新本文件与
   [CONTRIBUTING.md](./CONTRIBUTING.md) 两边的矩阵。
