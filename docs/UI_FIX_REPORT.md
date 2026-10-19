<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# CladeForge UI / 交互修复报告（2026-10-19）

> 对象：《CladeForge_UI交互修复任务书.md》（2026-10-19，11 项缺陷）
> 修复基线：仓库 `main` @ `2536b1b`（线上 <https://zengzichao.github.io/CladeForge/> 的构建产物即此提交，已在干净环境中复现：`npm ci && npm run build` 产出的主包哈希与线上 `assets/index-BcK_9XRS.js` 完全一致）
> 状态：全部工作已落在工作区但**未提交**；仓库在此前已有其他人未提交的改动（`CITATION.cff`、`CONTRIBUTING*`、`docs/MANUAL*`、`src/io/{newick,nexus}.ts` 等），本次修复未回退、未改动这些内容。
> 验证环境：macOS + Chromium 155（headless，CDP 驱动）；视口 1440×900 / 768×1024 / 375×812；中/英双语；浅/暗主题；默认 Cetacean 示例项目。

## 1. 结论摘要

任务书 11 项缺陷逐条复验，结果：**9 项确认存在并修复（BUG-1、3、4、6、7、8、9、10、11），2 项在当前构建上未复现（BUG-2、BUG-5），其中 BUG-5 仍补了根因级防御**。

- 单测：`npm test` → **58 个测试文件、911 passed / 6 skipped**（基线 818 passed / 6 skipped，本次新增/扩展 93 例）。
- 类型检查：`npx tsc --noEmit` **通过**（`node_modules` 已按 `package-lock.json` 同步到 vite 8.3.1 / TS 5.9.3；此前本机旧 `node_modules` 导致的 `vite.config.ts` `'oxc'` 基线错误已消失），`npm run build`（含 `tsc --noEmit`）完整通过。
- 浏览器端按任务书第 4 节执行 T1–T30 全量自动化验收（脚本位于临时 CDP 验证环境，未入库；步骤与下方逐项证据一致）：**32/32 项通过**（T1–T30，另含 T16b/T18b 两个补充断言）。
- 任务书第 5 节“徽标与标签重叠检测”脚本在 4 种布局 + zoom out 3 次后输出均为 `[]`。
- 额外收尾：导出 SVG/PNG/PDF 与画布共享同一套徽标避让与标签 stagger（WYSIWYG）；状态栏 `Saved` → `Auto-saved`；窄屏首次提示；帮助/偏好菜单收纳；Workflow tour。

## 2. 逐项状态

