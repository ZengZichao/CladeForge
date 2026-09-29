// 中 / EN segmented language control for the toolbar, styled after
// ThemeToggle. Switching remounts the app with the new locale.

import { changeLanguage, useLanguage } from './i18n';
import { S } from './strings';

export function LanguageToggle() {
  const lang = useLanguage();
  return (
    <div className="theme-toggle lang-toggle" role="group" aria-label={S.lang.label}>
      <button
        className={`theme-toggle-btn${lang === 'zh' ? ' active' : ''}`}
        onClick={() => changeLanguage('zh')}
        aria-pressed={lang === 'zh'}
        title={S.lang.toggleTitle}
      >
        中
      </button>
      <button
        className={`theme-toggle-btn${lang === 'en' ? ' active' : ''}`}
        onClick={() => changeLanguage('en')}
        aria-pressed={lang === 'en'}
        title={S.lang.toggleTitle}
      >
        EN
      </button>
    </div>
  );
}
