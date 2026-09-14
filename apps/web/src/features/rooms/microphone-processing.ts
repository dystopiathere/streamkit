import { AudioPresets, type AudioCaptureOptions, type TrackPublishOptions } from 'livekit-client';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';

/**
 * Обработка голоса на микрофоне участника комнаты.
 *
 * Браузер по умолчанию готовит звук под созвон с ноутбука: давит шум, вырезает
 * эхо колонок и выравнивает громкость. Для встроенного микрофона это спасение, а
 * хорошему микрофону в тихой комнате вредит: шумоподавление съедает дыхание и
 * хвосты согласных, автоусиление «качает» громкость между фразами, а сжатие
 * тишины (DTX) обрезает тихие начала слов. Поэтому степень обработки выбирает
 * сам человек — у него на столе микрофон, а не у нас.
 *
 * Настройка живёт в браузере, а не на сервере: она описывает микрофон на этом
 * компьютере, и у гостя нет аккаунта, где её хранить.
 */
export const microphoneProcessingSchema = z.object({
  noiseSuppression: z.boolean(),
  echoCancellation: z.boolean(),
  autoGainControl: z.boolean(),
  /** 96 кбит/с и передача тишины как есть, без DTX. */
  highQuality: z.boolean(),
});
export type MicrophoneProcessing = z.infer<typeof microphoneProcessingSchema>;

export const MICROPHONE_PRESETS = {
  /** Встроенный микрофон, гарнитура, колонки: всё, что умеет браузер. */
  full: {
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    highQuality: false,
  },
  /** Хороший микрофон без наушников: убираем только эхо колонок, голос не трогаем. */
  light: {
    noiseSuppression: false,
    echoCancellation: true,
    autoGainControl: false,
    highQuality: true,
  },
  /** Студийный микрофон и наушники: звук как есть. */
  off: {
    noiseSuppression: false,
    echoCancellation: false,
    autoGainControl: false,
    highQuality: true,
  },
} as const satisfies Record<string, MicrophoneProcessing>;
export type MicrophonePreset = keyof typeof MICROPHONE_PRESETS;

export const DEFAULT_MICROPHONE_PROCESSING: MicrophoneProcessing = MICROPHONE_PRESETS.full;

/** Пресет, которому соответствуют настройки, или `custom`, если ни одному. */
export function presetOf(processing: MicrophoneProcessing): MicrophonePreset | 'custom' {
  const keys = Object.keys(MICROPHONE_PRESETS) as MicrophonePreset[];
  return (
    keys.find((key) =>
      (Object.keys(processing) as Array<keyof MicrophoneProcessing>).every(
        (field) => MICROPHONE_PRESETS[key][field] === processing[field],
      ),
    ) ?? 'custom'
  );
}

/**
 * Параметры захвата для livekit-client.
 *
 * Все флаги передаются явно: livekit-client досыпает непереданные из своих
 * значений по умолчанию, а там всё включено. И `voiceIsolation` выключается
 * вместе с шумоподавлением: это его усиленная версия, и там, где браузер её
 * поддерживает, она ПЕРЕКРЫВАЕТ `noiseSuppression: false` — шумоподавление
 * «выключалось» бы только в интерфейсе.
 */
export function microphoneCaptureOptions(
  processing: MicrophoneProcessing,
  deviceId?: string,
): AudioCaptureOptions {
  return {
    // «default» — псевдоним, а не идентификатор устройства: с `exact` он даёт
    // OverconstrainedError (та же грабля, что у камеры).
    ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
    noiseSuppression: processing.noiseSuppression,
    voiceIsolation: processing.noiseSuppression,
    echoCancellation: processing.echoCancellation,
    autoGainControl: processing.autoGainControl,
  };
}

/**
 * Параметры публикации. Меняются только повторной публикацией дорожки: DTX
 * согласуется в SDP, на лету его не переключить.
 */
export function microphonePublishOptions(processing: MicrophoneProcessing): TrackPublishOptions {
  return processing.highQuality
    ? { audioPreset: AudioPresets.musicHighQuality, dtx: false }
    : { audioPreset: AudioPresets.music, dtx: true };
}

const STORAGE_KEY = 'streamkit.microphone-processing';
const listeners = new Set<() => void>();

// Прочитанное или выбранное значение держится в памяти: `useSyncExternalStore`
// сравнивает снимки по ссылке, и новый объект на каждое чтение зациклил бы
// рендер. Заодно выбор действует до перезагрузки вкладки, даже если хранилище
// закрыто (приватный режим, запрет сайта).
let current: MicrophoneProcessing | null = null;

export function readMicrophoneProcessing(): MicrophoneProcessing {
  if (current) return current;
  let parsed: unknown;
  try {
    parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    parsed = null;
  }
  // Значение из хранилища не доверенное: его могла оставить старая версия.
  const result = microphoneProcessingSchema.safeParse(parsed);
  current = result.success ? result.data : DEFAULT_MICROPHONE_PROCESSING;
  return current;
}

export function writeMicrophoneProcessing(value: MicrophoneProcessing): void {
  current = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Не сохранилось — применится до перезагрузки вкладки, этого достаточно.
  }
  for (const listener of listeners) listener();
}

/** Для тестов: забыть прочитанное и перечитать хранилище. */
export function resetMicrophoneProcessingCache(): void {
  current = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMicrophoneProcessing(): MicrophoneProcessing {
  return useSyncExternalStore(
    subscribe,
    readMicrophoneProcessing,
    () => DEFAULT_MICROPHONE_PROCESSING,
  );
}
