// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Left navigation rail: module switcher organised as three labelled groups
// (内容 Content / 推理 Inference / 输出 Output). Analysis is an INPUT-side
// cognitive activity, not an output — it used to sit in the 输出 group, which
// is where a user looking for "consistency check" would never think to click.
// The single-member 展示 group is gone: a group with one button is not a
// group, so 样式 closes the rail as part of 内容's trailing edge:
//
//   内容  性状 traits · 假说 layers · 时间 time · 样式 style
//   推理  分析 analysis
//   输出  导出 export

import {
  MixerHorizontalIcon,
  BarChartIcon,
  DownloadIcon,
  LayersIcon,
  Component1Icon,
  ClockIcon,
} from '@radix-ui/react-icons';
import { S, tr } from './strings';

export type NavModule = 'traits' | 'layers' | 'time' | 'style' | 'analysis' | 'export';

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
    { id: 'time', icon: <ClockIcon />, label: S.nav.time, hint: S.nav.timeHint },
    { id: 'style', icon: <MixerHorizontalIcon />, label: S.nav.style, hint: S.nav.styleHint },
  ];
}
function getInferenceGroup(): RailItem[] {
  return [
    { id: 'analysis', icon: <BarChartIcon />, label: S.nav.analysis, hint: S.nav.analysisHint },
  ];
}
function getOutGroup(): RailItem[] {
  return [
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
      data-nav={item.id}
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
      <div className="nav-rail-group" role="group" aria-label={S.nav.groupContent}>
        <div className="nav-rail-group-label">{S.nav.groupContent}</div>
        {getGroupContent().map((item) => (
          <RailButton key={item.id} item={item} active={active === item.id} onSelect={onSelect} />
        ))}
      </div>
      <div className="nav-rail-sep" />
      <div className="nav-rail-group" role="group" aria-label={S.nav.groupInference}>
        <div className="nav-rail-group-label">{S.nav.groupInference}</div>
        {getInferenceGroup().map((item) => (
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
