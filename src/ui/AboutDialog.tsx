// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// About box (Help → 关于 CladeForge). Shows the app identity and version read
// from the native host (`app_info`, sourced from CARGO_PKG_VERSION), so the
// packaged app can never disagree with the tauri.conf.json / package.json
// version stamps. In a plain-browser build the frontend package version is
// shown as the fallback.

import { useEffect, useState } from 'react';
import { getAppInfo, isTauri, type AppInfo } from '../io/native';
import { writeClipboardText } from '../io/clipboardIO';
import { PROJECT_VERSION } from '../model/types';
import { useDialogFocus } from './useDialogFocus';
import { S, tr } from './strings';
import { usePresence } from './motion';
import { notify } from './toast';
import pkg from '../../package.json';

/** The author record: language-neutral, shown verbatim in the About box. */
const AUTHOR_LINE = '曾子超，ORCID iD 0000-0001-6553-970X';
const REPOSITORY_URL = 'https://github.com/zengzichao/CladeForge';

/** Copy through the shared clipboard helper and report its actual result. */
async function copyRepository(openingFailed = false): Promise<void> {
  if (await writeClipboardText(REPOSITORY_URL)) {
    if (openingFailed) {
      notify.info(tr('无法打开浏览器，仓库地址已复制', 'Could not open the repository; URL copied'));
    } else {
      notify.success(tr('仓库地址已复制', 'Repository URL copied'));
    }
  } else {
    notify.error(
      openingFailed
        ? tr('无法打开仓库地址或复制链接', 'Could not open the repository or copy its URL')
        : tr('无法复制仓库地址', 'Could not copy repository URL'),
    );
  }
}

/** Open externally on both builds; thrown opener failures fall back to copying. */
async function openRepository(): Promise<void> {
  try {
    const native = isTauri();
    if (native) {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(REPOSITORY_URL);
    } else {
      // With `noopener`, a successful window.open legitimately returns null.
      // Its return value cannot distinguish success from a blocked popup.
      window.open(REPOSITORY_URL, '_blank', 'noopener,noreferrer');
    }
    if (native) {
      notify.success(tr('正在打开仓库地址', 'Opening repository URL'));
    } else {
      notify.info(tr('已请求打开仓库地址', 'Repository open requested'));
    }
  } catch {
    await copyRepository(true);
  }
}

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
            {/* Repository navigation: opens the system browser (or an isolated
                browser tab). The explicit copy action stays available because a
                blocked popup and a successful `noopener` open both return null. */}
            <div className="about-row wide">
              <dt>{tr('仓库地址', 'Repository URL')}</dt>
              <dd>
                <button
                  className="btn"
                  style={{ fontSize: 12 }}
                  onClick={() => {
                    void openRepository();
                  }}
                >
                  github.com/zengzichao/CladeForge
                </button>
                <button
                  className="btn"
                  style={{ marginLeft: 8, fontSize: 12 }}
                  onClick={() => {
                    void copyRepository();
                  }}
                >
                  {tr('复制仓库地址', 'Copy repository URL')}
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