| 编号 | 优先级 | 复验结论 | 根因 / 处理 | 主要改动 |
|---|---|---|---|---|
| BUG-1 | P0 | **复现并修复** | 不是“忘了 close()”。Enter 提交后对话框确实关闭，但 `useDialogFocus` 在同一 keydown 内把焦点还给打开它的工具栏按钮，浏览器随后把同一个 Enter 的默认动作发给该按钮，对话框被重新打开（DOM 里表现为“没关”）。修复：Enter 处理器 `preventDefault()+stopPropagation()` 后走与 Add 按钮完全相同的 confirm；提交前重新校验目标节点。 | `src/ui/AddChildrenDialog.tsx` |
| BUG-2 | P0 | **未复现（现行为符合要求）** | 所有模态（Add a polytomy / Keyboard Shortcuts / About / Beginner Tour / Character matrix / Analysis / Nexus export / 删除确认 / ⌘K palette）均走 `useDialogFocus`（capture 阶段 Esc → preventDefault+stopPropagation），逐一实测 Esc 均可关闭且无副作用；无模态时 Esc 仍清除画布选区。任务书观察到的“polytomy Esc 无效”很可能与 BUG-1 的“对话框被 Enter 重新打开”混淆。 | 验证为主；`useDialogFocus` 契约不变，新增浏览器回归覆盖 |
| BUG-3 | P0 | **复现并修复** | 对话框从未渲染目标节点。新增目标行：选中节点时显示 `Add children to [节点名]`；未选中时显示 `No node selected — children will be added to the root (Cetacea)`；目标被删除时显示警告并禁用 Add。中英文已补。 | `src/ui/AddChildrenDialog.tsx`、`src/ui/strings.ts` |
| BUG-4 | P0 | **复现并修复** | 徽标用固定偏移锚定（node 事件沿分支偏移 18px），不做碰撞检测；另实测 phylogram / time-calibrated 下还存在真实 `Basilosauridae × Neoceti` 标签互叠。新增世界坐标碰撞规划模块：标签 bbox（CJK 全角/旋转规则）→ 贪心垂直 stagger；徽标以节点为簇、按“离自然锚点由近到远”的环形候选避让所有标签/marker/时间轴文字/已放置徽标，偏移≥13 画细引导线+锚点。导出层（SVG/PNG/PDF）复用同一规划器。 | 新增 `src/canvas/eventBadgeLayout.ts`；`EventLayer.tsx`、`NodeView.tsx`、`labelBounds.ts`、`src/io/exportImage.ts` |
| BUG-5 | P0（待复验） | **未复现；已加根因级防御** | 四布局下 Time 模块提示名均非空且正确，time-calibrated 时不显示“请切换”提示。唯一真实空串风险是**加载的手改/旧版文档 `layout.type` 为空串/未知**（`projectIO` 会原样保留）：旧的两份重复 `layoutTypeName()` 的 `default: return type` 会显示 `“”`。抽出共享 `layoutTypeName()`：未知非空 id 原样回显，空/缺失→`未知布局 / Unknown layout`，永不空串。 | 新增 `src/ui/layoutTypeName.ts`；`TimePanel.tsx`、`TreeCanvas.tsx` |
| BUG-6 | P1 | **复现并修复** | 节点 hit 区只有可视 marker（r≈5.5），resizer 仅 5px 且无扩展。节点组最低层加透明 hit circle（r=size+8，实测 r=14，`data-role=node`），端口加 r=9 透明命中层（可视仍 r=5），`.resizer` 保持 5px 可视但 `::after` 左右各扩 4px、hover 高亮。相邻节点/标签点击经抽查不误伤。 | `NodeView.tsx`、`src/styles/app.css` |
| BUG-7 | P1 | **部分复现并修复** | 实测 time-calibrated 布局**已有 Ma 刻度与年代线**（任务书“无刻度”一项在当前构建不成立）；真实短板是 `Show geological eras` 默认关闭且切换布局完全静默。新增纯决策模块：首次切到 time-calibrated 自动开启年代带 + 一次性可操作提示（一键隐藏）；用户手动关闭后写入 localStorage，之后切换不再打扰；三个显式切换入口（样式 select / 时间面板按钮 / 画布提议 toast）统一接入；UI 状态不进 undo、无依赖 layout.type 的 effect。 | 新增 `src/ui/timeChartEras.ts`；`TimePanel.tsx`、`LayoutPanel.tsx`、`TreeCanvas.tsx` |
| BUG-8 | P1 | **复现并修复** | 折叠区只有计数、无内容摘要；数值仅 placeholder 提示单位；状态栏 `Saved` 与逐属性即时修改的关系不清。`Section` 新增可选 `summary`：TIME CONSTRAINT 折叠态显示“Inherits global default / 34–41 Ma”；NODE STYLE 显示色点+形状+尺寸+描边宽；LABEL 显示色点+字号+粗/斜；INCOMING BRANCH STYLE 显示线样+线宽+线型。NumberField 新增可见单位 chip（Age/校准=Ma，Branch length=s/s，Support=% 等；粘贴 “35 Ma” 自动取数值）；检查器顶部加中英自动保存提示；状态栏改为 `Auto-saved / 已自动保存`；搜索无结果时引导 ⌘K。 | `Section.tsx`、`PropertiesPanel.tsx`、`fields.tsx`、`strings.ts` |
| BUG-9 | P2 | **复现并修复** | 375×812 下 `body.scrollWidth` 451 > 375（menubar 427、toolbar 内容约 1197）。窄屏规则 + header 内部滚动，实测 375 下 `scrollWidth=375`；首次窄屏出现全屏引导层（“桌面端编辑器，建议 ≥1280px；仍要继续”，localStorage 记住）；768 下画布 100% 宽、左右面板按钮可唤出；1440 时帮助文字恢复显示（原 ≤1439 规则适配新结构）。 | `src/styles/app.css`、`NarrowScreenHint.tsx`、`MenuBar.tsx`、`Toolbar.tsx`、`App.tsx` |
| BUG-10 | P2 | **复现并修复** | 顶栏可见可点击目标 16 个。三个帮助项收进单个 `?` 帮助下拉（快捷键速查 / 新手指南 / Workflow tour / 关于），语言+主题 5 个分段收进单个“偏好”下拉；高频项保留。实测顶栏可点击目标 **10 个**，帮助/偏好逐项可达，⌘K 命令面板不受影响。 | `MenuBar.tsx`、`Toolbar.tsx`、新增 `PreferencesMenu.tsx`、`app.css` |
| BUG-11 | P2 | **复现并修复** | Beginner Tour 仅 4 步、未覆盖核心工作流。新增 Workflow Tour 模式：Traits → Hypotheses → Analysis → Export（+ 完成页“重放/快捷键速查/完成”），每步真实切换左侧模块并 spotlight；与 basics 各自持久化完成状态；Skip/Escape 无残留遮罩；中英文案完整。 | `FirstRunTour.tsx`、`App.tsx`、`NavigationRail.tsx` |

