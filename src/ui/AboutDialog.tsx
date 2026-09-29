// About box (Help → 关于 CladeForge). Shows the app identity and version read
// from the native host (`app_info`, sourced from CARGO_PKG_VERSION), so the
// packaged app can never disagree with the tauri.conf.json / package.json
// version stamps. In a plain-browser build the frontend package version is
// shown as the fallback.

import { useEffect, useState } from 'react';
import { getAppInfo, isTauri, type AppInfo } from '../io/native';
import { useDialogFocus } from './useDialogFocus';
import { S, tr } from './strings';
import pkg from '../../package.json';

/** The author record: language-neutral, shown verbatim in the About box. */
const AUTHOR_LINE = '曾子超 · ORCID 0000-0001-6553-970X';

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const ref = useDialogFocus(open, onClose);

  useEffect(() => {
    if (!open) return;
    void getAppInfo().then(setInfo);
  }, [open]);

  if (!open) return null;

  const version = info?.version ?? pkg.version;
  const runtime = isTauri()
    ? `Tauri ${info?.tauri ?? '?'}`
    : `${tr('浏览器预览', 'Browser preview')}`;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog about-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.about.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.about.title}</h2>
        <div className="about-body">
          <div className="about-brand">
            <span className="dot" />
            {S.app.name}
          </div>
          <div className="about-tagline">{S.about.tagline}</div>
          <dl className="about-facts">
            <div className="about-row">
              <dt>{S.about.version}</dt>
              <dd>{version}</dd>
            </div>
            <div className="about-row">
              <dt>{S.about.author}</dt>
              <dd>{AUTHOR_LINE}</dd>
            </div>
            <div className="about-row">
              <dt>{S.about.runtime}</dt>
              <dd>{runtime}</dd>
            </div>
            <div className="about-row">
              <dt>{S.about.license}</dt>
              <dd>MIT</dd>
            </div>
          </dl>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={onClose}>
            {S.about.close}
          </button>
        </div>
      </div>
    </div>
  );
}
