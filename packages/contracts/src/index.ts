/**
 * @streamkit/contracts — единственный источник правды для данных, которые
 * пересекают границу между приложениями.
 *
 * Каждая схема используется минимум дважды: валидация на бэкенде, типы и формы
 * на фронте, рендер в overlay. Если структура данных живёт только внутри одного
 * приложения — ей здесь не место.
 */
export * from './common.js';
export * from './analytics.js';
export * from './events.js';
export * from './chat.js';
export * from './rooms.js';
export * from './widgets.js';
export * from './auth.js';
export * from './billing.js';
export * from './admin.js';
export * from './site-stats.js';
export * from './realtime.js';
