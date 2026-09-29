// Left navigation rail: module switcher organised as three labelled groups
// (展示 View / 内容 Content / 输出 Output). 展示 comes first because the
// presentation decision (how the tree is drawn) precedes content editing
// (what data to attach): each item swaps the left panel to a
// single-responsibility module so related controls live together:
//
//   展示  样式 style
//   内容  性状 traits · 假说 layers · 协同 recon · 时间 time
//   输出  分析 analysis · 导出 export

import {
  MixerHorizontalIcon,
  BarChartIcon,
  DownloadIcon,
  LayersIcon,
  Component1Icon,
  ClockIcon,
  ShuffleIcon,
} from '@radix-ui/react-icons';
import { S, tr } from './strings';

export type NavModule = 'traits' | 'layers' | 'recon' | 'time' | 'style' | 'analysis' | 'export';

interface RailItem {
  id: NavModule;
  icon: React.ReactNode;
  label: string;
  hint: string;
}

function getGroupContent(): RailItem[] {
  return [
    { id: 'traits', icon: <Component1Icon />, label: S.nav.traits, hint: S.nav.traitsHint },
    { id: 'layers', icon: <LayersIcon />, label: S.nav.layers, hint: S.nav.layersHint },
    { id: 'recon', icon: <ShuffleIcon />, label: S.nav.recon, hint: S.nav.reconHint },
    { id: 'time', icon: <ClockIcon />, label: S.nav.time, hint: S.nav.timeHint },
  ];
}
function getViewGroup(): RailItem[] {
  return [
    { id: 'style', icon: <MixerHorizontalIcon />, label: S.nav.style, hint: S.nav.styleHint },
  ];
}
function getOutGroup(): RailItem[] {
  return [
    { id: 'analysis', icon: <BarChartIcon />, label: S.nav.analysis, hint: S.nav.analysisHint },
    { id: 'export', icon: <DownloadIcon />, label: S.nav.export, hint: S.nav.exportHint },
  ];
}

function RailButton({ item, active, onSelect }: { item: RailItem; active: boolean; onSelect: (m: NavModule) => void }) {
  return (
    <button
      className={`nav-rail-item${active ? ' active' : ''}`}
      onClick={() => onSelect(item.id)}
      aria-label={item.label}
      aria-pressed={active}
      title={item.hint}
    >
      <span className="nav-rail-icon">{item.icon}</span>
      <span className="nav-rail-label">{item.label}</span>
    </button>
  );
}

export function NavigationRail({
  active,
  onSelect,
}: {
  active: NavModule;
  onSelect: (module: NavModule) => void;
}) {
  return (
    <nav className="nav-rail" aria-label={tr('模块导航', 'Module navigation')}>
      <div className="nav-rail-group" role="group" aria-label={S.nav.groupView}>
        <div className="nav-rail-group-label">{S.nav.groupView}</div>
        {getViewGroup().map((item) => (
          <RailButton key={item.id} item={item} active={active === item.id} onSelect={onSelect} />
        ))}
      </div>
      <div className="nav-rail-sep" />
      <div className="nav-rail-group" role="group" aria-label={S.nav.groupContent}>
        <div className="nav-rail-group-label">{S.nav.groupContent}</div>
        {getGroupContent().map((item) => (
          <RailButton key={item.id} item={item} active={active === item.id} onSelect={onSelect} />
        ))}
      </div>
      <div className="nav-rail-sep" />
      <div className="nav-rail-group" role="group" aria-label={S.nav.groupOut}>
        <div className="nav-rail-group-label">{S.nav.groupOut}</div>
        {getOutGroup().map((item) => (
          <RailButton key={item.id} item={item} active={active === item.id} onSelect={onSelect} />
        ))}
      </div>
      <div className="nav-rail-spacer" />
    </nav>
  );
}
