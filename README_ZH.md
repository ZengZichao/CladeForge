<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# CladeForge

**面向演化场景构建与假说生成的交互式系统发育树编辑器**

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23053393.svg)](https://doi.org/10.5281/zenodo.23053393)
[![CI](https://github.com/ZengZichao/CladeForge/actions/workflows/ci.yml/badge.svg)](https://github.com/ZengZichao/CladeForge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![ORCID](https://img.shields.io/badge/ORCID-0000--0001--6553--970X-a6ce39?logo=orcid&logoColor=white)](https://orcid.org/0000-0001-6553-970X)

---

[English](./README.md) | [中文说明](./README_ZH.md)

---

CladeForge 是一款本地优先的跨平台桌面应用，用于构建、注释和导出带有演化语义层的系统发育树。它将系统发育树重新定义为“假说脚手架”——一个用于构建、比较和优化演化场景的画布。

基于 **Tauri v2 + React 18 + TypeScript + Vite** 构建，后端使用 Rust。

## 功能特性

- **交互式树编辑** — 有根树，支持二叉/三歧/多歧分支、节点和枝样式、折叠/展开、重新定根、阶梯化。
- **多种布局** — 矩形分支图、矩形枝长图、时间校准布局（带地质年代条带）和圆形布局；四种方向（LR/RL/TB/BT）；自动和手动布局模式。
- **性状/状态系统** — 离散和连续性状，支持色盲友好调色板；Sankoff 步矩阵支持不对称演化代价。
- **演化事件** — 九个分组共 27 种内置事件类型（26 种预定义 + 1 种自定义）：物种形成（4）、灭绝（2）、演化创新（3）、基因流（2）、生物地理（3）、微生物（9）、基因家族演化（2）、深时（1）、通用（1）。每种类型都有唯一的两个大写字母代号；调色板可能复用颜色。事件支持因果链链接。
- **假说层** — 在共享拓扑上管理多个竞争性假说；末端状态共享，内部节点假说分异。
- **推断助手（建议性）** — Sankoff 简约法建议、Mk 模型概率性 ASR（对数空间数值稳定）、一致性检查、性状相关性提示（Jaccard 共变化）。
- **DTL 协调重建** — 基因树/物种树分析，含动态规划求解器、手动细化、验证，以及两种画布布局：并排对照视图与嵌套视图（物种枝管道 + 基因谱系嵌套其中，支持 Alt + 单击构建演化路径并导出嵌套协调图 SVG）。
- **时间校准** — 化石校准点、地质年代条带和环境事件叠加。
- **导入/导出** — Newick 和 NEXUS 导入（NEXUS 读取 `TREES` **与** `DATA`/`CHARACTERS`/`ASSUMPTIONS` 块；Newick 原样保留方括号注释，并解析 `&support`、`&R/&U`、BEAST 的 `height`/`height_95%_HPD`/`posterior` 与 NHX 标签——其余注释文本仅按原文保存，不作解析）；CSV/TSV 性状矩阵与注释表导入，矩阵/注释/模板 CSV 导出；NeXML 导出；`.cladeforge.json` 项目文件（格式见 `docs/FORMAT.md`）；SVG/PNG/PDF 图像导出（带导出设置对话框：DPI 控制、支持度可选打印、比例尺、图例开关与自动图例）；假说 JSON、Markdown 叙述与自包含 R 分析脚本。

**边界声明。** CladeForge 是假说编辑与论证工作台：不建树、不比对序列、
不做贝叶斯定年、不搜索拓扑；界面上的一切推断都以文档中那棵由你编辑的
单一拓扑为前提。Mk 重建按极大似然拟合一维速率，但只实现等速率（ER）子模型。
- **撤销/重做** 基于 Immer 结构共享；双语界面（英文 / 中文）。

## 系统要求

| 平台 | 最低系统 | 架构 | 磁盘空间 | 内存 |
|------|---------|------|---------|------|
| macOS | 11.0 (Big Sur) | arm64、x86_64 | 实测 12.8 MiB（v0.2.0 arm64 应用包；安装镜像 4.8 MiB）；v0.3.0 未重新测量 | 512 MB |
| Windows | 10（64 位） | x86_64 | v0.2.0 发布包含 `.msi`；体积未测量 | 512 MB |
| Linux | glibc ≥ 2.28 | x86_64 | v0.2.0 发布包含 `.deb`/AppImage；体积未测量 | 512 MB |

应用自身不捆绑浏览器引擎，但它会渲染进操作系统自带的 web 视图（macOS 上为 WKWebView、
Windows 上为 WebView2、Linux 上为 WebKitGTK），因此宿主机必须提供对应的 web 视图；
运行本应用不需要任何其他运行时（Java、Python 或 Node.js）。

## 安装

### 预构建二进制包

某个版本实际附带了哪些产物，逐个版本说明，不做笼统承诺。请查看
[Releases 页面](https://github.com/ZengZichao/CladeForge/releases)确认某个标签实际带有什么。

- **未发布（工作区）** —— 内置示例由七组精简为三组**功能导向**演示（`feature-tour`、`large-tree`、
  `recon-family`），去除全部真实生物学背景；数值结构保持不变，交叉校验算例数据已重新生成。
  详见 CHANGELOG 的 [Unreleased] 小节。
- **v0.3.0** —— 已打标签的发布版本；预构建产物由 `.github/workflows/release.yml` 构建（见 [Releases 页面](https://github.com/ZengZichao/CladeForge/releases/tag/v0.3.0)）。
- **v0.2.0** —— 发布页产物：macOS 的 Apple Silicon 与 Intel 双架构 `.dmg`、Windows x64 的 `.msi`、
  Linux x86_64 的 `.deb` 与 AppImage（macOS 应用包 12.8 MiB；安装镜像 4.8 MiB；Windows/Linux 体积未测量）。
  本版本修复了顶栏窗口拖拽，全部示例重建为 `Taxon_*` 命名的严格二叉虚拟分类单元，
  并新增逐事件的标记自定义（形状 / 大小 / 颜色 / 标记文字）。
- **v0.1.0** —— 只有一个产物：`CladeForge_0.1.0_aarch64.dmg`（macOS，Apple Silicon）。
  该版本没有产出 Intel、Windows 或 Linux 构建，且由手工打包而非 `.github/workflows/release.yml` 产出。

这些产物**未签名**。macOS 首次打开时会被 Gatekeeper 拦截，办法见下方。

若 Releases 页面上没有你所在平台的构建，请改用下面的源码构建——它是受支持的路径，
本地打包会得到同样的安装包。

<details>
<summary>macOS：如何打开未签名的构建</summary>

右键 `.dmg` → **打开** → 确认即可。若要仅在这台机器上信任它：

```bash
xattr -d com.apple.quarantine CladeForge.app   # 先从 dmg 中把 app 拖出来
```

</details>

### 从源码构建

```bash
git clone https://github.com/ZengZichao/CladeForge.git
cd CladeForge
npm install
npm run dev            # Web 开发服务器（无需 Rust）
npm run tauri dev      # 桌面开发构建（需要 Rust）
npm run build          # 类型检查 + 构建 Web 前端
npm run typecheck      # TypeScript 严格检查
npm test               # 运行 Vitest 测试套件
npm run tauri build    # 构建打包的 .app / 安装包
```

**源码构建前置条件：** Node.js ≥ 20.19，Rust 工具链 ≥ 1.90，npm。该下限在 `package.json` 中写为
`>=20.19`，与 CI 实际构建所用的版本一致——为何是 20 而非更新的主版本，见 `ci.yml` 中的说明。

## 快速开始

1. 打开或创建项目（`.cladeforge.json`）。
2. 在主画布中编辑树——右键节点进行拓扑操作（添加枝、插入父节点、重新定根、删除、折叠）。
3. 使用侧面板定义性状、分配性状状态、放置事件、管理假说层和设置校准点。
4. 运行推断助手（简约法、Mk ASR、一致性检查）获取建议性提示。
5. 通过导出面板导出：SVG/PNG/PDF 用于图表，Newick/NEXUS 用于树，JSON 用于假说存档。

## 项目文件格式

CladeForge 项目以 JSON 格式存储（`.cladeforge.json`），架构版本 `0.2.0`。

## 文档

- [用户手册（中文）](./docs/MANUAL_ZH.md) — 完整的功能详解手册
- [User Manual (English)](./docs/MANUAL_EN.md) — 完整的功能详解手册（英文版）
- [贡献指南（中文）](./CONTRIBUTING_ZH.md) · [Contributing Guide](./CONTRIBUTING.md)
- [安全政策](./SECURITY.md) — 受支持的版本与漏洞私下报送渠道

## 路线图

- [x] 基因树–物种树协调（DTL 风格）
- [ ] 协调优化：并排对照视图中的拖拽映射、多基因聚合叠加
- [x] 嵌套视图协调布局（将基因树投影到物种树画布上）：物种枝管道 + 基因谱系嵌套、Alt + 单击路径构建与 SVG 导出
- [ ] 前向模拟引擎用于假说检验
- [ ] 第三方推断工具的插件架构
- [ ] 协作工作区

## 许可证

基于 [MIT 许可证](./LICENSE) 发布。

## 引用

每一个打标签的发布版本都会归档到 Zenodo，并拥有各自可引用的 DOI。请引用你实际使用的版本；概念 DOI
始终解析到最新的归档版本。

- **概念 DOI（全部版本）：** [10.5281/zenodo.23053393](https://doi.org/10.5281/zenodo.23053393)
- **v0.1.0：** [10.5281/zenodo.23053394](https://doi.org/10.5281/zenodo.23053394)
- **v0.2.0：** 版本 DOI 由 Zenodo 在归档该发布版本时分配。
- **v0.3.0：** [10.5281/zenodo.24108672](https://doi.org/10.5281/zenodo.24108672)（2026-11-10 归档）。

> Zeng, Z. (2026). *CladeForge* (Version v0.3.0) [Computer software]. Zenodo.
> https://doi.org/10.5281/zenodo.24108672

目前尚无可引用的论文条目。机器可读的引用信息见 [`CITATION.cff`](./CITATION.cff)。

## 资助

本项目受国家自然科学基金（资助号 42422209、42272354）和国家重点研发计划（资助号 2023YFC3108600）资助。
