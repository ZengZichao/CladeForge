// Light / dark / system segmented theme control for the toolbar. Reflects the
// active preference and updates live when the OS preference changes (while the
// preference is "system"). See ui/theme.ts for the persistence rules.

import { useEffect, useState } from 'react';
import { SunIcon, MoonIcon, LaptopIcon } from '@radix-ui/react-icons';
import { currentTheme, setTheme, storedTheme, type Theme } from './theme';
import { S } from './strings';

export function ThemeToggle() {
  const [pref, setPref] = useState<Theme>(storedTheme);

  // Track OS changes so the "system" option's resolved value stays in sync
  // with the operating system even without an explicit reload.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      setPref(storedTheme());
      void currentTheme();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const segments: { value: Theme; icon: React.ReactNode; label: string }[] = [
    { value: 'light', icon: <SunIcon />, label: S.theme.light },
    { value: 'dark', icon: <MoonIcon />, label: S.theme.dark },
    { value: 'system', icon: <LaptopIcon />, label: S.theme.system },
  ];

  return (
    <div className="theme-toggle" role="group" aria-label={S.theme.label}>
      {segments.map((seg) => (
        <button
          key={seg.value}
          className={`theme-toggle-btn${pref === seg.value ? ' active' : ''}`}
          title={seg.label}
          aria-label={seg.label}
          aria-pressed={pref === seg.value}
          onClick={() => {
            setTheme(seg.value);
            setPref(seg.value);
          }}
        >
          {seg.icon}
        </button>
      ))}
    </div>
  );
}
