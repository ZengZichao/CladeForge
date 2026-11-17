// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Onboarding tours: spotlight sequences that walk a region of the app with a
// short explanation and next/skip controls.
//
// Two modes share one component:
//
//   basics   — canvas → inspector → left panel → command palette. This is the
//              original 4-step tour, still reachable from Help → 新手指南, from
//              the command palette (⌘K) and from the shortcut reference.
//   workflow — bring-tree → 编辑 panel → export → complete. Each step
//              spotlights the relevant surface (the left panel on narrow
//              screens is opened through the tour-navigate event), ending with
//              a card that offers replay / shortcut reference.
//
// The tour is opt-in: it does not auto-show on first launch. Completion is
// persisted PER MODE (basics keeps `cladeforge:onboarded`, the workflow tour uses
// `cladeforge:workflowTour`), so an explicit replay always starts at step 1 while
// the recorded completion can be consulted without forcing the tour on repeat
// opens.

import { useCallback, useEffect, useState } from 'react';
import { S, tr } from './strings';
import { useDialogFocus } from './useDialogFocus';
import { useStore } from '../model/store';
import { documentHasTree } from './documentContent';
import * as file from '../io/fileActions';

const LS_ONBOARDED = 'cladeforge:onboarded';
/** Completion key for the workflow tour (basics keeps `cladeforge:onboarded`). */
export const LS_WORKFLOW_TOUR = 'cladeforge:workflowTour';

export type TourMode = 'basics' | 'workflow';
/** 用户反馈: the left rail is gone — ONE merged panel is all there is, so the
 *  tour's per-step "module" is now only a signal to open the left overlay on
 *  narrow screens. Kept as a type for the event payload. */
export type NavModule = 'edit';

interface TourStep {
  /** CSS selector of the element to spotlight; null = centered card. */
  target: string | null;
  title: string;
  desc: string;
  /** Workflow mode: the left module this step presents. */
  module?: NavModule;
}

function getBasicsSteps(): TourStep[] {
  return [
    {
      // Step 0 — the capability boundary. The inference UI has real statistical
      // vocabulary, so the FIRST thing a new user must learn is what the app
      // does NOT do; one acknowledged read is recorded in localStorage.
      target: null,
      title: S.review.boundaryTitle,
      desc: S.review.boundaryStatement,
    },
    {
      target: '.canvas-host',
      title: S.tour.step1Title,
      desc: S.tour.step1Desc,
    },
    {
      target: '.panel-right',
      title: S.tour.step2Title,
      desc: S.tour.step2Desc,
    },
    {
      target: '.nav-rail, .panel-left',
      title: S.tour.step3Title,
      desc: S.tour.step3Desc,
    },
    {
      target: null,
      title: S.tour.step4Title,
      desc: S.tour.step4Desc,
    },
  ];
}

function getWorkflowSteps(): TourStep[] {
  return [
    {
      // Step 0 — bring your own tree. The workflow tour used to start at
      // Traits, which presumes a tree already sits in the document; the first
      // real action is getting one in (file, drop, or clipboard).
      target: '.canvas-host',
      title: tr('第 0 步：把你的树放进来', 'Step 0: Bring your own tree'),
      desc: tr(
        '三种方式：文件 › 导入树、把 .nwk/.nex 文件拖进画布、或 文件 › 从剪贴板导入树。没有树时也可以先打开一个示例（帮助 › 新手指南）。',
        'Three ways: File › Import tree, drop a .nwk/.nex file onto the canvas, or File › Paste tree from clipboard. With no tree yet, open a sample first (Help › Guide).',
      ),
    },
    {
      // 用户反馈: 性状 / 假说 modules are gone and 导出 moved to the top menu
      // bar — the workflow now runs bring-tree → edit (时间/样式) → export.
      target: '.panel-left',
      module: 'edit',
      title: tr('第 1 步：设置时间与样式', 'Step 1: Set time & style'),
      desc: tr(
        '在左侧合并面板中设置时间数据（时间轴、环境事件、校准点）与全局样式（布局、分支、字体、颜色渐变）。',
        'Set time data (time axis, environmental events, calibration points) and global styles (layout, branches, fonts, colour gradient) in the merged left panel.',
      ),
    },
    {
      target: null,
      title: tr('第 2 步：导出', 'Step 2: Export'),
      desc: tr(
        '通过顶部菜单栏的「导出」下拉输出 SVG / PDF / PNG 图、Newick / Nexus 数据，或可重复的分析脚本。',
        'Export figures (SVG / PDF / PNG), data (Newick / Nexus), or a reproducible analysis script from the Export dropdown in the top menu bar.',
      ),
    },
    {
      target: null,
      title: tr('工作流走完了', 'Workflow complete'),
      desc: tr(
        '这就是从导入到导出的完整路径。可以重放本引导，或打开快捷键速查继续探索。',
        'That is the full path from import to export. Replay this tour, or open the shortcut reference to keep exploring.',
      ),
    },
  ];
}

