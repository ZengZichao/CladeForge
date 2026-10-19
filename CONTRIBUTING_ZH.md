<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# 为 CladeForge 贡献代码（中文）

> English version: [CONTRIBUTING.md](./CONTRIBUTING.md)

感谢你有兴趣为 CladeForge 做贡献。本文档介绍开发环境搭建与我们遵循的约定。

## 开发环境

- **Node.js ≥ 20.19** 和 **Rust 工具链**（桌面外壳需要）。该下限即 CI 实际使用的版本；`vite 8` 在 20.19 以下无法运行。
- 安装依赖：`npm install`
- 开始开发：`npm run dev`（Web 版）或 `npm run tauri dev`（桌面版）。

## 约定

- **TypeScript 严格模式** — `npm run typecheck` 必须零错误通过。
- **测试** — 我们使用 Vitest。所有新的纯模型逻辑（见 `src/model`、`src/io`）都必须附带测试。运行 `npm test`。
  - 组件测试的文件名必须是 `*.test.ts`（不是 `.test.tsx`）：`vite.config.ts` 只收集 `src/**/*.test.ts`，`.test.tsx` 永远不会被执行。请用 `createElement` 与 `createRoot` 渲染，并在首行写 `// @vitest-environment jsdom`。
  - 任何测试都不得对墙钟时间作出断言。复杂度类结论请用工作量计数器（结点访问数、height 写入数、祖先跳数）证明。保留下来的少量计时守卫位于 `CLADEFORGE_TIMING_GATE=1` 之后，普通运行会显示为 skipped——只在本地需要测速时设置该变量，CI 中永远不设。
- **界面文案** — 所有面向用户的文本集中在 `src/ui/strings.ts` + `src/ui/i18n.ts`，必须同时提供英文和中文两个版本。
- **提交信息** — 描述性、祈使语气（"Add reconciliation validation"、"Fix layout overflow"）。

## 合并请求（Pull Request）

1. 从 `main` 分支 fork 并创建分支。
2. 保持改动聚焦；如适用请在描述中引用相关 issue。
3. 提交 PR 前，在本地跑完 CI 的完整序列——见下。
4. 较大的设计改动请先开 issue 讨论方案。

### CI 实际执行什么，以及如何复现

CI 跑两个互不依赖的 job：Web 侧失败不会再导致 Rust 侧被跳过。推送前请两边都本地复现：

```bash
# web job
npm ci
npm run typecheck
npm test
npm run build

# desktop job —— 只要改动了 src-tauri/ 下的任何内容就必须跑
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

`cargo clippy` 这一行不是可选项。CI 用 `-D warnings` 运行 clippy，因此 lint 在那里是硬失败，
尽管看起来只是建议性检查。若 `cargo clippy` 报 `no such command: clippy`，说明工具链缺少该组件：

```bash
rustup component add clippy
```

`npm run build` 与 `npm run typecheck` 需分开执行：前者产出生产构建包，而类型检查加单元测试
无法发现仅在构建阶段出现的问题。

## 生成式 AI 的使用说明

在本软件的开发过程中，生成式 AI 助手用于两类工作：（1）辅助编写、修改与重构代码；
（2）润色文档与本仓库自身的文字。所有 AI 产出的改动都经过维护者逐条审阅、并通过测试套件验证，
其正确性由维护者全权负责。

**工具名称、版本与逐文件的辅助范围记录在 [`docs/AI_PROVENANCE.md`](./docs/AI_PROVENANCE.md) 中，
每个发布版本一行。** 无法从历史中追溯归属的文件，该记录会直接写明"未归属"，而不是猜测。
由此产生两条规则：

- 被该记录列为 AI 辅助的文件，在模块头部带一行标记（TypeScript/Rust 用
  `// AI-PROVENANCE: …`，Markdown 用 `<!-- AI-PROVENANCE: … -->`）。
  `src-tauri/tauri.conf.json` 这类严格 JSON 不带标记——它没有注释语法，写注释会让构建失败——
  其记录只存在于表格中。
- 若本次改动有 AI 参与，请在同一个 PR 里同步更新 `docs/AI_PROVENANCE.md` 的对应行，
  写清实际使用的工具名称与版本。

CladeForge 内部不运行任何生成式 AI。应用执行的每一项计算——Sankoff 简约法、Mk/ER 祖先态重建、
DTL 协同演化重建、共识树、布局与导出——都是 `src/model`、`src/layout`、`src/io` 中的确定性本地代码，
且工具全程离线运行。

贡献者请在 PR 描述中说明本次改动是否有生成式 AI 参与，以及参与的部分。

## 发布（Releasing）

被打 tag 的提交才是被归档与被引用的对象，所以它必须是自足的。打 tag 之前，请在**即将承载该 tag
的那个提交上**（而不是事后在 `main` 上）逐项核对：

1. `npm run typecheck` 与 `npm test` 通过；把摘要行原文（测试文件数与用例数）写进发布说明，
   并把 README 或论文中的相关数字显式钉到 tag——`main` 上的后续提交会改变用例数。
2. `CITATION.cff` **在该 tag 所指提交中存在**，且其中的 `version` / `doi` / `date-released`
   与本次发布一致。`CITATION.cff` 是在 `v0.1.0` 之后才加入的，因此归档的 `v0.1.0` 树里并没有它；
   新发布不得重演此事，因为归档件是 tag 的机器快照。
3. `docs/AI_PROVENANCE.md` 为本次发布新增一行，写出工具名称与版本、AI 辅助的文件清单，
   且每个被列出的文件都带上模块头部标记。
4. `src-tauri/tauri.conf.json` 的 `version`、`README.md` / `README_ZH.md` 与
   `docs/MANUAL_EN.md` / `docs/MANUAL_ZH.md` 所述的平台支持下限与架构，必须与本次**实际产出**的
   构件一致——只写了能力但未构建过的，要明确标注（见 README 中 macOS arm64 / universal 的注释）。
5. Zenodo 的概念 DOI 与版本 DOI 均可解析，且写入 `CITATION.cff`、`README.md`、`README_ZH.md`
   的版本 DOI 就是本次 tag 申请到的那一个。

## 范围说明

**协同重建（reconciliation）** 模块已经完成并随本版本提供，但它仍是 CladeForge 中交互设计尚未收敛的部分（见 [README_ZH.md](./README_ZH.md) 路线图中的"协同重建优化"一条）。改动该模块之前请先开 issue，以免把精力花在还会变动的方案上。

## 用户文档

完整的功能详解见[用户手册（中文）](./docs/MANUAL_ZH.md)和 [User Manual (English)](./docs/MANUAL_EN.md)。
