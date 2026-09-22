import { type AlertEvent, defaultAlertWidgetConfig } from '@streamkit/contracts';
import { AlertAnimationStyles, AlertCard } from '@streamkit/ui';
import { useTranslation } from 'react-i18next';

/** Полосы в порядке настоящей таблицы: белый, жёлтый, голубой, зелёный, пурпурный, красный, синий. */
const BARS = ['#eeeae2', '#f5d336', '#2ea3b4', '#40a85a', '#d0509c', '#e0473d', '#6b84ea'];
/** Ступени серой шкалы — от чёрного к белому, как нижний ряд таблицы. */
const STEPS = [
  '#0d0d0c',
  '#262523',
  '#403f3b',
  '#5c5a55',
  '#7a7872',
  '#9b9891',
  '#c2bfb7',
  '#eeeae2',
];

const SCENARIO = (() => {
  const donation = defaultAlertWidgetConfig().scenarios.donation;
  // Выделение имени и суммы — тёплым белым, а не фиолетовым по умолчанию
  // рендерера: в этом мире цвет живёт только в полосах таблицы.
  return {
    ...donation,
    text: { ...donation.text, fontSize: 26, strokeWidth: 3, highlightColor: '#EEEAE2' },
  };
})();

/**
 * Испытательная таблица, в центре которой — настоящее оповещение.
 *
 * Тезис главной одним кадром: StreamKit — то, чем эфир настраивают до выхода,
 * и то, что потом стоит в кадре. Полосы и серая шкала — рисунок таблицы, а
 * оповещение в круге рисует тот же рендерер, что оверлей в OBS, а не картинка.
 * Пример подписан как пример: донатов, которых не было, мы не показываем.
 */
export function TestCard(): React.JSX.Element {
  const { t } = useTranslation();
  const event: Pick<AlertEvent, 'type' | 'username' | 'message' | 'amount' | 'count'> = {
    type: 'donation',
    username: t('public.hero.sampleUser'),
    message: t('public.hero.sampleMessage'),
    amount: { amountMinor: 50_000, currency: 'RUB' },
    count: null,
  };

  return (
    <figure className="space-y-2">
      <div
        className="test-card relative aspect-video w-full overflow-hidden rounded-card border border-border-strong bg-bg"
        aria-hidden="true"
      >
        <div className="test-card-bars absolute inset-x-0 top-0 flex h-[64%]">
          {BARS.map((color) => (
            <div key={color} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 grid h-[36%] grid-cols-8">
          {STEPS.map((color) => (
            <div key={color} style={{ backgroundColor: color }} />
          ))}
        </div>

        {/* Круг и крест — центр кадра. Под оповещением подложка цвета фона:
            на полосах текст с обводкой читался бы, но пример должен выглядеть
            так, как стример увидит его поверх своей игры, а не поверх таблицы. */}
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-fg/35" />
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-fg/35" />
        <div className="absolute top-1/2 left-1/2 aspect-square h-[78%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-fg/80 bg-bg/90 shadow-[0_12px_40px_rgb(0_0_0/0.45)]" />

        {/* Оповещение рисуется в своём размере и масштабируется вместе с
            таблицей: рендерер задаёт шрифт в пикселях, и на телефоне заголовок
            иначе ломался бы на три строки и вылезал из круга. */}
        <div className="test-card-alert absolute top-1/2 left-1/2">
          <AlertAnimationStyles />
          <AlertCard event={event} config={SCENARIO} />
        </div>
      </div>
      <figcaption className="text-xs text-muted">{t('public.hero.sampleCaption')}</figcaption>
    </figure>
  );
}