const STEPS: Record<TourMode, () => TourStep[]> = {
  basics: getBasicsSteps,
  workflow: getWorkflowSteps,
};

/** Has this tour mode been completed before? (Opt-in tour: never auto-opened.) */
export function tourCompleted(mode: TourMode): boolean {
  try {
    return localStorage.getItem(mode === 'basics' ? LS_ONBOARDED : LS_WORKFLOW_TOUR) === 'true';
  } catch {
    return false;
  }
}

/** Mark a tour as completed (persisted per mode). */
export function markOnboarded(mode: TourMode = 'basics'): void {
  try {
    localStorage.setItem(mode === 'basics' ? LS_ONBOARDED : LS_WORKFLOW_TOUR, 'true');
  } catch {
    /* ignore */
  }
}

function targetRect(selector: string | null): DOMRect | null {
  if (!selector) return null;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // Skip fully hidden targets (e.g. collapsed panels on narrow screens).
  if (r.width < 8 || r.height < 8) return null;
  return r;
}

export function FirstRunTour({
  open,
  mode = 'basics',
  onClose,
  onNavigate,
  onOpenShortcuts,
}: {
  open: boolean;
  mode?: TourMode;
  onClose: () => void;
  /** Workflow mode: switch the left panel to the module this step presents. */
  onNavigate?: (module: NavModule) => void;
  /** Workflow finish card: open the keyboard-shortcut reference. */
  onOpenShortcuts?: () => void;
}) {
  // The tour declares role="dialog" aria-modal="true", so it must honour that
  // contract: claim focus, trap Tab and close on Escape. Previously it did none
  // of that, and keystrokes fell through to the canvas.
  const dialogRef = useDialogFocus(open, onClose);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Reset to the first step each time the tour is (re-)opened or its mode flips.
  useEffect(() => {
    if (open) setStep(0);
  }, [open, mode]);

  // Workflow mode: switch the module BEFORE the measurement effect below runs,
  // so the spotlight lands on the panel the step describes. On narrow screens
  // App also opens the left panel as an overlay from the same callback.
  useEffect(() => {
    if (!open || mode !== 'workflow') return;
    const module = getWorkflowSteps()[step]?.module;
    if (module) onNavigate?.(module);
  }, [open, mode, step, onNavigate]);

  useEffect(() => {
    if (!open) return undefined;
    const selector = STEPS[mode]()[step]?.target ?? null;
    const measure = () => setRect(targetRect(selector));
    measure();
    const raf = requestAnimationFrame(measure);
    // The workflow tour swaps the left module (and on narrow screens the panel
    // overlay appears) in the same commit; its final box settles a frame or two
    // later, so re-measure briefly rather than pinning the card to a stale rect.
    const t1 = setTimeout(measure, 120);
    const t2 = setTimeout(measure, 340);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', measure);
    };
  }, [open, step, mode]);

  const finish = useCallback(() => {
    markOnboarded(mode);
    onClose();
  }, [mode, onClose]);

  if (!open) return null;

  const steps = STEPS[mode]();
  // A#3: finishing the basics tour on its last step left `step` at 4; opening
  // the 4-step workflow tour afterwards rendered with step=4, so `steps[step]`
  // was undefined and `current.target` threw into the error boundary. Clamp for
  // rendering (the reset effect still runs right after) and never dereference
  // an out-of-range step.
  const safeStep = Math.max(0, Math.min(step, steps.length - 1));
  const current = steps[safeStep];
  const isLast = safeStep === steps.length - 1;
  // A16: on an EMPTY document the natural next step after a tour is to see a
  // worked example — offer the sample library right on the finish card instead
  // of sending the user hunting through the File menu.
  const documentIsEmpty = !documentHasTree(useStore.getState().project);

  /**
   * Place the card around the spotlight. Preference order: below the target,
   * above it, then BESIDE it (workflow steps spotlight a full-height panel, so
   * neither below nor above can fit and the old top-left fallback covered the
   * menu bar), and finally pinned low over the spotlight on viewports too narrow
   * for any free side.
   */
  const CARD_W = 340;
  const CARD_H = 240;
  const M = 12;
  const cardStyle: React.CSSProperties = (() => {
    if (!current.target) return { top: '45%', left: '50%', transform: 'translate(-50%, -50%)' };
    if (!rect) return { top: '45%', left: '50%', transform: 'translate(-50%, -50%)' };
    let left: number;
    let top: number;
    if (rect.bottom + M + CARD_H <= window.innerHeight - M) {
      left = rect.left;
      top = rect.bottom + M;
    } else if (rect.top - M - CARD_H >= M) {
      left = rect.left;
      top = rect.top - M - CARD_H;
    } else if (rect.right + 16 + CARD_W <= window.innerWidth - M) {
      left = rect.right + 16;
      top = rect.top + M;
    } else if (rect.left - 16 - CARD_W >= M) {
      left = rect.left - 16 - CARD_W;
      top = rect.top + M;
    } else {
      left = M;
      top = Math.max(M, window.innerHeight - CARD_H - M);
    }
    return {
      left: Math.max(M, Math.min(left, window.innerWidth - CARD_W - M)),
      top: Math.max(M, Math.min(top, window.innerHeight - CARD_H - M)),
    };
  })();

  return (
    <div
      ref={dialogRef}
      className="tour-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'workflow' ? tr('工作流引导', 'Workflow tour') : S.tour.title}
    >
      <div className="tour-mask" />
      {rect && current.target && (
        <div
          className="tour-spotlight"
          style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      <div className={`tour-card tour-card-${mode}`} style={cardStyle} data-tour-step={safeStep}>
        <div className="tour-step">
          {safeStep + 1} / {steps.length}
          {mode === 'workflow' ? tr(`（工作流）`, ` (Workflow)`) : ''}
        </div>
        <div className="tour-title">{current.title}</div>
        <div className="tour-desc">{current.desc}</div>
        {isLast && documentIsEmpty && (
          <div className="tour-actions">
            <button
              className="btn"
              onClick={() => {
                markOnboarded(mode);
                file.openAppDialog('sampleLibrary');
              }}
            >
              {tr('打开示例库…', 'Open sample library…')}
            </button>
          </div>
        )}
        {mode === 'workflow' && isLast ? (
          <div className="tour-actions wrap">
            <button className="btn ghost" onClick={() => setStep(0)}>
              {tr('重放', 'Replay')}
            </button>
            {onOpenShortcuts && (
              <button
                className="btn ghost"
                onClick={() => {
                  markOnboarded(mode);
                  onOpenShortcuts();
                }}
              >
                {tr('快捷键速查', 'Shortcut reference')}
              </button>
            )}
            <button className="btn primary" onClick={finish}>
              {tr('完成', 'Done')}
            </button>
          </div>
        ) : (
          <div className="tour-actions">
            <button className="btn ghost" onClick={finish}>
              {mode === 'workflow' ? tr('跳过导览', 'Skip tour') : S.tour.skip}
            </button>
            <button
              className="btn primary"
              onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
            >
              {isLast
                ? mode === 'workflow'
                  ? tr('完成', 'Done')
                  : S.tour.done
                : mode === 'workflow'
                  ? tr('下一步', 'Next')
                  : S.tour.next}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
