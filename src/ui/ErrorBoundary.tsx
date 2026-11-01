// Root-level and panel-level error boundaries.
//
// Until this existed, ONE render-phase exception (a bad layout, an unexpected
// data shape from a hand-edited file, a browser API difference) blanked the
// entire window with no recovery path but killing the process — the repo's own
// test comment said so ("with no ErrorBoundary anywhere in the app, that
// blanks…"). The boundary shows the error, a copyable diagnostic block
// (version / platform / message / stack), the autosave state, and the two ways
// forward: reload the view, or reset to a new empty document.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { APP_VERSION } from '../model/types';
import { tr } from './strings';

export interface ErrorBoundaryProps {
  /** What this boundary wraps ("canvas", "left panel", …) — shown in the report. */
  scope: string;
  children: ReactNode;
  /** Panel-level fallbacks can offer a lighter recovery (collapse the panel). */
  compact?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
}

/** The copyable diagnostic block: what support/debugging actually needs. */
export function errorDiagnostics(scope: string, error: Error, info: ErrorInfo | null): string {
  const lines = [
    `CladeForge ${APP_VERSION}`,
    `scope: ${scope}`,
    `ua: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    `time: ${new Date().toISOString()}`,
    `error: ${error.name}: ${error.message}`,
  ];
  if (info?.componentStack) {
    lines.push('component stack:', info.componentStack.split('\n').slice(0, 12).join('\n'));
  }
  return lines.join('\n');
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console keeps the full stack for devtools; the UI keeps the summary.
    console.error(`[ErrorBoundary:${this.props.scope}]`, error, info);
    this.setState({ info });
  }

  private reset = (): void => {
    this.setState({ error: null, info: null });
  };

  private hardReset = (): void => {
    // Last resort: drop the workspace snapshot so the next boot starts clean
    // instead of re-entering the crashing view. Documents saved to disk are
    // untouched; the autosave warning below says exactly what is lost.
    try {
      localStorage.removeItem('cladeforge:workspace');
      localStorage.removeItem('cladeforge:autosave');
    } catch {
      /* storage already broken */
    }
    window.location.reload();
  };

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    const diag = errorDiagnostics(this.props.scope, error, info);
    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 20,
          overflow: 'auto',
          height: '100%',
          boxSizing: 'border-box',
        }}
      >
        <strong>
          {tr(
            `「${this.props.scope}」区域出现渲染错误`,
            `The "${this.props.scope}" area hit a rendering error`,
          )}
        </strong>
        <pre
          style={{
            margin: 0,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            background: 'var(--surface-2, rgba(128,128,128,0.12))',
            padding: 10,
            borderRadius: 6,
            maxHeight: 200,
            overflow: 'auto',
          }}
        >
          {error.message}
        </pre>
        {!this.props.compact && (
          <span style={{ fontSize: 12, opacity: 0.8 }}>
            {tr(
              '未保存的修改仍可能在上次自动存档中；保存到磁盘的文档不受影响。',
              'Unsaved work may still be in the last autosave; documents saved to disk are unaffected.',
            )}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={this.reset}>
            {tr('重试渲染', 'Retry rendering')}
          </button>
          {!this.props.compact && (
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              {tr('重新加载应用', 'Reload the app')}
            </button>
          )}
          {!this.props.compact && (
            <button type="button" className="btn btn-danger" onClick={this.hardReset}>
              {tr('放弃本次会话并重置', 'Discard this session and reset')}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(diag);
            }}
          >
            {tr('复制诊断信息', 'Copy diagnostics')}
          </button>
        </div>
        {!this.props.compact && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12 }}>
              {tr('诊断详情（可随问题报告一并发送）', 'Diagnostic details (include with a bug report)')}
            </summary>
            <pre
              style={{
                margin: 0,
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                maxHeight: 260,
                overflow: 'auto',
              }}
            >
              {diag}
            </pre>
          </details>
        )}
      </div>
    );
  }
}
