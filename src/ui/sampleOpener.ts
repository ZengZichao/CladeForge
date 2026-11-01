// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Shared "open a sample project" entry point.
//
// Every sample entry — the empty-canvas card grid, the reconciliation empty
// state, the command palette — funnels through this one function so their
// behaviour cannot drift apart. `openInNewTab` resets `reconMode` (fresh
// documents start in the standard workspace), so a `recon` sample must set the
// active gene tree + mode AFTER the tab opens: one click then lands directly in
// the reconciliation workspace with its first gene tree active.

import { useStore } from '../model/store';
import type { SampleDescriptor } from '../model/sampleTree';

export function openSample(descriptor: SampleDescriptor): void {
  const project = descriptor.build();
  useStore.getState().openInNewTab(project);
  if (descriptor.entryView === 'recon' && project.geneTrees?.length) {
    useStore.getState().enterReconWorkspace();
  }
}
