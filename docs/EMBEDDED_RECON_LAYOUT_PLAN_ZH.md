<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# 嵌套视图（嵌入式协调布局）实施方案

> 英文版：[EMBEDDED_RECON_LAYOUT_PLAN_EN.md](./EMBEDDED_RECON_LAYOUT_PLAN_EN.md)——本文是该设计契约的中文正本，与英文对照必须保持同步。章节编号、标题层级，以及 §5 与 §9.1 的算法契约在两侧都是规范性内容——改一侧，就要在同一次提交中改另一侧。

> 状态：**已实施**（Phase 1–4 全部交付，2026-11-11）  
> 目标：在协调工作区新增 `embedded` 布局模式，把基因树嵌套绘制在物种树的粗枝内部  
> 关联路线图：[README_ZH.md](../README_ZH.md) “嵌套视图协调布局（将基因树投影到物种树画布上）”路线图项（已勾选）  
> 最后更新：2026-11-11  
> 实施落点：`src/model/reconPlacements.ts`、`src/layout/embeddedRecon.ts`、`src/canvas/EmbeddedReconCanvas.tsx`、`src/io/embeddedReconExport.ts` 及视图/检视面板/持久化/导出接线；用法见 [MANUAL_ZH.md](./MANUAL_ZH.md) “嵌套视图”

---

## 审阅记录（2026-11-10）

本方案已逐条对照当前源码核对，并针对发现的问题做了修订。审阅期间没有修改任何项目源码。

核对方法：逐文件读取相关源码，并对照现有测试的期望行为（尤其 `sampleRecon.test.ts`、`projectIO.test.ts`、`reconMapping.test.ts`）；本次只审阅文档，未运行完整测试套件。

**已核对准确的事实**

- 当前协调视图确实是“双窗格、独立布局、中间映射桥”的并排结构；物种树枝条是固定 1.4 px 描边。
- `GeneNodeAssumption` 当前只有 `speciesNode`、`event`、`losses`、`meta`，没有枝内位置或转移供体字段。
- `projectIO` 会原样保留 `assumptions`；`dtlScenarioToAssumptions` 会整体重建假设，因此应用 DTL 场景时必须有选择地保留/丢弃视觉字段。
- `mapTipsByLabel` 只覆盖基因末端；内部节点需要显式假设，或采用本方案新增的“显示推断”。
- `recon-family` 示例的基因树 β 含一个故意未映射的内部节点 β4，且其子代 E/F 仍可通过标签映射定位。
- 协调视图目前没有 SVG/PNG/PDF 图形导出，只有 Markdown 协调报告。
- 暗色主题实际选择器是 `:root[data-theme='dark']`，并另有 `@media (prefers-color-scheme: dark)` 的系统暗色分支。

**本次修订的关键点**

1. 增加“无假设但子代可定位”的内部节点显示推断（MRCA 占位），否则示例 β4 会让基因树断开。
2. 将转移供体的默认推导改为与 `validateScenario` / `geneTreeNhk` 一致：受体子树之外的子代所在物种节点是供体，而不是父节点所在的枝。
3. 增加物种树的纵向枢纽（hub bar）并纳入 SVG 遮罩（mask）；否则跨子管道的基因连接线会被裁掉，物种树也不会整体读作粗枝。
4. 明确丢失显示策略：未断言、断言覆盖结构最小值、断言低于结构最小值三种情况分开处理，不再承诺所有情况下 λ 与状态栏必然相等。
5. 将“可编辑假说/路径构建”从可选改为必需交付（Phase 3），因为它直接对应用户“自行构建演化路径”的要求。
6. 补充 `ReconWorkspace.tsx` / `ReconWorkspacePanel` 的单视口缩放与状态栏接线。
7. 修正暗色主题选择器，并补充系统暗色媒体查询块。
8. `useId()` 生成的 mask id 做字符清洗，避免 `url(#:r1:)` 的兼容性问题。
9. 明确“转移枝优先”与转移弧的注解语义：子节点 `event === 'transfer'` 时不得按父→子物种路径画普通下降；示例 α 的 αAC 受体是父映射的后代，必须先画“供体子代枝 → 受体枝”的弧，父枝用 τ 色短虚线，弧不替代基因树拓扑枝。

---

## 0. 摘要

当前协调视图是“物种树在左、基因树在右、中间用映射桥连接”的并排布局。本方案保留该布局作为精确映射编辑与审计视图，并新增一个嵌套布局：

- 物种树是唯一骨架，枝条画成较粗的“物种枝管道”；
- 基因树分支画成细线，通过 SVG mask 限制在物种枝管道内部；
- 物种形成 σ、基因重复 δ、水平转移（HGT）τ、基因丢失 λ 分别表达为：进入不同子管道、同管道内平行分叉、跨管道转移弧、管内丢失残枝；
- 所有几何在世界坐标中一次计算，平移缩放只做纯投影；
- 只读嵌套画布作为第一个里程碑；最终交付必须包含 Alt + 单击/可选拖放的路径编辑，并把枝内位置 `branchFraction` 与转移供体 `transferDonor` 持久化到工程文件。

术语约定（与 [UI_GLOSSARY.md](./UI_GLOSSARY.md) 一致）：**转移供体**下称“供体”，**物种枝管道**下称“管道”；某节点的**入枝** = 该节点与其父节点之间的那条枝（即“该节点的枝”，物种树与基因树同义；物种枝 id 取子节点 id，见 §3.2）；其余规范译名为**转移弧**、**纵向枢纽**、**车道**、**丢失残枝**、**显示推断**、**未映射**，而拓扑多歧一律用**多歧分支**表述。

本文件只描述实现方案，不包含源码修改。

---

## 1. 目标与非目标

### 1.1 目标

1. 在协调工作区提供“并排 / 嵌套”两种画布模式，默认仍为并排，避免既有工作流回归。
2. 嵌套模式使用单一坐标系、单一视口，物种树粗枝与基因树细枝共享同一世界坐标。
3. 支持以现有 `GeneNodeAssumption`（`speciesNode`、`event`、`losses`）自动推导一条确定性的基因谱系路径，不要求用户先补数据；对“内部节点无假设但子代可定位”的情况采用显示推断（MRCA 占位），不写入工程。
4. 支持在嵌套视图中查看 σ/δ/τ/λ 的空间位置；丢失显示按“断言 / 结构推断 / 低于结构最小值”三种状态区分，避免把推断值伪装成断言值。
5. 提供可持久化的路径构建字段：宿主枝内位置 `branchFraction`、转移供体 `transferDonor`；用户必须能在嵌套视图中完成映射与事件编辑，而不必回到并排视图。
6. 支持把嵌套图导出为矢量图，供论文或假说文档使用。

### 1.2 非目标

- 不修改 DTL 动态规划求解器、代价模型或事件语义。
- 不把基因树拓扑编辑搬进协调视图；基因树仍由构建对话框/标准视图修改。本方案的“构建路径”指在**已有基因树拓扑**上编辑映射、枝内位置、事件、供体与丢失；若要新增/删除基因节点或分支，请使用现有构建对话框。
- 不在第一版做多基因树聚合叠加；该功能属于独立路线图项。
- 不新增会自动写回工程或改变场景统计的推断；显示推断只用于布局占位，不写入 `assumptions`，也不改变校验/计数。
- 不在第一版支持圆形物种树；嵌套模式强制矩形/时间校准布局，并给出提示。

### 1.3 验收标准

- 打开 `recon-family` 示例，切换到嵌套模式后，所有“有效定位”的基因节点（显式假设、标签匹配、显示推断）都出现在其宿主物种枝的管道范围内；真正无法定位的节点进入明确的“孤立区”而不是消失。
- 示例 β 的未映射内部节点 β4 能以“显示推断”方式连接到 N4 的入枝，同时校验面板仍只报告原有的 1 个 `unresolved` 警告。
- 在合法场景中，σ 子代进入不同的子管道；δ 子代在同一管道内使用不同车道；τ 有跨管道转移弧；非法场景以虚线警示而不是伪造合法路径。
- 丢失显示按 §5.7 的三态策略执行：断言丢失覆盖结构最小值时总数与状态栏一致；未断言或低于结构最小值时明确标注“推断”或“断言不足”，不宣称数值相等。
- 缩放、平移、Fit、1:1、聚焦定位在嵌套模式下可用；并排模式的行为与现有测试完全一致。
- 用户可以在不使用并排视图的情况下完成路径构建：选中基因节点、点击/拖动宿主枝设置映射与 `branchFraction`、设置事件/供体/丢失，保存并重新打开后路径保持。
- 切换模式、切换基因树、撤销/重做、保存/重新打开工程后不丢失映射或新增可选字段。
- `npm run typecheck`、`npm test`、`npm run build` 全部通过。

### 1.4 用户需求映射

| 用户要求 | 方案落点 | 验收证据 |
| --- | --- | --- |
| 在协调视图中调整呈现方式 | `ReconViewOptions.layoutMode = 'embedded'`，工具栏“并排 / 嵌套”切换 | 协调工作区内可切换，并排模式不回归 |
| 物种树分支较粗 | 水平管道 + 纵向枢纽，宽度默认 18 世界 px | 物种树整体读作粗枝；管道与纵向枢纽都绘制 |
| 基因树分支较细 | 基因段默认 1.1–1.4 世界 px，按事件着色 | 粗细对比明显；缩放时仍位于管道内 |
| 基因树嵌套在物种树枝中 | 宿主枝 `t` 定位 + 车道偏移 + SVG mask | 所有有效定位的基因段位于宿主枝范围内 |
| 基于结构自行构建演化路径 | 选中基因节点 + Alt + 单击宿主枝（拖放为增强）+ `branchFraction` + `transferDonor` + 事件/丢失编辑 | Phase 3 完成后可保存、重开并保留路径 |
| 进而提出演化假说 | 场景摘要、校验、NHX/Markdown/SVG 导出 | 路径可导出为可引用的假说材料 |

---

## 2. 现状与差距

### 2.1 现有实现

| 位置 | 现状 |
| --- | --- |
| `src/canvas/ReconciliationView.tsx` | 两个独立窗格各调用一次 `computeLayout`，物种树 `LR`、基因树 `RL`；两个窗格各有自己的 transform；中间由 `ReconMappingLayer` 画映射桥。 |
| `src/canvas/ReconPane.tsx` | 树枝固定 `strokeWidth={1.4}` 且 `vector-effect="non-scaling-stroke"`；节点、标签、事件符号、视口裁剪均在此实现。 |
| `src/canvas/reconMapping.ts` | 映射线是“物种节点 y → 基因节点 y”的直线，纯投影，已分为 anchor pass 和 projection pass。 |
| `src/model/types.ts` | `GeneNodeAssumption` 只有 `speciesNode`、`event`、`losses`、`meta`；没有枝内位置、供体枝、丢失定位。 |
| `src/model/reconciliation.ts` | `minLossesBetween` / `descentLosses` 已给出沿物种路径的丢失语义；`validateScenario` 已校验 σ/δ/τ 结构。 |
| `src/io/reconExport.ts` | 协调视图只有 Markdown 报告；转移供体在 `geneTreeNhk` 里临时推导，没有持久化。 |
| `src/io/exportImage.ts` | 图片导出只覆盖标准画布；协调视图没有 SVG/PNG/PDF 导出。 |

### 2.2 关键差距

1. **没有共享坐标系**：两棵树各自布局、各自平移缩放，几何上不存在“包含”关系。
2. **没有嵌套布局算法**：`computeLayout` 是通用树布局，不知道基因节点应放在哪条物种枝、枝内什么位置、哪条车道。
3. **映射只有点语义**：只说明“映射到哪个物种节点”，不能唯一决定一条基因谱系沿物种枝的走法；需要自动推导规则或新增可选字段。
4. **没有物种枝管道渲染**：粗枝、管内裁剪、车道偏移、跨管道转移弧、管内丢失残枝都需要新渲染层。
5. **交互模型不匹配**：双窗格平移缩放、同步缩放、映射桥悬停都不适用于单视口嵌套图。
6. **没有图形导出**：现有导出链路与 `buildSVG(project)` 耦合，不能直接渲染协调场景。

