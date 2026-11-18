// A#5 / GUI reports: toasts used to linger for tens of seconds and pile up, so
// a later command's own result could hide behind earlier ones. These tests pin
// the bounded stack and the dedupe rule.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToasts } from './toast';

describe('toast stack', () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
  });

  it('never grows past three entries — the newest messages survive', () => {
    for (let i = 0; i < 6; i += 1) {
      useToasts.getState().push('info', `m${i}`, undefined, 0);
    }
    const messages = useToasts.getState().toasts.map((t) => t.message);
    expect(messages).toEqual(['m3', 'm4', 'm5']);
  });

  it('keeps distinct error messages apart instead of merging them away', () => {
    useToasts.getState().push('error', 'first failure', undefined, 0);
    useToasts.getState().push('error', 'second failure', undefined, 0);
    const errors = useToasts.getState().toasts.filter((t) => t.kind === 'error');
    expect(errors.map((t) => t.message)).toEqual(['first failure', 'second failure']);
  });

  it('drops an exact duplicate (same kind + same message)', () => {
    useToasts.getState().push('success', '已保存', undefined, 0);
    useToasts.getState().push('success', '已保存', undefined, 0);
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it('auto-dismisses an error inside the 3–6s window (GUI-C DEF-5)', () => {
    vi.useFakeTimers();
    try {
      useToasts.getState().push('error', 'boom');
      expect(useToasts.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(5999);
      expect(useToasts.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(useToasts.getState().toasts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
