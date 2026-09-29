// NEXUS export options dialog (6.1): lets the user choose which extra blocks
// to include in the exported NEXUS file — character matrix, assumption sets,
// MrBayes MCMC block, and BEAST calibration block.

import { useState } from 'react';
import { useDialogFocus } from './useDialogFocus';
import { CheckboxField } from './fields';
import { S } from './strings';
import { DEFAULT_NEXUS_OPTIONS, type NexusExportOptions } from '../io/nexus';

/**
 * The dialog's untouched state IS `DEFAULT_NEXUS_OPTIONS`: the
 * menu / palette entries export with those same defaults, so "NEXUS" means one
 * file whichever entry point produced it, and the dialog only ever ADDS blocks.
 */
export const NEXUS_DIALOG_DEFAULTS: NexusExportOptions = { ...DEFAULT_NEXUS_OPTIONS };

export function NexusExportDialog({
  open,
  onClose,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  onExport: (opts: NexusExportOptions) => void;
}) {
  const [includeCharacters, setIncludeCharacters] = useState(
    Boolean(DEFAULT_NEXUS_OPTIONS.includeCharacters),
  );
  const [includeHypothesis, setIncludeHypothesis] = useState(
    Boolean(DEFAULT_NEXUS_OPTIONS.includeHypothesis),
  );
  const [includeMrBayes, setIncludeMrBayes] = useState(
    Boolean(DEFAULT_NEXUS_OPTIONS.includeMrBayes),
  );
  const [includeBeast, setIncludeBeast] = useState(Boolean(DEFAULT_NEXUS_OPTIONS.includeBeast));
  const ref = useDialogFocus(open, onClose);

  if (!open) return null;

  const handleExport = () => {
    onExport({ includeCharacters, includeHypothesis, includeMrBayes, includeBeast });
    onClose();
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.nexusExport.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.nexusExport.title}</h2>
        <CheckboxField
          label={S.nexusExport.includeCharacters}
          checked={includeCharacters}
          onChange={setIncludeCharacters}
        />
        <CheckboxField
          label={S.nexusExport.includeHypothesis}
          checked={includeHypothesis}
          onChange={setIncludeHypothesis}
        />
        <CheckboxField
          label={S.nexusExport.includeMrBayes}
          checked={includeMrBayes}
          onChange={setIncludeMrBayes}
        />
        <CheckboxField
          label={S.nexusExport.includeBeast}
          checked={includeBeast}
          onChange={setIncludeBeast}
        />
        <div className="actions">
          <button className="btn" onClick={onClose}>
            {S.nexusExport.cancel}
          </button>
          <button className="btn primary" onClick={handleExport}>
            {S.nexusExport.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