---

## 3. 总体设计

### 3.1 模式切换与数据流

```text
ReconciliationView
├─ layoutMode === 'side-by-side'
│    ├─ ReconPane(species, LR)
│    ├─ ReconMappingLayer
│    └─ ReconPane(gene, RL)
└─ layoutMode === 'embedded'
     └─ EmbeddedReconCanvas
          ├─ computeLayout(prepareEmbeddedSpeciesDoc(project))
          ├─ resolveEffectiveGenePlacements(species, gene, assumptions) // 纯函数
          ├─ computeEmbeddedReconLayout(input)                          // 纯函数
          └─ SVG 渲染 + 单视口 pan/zoom
```

关键原则：

- **布局 pass** 只依赖文档、假设、视图选项；平移缩放不得重新计算布局。
- **投影 pass** 只根据当前 transform 计算屏幕坐标和视口裁剪，参照 `reconMapping.ts` 的 anchor/projection 分层。
- 并排视图的代码不改语义；嵌套视图使用新组件，减少回归面。
- **实现注意**：`ReconciliationView` 目前在任何模式下都会先计算两套布局、映射锚点和映射线。嵌套模式应短路这些 memo，或把现有并排画布抽成 `SideBySideReconCanvas` 并只在并排模式挂载；否则进入嵌套模式仍会付出无用的双窗格布局成本。React hooks 不能条件调用，短路必须写在 `useMemo` 内部（返回 `null`/空数组）或用子组件拆分实现。
- 同样要给现有的 fit/resize/focus 副作用加模式门控：嵌套模式下不得调用并排的 `fitBoth` / 窗格夹取，否则会改动画布不可见的双窗格状态；缩放读数应由 `EmbeddedReconCanvas` 上报。

### 3.2 单坐标系与“宿主枝”定义

- 世界坐标来自 `computeLayout` 的 `LR` 矩形布局；嵌套模式强制 `orientation: 'LR'`。
- **物种枝 id = 该枝的子节点 id**。不新增 EdgeId：`Project` 没有物种枝表，子节点 id 天然唯一标识一条入枝（即 §0 术语约定的“该节点的枝”）。
- **物种枝管道与纵向枢纽**：每条物种枝的水平段是容纳基因谱系的管道；父节点处的竖直连接条画成较粗的纵向枢纽，并纳入 mask。这样既让整棵物种树在视觉上读作粗枝，也保证基因谱系在子管道之间穿行时不会被裁剪。
  - 对枝 `b`（子节点 `c`，父节点 `p`）：水平管道中心线为 `(x_p, y_c) → (x_c - nodeR, y_c)`；
  - 每个物种内部节点各有一个纵向枢纽：x 固定为 `x(parent)`，y 覆盖其直接子节点的 y 范围；宽度取所有相邻管道宽度的最大值（至少 `minTubeWidth`），并在端点用覆盖节点枢纽的圆角/圆形补齐；
  - `t ∈ [0,1]`：0 在父端，1 在子节点端（水平管道终点位于节点标记左侧；节点标记本身不属于管道）；
  - `t` 是沿枝的**相对位置**，不是绝对时间；有年龄数据时只用于转移的时间可行性检查，不把基因节点强行放到某个真实节点年龄上；
  - 车道偏移沿垂直于管道方向（水平枝即 y 方向）偏移；纵向枢纽在第一版使用固定中心通道，不做车道分配（节点处会交叉，但空间很短）；
  - 根节点没有入枝，映射到根时使用根坐标，`hostBranchId = null`。
- 物种树布局使用更大的间距，给管道和标签留空间（见 §5.3）。该间距只影响视图，不写回工程。

### 3.3 视觉语法

| 元素 | 画法 | 颜色 token |
| --- | --- | --- |
| 物种枝管道 + 纵向枢纽 | 粗描边、圆角连接、浅色填充式管道；内部节点的纵向枢纽同样加粗 | `--recon-tube` / `--recon-tube-border` |
| 基因谱系 | 细线，位于管道内部 | σ：`--recon-map-sigma`；δ：`--recon-map-dup`；τ：`--recon-map-transfer`；事件未标注：`--recon-map-unresolved` |
| 基因末端映射 | 细线 + 管内末端节点 | `--recon-tip` |
| 物种形成 σ | 基因节点在物种分叉处，子代进入不同子管道 | σ 色 |
| 基因重复 δ | 同一管道内的平行分叉/车道 | δ 色 |
| 水平转移 τ | 供体管道 → 受体管道的跨管道转移弧，带箭头 | τ 色；时间不可行时虚线 |
| 基因丢失 λ | 管道内的短丢失残枝 + λ 计数 | `--recon-loss` |
| 事件未标注节点（有映射但无事件） | 空心/虚线节点，灰色 | `--recon-map-unresolved` |
| 未映射节点 | 右侧“孤立区”，虚线连接到最近已映射祖先 | 灰色 + 警示 |
| 选中/悬停 | 屏幕空间选择环；宿主管道高亮 | `--recon-select` |

---

## 4. 数据模型

### 4.1 视图选项

在 `src/model/types.ts` 中扩展 `ReconViewOptions`。这些是纯 UI 状态，不进入工程文件、不参与撤销/重做。

```ts
export type ReconLayoutMode = 'side-by-side' | 'embedded';

export interface ReconViewOptions {
  mappingScope: MappingScope;
  showLabels: boolean;
  showEventGlyphs: boolean;
  showLosses: boolean;
  showMappings: boolean;
  syncZoom: boolean;
  eventFilter: ReconEventType | 'unresolved' | 'all';

  /** 画布布局模式：并排对照 / 嵌入嵌套。 */
  layoutMode: ReconLayoutMode;
  /** 嵌套模式：物种枝基础管道宽度（世界 px）。 */
  embeddedTubeWidth: number;
  /** 嵌套模式：基因车道间距（世界 px）。 */
  embeddedLaneGap: number;
  /** 嵌套模式：是否绘制水平转移弧。 */
  embeddedShowTransfers: boolean;
  /** 嵌套模式：是否绘制基因丢失残枝。 */
  embeddedShowLossStubs: boolean;
}

export const DEFAULT_RECON_VIEW_OPTIONS: ReconViewOptions = {
  mappingScope: 'tips',
  showLabels: true,
  showEventGlyphs: true,
  showLosses: true,
  showMappings: true,
  syncZoom: true,
  eventFilter: 'all',

  layoutMode: 'side-by-side',
  embeddedTubeWidth: 18,
  embeddedLaneGap: 3,
  embeddedShowTransfers: true,
  embeddedShowLossStubs: true,
};
```

补充约定：

- `embeddedTubeWidth` 在 UI 中限制为 `[10, 32]`；`embeddedLaneGap` 限制为 `[1.5, 6]`。
- `syncZoom` 在嵌套模式无意义，工具栏中隐藏或禁用。
- `mappingScope` / `eventFilter` 在嵌套模式下**不隐藏拓扑**，只弱化非匹配元素的强调；选中/悬停元素始终高亮。否则会破坏基因树的完整性。
- `showMappings` 在嵌套模式下控制映射锚点、事件徽标等注释层，不控制嵌套枝本身。
- 新字段必须同时加入 `DEFAULT_RECON_VIEW_OPTIONS`；现有测试与 store 初始化都从该默认对象派生，因此不会出现大面积字面量缺失。
- `ReconPanel` 的“重置视图设置”当前只写入旧字段；实现时要把管道宽度、车道间距、转移/丢失开关一并复位，但**保留当前 `layoutMode`**，避免重置把用户从嵌套视图踢回并排视图。
- 可选：用 `localStorage` 记住上次的 `layoutMode`，但默认值仍为 `side-by-side`；不写入工程文件。

### 4.2 基因节点假设的扩展字段（Phase 3 必需）

> 字段在 schema 中保持**可选**以兼容旧工程；但 Phase 3 的 UI 与持久化是满足用户“自行构建路径”要求的必需交付，不是可选项。

在 `src/model/types.ts` 的 `GeneNodeAssumption` 中增加两个可选字段：

```ts
export interface GeneNodeAssumption {
  speciesNode: NodeId;
  event?: ReconEventType;
  losses?: number;
  meta?: HypothesisMeta;

  /**
   * 宿主物种枝内的位置：0 = 父节点端，1 = 映射到的物种节点端。
   * 仅在 speciesNode 不是物种根时有意义；缺省表示由布局自动推导。
   */
  branchFraction?: number;

  /**
   * 水平转移的供体：供体子代所在的物种节点（不是枝 id）。
   * 现行模型把“受体子树之外的子代”视为供体（validateScenario / geneTreeNhk 的约定）；
   * 缺省时按该规则自动推导；显式值用于多供体/歧义场景。
   */
  transferDonor?: NodeId;
}
```

语义与兼容性：

- 两个字段均为可选，旧工程无需迁移；`projectIO` 当前通过 `{ ...g, doc }` 原样保留 `assumptions`，不会丢失新字段。
- 打开时必须做边界修复：`branchFraction` 夹到 `[0,1]`；`transferDonor` 必须指向存在的物种节点，否则丢弃并在导入报告中说明。
- `setAssumption`（`src/model/geneTrees.ts`）本身已经使用 `{ ...cur, ...patch }`，因此新增可选字段无需改函数签名；只需在 UI 中传入 patch。
- `dtlScenarioToAssumptions`（`src/model/dtl.ts`）会整体重建 `assumptions`，而且**当前签名不接收旧 assumptions**；实现时必须新增可选参数 `previousAssumptions`，或在调用方调用后合并，否则无法“保留”视觉字段。
  - 若新旧 `speciesNode` 相同，保留原有 `branchFraction` / `transferDonor`；
  - 若映射目标改变，丢弃这两个视觉字段，避免指向旧枝；
  - 若新场景完全没有该基因节点，字段随假设一起消失。
- `reconExport.ts` 的 NHX 输出应增加 `BF=`、`TD=` 扩展标签；`geneTreeNhk` 生成 `TD=` 时优先使用显式 `transferDonor`，否则沿用现有的“子树外子代”推导。Markdown 表格可增加“枝内位置 / 供体”列。
- 不需要提升 `PROJECT_VERSION`；在 `docs/FORMAT.md` 中补充可选字段说明即可。

### 4.3 不新增的数据

- 不为物种枝新增 `EdgeId` 表；枝 id 复用子节点 id。
- 不持久化布局结果、车道号、屏幕坐标。
- 第一版不新增 `lossPositions`；丢失的管内位置由结构最小值自动推导，超出结构最小值的断言丢失以基因节点旁的额外丢失残枝/徽标表示（见 §5.7）。

---

## 5. 嵌套布局算法

### 5.1 新增纯模块

建议新增：

- `src/model/reconPlacements.ts`：有效定位、路径、丢失拆分、转移供体推导（`resolveTransferDonor`）。
- `src/layout/embeddedRecon.ts`：世界坐标、管道、纵向枢纽、车道、场景几何。
- 对应测试：`src/model/reconPlacements.test.ts`、`src/layout/embeddedRecon.test.ts`。

`reconPlacements.ts` 负责回答语义问题，不依赖 React：

