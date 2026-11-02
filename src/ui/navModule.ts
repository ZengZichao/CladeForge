// Persisted standard-workspace navigation module.
//
// `recon` is NOT a standard module: it is a workspace mode. If it were restored
// as the active module on the next mount, `LeftPanelContent` would immediately
// call `enterReconWorkspace()` again — which is why leaving reconciliation used
// to bounce straight back into it. Treat a stale `recon` as the default module.

import type { NavModule } from './NavigationRail';

export const LS_NAV_MODULE = 'cladeforge:navModule';

const STANDARD_MODULES: readonly NavModule[] = [
  'traits',
  'layers',
  'time',
  'style',
  'analysis',
  'export',
];

export function readNavModule(): NavModule {
  try {
    const v = localStorage.getItem(LS_NAV_MODULE);
    if (v && (STANDARD_MODULES as readonly string[]).includes(v)) return v as NavModule;
    // `hypothesis` is an accepted alias for the layers module, so a stored key
    // carrying it opens layers rather than falling back to the default.
    if (v === 'hypothesis') return 'layers';
  } catch {
    /* ignore */
  }
  return 'traits';
}
