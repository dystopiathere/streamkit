import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MICROPHONE_PRESETS,
  type MicrophonePreset,
  type MicrophoneProcessing,
  presetOf,
  useMicrophoneProcessing,
  writeMicrophoneProcessing,
} from './microphone-processing';

const PRESETS = Object.keys(MICROPHONE_PRESETS) as MicrophonePreset[];
const FIELDS: Array<keyof MicrophoneProcessing> = [
  'noiseSuppression',
  'echoCancellation',
  'autoGainControl',
  'highQuality',
];

/**
 * Степень обработки голоса: три готовых уровня и отдельные флажки под ними.
 *
 * Уровни — для тех, кто не знает, что такое AGC, флажки — для тех, кто знает.
 * Изменение флажка, не совпадающее ни с одним уровнем, показывается как «Своя»,
 * а не сбрасывает выбор молча. Настройка общая для всех комнат в этом браузере и
 * в комнате применяется сразу (`useMicrophone`).
 */
export function MicrophoneSettings(): React.JSX.Element {
  const { t } = useTranslation();
  const id = useId();
  const processing = useMicrophoneProcessing();
  const preset = presetOf(processing);

  return (
    // Контейнерный запрос, а не брейкпоинт окна: на странице гостя панель живёт в
    // узкой колонке рядом с превью, в комнате — во всю ширину.
    <div className="@container">
      <fieldset className="space-y-4">
        <legend className="sr-only">{t('rooms.microphone.title')}</legend>

        <div className="grid gap-2 @2xl:grid-cols-3">
          {PRESETS.map((key) => (
            <label
              key={key}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm has-[:checked]:border-accent"
            >
              <input
                type="radio"
                name={`${id}-preset`}
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={preset === key}
                onChange={() => writeMicrophoneProcessing(MICROPHONE_PRESETS[key])}
              />
              <span>
                {t(`rooms.microphone.presets.${key}.label`)}
                <span className="mt-1 block text-xs text-muted">
                  {t(`rooms.microphone.presets.${key}.hint`)}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="space-y-2">
          {FIELDS.map((field) => (
            <label key={field} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={processing[field]}
                onChange={(event) =>
                  writeMicrophoneProcessing({ ...processing, [field]: event.target.checked })
                }
              />
              <span>
                {t(`rooms.microphone.fields.${field}.label`)}
                <span className="block text-xs text-muted">
                  {t(`rooms.microphone.fields.${field}.hint`)}
                </span>
              </span>
            </label>
          ))}
        </div>

        {preset === 'custom' ? (
          <p className="text-xs text-muted">{t('rooms.microphone.custom')}</p>
        ) : null}

        {/* Без эхоподавления звук комнаты из колонок возвращается собеседникам
          их же голосом с задержкой — сам говорящий этого не слышит и не узнает. */}
        {!processing.echoCancellation ? (
          <p role="note" className="rounded-lg border border-border bg-bg p-3 text-xs">
            {t('rooms.microphone.headphones')}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