```ts
export type PlacementSource = 'assumption' | 'tip-label' | 'inferred-mrca';

export interface EffectivePlacement {
  geneNodeId: NodeId;
  speciesNodeId: NodeId;
  source: PlacementSource;
  /** true = 仅用于显示的推断位置，不写入 assumptions，也不改变场景统计。 */
  inferred: boolean;
}

export interface EffectivePlacements {
  byGeneNode: Map<NodeId, EffectivePlacement>;
  inferredGeneNodes: NodeId[];
  unmappedGeneNodes: NodeId[];
}

export function resolveEffectiveGenePlacements(
  species: Project,
  gene: Project,
  assumptions: Record<NodeId, GeneNodeAssumption>,
): EffectivePlacements;

/** 枝 id = 子节点 id；物种根返回 null。 */
export function branchIdOf(species: Project, speciesNodeId: NodeId): NodeId | null;

export type SpeciesPath =
  | { kind: 'same'; node: NodeId }
  | { kind: 'down'; from: NodeId; to: NodeId; branches: NodeId[] }
  | { kind: 'up'; from: NodeId; to: NodeId; branches: NodeId[] }
  | {
      kind: 'lateral';
      from: NodeId;
      to: NodeId;
      mrca: NodeId;
      upBranches: NodeId[];
      downBranches: NodeId[];
    };

export function speciesPathBetween(
  species: Project,
  from: NodeId,
  to: NodeId,
): SpeciesPath;

/** 每个物种分叉处丢掉的谱系数；与 descentLosses/minLossesBetween 同一语义。 */
export function lossesAlongSpeciesPath(
  species: Project,
  path: SpeciesPath,
): Map<NodeId, number>;

/** 与 validateScenario / geneTreeNhk 共用：子树外子代即供体；显式供体子代优先。 */
export function resolveTransferDonor(
  species: Project,
  gene: Project,
  geneNodeId: NodeId,
  effective: EffectivePlacements,
  explicitDonorGeneChild?: NodeId,
): { donorGeneNodeId: NodeId; donorSpeciesNodeId: NodeId } | null;
```

实现要点：

- `resolveEffectiveGenePlacements` 合并当前 `ReconciliationView.mappingAssumptions` 与 `reconExport.effectiveMapping` 的规则：显式假设优先，其次基因末端按标签匹配；不要在三个地方各写一份。
- 有效定位必须验证 `assumption.speciesNode` 仍然存在于 `species.nodes`：悬空目标不能作为有效位置；末端回退到标签匹配，内部节点允许显示推断接管（若子代可定位），否则记为未映射；始终生成 `dangling-assumption` 布局问题，这与 `validateScenario` 已有的 `dangling` 提示一致。
- 布局层（`computeEmbeddedReconLayout`）还必须检查目标在 `speciesLayout.visible` 中：被折叠隐藏的物种节点/枝不能作为宿主枝；布局应跳过并产生 `hidden-host`/`unmapped-gene-node` 问题，规则与并排视图“不可见目标不画映射线”一致。嵌套模式不自动展开折叠子树。
- `speciesPathBetween` 复用 `pathToRoot` / `mrcaOf`（`src/model/treeOps.ts`），并用 `minLossesBetween` 做交叉测试，保证视觉丢失计数与 DTL 面板一致。
- `up` 路径（子映射到父的祖先）是时间旅行，`validateScenario` 已报错；布局层仍返回路径，但渲染为虚线的不可行路径。

#### 5.1.1 显示推断（必须实现）

基因树的内部节点不保证都有 `GeneNodeAssumption`。示例 `recon-family` 的基因树 β 就故意留下了一个未映射的内部节点 β4，而其子代 E/F 仍可通过标签映射到物种末端。若把所有“无假设内部节点”都丢进孤立区，基因树会断开，无法满足用户的嵌套预期。

规则：

1. 自底向上遍历基因树：若一个内部节点没有假设，且它的**所有**子节点都有有效定位（显式假设、标签匹配或显示推断），把该节点的显示位置设为这些子节点位置的 MRCA，`source = 'inferred-mrca'`，`inferred = true`。
2. 若任一子节点无法定位，则该节点也不推断；它和它上方无法定位的节点进入 `unmappedGeneNodes`。
3. 显示推断只用于布局：**不得写入 `entry.assumptions`**，不得改变 `scenarioSummary`、`validateScenario` 或状态栏计数。
4. 推断节点用虚线/空心样式，入枝虚线；图例写明“显示推断（未写入假设）”。其子代若已有真实映射，子代路径仍按真实映射绘制。
5. 这与“按 MRCA 生成建议”不同：后者会显式写入假设并改变场景；显示推断不会。用户可以在检视面板中通过“按 MRCA 生成建议”把 β4 正式写回。

β4 的具体预期：子代 E/F 的标签映射到 Taxon_E/Taxon_F，MRCA 为 N4；β4 显示在 N4 的入枝上，子代分别进入 N4 的两个子管道，同时校验面板仍只报告原有的 `unresolved` 警告。

### 5.2 布局输入输出

```ts
export interface EmbeddedLayoutOptions {
  tubeWidth: number;
  laneGap: number;
  minTubeWidth: number;
  maxTubeWidth: number;
  showTransferArcs: boolean;
  showLossStubs: boolean;
}

export interface EmbeddedReconInput {
  speciesDoc: Project;
  speciesLayout: LayoutResult; // 由 prepareEmbeddedSpeciesDoc + computeLayout 得到
  geneDoc: Project;
  assumptions: Record<NodeId, GeneNodeAssumption>;
  options: EmbeddedLayoutOptions;
}

export interface EmbeddedReconLayout {
  speciesLayout: LayoutResult;
  tubes: Map<NodeId, EmbeddedTube>;          // key = 物种枝 id（子节点 id）
  hubs: Map<NodeId, EmbeddedHub>;            // key = 父物种节点 id
  placements: Map<NodeId, EmbeddedGeneNode>; // key = 基因节点 id
  segments: EmbeddedGeneSegment[];
  transfers: EmbeddedTransferArc[];
  losses: EmbeddedLossMark[];
  orphans: EmbeddedOrphan[];
  bounds: EmbeddedBounds;
  issues: EmbeddedLayoutIssue[];
  stats: {
    maxLane: number;
    overflowBranches: number;
    unmapped: number;
    inferred: number;
  };
}
```

`EmbeddedTube`：

```ts
export interface EmbeddedTube {
  /** 物种枝 id = 子节点 id。 */
  branchId: NodeId;
  parentId: NodeId;
  /** 管道中心线端点（世界坐标）；t=0 在父端，t=1 在子节点端。 */
  x0: number;
  y: number;
  x1: number;
  width: number;
  lanes: number;
  /** 管道外轮廓/描边路径（SVG d）。 */
  path: string;
}

export interface EmbeddedHub {
  /** 父物种节点 id；枢纽覆盖其直接子节点的 y 范围。 */
  parentId: NodeId;
  x: number;
  y0: number;
  y1: number;
  /** 取相邻管道宽度的最大值，至少 minTubeWidth。 */
  width: number;
  /** 纵向连接条路径（SVG d）。 */
  path: string;
  /** 端点枢纽半径，用于 mask 圆形补齐。 */
  nodeRadius: number;
}
```

`EmbeddedGeneNode`：

```ts
export interface EmbeddedGeneNode {
  geneNodeId: NodeId;
  speciesNodeId: NodeId | null;
  hostBranchId: NodeId | null; // 物种根为 null
  t: number;                   // 0..1，hostBranchId 为 null 时无意义
  lane: number;
  x: number;
  y: number;
  event: ReconEventType | null;
  kind: 'tip' | 'internal';
  placementSource: 'assumption' | 'tip-label' | 'inferred-mrca' | 'none';
  /** true = 事件未定（有映射但无 event），用虚线/灰色。 */
  unresolved: boolean;
  /** true = 显示推断位置，不写入 assumptions。 */
  inferred: boolean;
  unmapped: boolean;
  /** 是否为自动推导的位置（用于 UI 提示）。 */
  autoPositioned: boolean;
}
```

`EmbeddedGeneSegment`：

```ts
export interface EmbeddedGeneSegment {
  id: string;
  geneNodeId: NodeId;
  parentGeneNodeId: NodeId;
  hostBranchId: NodeId;
  t0: number;
  t1: number;
  lane: number;
  d: string;
  event: ReconEventType | null;
  kind: 'tip' | 'internal';
  dashed: boolean;
  /** 'normal' | 'muted'，是否因过滤/弱化而淡化。 */
  emphasis: 'normal' | 'muted';
}
```

`EmbeddedTransferArc`：

```ts
export interface EmbeddedTransferArc {
  /** 转移事件所在的基因节点 g。 */
  geneNodeId: NodeId;
  /** 受体子树之外的子代 d；其宿主枝是供体枝。 */
  donorGeneNodeId: NodeId | null;
  /** 留在受体子树内的子代 r（用于受体端点兜底）。 */
  recipientGeneNodeId: NodeId | null;
  donorBranchId: NodeId | null;
  recipientBranchId: NodeId;
  donorSpeciesNodeId: NodeId | null;
  recipientSpeciesNodeId: NodeId;
  from: Point;
  to: Point;
  d: string;
  timeFeasible: boolean | null; // null = 无年龄数据，无法判断
}
```

`EmbeddedLossMark`：

```ts
export interface EmbeddedLossMark {
  geneNodeId: NodeId;
  atSpeciesNodeId: NodeId;
  branchId: NodeId | null;
  count: number;
  x: number;
  y: number;
  /** structural = 路径结构要求的最小丢失；asserted = 断言超出结构最小值的额外丢失。 */
  source: 'structural' | 'asserted';
  /** true = 该结构丢失没有被断言值覆盖，按“推断”样式绘制。 */
  inferred: boolean;
}

export interface EmbeddedOrphan {
  geneNodeId: NodeId;
  parentGeneNodeId: NodeId | null;
  reason: 'unmapped-tip' | 'unmapped-internal' | 'unknown-path';
  /** 孤立区内的世界坐标。 */
  x: number;
  y: number;
}

export interface EmbeddedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type EmbeddedLayoutIssue =
  | { kind: 'lane-overflow'; branchId: NodeId; lanes: number; cap: number }
  | { kind: 'unmapped-gene-node'; geneNodeId: NodeId }
  | { kind: 'dangling-assumption'; geneNodeId: NodeId; speciesNodeId: NodeId }
  | { kind: 'hidden-host'; geneNodeId: NodeId; speciesNodeId: NodeId }
  | { kind: 'unknown-path'; geneNodeId: NodeId }
  | { kind: 'embedding-order-conflict'; geneNodeId: NodeId }
  | { kind: 'infeasible-lateral'; geneNodeId: NodeId }
  | { kind: 'donor-unknown'; geneNodeId: NodeId };
```

#### 5.2.1 几何辅助函数

以下函数放在 `src/layout/embeddedRecon.ts` 或 `src/canvas/embeddedReconGeometry.ts`，纯函数、可单测：

```ts
/** 管道上的世界坐标；laneOffset 垂直于管道方向（水平枝即 y 偏移）。 */
export function pointOnTube(
  tube: EmbeddedTube,
  t: number,
  laneOffset = 0,
): Point {
  const tt = Math.max(0, Math.min(1, t));
  return {
    x: tube.x0 + (tube.x1 - tube.x0) * tt,
    y: tube.y + laneOffset,
  };
}

/** 车道偏移后的管内路径；t0→t1，用于基因段与丢失残枝。 */
export function lanePath(
  tube: EmbeddedTube,
  t0: number,
  t1: number,
  laneOffset: number,
  rounded = true,
): string;

/** 世界点到管道的最近命中：返回枝 id 与 t，用于 Alt+click / 悬停。 */
export function hitTestTube(
  tubes: Iterable<EmbeddedTube>,
  p: Point,
  tolerance: number,
): { tube: EmbeddedTube; t: number; distance: number } | null;

/** Fit：与 reconPaneBounds 相同的 padding=24 规则。 */
export function fitEmbeddedBounds(
  bounds: EmbeddedBounds,
  width: number,
  height: number,
): PaneTransform;

/** 场景包围盒：管道/枢纽/基因段/转移弧/丢失/标签。 */
export function computeEmbeddedBounds(
  scene: EmbeddedReconLayout,
  speciesDoc: Project,
  geneDoc: Project,
): EmbeddedBounds;
```

