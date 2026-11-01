// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Reconciliation-specific navigation rail: 树库 / 场景 / 校验 / 视图, with the
// "back to standard view" action pinned at the bottom. This is the recon
// workspace's own rail — the standard module rail never mounts here (§5.3),
// so no standard panel can cover the scenario/validation content again.

import { MixerHorizontalIcon, CheckCircledIcon, LayersIcon, StackIcon, EnterIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import type { ReconSection } from '../model/types';
import { S } from './strings';

function railItems(): { id: ReconSection; icon: React.ReactNode; label: string }[] {
  return [
    { id: 'trees', icon: <StackIcon />, label: S.recon.railTrees },
    { id: 'scenario', icon: <LayersIcon />, label: S.recon.railScenario },
    { id: 'validation', icon: <CheckCircledIcon />, label: S.recon.railValidation },
    { id: 'view', icon: <MixerHorizontalIcon />, label: S.recon.railView },
  ];
}

export function ReconRail({ onSelect }: { onSelect?: (s: ReconSection) => void }) {
  const reconSection = useStore((s) => s.reconSection);
  const setReconSection = useStore((s) => s.setReconSection);
  const exitReconWorkspace = useStore((s) => s.exitReconWorkspace);

  return (
    <nav className="nav-rail recon-rail" aria-label={S.recon.railLabel}>
      {railItems().map((item) => (
        <button
          key={item.id}
          className={`nav-rail-item${reconSection === item.id ? ' active' : ''}`}
          onClick={() => {
            setReconSection(item.id);
            onSelect?.(item.id);
          }}
          aria-label={item.label}
          aria-pressed={reconSection === item.id}
          data-recon-nav={item.id}
        >
          <span className="nav-rail-icon">{item.icon}</span>
          <span className="nav-rail-label">{item.label}</span>
        </button>
      ))}
      <div className="nav-rail-spacer" />
      <button
        className="nav-rail-item recon-rail-exit"
        onClick={exitReconWorkspace}
        aria-label={S.recon.exitView}
        title={S.recon.exitView}
        data-recon-exit
      >
        <span className="nav-rail-icon"><EnterIcon /></span>
        <span className="nav-rail-label">{S.recon.exitView}</span>
      </button>
    </nav>
  );
}