## 3. 关键实现要点

1. **统一键盘契约**：所有模态共用 `useDialogFocus`（焦点陷阱 + Escape + IME 保护）；`AddChildrenDialog` 的 Enter 现在与 Add 按钮同一条 confirm 路径，且阻止默认动作以避免“关闭后同一按键激活恢复焦点的按钮”。
2. **世界坐标碰撞规划**（`eventBadgeLayout.ts`）：标签 bbox 使用与渲染完全一致的 `labelPlacement` + CJK 宽度估算规则；徽标锚点按分支轴向/垂直/环形候选由近及远搜索，障碍包含标签、marker、时间轴/年代/环境事件文字与已放置徽标；空间哈希避免 O(n²)；>1200 节点文档跳过标签 stagger（性能保护），徽标避让仍生效。
3. **时间图首次进入**（`timeChartEras.ts`）：纯决策函数 + 显式入口桥，UI-only 副作用（`setShowEras` + fit + 一次性 toast），不写 project、不产生 undo 步；用户可选“隐藏年代带”记住 opt-out。
4. **数字单位**：`NumberField` 的 `unit` 变为**可见**装饰（不再依赖 placeholder），支持 `unitTitle`、`unitSide`、`hint` 与粘贴 “35 Ma” 数值提取；不传 `unit` 的调用点渲染与旧版一致。
5. **响应式 chrome**：≤900 隐藏项目名、≤640 隐藏品牌文字并压缩 header、header 内部滚动；首次窄屏引导层；`.panel.overlay` 基于 `.body` 定位，避免压住 header/底部 tab。

## 4. 改动文件

**修改（22）**：`vite.config.ts`、`src/App.tsx`、`src/canvas/EventLayer.tsx`、`src/canvas/NodeView.tsx`、`src/canvas/TreeCanvas.tsx`、`src/canvas/labelBounds.ts`、`src/canvas/treeCanvasTimeProposal.test.ts`、`src/io/exportImage.ts`、`src/io/exportImage.test.ts`、`src/styles/app.css`、`src/ui/AddChildrenDialog.tsx`、`src/ui/FirstRunTour.tsx`、`src/ui/LayoutPanel.tsx`、`src/ui/MenuBar.tsx`、`src/ui/NavigationRail.tsx`、`src/ui/PropertiesPanel.tsx`、`src/ui/Section.tsx`、`src/ui/TimePanel.tsx`、`src/ui/Toolbar.tsx`、`src/ui/fields.tsx`、`src/ui/section.test.ts`、`src/ui/strings.ts`

**新增（12）**：`src/canvas/eventBadgeLayout.ts` + `.test.ts`、`src/ui/NarrowScreenHint.tsx`、`src/ui/PreferencesMenu.tsx`、`src/ui/addChildrenDialog.test.ts`、`src/ui/chromeTour.test.ts`、`src/ui/layoutTypeName.ts` + `.test.ts`、`src/ui/numberField.test.ts`、`src/ui/timeChartEras.ts` + `.test.ts`、`src/ui/timePanelLayoutName.test.ts`

另：`docs/AI_PROVENANCE.md` 按仓库约定补记本次 AI 辅助会话；本报告为新增文档。

## 5. 验证方法与证据

### 5.1 静态/单元
- `npm test`：58 files / 911 passed / 6 skipped。
- `npx tsc --noEmit`：0 错误。
- 干净环境：`npm ci` + `npm run build` → ✓ built（vite 8.3.1，主包含全部修复）。