`pointOnTube` 的 `laneOffset` 必须包含车道半宽和基因线半宽的安全余量；`lanePath` 在管道内生成折线/圆角路径；`hitTestTube` 用管道矩形（y ± width/2）加上 `tolerance` 做快速筛选，再在 x 方向求 `t`。命中优先级：节点 > 基因段 > 管道/枢纽。`PaneTransform` 可复用 `reconMapping.ts` 的导出类型。

### 5.3 物种树准备

```ts
export function prepareEmbeddedSpeciesDoc(doc: Project): Project {
  const type = doc.layout.type === 'circular'
    ? 'rectangular-cladogram'
    : doc.layout.type;
  return {
    ...doc,
    layout: {
      ...doc.layout,
      type,
      orientation: 'LR',
      vGap: Math.max(doc.layout.vGap, 88),
      hGap: Math.max(doc.layout.hGap, 180),
    },
  };
}
```

- `circular` 不支持嵌套；强制矩形并给出视图提示。
- `time-calibrated` 保留年龄与 `timeAxisLength`；`rectangular-phylogram` 保留枝长。没有年龄/枝长时按拓扑布局，UI 显示“拓扑示意”。
- 加大 `vGap` 是为了容纳管道宽度和基因标签；该修改只用于本视图的布局输入，不写回工程。
- 管道宽度自适应有上限（见 §5.6），因此不需要把管道宽度反向反馈到物种布局，避免“布局→宽度→布局”的循环依赖。

### 5.4 基因节点定位规则

每个基因节点先求 `speciesNodeId`（有效映射），再求 `hostBranchId`、`t`、`lane`。

| 节点情形 | 宿主枝 | 默认 `t` | 说明 |
| --- | --- | --- | --- |
| 物种根 | `null` | 无 | 基因根/映射到根的节点放在物种根坐标 |
| 基因根（非自由根） | 映射节点的入枝 | 1.0 | 与物种根锚定 |
| 物种形成 σ | 映射节点的入枝 | 1.0（贴近节点） | 分叉发生在物种节点处 |
| 基因重复 δ | 映射节点的入枝 | 0.55 | 在管内留出分叉空间 |
| 水平转移 τ | 受体映射节点的入枝 | 0.75 | 到达点；转移弧从供体子代枝指向受体枝，父枝用 τ 色短虚线 |
| 基因末端（已映射） | 映射节点若是末端 → 该末端入枝 | 1.0 | 与物种末端对齐 |
| 有映射但事件未标注的内部节点 | 映射节点的入枝 | 0.9 | 虚线/灰色，保留占位 |
| 无映射、但所有子代可定位的内部节点 | 子代位置的 MRCA 的入枝（显示推断） | 1.0（子代进入不同子枝）或 0.55（同枝） | 节点/入枝虚线，标注“显示推断”，不写入假设 |
| 无映射且无法推断 | `null` | 无 | 进入孤立区，不参与嵌套 |

强制约束：

- 同一宿主枝内，基因父节点的 `t` 必须小于子节点的 `t`；否则把父节点向父端压缩（下限 0.15），仍无法满足时产生 `embedding-order-conflict` 布局错误，并用虚线表示。
- `branchFraction` 存在时覆盖默认 `t`，但仍受父子顺序约束。
- 同一物种节点上多个基因节点分配给不同车道，避免标记重叠。
- 显示推断节点受同样的父子顺序约束；其入枝与节点用虚线，避免被误读为已写回的假设。
- 跨子管道的连接走纵向枢纽的固定中心通道；枢纽很短，第一版不做车道分配，允许连接线在节点处交叉。
- 基因树是只读的；以上规则只决定“画在何处”，不改变假设。

### 5.5 基因枝分解

对每条基因枝“父基因节点 → 子基因节点”：

1. 取父、子有效映射 `u`、`v`。
2. **先检查子节点的 `event`**：
   - 若 `event === 'transfer'`：**不要**按 `speciesPathBetween(u, v)` 展开物种路径。按 §5.8 画转移注解：供体子代 d（受体子树外的子代）的宿主枝 → 受体枝的跨管道转移弧；转移基因节点 g 的父枝用 τ 色短虚线表示，不沿物种路径展开。即使 `v` 是 `u` 的后代（示例 α 的 αAC 就是这种情况），也不能画成普通下降。
   - 若 `event !== 'transfer'`，进入下一步。
3. 调用 `speciesPathBetween(species, u, v)`：
   - `same`：基因枝在同一宿主枝内，按 `t` 顺序画短分叉/平行线；
   - `down`：沿 `u → v` 的物种路径逐枝画段；每个中间物种节点生成丢失标记；
   - `lateral`：先上到 MRCA，再下到 `v`；非水平转移的横向移动视为不可行，画虚线警示路径并产生布局问题；
   - `up`：不可行时间旅行，虚线警示。
4. 每一段输出 `EmbeddedGeneSegment`，记录 `hostBranchId`、`t0`、`t1`、`lane`。
5. 在物种节点处连接相邻段；连接处走纵向枢纽的固定中心通道，因此不会离开管道。
6. 末端已映射节点：最后一段在 `t=1` 收束，节点与物种末端相邻对齐（管道终点在节点标记左侧）。
7. 显示推断节点：其入枝虚线；子代路径仍按各自有效位置绘制；不得把推断值写回 `assumptions`。
8. 若基因枝的一端没有有效位置（完全未映射且无法推断）：
   - 不生成普通嵌套段；
   - 若该节点有最近的已映射祖先，画一条虚线“路径未知”连接（标记 `unknown-path`）；
   - 若没有，该节点进入孤立区；
   - 不得用子代 MRCA 伪造父节点映射。
9. 若该基因枝连接“显示推断父节点”与“真实映射子节点”，父到子的段用虚线，子节点以下恢复实线。

重要：路径分解必须与 `minLossesBetween` 的语义对齐。`down` 路径的丢失是每个中间分叉的 `childrenIds.length - 1`，不是固定 1；横向路径的两侧下探都计入。显示推断只影响布局，不改变丢失定价；由显示推断节点引出的结构丢失同样标记为 `inferred`，不计入断言统计。

### 5.6 车道分配与管道宽度

对每条物种枝收集所有 `EmbeddedGeneSegment` 和一个基因节点占位区间 `[t-ε, t+ε]`：

1. 按 `t0`、基因节点 id 排序。
2. 贪心区间着色：分配当前空闲的最小车道；没有空闲则新增车道。
3. 可选优化：按后代基因末端的物种 y 序（质心）排序车道，减少无意义交叉；但**不得试图消除全部交叉**——基因树与物种树的冲突正是要表达的信息。
4. 车道偏移：

```text
laneOffset(lane, laneCount, laneGap) =
  (lane - (laneCount - 1) / 2) * laneGap
```

5. 管道宽度：

```text
required = (laneCount - 1) * laneGap + 2 * padding
width = clamp(max(baseWidth, required), minTubeWidth, maxTubeWidth)
```

6. 若 `required > maxTubeWidth`：
   - 依次缩小 `laneGap` 到最小值；
   - 仍溢出时产生 `lane-overflow` 布局问题，在管道端点显示 `+n` 徽标；
   - 不自动改变物种树文档的间距。

推荐默认值：

- `minTubeWidth = 12`，`baseWidth = 18`，`maxTubeWidth = 32`；
- `laneGap = 3`，最小 `1.5`；
- 管道内边距 `padding = 2`。

### 5.7 丢失标记与计数一致性

代码事实：`scenarioSummary` 的 λ 只统计 `assumptions[].losses`，**不会自动加入路径结构最小值**；`validateScenario` 的 `loss-shortfall` 才报告“断言值低于结构最小值”。因此不能简单承诺所有情况下“图上的 λ 总数 = 状态栏 λ”。

定义：

- `structuralMin`：由 `lossesAlongSpeciesPath` 得到每个物种分叉处的 `m-1` 之和；
- `asserted`：`assumption.losses ?? 0`；
- 若路径为 `up`（时间旅行）或 `structuralMin` 非有限（对应 `minLossesBetween` 的 `Infinity`）：不套用下表，不画丢失残枝；画不可行路径并引用校验的 `upward-move` 错误。不要把 `Infinity` 放进比较。
- 显示策略（仅对有限结构丢失）：

| 断言丢失 `asserted` | 管内绘制 | 与状态栏关系 |
| --- | --- | --- |
| 缺省（undefined） | 在路径分叉处绘制 `structuralMin`，用空心/虚线丢失残枝，标注“推断结构丢失” | 状态栏按 0 计；图例说明“推断丢失不计入断言统计” |
| `asserted >= structuralMin` | 绘制 `structuralMin` 的结构残枝 + 在基因节点旁绘制 `asserted - structuralMin` 的额外残枝/λ 徽标 | 总数 = `asserted`，与状态栏一致 |
| `asserted < structuralMin` | 绘制 `structuralMin` 的结构残枝，并加警告徽标“断言 λa < 结构最小 λm” | 总数不等于状态栏；校验已报 `loss-shortfall`，界面必须明确说明 |

补充：

- 结构残枝由 `lossesAlongSpeciesPath` 定位到具体分叉；`count > 1` 时标注 `λn`。
- 同一物种分叉处多个基因节点产生的结构丢失可汇总为一个 `λn`，tooltip 列出贡献的基因节点；汇总不改变总数。
- 额外断言丢失没有精确位置时，画在基因节点的宿主枝旁，不伪造具体分叉；检视面板显示断言值。
- DTL 求解器在 `dtlScenarioToAssumptions` 中会产生 `lossMarks`（含 `at`：谱系终止的物种节点），但当前只存了总数。若需要精确复现求解器的丢失位置，可在 Phase 3 增加可选字段 `lossMarks?: { at: NodeId; count: number }[]`；第一版不要求。
- 丢失残枝画在管道内部，不穿透管道边界；残枝末端使用小圆点/叉号，颜色 `--recon-loss`。
- 不要为了“与状态栏对齐”而隐藏结构最小值：科学上必须显示路径要求的最小丢失，并必须明确推断/断言/警告的区别。

### 5.8 水平转移（HGT）

- **受体**：转移基因节点映射所在的物种枝（`speciesNode` 的入枝）。这是基因谱系“到达”的一侧。
- **转移供体**（与现有 `validateScenario` / `geneTreeNhk` 的约定保持一致）：
  - 优先生效显式 `assumption.transferDonor`；
  - 显式供体必须存在于 `species.nodes` 且位于受体子树之外；否则忽略该字段、回退自动推导并标注 `donor-unknown`/`dangling-assumption`；
  - 否则在该基因节点的子代中，取有效定位落在受体物种子树之外的子代；该子代映射的物种节点所在枝即供体枝；
  - 若有多个子树外子代，按 `childrenIds` 顺序取第一个（与 `geneTreeNhk` 当前行为一致），并在 UI 标注“自动推导供体”；用户可用 `transferDonor` 覆盖；建议把该规则抽成 `resolveTransferDonor` 共享函数，导出与布局不得各写一份；
  - 若所有子代都有有效位置且没有子树外子代，说明转移事件本身不合法（`validateScenario` 会报 `event-conflict`）；不画合法转移弧，只画虚线警示；
  - 若存在未定位子代，`validateScenario` 可能跳过该节点的转移校验；此时供体未知，转移弧虚线并在图例/检视面板标注，不猜测；
  - **不要把父基因节点所在的枝作为默认供体**：现有模型把“受体子树之外的子代”视为供体，父枝默认会与校验/导出语义冲突。
