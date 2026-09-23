import { beforeEach, describe, expect, it } from 'vitest';
import { isMirrored, mirrorAttribute } from '@streamkit/contracts';
import { readMirrorCamera, resetMirrorCameraCache, writeMirrorCamera } from './mirror';

/**
 * Выбор зеркала. Хранится в браузере, а остальным уходит атрибутом участника:
 * важно, что по умолчанию его нет — в кадр идёт то, что снимает камера, пока
 * человек сам не решил иначе.
 */
describe('зеркало камеры', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMirrorCameraCache();
  });

  it('по умолчанию выключено', () => {
    expect(readMirrorCamera()).toBe(false);
    expect(isMirrored(mirrorAttribute(readMirrorCamera()))).toBe(false);
  });

  it('выбор переживает перезагрузку вкладки', () => {
    writeMirrorCamera(true);
    resetMirrorCameraCache();
    expect(readMirrorCamera()).toBe(true);
    expect(isMirrored(mirrorAttribute(readMirrorCamera()))).toBe(true);
  });

  it('мусор в хранилище читается как «без зеркала», а не роняет комнату', () => {
    window.localStorage.setItem('streamkit.mirror-camera', 'да');
    expect(readMirrorCamera()).toBe(false);
  });

  it('участник без атрибута — не зеркальный: так выглядят все, кто вошёл раньше', () => {
    expect(isMirrored(undefined)).toBe(false);
    expect(isMirrored({})).toBe(false);
  });
});
