// 中 / EN segmented language control for the toolbar, styled after
// ThemeToggle. Switching remounts the app with the new locale.

import { changeLanguage, useLanguage } from './i18n';
import { S, tr } from './strings';
import { requestConfirm } from './confirmDialog';

export function LanguageToggle() {
  const lang = useLanguage();
  // A-11: switching remounts the whole UI tree, so an open form (e.g. the gene
  // tree builder) resets. The reload is stated once, with the standard
  // "don't ask again" opt-out, instead of surprising the user mid-typing.
  const switchTo = (next: 'zh' | 'en') => {
    if (next === lang) return;
    requestConfirm({
      key: 'language-switch-reload',
      title: S.lang.toggleTitle,
      message: tr(
        '切换语言会重载整个界面：正在填写的表单会被重置。未保存的文档修改与自动保存不受影响。',
        'Switching the language reloads the interface: forms you are filling in are reset. Unsaved document changes and autosave are unaffected.',
      ),
      confirmLabel: tr('切换语言', 'Switch language'),
      onConfirm: () => changeLanguage(next),
    });
  };
  return (
    <div className="theme-toggle lang-toggle" role="group" aria-label={S.lang.label}>
      <button
        className={`theme-toggle-btn${lang === 'zh' ? ' active' : ''}`}
        onClick={() => switchTo('zh')}
        aria-pressed={lang === 'zh'}
        title={S.lang.toggleTitle}
      >
        中
      </button>
      <button
        className={`theme-toggle-btn${lang === 'en' ? ' active' : ''}`}
        onClick={() => switchTo('en')}
        aria-pressed={lang === 'en'}
        title={S.lang.toggleTitle}
      >
        EN
      </button>
    </div>
  );
}