- 若供体子代本身未映射/无法定位，供体未知：转移弧虚线并在图例/检视面板标注，不猜测。
- **转移弧是事件注解，不替代基因树拓扑枝**：
  - 供体子代 d 的谱系在供体枝内绘制；留在受体子树内的子代 r 的谱系在受体枝内绘制；
  - 跨管道转移弧从 d 的宿主枝指向受体枝（g/r 所在枝），箭头指向受体；
  - 转移基因节点 g 的父枝用 τ 色虚线从父节点落点连接到 g 的受体端点；若两点跨管道，走外部绕行；不要展开父→g 的物种路径，也不要把父节点枝当供体；
  - 若父枝与转移弧在视觉上重复，可只保留转移弧 + 一个 τ 色父枝短残段，但不得删除 g 与父节点的拓扑关系提示。
- 受体端点取 g 的宿主枝（与 r 同侧）；若 g 是根或没有入枝，退回 r 的宿主枝。
- 转移弧本身不产生结构丢失；供体子代 d 自身入枝的断言丢失仍按 §5.7 的普通规则显示（若有）。转移事件在状态栏中的 λ 仍由 `assumptions[].losses` 统计，布局不额外计入。
- 转移弧路由：
  - 从供体管道的 `(x_d, y_d + laneOffset_d)` 到受体管道的 `(x_r, y_r + laneOffset_r)`；
  - 使用三次贝塞尔曲线，在管道上方或下方留出垂直净空，避免穿过无关管道；
  - 箭头指向受体管道；
  - 曲线沿“上方”还是“下方”按两条枝的上下关系选择：受体在供体上方则走上方，反之走下方；
  - 管道拥挤时可选择从树的外侧绕行，第一版先用简单的上方/下方规则。
- 时间可行性：
  - 有年龄时，检查供体枝与受体枝的生存区间是否重叠（复用 `validateScenario` 的 `timing` 逻辑）；
  - 不重叠时转移弧虚线化并标注警告；
  - 无年龄时 `timeFeasible = null`，图例注明“拓扑转移，时间未校验”。

### 5.9 边界与 Fit

- `bounds` 必须包含：管道外轮廓、所有基因段、转移弧、丢失残枝/徽标、物种与基因标签、事件符号、选择环余量。
- `fitEmbeddedBounds(bounds, width, height)` 复用现有 `fitTransformFor` 的 padding=24 规则；缩放范围沿用 `RECON_MIN_SCALE=0.15`、`RECON_MAX_SCALE=4`。
- 时间校准布局若有 `timeAxis`，把轴标签区域计入 bounds（可复用 `planEraOverlay` 的边距逻辑），第一版可先不画时间轴，但必须在图例中说明 x 轴含义。

### 5.10 确定性与复杂度

- 所有排序必须带稳定的二级键（基因节点 id / 物种节点 id），保证同一输入产生同一布局。
- 复杂度目标：
  - 有效映射 O(g + s)；
  - 路径分解 O(g × speciesDepth)，可用 MRCA 缓存降到接近 O(g × log s)；
  - 车道分配 O(k log k)（每条枝 k 个区间）；
  - 场景生成 O(segments + transfers + losses)；
  - 平移缩放不重算布局。
- 布局缓存的键：`project`、`activeGeneTreeId`、`assumptions`、`ReconViewOptions` 中影响布局的字段；悬停/选择只影响强调，不得触发布局重算。

### 5.11 伪代码

```ts
export function computeEmbeddedReconLayout(
  input: EmbeddedReconInput,
): EmbeddedReconLayout {
  const { speciesDoc, speciesLayout, geneDoc, assumptions, options } = input;

  const effective = resolveEffectiveGenePlacements(
    speciesDoc, geneDoc, assumptions,
  );

  const placements = placeGeneNodes(
    speciesDoc,
    geneDoc,
    assumptions,
    effective,
    speciesLayout,
  );

  const { segments, transfers, losses, orphans, issues } =
    decomposeGeneEdges(
      speciesDoc,
      geneDoc,
      placements,
      options,
    );

  const lanes = assignTubesAndLanes(
    speciesDoc,
    speciesLayout,
    placements,
    segments,
    options,
  );

  const { tubes, hubs } = buildTubeGeometry(speciesLayout, lanes, options);
  const emitted = emitScene(placements, segments, transfers, losses, orphans);
  const scene: EmbeddedReconLayout = {
    speciesLayout,
    tubes,
    hubs,
    ...emitted,
    // 先放占位值，下面用真实几何覆盖；避免 computeEmbeddedBounds 依赖 bounds 自身。
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    issues,
    stats: summarize(lanes),
  };
  return { ...scene, bounds: computeEmbeddedBounds(scene, speciesDoc, geneDoc) };
}
```

---

## 6. 渲染设计

### 6.1 组件

新增 `src/canvas/EmbeddedReconCanvas.tsx`，不改 `ReconPane`。推荐组件接口：

```tsx
export interface EmbeddedReconCanvasProps {
  speciesDoc: Project;
  geneEntry: GeneTreeEntry;
  options: ReconViewOptions;
  geneSelection: NodeId[];
  speciesSelection: NodeId[];
  hoveredGeneId: NodeId | null;
  focusTarget: { id: NodeId; seq: number } | null;
  onGeneNodeClick: (id: NodeId, e: React.MouseEvent) => void;
  onSpeciesNodeClick: (id: NodeId, e: React.MouseEvent) => void;
  onTubeClick: (branchId: NodeId, t: number, e: React.MouseEvent) => void;
  onGeneHover: (id: NodeId | null) => void;
  onZoomChange?: (zoom: number) => void;
  onFitReady?: (fit: () => void) => void;
  onResetZoom?: () => void;
}
```

组件内部应渲染一个固定的 header 行（布局行，不是 overlay）：标题“物种树 · 当前基因树”、节点数、当前缩放、Fit、1:1。`ReconPane` 的每窗格 Fit/1:1 在嵌套模式下没有对应窗格，因此这两个操作必须在 `EmbeddedReconCanvas` header 或 `ReconToolbar` 中可达；不能只保留 Fit 事件而漏掉 1:1。

内部：

```tsx
const speciesLayout = useMemo(
  () => computeLayout(prepareEmbeddedSpeciesDoc(speciesDoc)),
  [speciesDoc],
);
const scene = useMemo(
  () => computeEmbeddedReconLayout({
    speciesDoc,
    speciesLayout,
    geneDoc: geneEntry.doc,
    assumptions: geneEntry.assumptions,
    options: layoutOptionsFrom(options),
  }),
  [speciesDoc, speciesLayout, geneEntry, options],
);
```

### 6.2 图层顺序

从下到上：

1. 物种树水平管道描边（外层边框 + 内层填色）；
2. 物种树纵向枢纽与节点枢纽圆（同样加粗，令整棵物种树读作粗枝）；
3. 基因段（应用管道 + 枢纽 mask）；
4. 转移弧（管道之上、节点之下）；
5. 基因节点标记、事件符号；
6. 丢失残枝与 λ 徽标；
7. 标签（物种标签在管道外，基因标签在管内或末端）；
8. 选择/悬停环、焦点指示；
9. 孤立区（未映射节点）。

### 6.3 管道 mask（关键 SVG 细节）

不能用 `clipPath` 直接裁剪“描边形状”：`clipPath` 使用填充几何，粗描边不是填充区域。正确做法是用 `<mask>`：

```svg
<mask id={maskId} maskUnits="userSpaceOnUse"
      x={bounds.minX} y={bounds.minY}
      width={bounds.maxX - bounds.minX}
      height={bounds.maxY - bounds.minY}>
  <rect x={bounds.minX} y={bounds.minY}
        width={bounds.maxX - bounds.minX}
        height={bounds.maxY - bounds.minY} fill="black" />
  {tubes.map(t => (
    <path d={t.path} fill="none" stroke="white"
          strokeWidth={t.width} strokeLinecap="round" />
  ))}
  {hubs.map(h => (
    <path d={h.path} fill="none" stroke="white"
          strokeWidth={h.width} strokeLinecap="round" />
  ))}
  {speciesNodes.map(n => (
    <circle cx={n.x} cy={n.y} r={n.hubRadius} fill="white" />
  ))}
</mask>

<g mask={`url(#${maskId})`}>
  {segments.map((s) => {
    const token = s.event
      ? eventToken(s.event)
      : s.kind === 'tip'
        ? 'tip'
        : 'unresolved';
    return (
      <path key={s.id} d={s.d} fill="none"
            stroke={`var(--recon-map-${token})`}
            strokeWidth={1.25} strokeLinecap="round" />
    );
  })}
</g>
```

注意：

- 不能用 `clipPath` 直接裁剪“描边形状”：`clipPath` 使用填充几何，粗描边不是填充区域。`<mask>` 的白色描边才是可靠做法。
- 示例里的 `speciesNodes` 可由 `speciesLayout.visible` + `positions` 派生（每个节点带 `hubRadius`）；也可以用 `hubs` 的端点圆补齐，避免额外查询。
- **纵向枢纽必须进入 mask**：基因谱系从父管道穿到子管道时经过的是竖直段；只遮罩水平管道会把连接线裁掉。纵向枢纽与节点圆补齐后，连接线才能连续。
- `maskId` 用 React `useId()` 生成，并做字符清洗（例如 `const maskId = 'er-mask-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')`）；导出 SVG 时也要保证唯一。
- mask 的覆盖矩形必须包含一个视口缓冲，避免平移时边缘被裁掉。
- 转移弧、丢失徽标不被 mask 裁剪，画在 mask 组之外。
- 管道内层建议用略浅的颜色填充；外层加 1px 边框，避免与背景融为一体。
- 车道中心距管道边缘至少保留一个基因线宽，避免细线外沿被 mask 削掉。

### 6.4 线宽与缩放策略

- 管道宽度与基因线宽都使用**世界坐标**，随缩放同步变化，保证基因线始终在管道内。
- 基因线建议 1.1–1.4 世界 px；管道基础 18 世界 px；车道间距 3 世界 px。
- 管道宽度首先由“同时存在的基因车道数”决定，因此会间接反映该枝的基因拷贝数；图例必须说明这一点，避免读者把宽度理解为支持度或节点年龄。若改用固定宽度，则必须压缩车道并提示溢出，不能让同一宽度通道同时编码两种含义。
- 标签、事件符号、选择环使用屏幕空间尺寸（逆缩放），沿用 `ReconPane` 的 `invScale` 模式。
- 低缩放时按 LOD 隐藏基因内部标签，仅保留选中/悬停标签与末端计数徽标。

### 6.5 标签

- 物种标签：放在管道外侧（右侧末端或节点上方），确保不会压住管道；复用 `estimateLabelWidth` 与现有标签边界规则。
- 基因标签：
  - 默认显示基因末端标签；内部基因标签仅在选中/悬停或放大到阈值以上时显示；
  - 同一末端有多个基因拷贝时，显示堆叠标签或 `×n` 徽标；
  - 标签使用 `paint-order: stroke`，带背景描边，避免压在细线上。
- 图例必须说明：物种枝管道 = 物种枝；管内细线 = 基因谱系；虚线 = 显示推断/事件未标注/不可行/时间未校验/路径未知。

### 6.6 裁剪与性能

- 复用 `paneWorldViewport` 的世界视口计算；为管道、基因段、转移弧、丢失徽标分别建立包围盒，按视口 + 一屏缓冲裁剪。
- `memo` 子组件的 props 使用世界坐标基元，保证悬停/选择只重渲染少数元素。
- 平移缩放采用 `ReconPane` 的“ref 累积 + 每帧最多提交一次”模式，避免高频输入触发大量 React 渲染。
- 布局只在文档/假设/布局选项变化时重算；选择、悬停、平移缩放不触发布局。

### 6.7 主题变量

在 `src/styles/app.css` 增加：

```css
:root {
  --recon-tube: #e4e4e7;
  --recon-tube-border: #a1a1aa;
  --recon-tube-inner: #fafafa;
  --recon-gene-unmapped: #71717a;
}

