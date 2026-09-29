// Keyboard-shortcut reference dialog (⌘?, Help → 快捷键). Lists every shortcut
// grouped by scope with a live filter, matching the professional-tool
// convention of an always-available cheat sheet.

import { useMemo, useState } from 'react';
import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { useDialogFocus } from './useDialogFocus';
import { S, tr } from './strings';

interface ShortcutRow {
  keys: string;
  label: string;
}

const globalRows = (): ShortcutRow[] => [
  { keys: '⌘Z / Ctrl+Z', label: tr('撤销','Undo') },
  { keys: '⌘⇧Z / Ctrl+Y', label: tr('重做','Redo') },
  { keys: '⌘S / Ctrl+S', label: tr('保存项目','Save project') },
  // ⌘O opens a saved project; its picker filters to project files, so a tree
// file is not accepted here — importing trees is a separate command.
{ keys: '⌘O / Ctrl+O', label: tr('打开工程…','Open project…') },
  { keys: '⌘T / ⌘N', label: tr('新建标签页','New tab') },
  { keys: '⌘F / Ctrl+F', label: tr('搜索节点','Search nodes') },
  { keys: '⌘⇧F', label: tr('适应窗口','Fit to window') },
  { keys: '⌘K', label: tr('命令面板','Command palette') },
  { keys: '⌘?', label: tr('快捷键速查','Shortcut reference') },
  { keys: '⌘= / ⌘-', label: tr('放大 / 缩小','Zoom in / out') },
  { keys: '⌘.', label: tr('收起 / 展开左右面板','Collapse / expand side panels') },
];

const canvasRows = (): ShortcutRow[] => [
  { keys: 'Delete / Backspace', label: tr('删除所选节点','Delete selected nodes') },
  { keys: 'Esc', label: tr('取消选择 / 中断手势','Clear selection / abort gesture') },
  { keys: tr('方向键','Arrows'), label: tr('微调选中节点（Shift = 10px 步进）','Nudge selected nodes (Shift = 10px steps)') },
  { keys: tr('Alt + 方向键','Alt + Arrows'), label: tr('在树节点间移动焦点（父/子/兄弟）','Move focus between nodes (parent/child/sibling)') },
  { keys: tr('滚轮','Wheel'), label: tr('缩放画布','Zoom canvas') },
  { keys: tr('空格 / 中键拖拽','Space / middle-drag'), label: tr('平移画布','Pan canvas') },
  { keys: tr('拖拽节点','Drag node'), label: tr('移动节点','Move node') },
  { keys: tr('Alt + 拖拽到节点','Alt + drag onto node'), label: tr('重定父（改父）','Reparent') },
  { keys: tr('拖拽端口圆点','Drag port dot'), label: tr('创建自定义连线','Create custom link') },
  { keys: tr('双击节点','Double-click node'), label: tr('重命名','Rename') },
  { keys: tr('Shift + 点击','Shift + click'), label: tr('多选节点（选 2 个显示 MRCA）','Multi-select (2 selected shows MRCA)') },
];

const paletteRows = (): ShortcutRow[] => [
  { keys: '↑ / ↓', label: tr('在命令间移动','Move between commands') },
  { keys: 'Enter', label: tr('执行选中命令','Run selected command') },
  { keys: 'Esc', label: tr('关闭','Close') },
];

export function ShortcutsDialog({
  open,
  onClose,
  onOpenTour,
}: {
  open: boolean;
  onClose: () => void;
  onOpenTour?: () => void;
}) {
  const [q, setQ] = useState('');
  const ref = useDialogFocus(open, onClose);

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const match = (rows: ShortcutRow[]) =>
      t ? rows.filter((r) => r.keys.toLowerCase().includes(t) || r.label.toLowerCase().includes(t)) : rows;
    return [
      { title: S.shortcuts.global, rows: match(globalRows()) },
      { title: S.shortcuts.canvas, rows: match(canvasRows()) },
      { title: S.shortcuts.palette, rows: match(paletteRows()) },
    ].filter((g) => g.rows.length > 0);
  }, [q]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.shortcuts.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.shortcuts.title}</h2>
        <div className="shortcuts-search">
          <MagnifyingGlassIcon />
          <input
            type="text"
            placeholder={S.shortcuts.searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="shortcuts-body">
          {groups.length === 0 && <div className="hint">{S.shortcuts.noResults}</div>}
          {groups.map((g) => (
            <div className="shortcuts-group" key={g.title}>
              <div className="shortcuts-group-label">{g.title}</div>
              {g.rows.map((r) => (
                <div className="shortcut-row" key={r.keys + r.label}>
                  <span className="shortcut-label">{r.label}</span>
                  <kbd className="shortcut-keys">{r.keys}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="actions">
          {onOpenTour && (
            <button
              className="btn"
              onClick={() => {
                onClose();
                onOpenTour();
              }}
              title={S.menu.guideTitle}
            >
              {S.menu.guide}
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            {S.shortcuts.close}
          </button>
        </div>
      </div>
    </div>
  );
}
