import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Подтвердить почту без письма — скриптом `verify-email` из сборки API.
 *
 * Почты в сквозном прогоне нет, а без подтверждения закрыта оплата тарифа.
 * Скрипт ходит в ту же базу, что и поднятый API (`DATABASE_URL` из окружения
 * прогона или `.env` в корне), — так же, как владелец подтвердил бы себя на
 * свежем сервере.
 */
export function confirmEmail(email: string): void {
  execFileSync('node', ['dist/scripts/verify-email.js', email], {
    // Прогон запускается из каталога e2e (`pnpm --filter @streamkit/e2e test:e2e`).
    cwd: resolve(process.cwd(), '../apps/api'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
