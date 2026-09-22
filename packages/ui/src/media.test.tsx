import { type AlertEvent, defaultAlertWidgetConfig } from '@streamkit/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlertCard } from './AlertCard';
import { isVideoUrl } from './media';
import { WidgetBackgroundLayer } from './slots';

const event = (): AlertEvent =>
  ({
    id: 'e1',
    type: 'donation',
    username: 'Зритель',
    message: '',
    amount: null,
    count: null,
    isTest: true,
    createdAt: new Date().toISOString(),
  }) as unknown as AlertEvent;

describe('картинка или видео по ссылке', () => {
  it('WebM узнаётся по пути, а не по концу строки', () => {
    expect(isVideoUrl('https://cdn.example/alert.webm')).toBe(true);
    expect(isVideoUrl('https://cdn.example/alert.WEBM?v=2#t')).toBe(true);
    expect(isVideoUrl('https://cdn.example/alert.gif')).toBe(false);
    expect(isVideoUrl('https://cdn.example/webm/alert.png')).toBe(false);
    expect(isVideoUrl('не ссылка')).toBe(false);
  });

  it('картинка оповещения .webm — беззвучное видео по кругу', () => {
    // Со звуком браузер без действия пользователя видео не запустит — в OBS
    // оно молча не играло бы. Звук у оповещения свой.
    const config = {
      ...defaultAlertWidgetConfig().scenarios.donation,
      imageUrl: 'https://cdn.example/alert.webm',
    };
    const { container } = render(<AlertCard event={event()} config={config} animate={false} />);

    const video = container.querySelector('video')!;
    expect(video).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.dataset.slot).toBe('image');
  });

  it('фон «Заполнить» — во весь слой, видео тоже', () => {
    render(
      <WidgetBackgroundLayer
        background={{
          color: null,
          imageUrl: 'https://cdn.example/bg.webm',
          fit: 'tile',
          opacity: 1,
          cornerRadius: 0,
        }}
      />,
    );
    const video = screen.getByTestId('widget-background').querySelector('video')!;
    // Плиткой видео не размножить — оно заполняет слой.
    expect(video.style.objectFit).toBe('cover');
    expect(video.style.position).toBe('absolute');
    expect(video.style.width).toBe('100%');
    expect(video.style.height).toBe('100%');
  });

  it('звук из видео: по кругу, со звуком только в оверлее и до конца показа', () => {
    const played: HTMLMediaElement[] = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      played.push(this);
      return Promise.resolve();
    };
    try {
      const config = {
        ...defaultAlertWidgetConfig().scenarios.donation,
        imageUrl: 'https://cdn.example/alert.webm',
        sound: { enabled: true, source: 'video' as const, url: null, volume: 0.4 },
      };
      const { container, rerender } = render(
        <AlertCard event={event()} config={config} animate={false} playSound />,
      );
      const video = container.querySelector('video')!;
      // Время показа задаёт сценарий: короткий ролик повторяется до конца показа.
      expect(video.loop).toBe(true);
      expect(video.muted).toBe(false);
      expect(video.volume).toBeCloseTo(0.4);
      expect(played).toContain(video);

      // Показ кончился (оповещение уходит) — звук глушится сразу.
      rerender(<AlertCard event={event()} config={config} animate={false} />);
      expect(container.querySelector('video')!.muted).toBe(true);
    } finally {
      HTMLMediaElement.prototype.play = play;
    }
  });
});