/* 显式暗色主题：app.css 使用 :root[data-theme='dark'] */
:root[data-theme='dark'] {
  --recon-tube: #3f3f46;
  --recon-tube-border: #71717a;
  --recon-tube-inner: #27272a;
  --recon-gene-unmapped: #a1a1aa;
}

/* 系统暗色：与 app.css 现有分支保持一致 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']):not([data-theme='dark']) {
    --recon-tube: #3f3f46;
    --recon-tube-border: #71717a;
    --recon-tube-inner: #27272a;
    --recon-gene-unmapped: #a1a1aa;
  }
}

/* 嵌套画布容器：占用 .recon-canvas 的 panes 行 */
.recon-embedded {
  grid-area: panes;
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--recon-pane-bg);
  color: var(--text);
}
.recon-embedded svg {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}
```

继续使用现有 `--recon-map-sigma`、`--recon-map-dup`、`--recon-map-transfer`、`--recon-map-unresolved`、`--recon-tip`、`--recon-loss`、`--recon-select`。确保亮/暗主题下管道与基因线对比度足够。图例需增加“物种枝管道 / 基因谱系 / 显示推断 / 拓扑示意”四项；嵌套模式下 `syncZoom` 图例项不得出现。

### 6.8 无障碍

- 画布容器：`role="group"` + `aria-label`（嵌套协调视图）。
- 基因节点：`role="button"`、`tabIndex=0`、Enter/Space 选择；`aria-label` 包含映射目标、事件、丢失。
- 物种枝管道：`role="button"`（可选择；可编辑模式下支持 Alt + 单击）并带 `aria-label`（宿主物种枝 + 枝内位置）。
- 选择变化通过 `aria-live="polite"` 播报，复用现有 `ReconciliationView` 的播报模式。

---

## 7. 视图集成与交互

### 7.1 模式切换

在 `src/ui/ReconToolbar.tsx` 增加分段控件：

```text
[并排对照] [嵌套视图]
```

- 写入 `reconViewOptions.layoutMode`；
- `syncZoom` 控件在嵌套模式下隐藏或禁用；
- Fit 按钮继续派发 `cladeforge:recon-fit` 事件，由嵌套画布监听；嵌套模式下按钮文案用“适配视图”，不要写“适配两侧窗格”；
- 切换模式不改变选择、不重置映射、不写工程文件；
- `ReconPanel` 的“重置视图设置”要把嵌套专属字段一并复位，但保留 `layoutMode`；
- 可选：在 `ReconPanel` 的“视图”节增加管道宽度、车道间距、转移/丢失开关；
- 推荐把现有并排画布抽成 `SideBySideReconCanvas`，只在并排模式挂载；若不做拆分，至少在 `ReconciliationView` 的布局/锚点 memo 内按模式短路，避免嵌套模式仍计算双窗格。

在 `src/ui/strings.ts` 新增以下字符串：

```ts
layoutSideBySide: '并排对照',
layoutEmbedded: '嵌套视图',
tubeWidth: '物种枝粗细',
laneGap: '基因车道间距',
showTransfers: '显示转移弧',
showLossStubs: '显示丢失残枝',
topologicalSketch: '拓扑示意（无年龄 / 枝长）',
orphanGutter: '未映射基因节点',
legendTube: '物种枝管道',
legendGene: '基因谱系',
legendInferred: '显示推断（虚线，不写入假说）',
```

以及对应的英文。

### 7.2 现有选项在嵌套模式下的行为

| 选项 | 并排模式 | 嵌套模式 |
| --- | --- | --- |
| `mappingScope` | 决定映射线是否显示 | 弱化非匹配基因节点的强调，不隐藏拓扑 |
| `eventFilter` | 过滤映射线 | 弱化非匹配事件，选中/悬停始终显示 |
| `showLabels` | 节点标签 | 物种 + 基因标签（带 LOD） |
| `showEventGlyphs` | 事件符号 | 基因节点上的 σ/δ/τ 符号 |
| `showLosses` | λ 徽标 | 管内丢失残枝 + λ 徽标 |
| `showMappings` | 映射桥线 | 映射锚点/注释层；不控制嵌套枝 |
| `syncZoom` | 两侧同步 | 不适用，禁用 |
| `embeddedShowTransfers` | 不适用 | 转移弧开关 |
| `embeddedShowLossStubs` | 不适用 | 丢失残枝开关 |

### 7.3 视口

- 单 transform（`{ tx, ty, scale }`），复用 `RECON_MIN_SCALE` / `RECON_MAX_SCALE`。
- 滚轮缩放以鼠标位置为锚点；背景拖拽平移；使用 `ReconPane` 的合帧提交模式。
- Fit：`fitEmbeddedBounds(scene.bounds, width, height)`；窗口变化时，Fit 模式自动重拟合，手动平移后仅做夹取。
- 1:1：保持当前中心，缩放恢复 100%。
- `reconFocusTarget`：居中选中的基因节点；若选中物种节点，居中对应管道。

### 7.4 选择与悬停

- 基因节点点击：沿用当前 `selectGeneNode` 逻辑，选中后清除物种选择。
- 物种节点/管道点击：选中物种节点并清除基因选择。
- 悬停基因节点：高亮其所有基因段、宿主管道和转移弧；可选弱化其他元素。
- 悬停/点击转移弧：选中对应基因节点，检视面板显示转移供体/受体。
- 悬停丢失残枝：显示对应基因节点与物种节点提示。

### 7.5 映射编辑与路径构建（Phase 3，必须）

- Alt + 单击物种枝管道：把当前选中的单个基因节点映射到该管道的子物种节点；
  - 若开启“精确位置”编辑，同时写入 `branchFraction = t`；
  - 未开启时按节点映射处理，保持与并排视图一致；
  - 若映射目标发生变化且没有提供新的 `branchFraction`，必须删除旧的 `branchFraction`（它指向旧枝上的旧位置）；仅修改事件/供体时保留。
- 拖放（可选）：
  - 拖动基因节点到管道上，更新 `speciesNode` 与 `branchFraction`；
  - 拖动转移弧端点更换供体/受体（需要显式 `transferDonor`）；
  - 拖放期间用临时虚影（ghost）预览，松手后通过 `store.apply()` 写入，自动进入撤销栈。
- 检视面板（`GeneAssumptionInspector.tsx`）新增：
  - “枝内位置”：0–100% 滑块/数字，带“自动”开关；
  - “转移供体”：物种节点下拉（仅 `event === 'transfer'` 显示）；
  - “自动推导”标签：当字段缺省时说明由布局自动决定。
- 事件从 `transfer` 改为其他类型时删除 `transferDonor`；受体映射改变时重新验证显式供体仍在受体子树之外，不满足则回退自动推导并提示。
- 校验：
  - `branchFraction` 越界夹取；`transferDonor` 不存在时报告；
  - 转移供体落在受体子树内时报告“供体应在受体子树外”；
  - 时间不可行的转移继续由现有 `timing` 检查报告。
- 应用 DTL 场景时（`dtlScenarioToAssumptions`）遵循 §4.2 的保留/丢弃规则。
- 导出报告增加新字段，保证手工假说可被外部工具读取。

### 7.6 状态栏与面板

- `ReconStatusBar` 当前接收 `speciesZoom` / `geneZoom`。嵌套模式改为一个缩放读数：
  - 推荐改成语义更清晰的 props：`mode: ReconLayoutMode`、`zoom: number`，并保留并排模式的双读数；
  - 或在嵌套模式传入 `speciesZoom = geneZoom = zoom`，但文案仍应改成单值，避免“物种/基因缩放”误导。
- `src/canvas/ReconWorkspace.tsx` 的 `ReconWorkspacePanel` 目前把 `onZoomChange(species, gene)` 写入 `{ species, gene }`；嵌套模式需要把 `layoutMode` 或单个 `zoom` 一并上报，并同步修改 `ReconStatusBar` 的调用处。
- “场景”面板的悬停/点击定位在嵌套模式下继续有效；悬停行高亮对应基因段/管道。
- “视图”面板增加嵌套专属选项；并排专属选项在嵌套模式下隐藏，避免无效控件。

### 7.7 键盘

- Esc 退出协调工作区：保持不变。
- ⌘⇧F / Ctrl + Shift + F：调用当前模式的 Fit。
- Enter/Space 选择节点：沿用现有节点键盘处理。
- 可选：`[` / `]` 在未映射节点之间跳转，复用现有上一个/下一个未映射节点逻辑。

### 7.8 假说构建工作流（对应用户要求）

这一步把“看图”变成“构建路径”，是 Phase 3 的验收场景：

1. 在嵌套画布选中一个基因节点；检视面板显示当前宿主枝、枝内位置、事件和丢失。
2. Alt + 单击目标宿主枝，或把节点拖到枝上：
   - 写入 `speciesNode = 枝的子节点 id`；
   - 若开启精确位置，写入 `branchFraction = t`；
   - 拖放是增强项，Alt + 单击是必须可用的基线交互。
3. 在检视面板选择事件 σ/δ/τ；若为 τ，确认或修改供体（默认按“受体子树外子代”推导）。
4. 编辑断言丢失；布局即时重绘，明确区分结构推断与断言值。
5. 校验面板显示错误/警告；状态栏更新 σ/δ/τ/λ 与代价。
6. 保存工程并重新打开，路径与视觉字段保留；导出 NHX/Markdown/SVG 作为假说材料。
7. 可选：在现有假说层或节点备注中记录假说陈述与证据；这一集成不属于本方案的最小必需范围。

注意：路径构建编辑的是“映射、枝内位置、事件、供体和丢失”，不是基因树拓扑；基因树拓扑仍然只读，以免按节点 id 存储的假设失效。

---

## 8. 导出

### 8.1 范围

第一版先导出 **SVG**，因为它是矢量、可后处理、实现风险最低。PNG/PDF 在 SVG 稳定后复用现有光栅化/PDF 管线。

### 8.2 纯场景到 SVG

新增 `src/io/embeddedReconExport.ts`：

```ts
export interface EmbeddedExportOptions {
  includeLegend?: boolean;
  includeMetadata?: boolean;
  background?: string;
  marginPx?: number;
}

export interface EmbeddedExportResult {
  svg: string;
  width: number;
  height: number;
  bounds: EmbeddedBounds;
}

