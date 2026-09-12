import { describe, expect, it } from 'vitest';
import { configUpdatedMessageSchema, overlayBootstrapSchema, SOCKET_EVENTS } from './realtime.js';
import { goalWidgetConfigSchema } from './widgets.js';

const WIDGET_ID = '11111111-1111-4111-8111-111111111111';
const config = goalWidgetConfigSchema.parse({});

/**
 * Регрессия на баг, который прожил целый этап незамеченным.
 *
 * Bootstrap и «настройки изменились» ехали ОДНИМ событием и разбирались ОДНОЙ
 * схемой. Схема требовала имя виджета, а сервер при смене настроек его не
 * слал — сообщение не проходило разбор и молча отбрасывалось, то есть правка
 * настроек не доезжала до открытого в OBS оверлея вообще никогда.
 *
 * Вторая половина ловушки: в той же схеме состояние стояло с `.default(null)`.
 * Допиши сервер недостающее имя — и правка заголовка цели обнуляла бы на экране
 * собранную сумму, а идущий марафон откатывала к начальной длительности.
 */
describe('сообщения оверлея', () => {
  it('bootstrap и смена настроек — разные события', () => {
    expect(SOCKET_EVENTS.bootstrap).not.toBe(SOCKET_EVENTS.configUpdated);
  });

  it('смена настроек не требует имени виджета', () => {
    const message = { widgetId: WIDGET_ID, isEnabled: true, type: 'goal', config };
    expect(configUpdatedMessageSchema.safeParse(message).success).toBe(true);
  });

  it('в смене настроек нет состояния — и не появляется само', () => {
    const parsed = configUpdatedMessageSchema.parse({
      widgetId: WIDGET_ID,
      isEnabled: true,
      type: 'goal',
      config,
    });
    expect(parsed).not.toHaveProperty('state');
  });

  it('bootstrap несёт имя и состояние явно', () => {
    const withoutState = {
      widgetId: WIDGET_ID,
      name: 'Цель',
      isEnabled: true,
      type: 'goal',
      config,
    };
    // Без состояния bootstrap невалиден: подставлять null молчаливым дефолтом
    // значит разрешить серверу «забыть» состояние и обнулить экран.
    expect(overlayBootstrapSchema.safeParse(withoutState).success).toBe(false);

    const full = { ...withoutState, state: null };
    expect(overlayBootstrapSchema.safeParse(full).success).toBe(true);
  });
});
