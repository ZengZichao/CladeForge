// Full-screen busy veil shown while a long async operation (e.g. PDF export of
// a large tree) is in flight. Mounted once in App; reads the shared busy store
// so non-React code (fileActions) can trigger it imperatively.

import { useBusy } from './busy';

export function BusyOverlay() {
  const message = useBusy((s) => s.message);
  if (!message) return null;
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-badge">
        <span className="busy-spinner" aria-hidden="true" />
        {message}
      </div>
    </div>
  );
}