export function buildEmbeddedReconSVG(
  project: Project,
  entry: GeneTreeEntry,
  viewOptions: ReconViewOptions,
  exportOptions?: EmbeddedExportOptions,
): EmbeddedExportResult;
```

实现要点：

- 复用 `computeEmbeddedReconLayout`，不要另写一套几何。
- 场景与 React 渲染器共享同一份 `EmbeddedReconLayout`；导出器只负责把场景画成字符串。
- 输出必须包含：管道、基因段 mask、转移弧、丢失残枝、节点、标签、图例、版本/时间戳元数据。
- 标签使用显式字体族；CJK 文本沿用 `exportImage.ts` 的字体策略（PNG 需要 canvas 文本回退时复用其现有处理）。
- 图例中注明：物种枝管道 = 物种枝、细线 = 基因谱系、σ/δ/τ/λ 含义、是否为拓扑示意、基因树名称、事件计数与总代价。
- 若 `timeFeasible === null`，图例注明“未做时间校验”。

### 8.3 PNG/PDF

- 优先从 `exportImage.ts` 抽出可复用的 `svgStringToPng` / `svgStringToPdf` 辅助函数，或复用其内部光栅化步骤；如果耦合过深，先只提供 SVG 导出，PNG/PDF 作为后续小版本。
- 导出尺寸：按场景 bounds + margin 计算；不要复用标准画布的 `canvas.width/height`。
- 透明背景选项可选；默认使用主题背景或显式白色。

### 8.4 入口

- 在 `ReconToolbar` 增加“导出嵌套图”按钮（仅在嵌套模式显示），或在命令面板新增“导出嵌套协调图 (SVG)”。
- 复用 `src/io/fileActions.ts` 的保存/下载工具；桌面壳走原生保存对话框，浏览器预览走下载。
- 不改变现有“导出协调重建报告（Markdown）”的行为。

---

## 9. 测试计划

### 9.1 单元测试

**`src/model/reconPlacements.test.ts`**

- 显式假设优先于标签匹配；未匹配末端进入 `unmappedGeneNodes`。
- 无假设但所有子代可定位的内部节点被推断到子代 MRCA，`source = 'inferred-mrca'`、`inferred = true`，且不写入 `assumptions`。
- 任一子代不可定位时父节点不推断，进入 `unmappedGeneNodes`。
- 悬空的 `speciesNode` 不作为有效位置；末端回退标签映射，内部节点由显示推断接管（若子代可定位）或记为未映射，并始终产生 `dangling-assumption`。
- 被折叠隐藏的物种节点不能作为宿主；产生 `hidden-host` 或未映射，规则与并排视图不可见目标一致。
- `recon-family` β4 被推断到 N4；其子代 E/F 的标签映射保持真实来源。
- `branchIdOf` 对物种根返回 `null`，其余返回子节点 id。
- `speciesPathBetween` 的 `same/down/up/lateral` 分类正确。
- `lossesAlongSpeciesPath` 与 `minLossesBetween` 在随机/固定树上逐对一致。
- 多歧分叉的丢失为 `m-1`；单叉节点为 0。

**`src/layout/embeddedRecon.test.ts`**

- 所有“有效定位”基因节点（显式假设、标签匹配、显示推断）的坐标位于其宿主管道/枢纽范围内（允许车道偏移）；真正未映射的节点进入孤立区。
- σ：两个子代进入不同的子物种枝。
- δ：子代共享宿主枝但车道不同。
- τ：转移弧端点分别位于“受体子树外子代所在供体枝”和“受体枝”的中心线上；显式 `transferDonor` 覆盖自动推导；无子树外子代时只产生警告虚线。
- 转移枝优先：示例 α 的 αAC 受体 n1 是父映射 root 的后代，仍应画供体 C 枝 → 受体 n1 枝的转移弧，**不得**按 root→n1 的物种路径画成普通下降。
- λ：结构丢失总数与 `lossesAlongSpeciesPath` 汇总一致；`asserted >= structuralMin` 时额外丢失以 `asserted` 标记，总数等于断言；`asserted < structuralMin` 时产生“断言不足”状态，不宣称与状态栏相等；未断言时结构丢失以 `inferred` 标记。
- `recon-family` 示例：α 的 σ/δ/τ/λ 全部可绘制；β4 显示推断且基因树保持连通；β 的校验结果仍只有 1 个 `unresolved` 警告。
- 未映射节点进入孤立区，不丢失；父节点未映射但子节点有位置时生成 `unknown-path` 虚线，不伪造父映射。
- 确定性：同一输入两次输出深度相等。
- 边界：`bounds` 覆盖管道、纵向枢纽、标签、转移弧、丢失徽标；坐标均为有限值，无 NaN。
- 溢出：基因家族过大时产生 `lane-overflow`，宽度不超过上限。
- 不可行路径：`up`/`lateral` 非水平转移不生成普通嵌套段，生成对应的布局问题。
- mask 几何：水平管道 + 纵向枢纽 + 节点圆能覆盖所有基因段的中心线；枢纽不缺失。

**`src/canvas/embeddedReconGeometry.test.ts`**

- `pointOnTube` 在 t=0/1 时分别落在父端/子端。
- 车道偏移不越出管道；Fit bounds 包含标签、转移弧与丢失徽标。
- 命中检测：管道内点返回正确 branchId 与 t；管道外返回 null。

### 9.2 组件测试

- 切换 `layoutMode` 后渲染嵌套画布；切回并排后原有窗格仍存在。
- 点击基因节点触发 `selectGeneNode`；Alt + 单击物种枝管道触发映射更新（mock store），且在未开启精确位置时不写入 `branchFraction`。
- 显示推断节点呈虚线/空心样式，检视面板仍显示“未映射”；不会因为布局推断而出现新的校验问题。
- 状态栏在嵌套模式只显示一个缩放读数；并排模式仍显示物种/基因两个读数。
- mask id 唯一；图层顺序正确；选中/悬停类名出现。
- 暗色/亮色主题下 CSS 变量存在（可用 jsdom + class 断言，不依赖真实视觉）；显式暗色与系统暗色两个分支都要覆盖。

### 9.3 导出测试

- `buildEmbeddedReconSVG` 输出可被 DOM 解析；包含预期数量的管道、mask、转移弧、丢失标记。
- 无 `NaN`、`Infinity`、未转义标签。
- CJK 标签存在；元数据包含版本/时间戳。
- 与 React 场景共享几何：相同输入下元素数量/关键坐标一致。

### 9.4 持久化与回归

- `projectIO` 往返：带 `branchFraction` / `transferDonor` 的工程保存/打开不丢失；非法值被夹取/丢弃并报告。
- `setAssumption` 的 `{ ...cur, ...patch }` 能保留/更新新字段；清除映射时字段一起消失。
- `dtlScenarioToAssumptions`：同目标保留视觉字段，改目标丢弃；节点在新场景中缺失时字段一并消失；有测试覆盖。
- `reconExport.geneTreeNhk`：显式 `transferDonor` 覆盖自动推导，NHX 输出包含 `BF=` / `TD=`。
- 并排视图既有测试全部通过；`reconPaneGeometry.test.ts` / `reconViewport.test.ts` 预期无需修改（除非重构共享工具）。
- `npm run typecheck`、`npm test`、`npm run build`。

### 9.5 性能

- 用 `recon-family` 示例做基本基准。
- 合成一棵 100–200 末端的物种树 + 300–600 节点的基因树，验证：
  - 布局计算可接受（目标 < 100 ms，具体阈值在实现时用基准脚本记录，避免脆弱的绝对时间断言）；
  - 平移缩放不重新计算布局（可用 spy/memo 计数验证）；
  - 视口裁剪后 DOM 元素数量受控。
- 可选：新增 `scripts/bench_embedded_recon.mjs`，沿用 `scripts/bench_tips.mjs` 的输出风格。

### 9.6 手工验收

- 亮色/暗色主题；
- 1024 / 1200 / 1440 宽度；
- 高 DPI；
- 缩放 15% / 100% / 400%；
- 选中、悬停、Alt + 单击、Fit、1:1、切换基因树、撤销/重做；
- 未匹配末端、未映射节点、DTL 应用后的场景；
- 有年龄的时间校准物种树与无年龄的拓扑树。

---

## 10. 分阶段实施

Phase 1–3 是满足用户核心要求（嵌套呈现 + 自行构建路径）的必需范围；Phase 4 是出图与文档支持，建议同期完成，但不阻塞路径构建。

### Phase 0：设计确认（0.5 天）

产出：

- 确认 §12 的待确认事项；
- 确认里程碑边界：Phase 1–2 交付只读嵌套可视化；Phase 3 的路径编辑/持久化是最终必需范围；
- 确认管道宽度/车道间距默认值。

不写代码。

### Phase 1：语义与布局基础（2–3 天）

新增：

- `src/model/reconPlacements.ts`
- `src/model/reconPlacements.test.ts`
- `src/layout/embeddedRecon.ts`
- `src/layout/embeddedRecon.test.ts`

修改：

- `src/model/types.ts`：新增 `ReconLayoutMode` 与 `ReconViewOptions` 字段（先不接 UI）。

验收：

- 纯布局测试覆盖 σ/δ/τ/λ、未映射、不可行路径、确定性、边界；
- `lossesAlongSpeciesPath` 与 `minLossesBetween` 交叉测试通过；
- 不影响任何现有 UI 行为。

### Phase 2：只读嵌套视图（3–4 天）

新增：

- `src/canvas/EmbeddedReconCanvas.tsx`

修改：

- `src/canvas/ReconciliationView.tsx`：按 `layoutMode` 分支渲染；
- `src/canvas/ReconWorkspace.tsx`：单视口缩放/状态栏接线（`ReconWorkspacePanel`）；
- `src/ui/ReconToolbar.tsx`：模式切换；
- `src/ui/ReconPanel.tsx`：嵌套视图选项；
- `src/ui/ReconStatusBar.tsx`：单/双缩放读数；
- `src/styles/app.css`：管道与嵌套画布样式；
- `src/ui/strings.ts`：中英文案。
- 可选：`src/canvas/SideBySideReconCanvas.tsx`，把并排画布抽成独立组件。

验收：

- 示例可切换、Fit/缩放/平移/选择/悬停可用；
- 并排模式无回归；
- 性能与可访问性检查通过。

### Phase 3：可编辑假说（3–5 天，必须）

> 该阶段直接对应用户“基于该结构自行构建基因树在物种树中的演化路径”的要求，不能省略。至少交付 Alt + 单击映射 + 枝内位置/转移供体编辑 + 持久化；拖放是增强项。

修改：

- `src/model/types.ts`：`branchFraction` / `transferDonor`；
- `src/ui/GeneAssumptionInspector.tsx`：位置/供体字段；
- `src/model/geneTrees.ts`：映射更新辅助（如需要）；
- `src/model/dtl.ts`：应用场景时保留/丢弃视觉字段；
- `src/io/projectIO.ts`：打开时夹取/清理新字段；
- `src/io/reconExport.ts`：报告/NHX 输出新字段；
- `src/canvas/EmbeddedReconCanvas.tsx`：物种枝管道命中检测、Alt + 单击、拖放（可选）。

验收：

- 映射编辑进入撤销栈；
- 保存/打开往返；
- DTL 应用不产生悬空字段；
- 报告包含枝内位置与供体。

### Phase 4：出图与文档（2–3 天）

新增：

- `src/io/embeddedReconExport.ts`
- `src/io/embeddedReconExport.test.ts`

修改：

- `src/ui/ReconToolbar.tsx` / `CommandPalette.tsx`：导出入口；
- `docs/MANUAL_ZH.md` / `docs/MANUAL_EN.md`：使用说明；
- `README_ZH.md` / `README.md`：勾选路线图；
- `docs/FORMAT.md`：新增可选字段说明（Phase 3 已实现）；
- `CHANGELOG.md`；
- `docs/AI_PROVENANCE.md`：按仓库约定登记 AI 辅助修改。

验收：

- SVG 可打开、可打印、标签正确；
- PNG/PDF（如实现）与 SVG 视觉一致；
- 文档步骤可复现。

---

## 11. 文件级改动清单

| 文件 | 改动 | 阶段 | 风险 |
| --- | --- | --- | --- |
| `src/model/types.ts` | 新增 `ReconLayoutMode`、视图选项、可选假设字段 | 1 / 3 | 低；纯类型扩展 |
| `src/model/reconPlacements.ts` | 新增有效定位、物种路径、丢失拆分、转移供体推导 | 1 | 中；必须与 DTL 语义一致 |
| `src/layout/embeddedRecon.ts` | 新增嵌套布局、车道、场景几何 | 1 | 高；核心算法 |
| `src/canvas/EmbeddedReconCanvas.tsx` | 新增单视口嵌套渲染 | 2 | 高；SVG mask/图层/性能 |
| `src/canvas/ReconciliationView.tsx` | 按模式分支；共享映射合并逻辑；短路双窗格 memo | 2 | 中；避免并排回归 |
| `src/canvas/ReconWorkspace.tsx` | 单视口缩放/状态栏接线；`ReconWorkspacePanel` 传参 | 2 | 低 |
| `src/canvas/SideBySideReconCanvas.tsx`（可选新建） | 抽出并排画布，避免嵌套模式仍计算双窗格 | 2 | 中；需保持现有行为 |
| `src/ui/ReconToolbar.tsx` | 并排/嵌套切换、隐藏同步缩放、Fit 文案 | 2 | 低 |
| `src/ui/ReconPanel.tsx` | 嵌套视图选项 | 2 | 低 |
| `src/ui/ReconStatusBar.tsx` | 单/双缩放读数 | 2 | 低 |
| `src/ui/strings.ts` | 中英文案 | 2 | 低 |
| `src/styles/app.css` | 管道/嵌套画布样式、主题变量 | 2 | 中；亮暗对比度 |
| `src/ui/GeneAssumptionInspector.tsx` | 枝内位置、转移供体字段 | 3 | 中 |
| `src/model/geneTrees.ts` | 映射更新辅助（按需） | 3 | 低 |
| `src/model/dtl.ts` | 应用场景时保留/丢弃视觉字段 | 3 | 中；避免悬空字段 |
| `src/io/projectIO.ts` | 新字段夹取/清理 | 3 | 低 |
| `src/io/reconExport.ts` | 报告/NHX 新字段 | 3 | 低 |
| `src/io/embeddedReconExport.ts` | 嵌套 SVG 导出 | 4 | 中；字体与元数据 |
| `src/io/exportImage.ts` | 抽取可复用光栅化辅助（如需要） | 4 | 中；不要破坏标准导出 |
| `README.md` / `README_ZH.md` | 路线图勾选 | 4 | 低 |
| `docs/MANUAL_ZH.md` / `docs/MANUAL_EN.md` | 使用说明 | 4 | 低 |
| `docs/FORMAT.md` | 可选字段说明 | 3/4 | 低 |
| `docs/AI_PROVENANCE.md` | AI 辅助修改登记 | 各阶段 | 低 |

---

## 12. 风险与待确认事项

| 事项 | 风险 | 建议 |
| --- | --- | --- |
| 自动路径是否唯一 | 仅凭节点映射，同一场景可画出多条合理路径 | 先采用确定性自动规则，并在图例标注“自动布局”；`branchFraction` 允许手工覆盖 |
| 是否持久化枝内位置 | 只存视图状态则无法作为假说留存 | 用户目标要求必须持久化；Phase 3 写入工程文件并在报告/NHX 中导出 |
| 管道宽度策略 | 固定宽度可能容纳不下大基因家族；自适应宽度会改变物种树视觉比例 | 基础宽度 + 自适应上限 + 溢出提示；图例说明 |
| 拓扑 vs 时间 | 无年龄/枝长时，嵌套只是拓扑示意，转移时间不可校验 | UI 明确显示“拓扑示意”；有年龄时自动切换时间语义 |
| 未映射基因节点 | 无法嵌套，若直接丢弃会误导 | 右侧孤立区 + 虚线连接到最近已映射祖先；状态栏计数 |
| 无假设但子代可定位的内部节点 | 若丢入孤立区，示例 β 的基因树会断开 | 采用显示推断 MRCA；不写入假设，虚线标注 |
| 丢失显示与状态栏 | 未断言或低于结构最小值时数值可能不同 | 按 §5.7 三态显示；明确推断/警告，不承诺恒等 |
| 转移供体约定 | 父枝默认会与现有“子树外子代”约定冲突 | 以 `validateScenario` / `geneTreeNhk` 为准；显式字段覆盖 |
| 纵向枢纽遮挡 | 只遮罩水平管道会裁掉跨子管道连接线 | 纵向枢纽 + 节点圆进入 mask；整棵物种树加粗 |
| 并排视图回归 | 共享逻辑抽取可能影响现有映射编辑 | 嵌套视图用新文件；共享逻辑只抽纯函数并加测试 |
| 导出耦合 | `exportImage.ts` 与标准画布深度耦合 | 先做独立 SVG 导出器；PNG/PDF 后续复用光栅化步骤 |
| 大基因家族性能 | 车道和 SVG 元素数量增长 | 视口裁剪、memo、车道上限、LOD、基准测试 |
| 多基因树 | 第一版只画当前基因树 | 多基因叠加按路线图单独实现 |
| DTL 丢失位置缺失 | `lossMarks.at` 未持久化 | 第一版用结构最小值；需要精确复现时增加可选 `lossMarks` 字段 |

### 推荐默认决策

1. 并排视图保留为默认；嵌套视图作为第二模式。
2. 只读嵌套视图先作为开发里程碑；**最终交付必须包含 Phase 3 的枝内位置、供体与映射编辑**，否则无法满足“自行构建路径”的要求。
3. 管道宽度自适应但有上限；默认 `18` 世界 px，上限 `32`。
4. 未映射节点进入孤立区，不静默丢弃；无假设但子代可定位的内部节点采用显示推断。
5. 无年龄/枝长时明确标注“拓扑示意”。
6. 第一版只导出 SVG；PNG/PDF 在 SVG 稳定后补齐。

---

## 附录 A：事件路由速查

| 场景 | 路径/几何 | 颜色 | 备注 |
| --- | --- | --- | --- |
| 父子映射同一物种节点（非水平转移） | 同管道内短分叉/平行车道 | 子节点事件色 | 需保证父 t < 子 t |
| 子映射在父的子树内（非水平转移） | 沿物种路径向下，逐枝画段 | 子节点事件色 | 每个中间分叉生成丢失 |
| 子节点 `event=transfer`（无论父/子映射关系） | 供体子代枝 → 受体枝转移弧 + τ 色短虚线父枝；不按物种路径走普通下降 | τ 色 | 弧是事件注解；供体 = 受体子树外的子代所在枝 |
| 子映射在父的子树外，非水平转移 | 虚线警示路径 | 灰色 | 产生布局问题，不伪造嵌套 |
| 子映射是父的祖先 | 虚线警示路径 | 灰色/红色 | 时间旅行，校验已报错 |
| 有映射但事件未标注 | 映射节点处虚线空心节点 | 灰色 | 不进入合法路径着色 |
| 无映射但子代可定位 | MRCA 入枝处的显示推断节点 | 灰色虚线 | 不写入假设；不改变校验/统计 |
| 无映射且无法推断 | 孤立区 + 虚线连接 | 灰色 | 状态栏计数；不伪造父映射 |
| 末端映射 + 断言丢失 | 管内丢失残枝 | λ 色 | 按 §5.7 三态策略；断言覆盖结构最小时总数一致 |

## 附录 B：场景输入输出示例

```ts
const scene = computeEmbeddedReconLayout({
  speciesDoc,
  speciesLayout: computeLayout(prepareEmbeddedSpeciesDoc(speciesDoc)),
  geneDoc: entry.doc,
  assumptions: entry.assumptions,
  options: {
    tubeWidth: 18,
    laneGap: 3,
    minTubeWidth: 12,
    maxTubeWidth: 32,
    showTransferArcs: true,
    showLossStubs: true,
  },
});

