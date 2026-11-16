// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Reconciliation-specific navigation rail: 树库 / 场景 / 视图. 用户反馈: the
// 校验 section and the bottom "back to standard view" action are gone — leaving
// the workspace lives in the header mode switch (a third exit was visual noise,
// R-19). This is the recon workspace's own rail — the standard module rail
// never mounts here (§5.3), so no standard panel can cover the scenario content
// again.

import { MixerHorizontalIcon, LayersIcon, StackIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import type { ReconSection } from '../model/types';
import { S } from './strings';

function railItems(): { id: ReconSection; icon: React.ReactNode; label: string }[] {
  return [
    { id: 'trees', icon: <StackIcon />, label: S.recon.railTrees },
    { id: 'scenario', icon: <LayersIcon />, label: S.recon.railScenario },
    { id: 'view', icon: <MixerHorizontalIcon />, label: S.recon.railView },
  ];
}

export function ReconRail({ onSelect }: { onSelect?: (s: ReconSection) => void }) {
  const reconSection = useStore((s) => s.reconSection);
  const setReconSection = useStore((s) => s.setReconSection);

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
    </nav>
  );
}
