// Top menu bar: document lifecycle and import/export consolidated into a
// single "文件" dropdown to keep the header clean. The prominent Save button
// and help actions (shortcuts, guide) live in the Toolbar on the right side.

import { useEffect, useState } from 'react';
import { QuestionMarkIcon, MagicWandIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import * as file from '../io/fileActions';
import { RECENTS_CHANGED_EVENT, readRecents, clearRecents, type RecentEntry } from '../io/recent';
import { Dropdown } from './Dropdown';
import { buildFileMenuItems, buildRecentItems } from './fileMenu';
import { S } from './strings';

export function MenuBar({
  onOpenShortcuts,
  onOpenTour,
  onOpenAbout,
}: {
  onOpenShortcuts: () => void;
  onOpenTour: () => void;
  onOpenAbout: () => void;
}) {
  // Live recents: re-read on the change event (fired by pushRecent / clearRecents),
  // so importing via the canvas dropzone also refreshes the list immediately.
  const [recents, setRecents] = useState<RecentEntry[]>(() => readRecents());
  useEffect(() => {
    const refresh = () => setRecents(readRecents());
    window.addEventListener(RECENTS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(RECENTS_CHANGED_EVENT, refresh);
  }, []);
  const openRecent = (entry: RecentEntry) => void file.actionOpenRecent(entry);
  // Both lists are built by `fileMenu.ts`: every export action
  // is wrapped there, so no handler can receive the click event as an argument.
  const recentItems = buildRecentItems(recents, openRecent, () => clearRecents());
  const fileItems = buildFileMenuItems(recents[0], openRecent);

  return (
    <div className="menubar">
      <div className="brand">
        <span className="dot" />
        {S.app.name}
      </div>

      <div className="group">
        <Dropdown label={S.menu.fileGroup} items={fileItems} />
        <Dropdown label={S.menu.recent} items={recentItems} />
      </div>

      {/* Help group: shortcut reference + re-openable onboarding tour (P1).
          Labels drop to icons below 1440px so the toolbar keeps its width —
          see the .menubar-help rule in app.css. */}
      <div className="group">
        <button
          className="btn icon ghost menubar-help"
          onClick={onOpenShortcuts}
          title={S.menu.shortcutsTitle}
          aria-label={S.menu.shortcuts}
        >
          <QuestionMarkIcon />
          <span className="menubar-help-label">{S.menu.shortcuts}</span>
        </button>
        <button
          className="btn icon ghost menubar-help"
          onClick={onOpenTour}
          title={S.menu.guideTitle}
          aria-label={S.menu.guide}
        >
          <MagicWandIcon />
          <span className="menubar-help-label">{S.menu.guide}</span>
        </button>
        <button
          className="btn icon ghost menubar-help"
          onClick={onOpenAbout}
          title={S.about.title}
          aria-label={S.menu.about}
        >
          <InfoCircledIcon />
          <span className="menubar-help-label">{S.menu.about}</span>
        </button>
      </div>
    </div>
  );
}
