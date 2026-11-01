// About box (Help → 关于 CladeForge). Shows the app identity and version read
// from the native host (`app_info`, sourced from CARGO_PKG_VERSION), so the
// packaged app can never disagree with the tauri.conf.json / package.json
// version stamps. In a plain-browser build the frontend package version is
// shown as the fallback.

import { useEffect, useState } from 'react';
import { getAppInfo, isTauri, type AppInfo } from '../io/native';
import { useDialogFocus } from './useDialogFocus';
import { S, tr } from './strings';
import { notify } from './toast';
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
          {/* One-sentence positioning, matching the README's own claim, plus the
              capability boundary the reviewers asked to be visible INSIDE the
              app (it used to live only in code comments and the manual). */}
          <p style={{ fontSize: 12, margin: '8px 0 0' }}>
            {tr(
              'CladeForge 是演化假说的可复核工作台账：把一棵树、一组性状、一套事件解释与若干竞争假说，连同方法、参数与版本一起，导出成可核验的图与表。',
              'CladeForge is an auditable ledger for evolutionary hypotheses: one tree, a set of characters, event explanations and competing hypothesis layers — exported with their methods, parameters and version as verifiable figures and tables.',
            )}
          </p>
          <div className="hint" style={{ marginTop: 8 }}>{S.review.boundaryStatement}</div>
          <dl className="about-facts">
            <div className="about-row">
              <dt>{S.about.version}</dt>
              <dd>
                {version}
                <button
                  className="btn"
                  style={{ marginLeft: 8, fontSize: 11 }}
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
            {/* Documentation / repository / issue links, copyable: the About box
                used to answer none of "what is this / where are the docs / how
                do I cite or complain". */}
            <div className="about-row">
              <dt>{tr('文档 / 仓库', 'Docs / repo')}</dt>
              <dd>
                <button
                  className="btn"
                  style={{ fontSize: 11 }}
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
