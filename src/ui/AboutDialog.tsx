// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// About box (Help → 关于 CladeForge). Shows the app identity and version read
// from the native host (`app_info`, sourced from CARGO_PKG_VERSION), so the
// packaged app can never disagree with the tauri.conf.json / package.json
// version stamps. In a plain-browser build the frontend package version is
// shown as the fallback.

import { useEffect, useState } from 'react';
import { getAppInfo, isTauri, type AppInfo } from '../io/native';
import { PROJECT_VERSION } from '../model/types';
import { useDialogFocus } from './useDialogFocus';
import { S, tr } from './strings';
import { usePresence } from './motion';
import { notify } from './toast';
import pkg from '../../package.json';

/** The author record: language-neutral, shown verbatim in the About box. */
const AUTHOR_LINE = '曾子超，ORCID iD 0000-0001-6553-970X';

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const ref = useDialogFocus(open, onClose);

  useEffect(() => {
    if (!open) return;
    void getAppInfo().then(setInfo);
  }, [open]);

  const presence = usePresence(open);

  if (!presence.mounted) return null;

  const version = info?.version ?? pkg.version;
  const runtime = isTauri()
    ? `Tauri ${info?.tauri ?? '?'}`
    : `${tr('浏览器预览', 'Browser preview')}`;

  return (
    <div className="dialog-backdrop" data-state={presence.state} onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog about-dialog" data-state={presence.state}
        role="dialog"
        aria-modal="true"
        aria-label={S.about.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.about.title}</h2>
        <div className="about-body">
          <div className="about-brand">{S.app.name}</div>
          <div className="about-tagline">{S.about.tagline}</div>
          <div className="hint" style={{ marginTop: 8 }}>{S.review.boundaryStatement}</div>
          <dl className="about-facts">
            <div className="about-row">
              <dt>{S.about.version}</dt>
              <dd>
                {version}
                <button
                  className="btn"
                  style={{ marginLeft: 8, fontSize: 'var(--text-xs)' }}
                  onClick={() => {
                    void import('../io/clipboardIO').then(({ writeClipboardText }) =>
                      writeClipboardText(`CladeForge ${version}`),
                    );
                  }}
                >
                  {tr('复制版本号', 'Copy version')}
                </button>
              </dd>
            </div>
            {/* E-P6: the app version and the saved-file format version are two
                different numbers (0.3.0 vs 0.2.0). Showing only the former made
                the two look contradictory, so the format version is stated
                explicitly beside it. */}
            <div className="about-row">
              <dt>{tr('项目格式版本', 'Project format version')}</dt>
              <dd>{PROJECT_VERSION}</dd>
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
              <dd>MIT License（© 2026 曾子超）</dd>
            </div>
            {/* Documentation / repository / issue links, copyable: the About box
                used to answer none of "what is this / where are the docs / how
                do I cite or complain". */}
            <div className="about-row wide">
              <dt>{tr('仓库地址', 'Repository URL')}</dt>
              <dd>
                <button
                  className="btn"
                  style={{ fontSize: 12 }}
                  onClick={() => {
                    void import('../io/clipboardIO').then(({ writeClipboardText }) =>
                      writeClipboardText('https://github.com/zengzichao/CladeForge'),
                    );
                    notify.success(tr('仓库地址已复制', 'Repository URL copied'));
                  }}
                >
                  github.com/zengzichao/CladeForge
                </button>
              </dd>
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
