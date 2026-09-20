import { isLanguage } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@streamkit/app-kit';
import { setLanguage } from '@/lib/locale';

/**
 * Переключатель языка: одна кнопка целой фразой на языке, на который она
 * переключает, — «Версия сайта на английском» в русском интерфейсе, «Russian
 * version» в английском. Языков два, и список из двух пунктов был бы лишним
 * щелчком.
 *
 * Фразой, а не словом «English»: коротким словом в шапке дашборда он стоял
 * посреди названий разделов, и понять, раздел это, действие или название
 * чего-то, было нельзя. Место кнопки — подвал.
 *
 * `lang` у подписи — чтобы скринридер прочитал английскую фразу
 * по-английски, а не русской фонетикой.
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
      className={cn('text-left hover:text-fg', className)}
    >
      {t('language.switchSite')}
    </button>
  );
}
