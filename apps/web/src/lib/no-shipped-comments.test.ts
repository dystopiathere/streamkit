import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALERT_KEYFRAMES } from '@streamkit/ui';
import { describe, expect, it } from 'vitest';

/**
 * В клиентский прод комментарии не уходят.
 *
 * JS и CSS минификатор чистит сам, а HTML-комментарии в `index.html` и
 * комментарии внутри строк сборщик считает данными и отдаёт каждому
 * посетителю как есть. Пояснения к разметке — в CLAUDE.md и DESIGN.md
 * приложений. Все три приложения здесь: у каждого свой index.html, а правило одно.
 */
// От каталога пакета: vitest запускается в apps/web, а `import.meta.url` в
// окружении jsdom указывает не на файл на диске.
const html = (app: string): string =>
  readFileSync(resolve(process.cwd(), '..', app, 'index.html'), 'utf8');

describe('комментарии не уходят в сборку', () => {
  it.each(['web', 'admin', 'overlay'])('index.html приложения %s — без комментариев', (app) => {
    const source = html(app);
    expect(source).not.toContain('<!--');
    expect(source).not.toContain('/*');
  });

  it('keyframes строкой — без комментариев CSS', () => {
    expect(ALERT_KEYFRAMES).not.toContain('/*');
  });
});
