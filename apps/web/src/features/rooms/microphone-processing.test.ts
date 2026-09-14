import { AudioPresets } from 'livekit-client';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MICROPHONE_PROCESSING,
  MICROPHONE_PRESETS,
  microphoneCaptureOptions,
  microphonePublishOptions,
  presetOf,
  readMicrophoneProcessing,
  resetMicrophoneProcessingCache,
  writeMicrophoneProcessing,
} from './microphone-processing';

describe('обработка голоса на микрофоне', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMicrophoneProcessingCache();
  });

  it('выключенное шумоподавление выключает и изоляцию голоса', () => {
    // Изоляция — усиленное шумоподавление, и там, где браузер её поддерживает,
    // она перекрывает `noiseSuppression: false`. Без этого флажок в интерфейсе
    // снимался бы, а голос продолжал бы проходить через фильтр.
    const options = microphoneCaptureOptions(MICROPHONE_PRESETS.off);
    expect(options).toMatchObject({
      noiseSuppression: false,
      voiceIsolation: false,
      echoCancellation: false,
      autoGainControl: false,
    });
  });

  it('все флаги передаются явно — иначе livekit-client досыпет включённые', () => {
    const options = microphoneCaptureOptions(MICROPHONE_PRESETS.light);
    for (const key of [
      'noiseSuppression',
      'voiceIsolation',
      'echoCancellation',
      'autoGainControl',
    ]) {
      expect(options).toHaveProperty(key);
    }
  });

  it('псевдоним «default» не становится точным идентификатором устройства', () => {
    expect(microphoneCaptureOptions(DEFAULT_MICROPHONE_PROCESSING, 'default')).not.toHaveProperty(
      'deviceId',
    );
    expect(microphoneCaptureOptions(DEFAULT_MICROPHONE_PROCESSING, 'abc').deviceId).toEqual({
      exact: 'abc',
    });
  });

  it('высокое качество — повышенный битрейт и без сжатия тишины', () => {
    expect(microphonePublishOptions(MICROPHONE_PRESETS.off)).toEqual({
      audioPreset: AudioPresets.musicHighQuality,
      dtx: false,
    });
    expect(microphonePublishOptions(MICROPHONE_PRESETS.full)).toMatchObject({ dtx: true });
  });

  it('узнаёт уровень по флажкам, а несовпадение называет своей настройкой', () => {
    expect(presetOf({ ...MICROPHONE_PRESETS.light })).toBe('light');
    expect(presetOf({ ...MICROPHONE_PRESETS.full, autoGainControl: false })).toBe('custom');
  });

  it('по умолчанию — полная обработка, как у браузера', () => {
    expect(readMicrophoneProcessing()).toEqual(MICROPHONE_PRESETS.full);
  });

  it('выбор переживает перезагрузку вкладки', () => {
    writeMicrophoneProcessing(MICROPHONE_PRESETS.off);
    resetMicrophoneProcessingCache();
    expect(readMicrophoneProcessing()).toEqual(MICROPHONE_PRESETS.off);
  });

  it('испорченное значение в хранилище даёт настройки по умолчанию, а не падение', () => {
    window.localStorage.setItem('streamkit.microphone-processing', '{"noiseSuppression":"да"');
    expect(readMicrophoneProcessing()).toEqual(DEFAULT_MICROPHONE_PROCESSING);
    resetMicrophoneProcessingCache();
    window.localStorage.setItem('streamkit.microphone-processing', '{"noiseSuppression":"да"}');
    expect(readMicrophoneProcessing()).toEqual(DEFAULT_MICROPHONE_PROCESSING);
  });

  it('снимок стабилен между чтениями — иначе useSyncExternalStore зациклит рендер', () => {
    expect(readMicrophoneProcessing()).toBe(readMicrophoneProcessing());
  });
});
