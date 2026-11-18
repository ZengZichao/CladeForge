// GUI-B BUG-08: clicking a sample card on an untouched blank tab opened ANOTHER
// tab and left the blank one behind, so exploratory clicks accumulated
// "Untitled / Untitled 2 / Untitled 3…". A blank document has nothing to lose;
// the sample loads into it (like the library's 「替换当前文档」).

import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { openSample } from './sampleOpener';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';
import { SAMPLE_PROJECTS } from '../model/sampleTree';

const featureTour = SAMPLE_PROJECTS.find((s) => s.id === 'feature-tour')!;
const largeTree = SAMPLE_PROJECTS.find((s) => s.id === 'large-tree')!;

afterEach(() => {
  useStore.getState().loadProject(createEmptyProject('Untitled'));
});

describe('openSample — blank-tab reuse (BUG-08)', () => {
  it('loads the sample into a fresh blank tab instead of adding a second tab', () => {
    act(() => useStore.getState().loadProject(createEmptyProject('Untitled')));
    const before = useStore.getState().tabs.length;
    openSample(featureTour);
    const st = useStore.getState();
    expect(st.tabs.length).toBe(before);
    expect(st.project.name).toBe(featureTour.build().name);
    expect(st.reconMode).toBe(false);
  });

  it('still opens a new tab when the current document carries work', () => {
    act(() => useStore.getState().loadProject(createEmptyProject('Untitled')));
    // Any edit creates an undo step — the document is no longer disposable.
    act(() => {
      useStore.getState().apply((d) => {
        d.nodes[d.rootId].label = 'My root';
      });
    });
    const before = useStore.getState().tabs.length;
    openSample(largeTree);
    expect(useStore.getState().tabs.length).toBe(before + 1);
  });
});
