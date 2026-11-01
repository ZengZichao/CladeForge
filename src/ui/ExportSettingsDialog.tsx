// Export-settings dialog: the publication controls the exporter never had.
//
// Clicking "export SVG" used to snapshot whatever the screen happened to show —
// the active character, the event toggle, the ASR run — so re-exporting "the
// same figure" twice could produce two different files, and a reviewer asking
// "why does figure 3 have no events?" had no answer. This dialog decouples the
// export content from the live view (preset mode) and carries the DPI control
// PNG always lacked.

import { useStore } from '../model/store';
import { useDialogFocus } from './useDialogFocus';
import { RangeField } from './fields';
import { Field, CheckboxField } from './fields';
import { S } from './strings';

export function ExportSettingsDialog({
  open,
  onClose,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  /** Run with the current settings applied (preset mode on). */
  onExport: (format: 'svg' | 'png' | 'pdf') => void;
}) {
  const settings = useStore((s) => s.exportSettings);
  const setExportSettings = useStore((s) => s.setExportSettings);
  const ref = useDialogFocus(open, onClose);
  if (!open) return null;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.review.exportDialogTitle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.review.exportDialogTitle}</h2>
        <CheckboxField
          label={S.review.exportFollowView}
          title={S.review.exportFollowViewHint}
          checked={settings.followView}
          onChange={(v) => setExportSettings({ followView: v })}
        />
        {!settings.followView && (
          <>
            <div className="hint">{S.review.exportDecoupledNote}</div>
            <Field label={S.review.exportDpi} title={S.review.exportDpiHint}>
              <RangeField
                value={settings.dpi}
                min={96}
                max={1200}
                step={12}
                onCommit={(v) => v !== undefined && setExportSettings({ dpi: v })}
              />
            </Field>
            <div className="hint">{`${settings.dpi} dpi ≈ ${Math.round((settings.dpi / 96) * 100) / 100}× scale`}</div>
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
