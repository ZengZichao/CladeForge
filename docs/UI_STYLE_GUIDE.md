<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# CladeForge UI 文案风格指南 / UI Style Guide

> 适用于 `src/ui/strings.ts`、组件内联 `tr()` 文案、通知、导出图与 NEXUS 注释。目标：准确、克制、可核查。

## 1. 英语变体与拼写

- 统一 **英式英语**：Colour、Licence、Centre、normalised、cancelled、grey、Favourite、Greyscale。
- 专业名词：NEXUS、Newick、NeXML、MrBayes、BEAST、Mk、ER、SYM、ARD、ASR、DTL、MP、MAP、CI、RI、BM、SH-aLRT、RF、ICS。
- 缩写首次出现时展开；统计符号 `p`、`n`、`K`、`r`、`m`、`s`、`g`、`ln L` 使用斜体（可用的渲染环境中）。
- 单位：Ma/ka/Ga 只用于年龄；Myr/kyr/Gyr 只用于持续时间；`subst./site`；`DPI`；`px` 小写。

## 2. 大小写

| 控件类型 | 规则 | 示例 |
|---|---|---|
| 菜单项 | Title Case | `Import Tree…`、`Keyboard Shortcuts` |
| 对话框标题 | 名词短语；Title Case | `Export Options`、`Delete Hypothesis Layer` |
| 分区标题 | Sentence case | `Tree summary`、`ASR model settings` |
| 按钮 | Sentence case；动词开头 | `Add children`、`Fit to window` |
| 选项/下拉值 | 首字母大写（专有名词按官方写法） | `Bootstrap`、`Posterior probability`、`Ma` |
| 提示/说明 | Sentence case；完整句加句号 | `No branch lengths in this tree.` |
| 缩写 | 全大写，模型名除外 | `NEXUS`、`DTL`、`Mk`、`Ma` |
| 全大写强调 | 禁止 | 用粗体/图标/短句代替 |

## 3. 中文标点与空格

1. 中文句子用全角标点（，。；：！？（）“”《》）。
2. UI 控件名/路径用「」；引文/概念用“”；禁止 ASCII `"` 作为可见引号。
3. 中文与拉丁字母/数字之间加一个空格（如“Mk 模型”“0–100 的阈值”“Alt + 拖拽”）。
4. 数值范围用 `–`；不要用 `-` 或 `~`。中文破折号用 `——`。
5. 文件扩展名可用 `.nex`，括注统一为“（.nex）”。
6. 列表用“、”；并列动作可用“/”但前后加空格，且全库统一。
7. 单位与数字之间加空格：`66 Ma`、`10 px`、`300 DPI`；百分号紧贴数字：`50%`。

## 4. 复数与占位符

1. 英文使用正确单复数；禁止 `(s)`、`(es)` 伪复数。
2. 中文用“个/条/对/处”等量词。
3. 占位符统一为 formatter 函数；禁止 `{n}` 字面量。
4. 所有占位符必须在两种语言中都存在；`src/ui/copyQuality.test.ts` 检查键结构与占位符。

## 5. 按钮、菜单与对话框

1. 按钮 = 动词 + 对象：`Add children`、`Clear selection`、`Fit to window`。
2. 破坏性按钮写明对象与后果：`Delete gene tree`，不要只写 `Delete`。
3. 省略号只用于“还会打开另一个对话框/需要更多输入”的动作。
4. 对话框标题用名词短语，不加问号；确认按钮重复动作名（`Delete`、`Reroot`），不要用 `OK`。
5. 菜单项平行：同类动作同一词性、同一大小写、同一结尾。
6. 禁用项要有原因 tooltip。

## 6. 错误与空状态

1. 错误信息模板：发生了什么 + 为什么 + 下一步。
2. 不暴露原始枚举、字段名、文件路径、堆栈；诊断信息放在可复制的折叠区。
3. 空状态给 2–3 个等价入口，不承诺软件不做的功能。
4. 删除/清空操作明确是否可撤销、是否影响磁盘文件。

## 7. 语气

1. 中性、描述性、可核查；避免“任何/永远/绝不/保证”等绝对词。
2. 避免第二人称说教；用“These values…”而不是“You must…”。
3. 避免拟人化与俚语；用“the model requires”而不是“the solver needs”。
4. 科学限制用“条件/范围/不可比”描述，不用“不要/必须”命令句。
5. 长方法论说明放入用户手册或帮助面板，界面保留短摘要。

## 8. 本地化工程规则

1. 禁止在英文可见字符串中出现 CJK（语言名称除外）。
2. 禁止在中文可见字符串中出现未翻译的英文枚举/内部键名（如 `global`、`canvas`、`palette`）。
3. 禁止硬编码中文标点拼接英文（`.join('；')`、`、`、`：`）；按 locale 选择分隔符。
4. 语言切换后所有分组标题、枚举值、单位、错误消息必须重新本地化。
5. `aria-label`、`title`、`placeholder` 也属于 UI 文案，必须走同一目录或同一 `tr()` 体系。
6. `document.documentElement.lang` 在启动即设置（见 `index.html`）。
7. 提交前运行 `npm test`；`src/ui/copyQuality.test.ts` 是文案质量门禁。
