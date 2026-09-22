/**
 * Длина голосового доната в секундах — до показа оповещения.
 *
 * Спрашивается заранее, потому что время показа задаётся один раз, при выходе
 * оповещения в кадр: карточка, которая появилась на секунды сценария, а потом
 * «передумала» и осталась висеть, выглядит зависшей.
 *
 * `null` — длину узнать не удалось: запись не открылась, отдаётся потоком без
 * длительности или отвечает слишком долго. Тогда оповещение показывается по
 * сценарию, а голос всё равно играет и обрывается вместе с уходом карточки:
 * ждать неизвестно чего в прямом эфире нельзя.
 */
export async function probeAudioSeconds(url: string, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    let done = false;

    const finish = (seconds: number | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      audio.removeAttribute('src');
      resolve(seconds);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () =>
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null),
    );
    audio.addEventListener('error', () => finish(null));
    audio.src = url;
  });
}
