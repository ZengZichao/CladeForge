// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Export-settings dialog: the publication controls the exporter never had.
//
// Clicking "export SVG" used to snapshot whatever the screen happened to show —
// the active character, the event toggle, the ASR run — so re-exporting "the
// same figure" twice could produce two different files, and a reviewer asking
// "why does figure 3 have no events?" had no answer. This dialog decouples the
// export content from the live view (preset mode) and carries the DPI control
// PNG always lacked.

import { useState } from 'react';
import { useStore } from '../model/store';
import { useDialogFocus } from './useDialogFocus';
import { RangeField } from './fields';
import { Field, TextField, CheckboxField } from './fields';
import { notify } from './toast';
import { S, tr } from './strings';
import { usePresence } from './motion';

export function ExportSettingsDialog({
  open,
  onClose,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  /** Run with the current settings applied (preset mode on). */
  onExport: (format: 'svg' | 'png' | 'pdf' | 'tiff') => void;
}) {
  const settings = useStore((s) => s.exportSettings);
  const project = useStore((s) => s.project);
  // S21: the live canvas viewport drives the bitmap size estimate.
  const viewport = useStore((s) => s.viewport);
  const setExportSettings = useStore((s) => s.setExportSettings);
  const presets = useStore((s) => s.exportPresets);
  const saveExportPreset = useStore((s) => s.saveExportPreset);
  const applyExportPreset = useStore((s) => s.applyExportPreset);
  const deleteExportPreset = useStore((s) => s.deleteExportPreset);
  const [presetName, setPresetName] = useState('');
  const ref = useDialogFocus(open, onClose);
  const presence = usePresence(open);
  if (!presence.mounted) return null;

  return (
    <div className="dialog-backdrop" data-state={presence.state} onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog export-dialog" data-state={presence.state}
        role="dialog"
        aria-modal="true"
        aria-label={S.review.exportDialogTitle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.review.exportDialogTitle}</h2>
        {/* S04/S21 (Sonus): the export contract must be legible BEFORE the
            click — which document, which content mode, which scope, which
            resolution, which background and legend switches will apply. */}
        <div className="hint export-summary" aria-live="polite">
          {S.review.exportSummaryDoc(project?.name ?? S.tabs.untitled)}
          <br />
          {settings.followView
            ? S.review.exportSummaryModeFollow
            : S.review.exportSummaryModePreset}
          {` · ${S.review.exportSummaryScope(
            settings.followView
              ? tr('当前视图', 'current view')
              : tr('整棵树（预设开关）', 'whole tree (preset switches)'),
          )}`}
          {` · ${S.review.exportSummaryDpi(settings.dpi)}`}
          <br />
          {/* S21: bitmap size estimate for the current viewport (the
              rasteriser renders the live canvas at dpi/96 scale). */}
          {`≈ ${Math.max(1, Math.round((viewport.w * settings.dpi) / 96))} × ${Math.max(
            1,
            Math.round((viewport.h * settings.dpi) / 96),
          )} px · `}
          {settings.followView
            ? tr('背景/图例：跟随画布', 'background/legend: as on canvas')
            : tr(
                `背景：${settings.transparentBackground ? '透明' : settings.whiteBackground ? '白色' : '主题底色'} · 图例${settings.includeLegend ? '含' : '不含'} · 比例尺${settings.includeScaleBar ? '含' : '不含'}`,
                `background: ${settings.transparentBackground ? 'transparent' : settings.whiteBackground ? 'white' : 'theme'} · legend ${settings.includeLegend ? 'on' : 'off'} · scale bar ${settings.includeScaleBar ? 'on' : 'off'}`,
              )}
        </div>
        <CheckboxField
          label={S.review.exportFollowView}
          title={S.review.exportFollowViewHint}
          checked={settings.followView}
          onChange={(v) => setExportSettings({ followView: v })}
        />
        {/* DPI is DENSITY, not content: it applies in follow-view mode too now
            that the rasteriser honours it there (M8), so the control is no
            longer hidden behind the preset switch. */}
        <Field label={S.review.exportDpi} title={S.review.exportDpiHint}>
          <RangeField
            value={settings.dpi}
            min={96}
            max={1200}
            step={12}
            onCommit={(v) => v !== undefined && setExportSettings({ dpi: v })}
          />
        </Field>
        <div className="hint">
          {tr(
            `${settings.dpi} dpi ≈ ${Math.round((settings.dpi / 96) * 100) / 100}× 缩放`,
            `${settings.dpi} dpi ≈ ${Math.round((settings.dpi / 96) * 100) / 100}× scale`,
          )}
        </div>
        <CheckboxField
          label={S.review.exportTransparentBg}
          title={S.review.exportTransparentBgHint}
          checked={settings.transparentBackground}
          onChange={(v) => setExportSettings({ transparentBackground: v })}
        />
        {!settings.followView && (
          <>
            <div className="hint">{S.review.exportDecoupledNote}</div>
            <CheckboxField
              label={S.review.exportShowSupport}
              title={S.review.exportShowSupportHint}
              checked={settings.showSupportValues}
              onChange={(v) => setExportSettings({ showSupportValues: v })}
            />
            <CheckboxField
              label={S.review.exportIncludeLegend}
              checked={settings.includeLegend}
              onChange={(v) => setExportSettings({ includeLegend: v })}
            />
            <CheckboxField
              label={S.review.exportIncludeScaleBar}
              checked={settings.includeScaleBar}
              onChange={(v) => setExportSettings({ includeScaleBar: v })}
            />
            <CheckboxField
              label={S.review.exportGrayscale}
              checked={settings.grayscale}
              onChange={(v) => setExportSettings({ grayscale: v })}
            />
            <CheckboxField
              label={S.review.exportWhiteBg}
              checked={settings.whiteBackground}
              onChange={(v) => setExportSettings({ whiteBackground: v })}
            />
          </>
        )}
        {/* Named presets (2026-11-15 P-7): the settings themselves now persist
            across restarts, and these save recurring combinations (e.g. a
            journal's 600 dpi halftone set) under one click. */}
        <div className="panel-section">
          <h3>{S.review.exportPresetsTitle}</h3>
          {presets.length === 0 ? (
            <div className="hint">{S.review.exportPresetEmpty}</div>
          ) : (
            <ul className="export-preset-list">
              {presets.map((p) => (
                <li key={p.id} className="export-preset-row">
                  <span className="export-preset-name" title={p.name}>
                    {p.name}
                  </span>
                  <button
                    className="btn tiny"
                    onClick={() => {
                      applyExportPreset(p.id);
                      notify.info(
                        tr(
                          `已应用预设「${p.name}」（${p.settings.dpi} dpi）`,
                          `Applied preset "${p.name}" (${p.settings.dpi} dpi)`,
                        ),
                      );
                    }}
                  >
                    {S.review.exportPresetApply}
                  </button>
                  <button
                    className="btn icon tiny ghost-danger"
                    title={S.review.exportPresetDelete}
                    aria-label={`${S.review.exportPresetDelete}: ${p.name}`}
                    onClick={() => {
                      deleteExportPreset(p.id);
                      notify.info(S.review.exportPresetDeleted(p.name));
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="field export-preset-save">
            <Field label={S.review.exportPresetName}>
              <TextField
                value={presetName}
                placeholder={S.review.exportPresetPlaceholder}
                onChange={setPresetName}
                onCommit={setPresetName}
              />
            </Field>
            <button
              className="btn"
              disabled={presetName.trim() === ''}
              onClick={() => {
                saveExportPreset(presetName);
                notify.success(S.review.exportPresetSaved(presetName.trim()));
                setPresetName('');
              }}
            >
              {S.review.exportPresetSave}
            </button>
          </div>
        </div>
        <div className="field row-actions">
          <button className="btn primary" onClick={() => onExport('svg')}>
            SVG
          </button>
          <button className="btn" onClick={() => onExport('png')}>
            PNG
          </button>
          <button className="btn" onClick={() => onExport('pdf')}>
            PDF
          </button>
          <button className="btn" onClick={() => onExport('tiff')} title={S.review.exportTiffHint}>
            {S.review.exportTiff}
          </button>
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            {S.analysis.close}
          </button>
        </div>
      </div>
    </div>
  );
}
