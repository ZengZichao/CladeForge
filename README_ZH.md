# CladeForge

**面向演化场景构建与假说生成的交互式系统发育树编辑器**

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23053393.svg)](https://doi.org/10.5281/zenodo.23053393)

---

[English README](./README.md) | [中文说明](./README_ZH.md)

---

CladeForge 是一款本地优先的跨平台桌面应用，用于构建、注释和导出带有演化语义层的系统发育树。它将系统发育树重新定义为"假说脚手架"——一个用于构建、比较和优化演化场景的画布。

基于 **Tauri v2 + React 18 + TypeScript + Vite** 构建，后端使用 Rust。

## 功能特性

- **交互式树编辑** — 有根树，支持二叉/三叉/多叉分支、节点和分支样式、折叠/展开、重新定根、梯形化。
- **多种布局** — 矩形支序图、矩形系统发育图、时间校准布局（带地质年代条带）和圆形布局；四种方向（LR/RL/TB/BT）；自动和手动布局模式。
- **性状/状态系统** — 离散和连续性状，支持色盲友好调色板；桑科夫步矩阵支持不对称演化代价。
- **演化事件** — 六个分组共 15 种内置事件类型（物种形成、灭绝、关键演化、基因流、生物地理，以及仅包含用户自定义类型的"通用"组），每种都有独立的二字代号与配色，支持因果链链接。
- **假说层** — 在共享拓扑上管理多个竞争性假说；终端状态共享，内部节点假说分异。
- **推理辅助（建议性）** — 桑科夫简约法建议、Mk 模型概率性 ASR（对数空间数值稳定）、一致性检查、性状相关性提示（Jaccard 共变化）。
- **DTL 协同重建** — 基因树/物种树分析，含动态规划求解器、手动细化、验证和并排协同视图。
- **时间校准** — 化石校准点、地质年代条带和环境事件叠加。
- **导入/导出** — Newick 和 Nexus 导入（NHX 元数据无损往返）；`.cladeforge.json` 项目文件；SVG/PNG/PDF 图像导出（带自动图例）；假说 JSON 导出。
- **撤销/重做** 基于 Immer 结构共享；双语界面（英文/中文）。

## 系统要求

| 平台 | 最低系统 | 架构 | 磁盘空间 | 内存 |
|------|---------|------|---------|------|
| macOS | 11.0 (Big Sur) | arm64、x86_64 | 实测 12.4 MiB（v0.1.0，arm64 应用包；安装镜像 4.6 MiB） | 512 MB |
| Windows | 10 (64位) | x86_64 | 尚未实测——本版本未产出 Windows 构建 | 512 MB |
| Linux | glibc ≥ 2.28 | x86_64 | 尚未实测——本版本未产出 Linux 构建 | 512 MB |

应用自身不捆绑浏览器引擎，但它会渲染进操作系统自带的 web 视图（macOS 上为 WKWebView、
Windows 上为 WebView2、Linux 上为 WebKitGTK），因此宿主机必须提供对应的 web 视图；
运行本应用不需要任何其他运行时（Java、Python 或 Node.js）。

## 安装

### 预构建二进制包

预构建安装包随 GitHub Releases 发布（以该页面实际是否存在对应构建为准）：

- **macOS**：`.dmg`（同时支持 Apple Silicon 和 Intel）
- **Windows**：`.msi`（x64）
- **Linux**：`.deb` 或 AppImage

若发布页上还没有你所在平台的构建，请改用下面的源码构建——它是主要的安装路径，
本地打包会得到同样的安装包。

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

**源码构建前置条件：** Node.js ≥ 18，Rust 工具链 ≥ 1.70，npm。

## 快速开始

1. 打开或创建项目（`.cladeforge.json`）。
2. 在主画布中编辑树——右键节点进行拓扑操作（添加分支、插入父节点、重新定根、删除、折叠）。
3. 使用侧面板定义性状、分配状态、放置事件、管理假说层和设置校准点。
4. 运行推理辅助（简约法、Mk ASR、一致性检查）获取建议性提示。
5. 通过导出面板导出：SVG/PNG/PDF 用于图表，Newick/Nexus 用于树，JSON 用于假说存档。

## 项目文件格式

CladeForge 项目以 JSON 格式存储（`.cladeforge.json`），架构版本 `0.1.0`。

## 文档

- [用户手册（中文）](./docs/MANUAL_ZH.md) — 完整的功能详解手册
- [User Manual (English)](./docs/MANUAL_EN.md) — 英文完整手册
- [贡献指南（中文）](./CONTRIBUTING_ZH.md) · [Contributing Guide](./CONTRIBUTING.md)

## 路线图

- [x] 基因树/物种树协同重建（DTL 风格）
- [ ] 协同重建优化：并排视图中的拖拽映射、多基因聚合叠加
- [ ] 嵌入式协同重建布局（将基因树投影到物种树画布上）
- [ ] 前向模拟引擎用于假说检验
- [ ] 第三方推理工具的插件架构
- [ ] 协作工作区

## 许可证

基于 [MIT 许可证](./LICENSE) 发布。

## 引用

每一个打标签的发布版本都会归档到 Zenodo，并拥有各自可引用的 DOI。请引用你实际使用的版本；concept DOI
始终解析到最新的归档版本。

- **Concept DOI（全部版本）：** [10.5281/zenodo.23053393](https://doi.org/10.5281/zenodo.23053393)
- **v0.1.0（本次发布）：** [10.5281/zenodo.23053394](https://doi.org/10.5281/zenodo.23053394)

> 曾子超 (Zeng, Z.). (2026). *CladeForge* (Version v0.1.0) [计算机软件]. Zenodo.
> https://doi.org/10.5281/zenodo.23053394

目前尚无可引用的论文条目。机器可读的引用信息见 [`CITATION.cff`](./CITATION.cff)。

## 资助

本项目受国家级科研项目资助。资助编号将在可以披露后列入本节。
