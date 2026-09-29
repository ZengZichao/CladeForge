import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './model/store';
import { initTheme } from './ui/theme';
import './styles/app.css';

// Apply the stored / OS theme before first paint so the chrome never flashes.
// Wrapped: this runs at module scope, so a throwing localStorage — private mode,
// storage disabled, quota full — would abort the whole entry point and leave a
// white window with no error screen. initTheme() guards its own storage access;
// this belt keeps any surprise from taking the app down with it.
try {
  initTheme();
} catch (e) {
  console.warn('Theme initialisation skipped:', e);
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Dev-only handle so headless smoke tests can drive the store directly.
const isDev = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
if (isDev) {
  (window as unknown as Record<string, unknown>).__cladeforge = { useStore };
}
