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
import { documentHasTree } from './documentContent';
import type { SampleDescriptor } from '../model/sampleTree';

export function openSample(descriptor: SampleDescriptor): void {
  const project = descriptor.build();
  const st = useStore.getState();
  // GUI-B BUG-08: clicking a sample card on an UNTOUCHED blank tab used to open
  // yet another tab and leave the blank one behind, so a couple of exploratory
  // clicks accumulated "Untitled / Untitled 2 / Untitled 3…". A blank document
  // has nothing to lose, so load into the current tab, exactly like the sample
  // library's 「替换当前文档」 path. "Untouched" is CONTENT-based (no tree,
  // edges, characters, events, calibrations or gene trees, and no applied
  // edit): undo history is not usable here because loading a document always
  // leaves one entry pointing at the outgoing document.
  const blank =
    !documentHasTree(st.project) &&
    st.project.customEdges.length === 0 &&
    st.project.characters.length === 0 &&
    st.project.environmentalEvents.length === 0 &&
    st.project.calibrationPoints.length === 0 &&
    (st.project.geneTrees?.length ?? 0) === 0 &&
    st.revision === 0;
  if (blank) st.loadProject(project);
  else st.openInNewTab(project);
  if (descriptor.entryView === 'recon' && project.geneTrees?.length) {
    useStore.getState().enterReconWorkspace();
  }
}