### 5.2 浏览器自动化（任务书 T1–T30）
在 Chromium 1440×900（及 768×1024 / 375×812）逐项执行，最终一轮 **32/32 检查全部通过**（T1–T30，另含 T16b/T18b 两个补充断言；运行输出已保存为 `/tmp/acceptance-run10.json`，属临时验证环境）。要点：
- T1–T7：Enter/Add 行为一致且关闭、Esc 无副作用、目标节点/root 兜底文案、中英双语；9 类模态 Esc 均可关闭。
- T8–T13：4 布局 `svg text` bbox 两两无交集（`[]`），zoom out 3 次后仍 `[]`；距节点中心 7px 点击可选中；resizer 条外 3px 起拖生效；刷新后布局正常。
- T14–T16：四布局提示名非空且正确；time-calibrated 无“请切换”提示且有 Ma 刻度；首次切换自动开启年代带 + 提示，手动关闭后不再打扰；切回 rectangular 无残留。
- T17–T20：TIME CONSTRAINT 折叠摘要、三个样式区折叠摘要、Age 可见单位、`Auto-saved` 语义与自动保存提示均可见。
- T21–T23：375 无横向滚动/出现引导层；768 画布 ≥60% 且右检查器可唤出；顶栏可点击目标 ≤10。
- T24–T30：撤销/重做链路正确；点击选中/Esc 清除；暗色模式组件底色仍为 `rgb(28,28,31)`；中英切换 chrome 无漏译、用户数据（自定义标签）不被翻译；示例数据完整（8 节点/2 性状/2 假说/KI+AR/校准点）；⌘K 可开/搜索/Esc 关；新标签页空状态正常。

### 5.3 任务书脚本 B（徽标/标签重叠）
rectangular-cladogram / rectangular-phylogram / time-calibrated（含 13 条时间轴文字）/ circular 均为 `[]`；各布局 zoom out 3 次后仍为 `[]`；暗色模式同样 `[]`。

## 6. 已知限制与后续建议

1. `showEras` 是会话级 UI 状态：从文件打开一个已保存为 time-calibrated 的工程时不会自动开启年代带（按任务约束未加“依赖 layout.type 的 effect”，以免与 undo 冲突）；可选后续在项目加载回调里调用 `enterTimeChartLayout()`。
2. `projectIO` 仍会保留非法的 `layout.type`（只做了显示层兜底）；建议后续在加载时 normalize。
3. >1200 节点文档跳过标签 stagger（保持深树拖拽性能），徽标避让仍生效。
4. 画布对屏外节点用 `culled` 子集、导出用全量 `visible`：放大到部分节点在屏外时，屏幕与导出的徽标候选位置可能不同（fit 视图下一致）。
5. ≤640 时顶栏改为内部横向滚动（保留全部控件），Workflow tour 卡在 375 会覆盖左面板下半部分（窄屏权衡）。
6. `Branch length` 单位在 272px 面板显示缩写 `s/s`，完整 “substitutions per site” 在 tooltip/aria。
7. 既有行为（非本次引入）：示例加载时右上角“切换到地质时间图”提议 toast 会短暂覆盖顶栏右端。

## 6.1 打包修复（`vite.config.ts` base 条件化）

任务书的修复完成后重新打包桌面版曾出现“打开即白屏”：`vite.config.ts` 的 `base: '/CladeForge/'`（为 GitHub Pages 项目站点加入）会让构建出的 `index.html` 引用 `/CladeForge/assets/...`；而 Tauri 桌面版通过自定义协议在**根路径**加载同一份 `dist/`，这些绝对路径在 `tauri://localhost` 下 404，于是窗口空白。现已按 `TAURI_ENV_PLATFORM`（Tauri CLI 为 beforeBuild/beforeDev 钩子注入）条件化：桌面构建 `base: '/'`，浏览器/Pages 构建保持 `/CladeForge/`。已从打包产物中解出内嵌 `index.html` 验证：修复前为 `/CladeForge/assets/...`，修复后为 `/assets/...`。

## 7. 如何复验

```bash
cd CladeForge-项目代码
npm ci            # 干净安装（本机旧 node_modules 会导致 vite.config 的 oxc 类型报错）
npm test          # 911 passed / 6 skipped
npm run typecheck # 0 error（干净依赖下）
npm run build     # tsc + vite build
npm run dev       # 打开 http://localhost:1420/（Tauri 配置端口）
```

浏览器侧可直接用任务书第 5 节脚本 A–E，以及第 4 节 T1–T30 手工步骤复验；本报告的自动化验收脚本为一次性 CDP 工具，未入库，可按任务书步骤等价复现。

---

*本报告中的所有“实测”数据来自 2026-10-19 的 Chromium 真实渲染与 DOM/坐标核验；工作区改动未提交，请审阅后自行决定提交范围。*