scene.tubes.get(speciesChildId);        // 该物种枝的水平管道
scene.hubs.get(speciesParentId);        // 该父节点的纵向枢纽
scene.placements.get(geneNodeId);       // 基因节点在管道内的位置
scene.placements.get(geneNodeId)?.inferred; // 显示推断标记
scene.segments.filter(s => s.hostBranchId === speciesChildId);
scene.transfers;                        // 转移弧（含 donor/recipient gene node）
scene.losses;                           // 结构/推断/断言丢失
scene.orphans;                          // 真正无法定位的节点
scene.issues;                           // lane-overflow / unknown-path 等
```

## 附录 C：现有代码索引

| 主题 | 文件 |
| --- | --- |
| 并排协调视图与映射桥 | `src/canvas/ReconciliationView.tsx`、`src/canvas/ReconMappingLayer.tsx` |
| 协调工作区/状态栏接线 | `src/canvas/ReconWorkspace.tsx`、`src/ui/ReconStatusBar.tsx` |
| 窗格渲染、Fit、LOD、裁剪 | `src/canvas/ReconPane.tsx`、`src/canvas/reconViewport.ts` |
| 映射 anchor/projection 分层 | `src/canvas/reconMapping.ts` |
| 映射与丢失语义 | `src/model/reconciliation.ts`、`src/model/treeOps.ts` |
| DTL 场景写回假设 | `src/model/dtl.ts`（`dtlScenarioToAssumptions`） |
| 假设编辑 | `src/ui/GeneAssumptionInspector.tsx`、`src/model/geneTrees.ts` |
| 视图选项与状态 | `src/model/types.ts`、`src/model/store.ts` |
| 工具栏/面板/状态栏 | `src/ui/ReconToolbar.tsx`、`src/ui/ReconPanel.tsx`、`src/ui/ReconStatusBar.tsx` |
| 样式与主题 | `src/styles/app.css` |
| 报告与 NHX | `src/io/reconExport.ts` |
| 标准画布图片导出 | `src/io/exportImage.ts` |
| 工程持久化 | `src/io/projectIO.ts` |
| 协调示例（含 β4） | `src/model/sampleTree.ts`、`src/model/sampleRecon.test.ts` |

## 附录 D：本次审阅核对清单

| 核对项 | 源码证据 | 结论 |
| --- | --- | --- |
| 并排视图是独立双窗格 + 映射桥 | `ReconciliationView.tsx` 的 `speciesLayout` / `geneLayout` 与 `ReconMappingLayer` | 文档描述准确 |
| 物种枝是固定细线 | `ReconPane.tsx` 的 `PaneEdge`：`strokeWidth={1.4}`、`non-scaling-stroke` | 文档描述准确；嵌套模式必须新写粗管道 |
| 假设只有节点级映射 | `types.ts` 的 `GeneNodeAssumption`（`speciesNode/event/losses/meta`） | 文档描述准确；`branchFraction`/`transferDonor` 是新增字段 |
| `projectIO` 保留假设 | `projectIO.ts` 的 `{ ...g, doc }` | 新可选字段无需迁移 |
| DTL 应用会重建假设 | `dtl.ts` 的 `dtlScenarioToAssumptions` | 文档已要求保留/丢弃规则 |
| 转移供体的现有约定 | `reconciliation.ts` 的转移校验（子树外子代 = 供体子代）、`reconExport.geneTreeNhk` | 文档已改为“子树外子代所在枝” |
| 转移枝不能按普通路径下降 | 示例 α 的 αAC 受体 n1 是父映射 root 的后代；若按 `speciesPathBetween` 会画成下降 | 文档已加入“先检查 `event=transfer`，转移弧优先” |
| 示例 β 的未映射节点 | `sampleTree.ts` 的 β4（无假设，子代 E/F 可标签匹配）；`sampleRecon.test.ts` 断言只有 1 个 `unresolved` | 文档新增显示推断规则 |
| 丢失的计数来源 | `reconciliation.ts` 的 `scenarioSummary` 只累加 `assumptions[].losses`；`validateScenario` 报告 `loss-shortfall` | 文档新增三态显示策略，不再承诺无条件相等 |
| 状态栏双缩放接口 | `ReconWorkspace.tsx` 的 `ReconWorkspacePanel` → `ReconStatusBar speciesZoom/geneZoom` | 文档已加入单视口接线 |
| 暗色主题选择器 | `app.css` 的 `:root[data-theme='dark']` 与 `@media (prefers-color-scheme: dark)` | 文档选择器已修正 |
| 图形导出范围 | `exportImage.ts` 的 `buildSVG(project)` 只覆盖标准画布；`reconExport.ts` 只输出 Markdown | 文档把嵌套 SVG 导出列为 Phase 4 |
| 用户“自行构建路径”要求 | 需要映射、枝内位置、事件、供体、丢失的编辑与持久化 | Phase 3 已从可选改为必须 |

**审阅结论**：修订后的方案在事实层面与当前代码一致，在交付层面覆盖了用户的三项核心要求（粗物种枝/细基因枝、基因枝嵌入物种枝、用户自行构建路径并形成假说）。实现时应以 Phase 1–3 为必需范围，Phase 4 为出图支持。本次审阅仅修改本文档，没有修改任何项目源码。
