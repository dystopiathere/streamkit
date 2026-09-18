import { isLanguage } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@streamkit/app-kit';
import { setLanguage } from '@/lib/locale';

/**
 * Переключатель языка: одна кнопка с названием другого языка на нём самом —
 * «English» в русском интерфейсе, «Русский» в английском. Языков два, и
 * список из двух пунктов был бы лишним щелчком.
 *
 * `lang` у подписи — чтобы скринридер прочитал «English» по-английски, а не
 * русской фонетикой.
 */
export function LanguageSwitch({ className }: { className?: string }): React.JSX.Element {
  const { t } = useTranslation();
  const target = t('language.switchLang');

  return (
    <button
      type="button"
      lang={target}
      title={t('language.label')}
      onClick={() => {
        if (isLanguage(target)) setLanguage(target);
      }}
      className={cn('hover:text-fg', className)}
    >
      {t('language.switch')}
    </button>
  );
}
