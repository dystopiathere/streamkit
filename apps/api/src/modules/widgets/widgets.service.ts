import { Injectable, NotFoundException } from '@nestjs/common';
import type { Widget as PrismaWidget } from '@prisma/client';
import {
  type AlertWidgetConfig,
  configSchemaFor,
  type CreatedOverlayToken,
  type CreateWidgetInput,
  type OverlayTokenView,
  type UpdateWidgetInput,
  type Widget,
  type WidgetConfig,
} from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { type BusMessage, RealtimeBus } from '../../common/bus/realtime-bus.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { validationError } from '../../common/pipes/zod-validation.pipe';
import { AppConfig } from '../../config/app-config.service';
import {
  parseWidgetConfig,
  toContractWidget,
  toContractWidgetType,
  toPrismaWidgetType,
} from './widget.mappers';

export interface ResolvedOverlayToken {
  tokenId: string;
  widgetId: string;
  userId: string;
  name: string;
  isEnabled: boolean;
  /** Тип и конфиг вместе: оверлей без типа не знает, чем рендерить конфиг. */
  widget: WidgetConfig;
}

@Injectable()
export class WidgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly bus: RealtimeBus,
    private readonly config: AppConfig,
  ) {}

  async list(userId: string): Promise<Widget[]> {
    const rows = await this.prisma.widget.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toContractWidget);
  }

  async get(userId: string, widgetId: string): Promise<Widget> {
    return toContractWidget(await this.requireOwned(userId, widgetId));
  }

  async create(userId: string, input: CreateWidgetInput): Promise<Widget> {
    const row = await this.prisma.widget.create({
      data: {
        userId,
        type: toPrismaWidgetType(input.type),
        name: input.name,
        // Прогоняем через схему ещё раз: дефолты должны попасть в БД целиком,
        // иначе старые записи будут отличаться от новых набором полей.
        config: configSchemaFor(input.type).parse(input.config) as never,
      },
    });
    return toContractWidget(row);
  }

  /**
   * Частичное обновление конфига.
   *
   * Мержим поверх сохранённого и валидируем целиком: если прислать только
   * `config.text.fontSize`, остальные поля стиля обязаны сохраниться, а результат
   * обязан остаться валидным по схеме.
   *
   * Схема берётся по типу СОХРАНЁННОГО виджета, а не по присланному: тип
   * менять нельзя (у цели и таймера нет ничего общего в конфиге), и запрос его
   * не содержит вовсе. Валидация от этого не ослабла — она осталась ровно
   * здесь, вместо того чтобы разойтись по схемам транспорта.
   */
  async update(userId: string, widgetId: string, input: UpdateWidgetInput): Promise<Widget> {
    const existing = await this.requireOwned(userId, widgetId);

    let config: unknown;
    if (input.config) {
      const merged = configSchemaFor(toContractWidgetType(existing.type)).safeParse(
        mergeConfig(existing.config as object, input.config),
      );
      // safeParse, а не parse: ZodError отсюда ушёл бы в Nest необработанным и
      // стал пятисоткой, хотя это обычная ошибка в поле формы.
      if (!merged.success) throw validationError(merged.error);
      config = merged.data;
    }

    const row = await this.prisma.widget.update({
      where: { id: widgetId },
      data: {
        name: input.name,
        isEnabled: input.isEnabled,
        config: config as never,
      },
    });

    const result = toContractWidget(row);
    // Открытый в OBS оверлей подхватит новые настройки без перезагрузки сцены.
    await this.bus.publish({
      kind: 'widget-config',
      userId,
      widgetId,
      isEnabled: result.isEnabled,
      type: result.type,
      config: result.config,
    } as BusMessage);

    return result;
  }

  async remove(userId: string, widgetId: string): Promise<void> {
    await this.requireOwned(userId, widgetId);
    const tokens = await this.prisma.overlayToken.findMany({
      where: { widgetId, revokedAt: null },
      select: { id: true },
    });

    // Токены оверлеев удалятся каскадом — открытые вкладки OBS потеряют доступ.
    await this.prisma.widget.delete({ where: { id: widgetId } });

    for (const token of tokens) {
      await this.bus.publish({
        kind: 'overlay-revoked',
        tokenId: token.id,
        reason: 'widget-deleted',
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Overlay-токены                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Выпускает публичную ссылку для OBS. Сам токен возвращается ОДИН раз:
   * в БД лежит только хэш, восстановить значение потом невозможно.
   */
  async createOverlayToken(
    userId: string,
    widgetId: string,
    label: string | null,
    context: AuditContext = {},
  ): Promise<CreatedOverlayToken> {
    await this.requireOwned(userId, widgetId);

    const raw = this.crypto.generateToken(32);
    const created = await this.prisma.overlayToken.create({
      data: { widgetId, tokenHash: this.crypto.hashToken(raw), label },
      select: { id: true },
    });

    await this.audit.record('overlay.token.created', userId, {
      ...context,
      metadata: { widgetId, tokenId: created.id },
    });

    return { id: created.id, url: this.buildOverlayUrl(raw) };
  }

  async listOverlayTokens(userId: string, widgetId: string): Promise<OverlayTokenView[]> {
    await this.requireOwned(userId, widgetId);
    const rows = await this.prisma.overlayToken.findMany({
      where: { widgetId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    }));
  }

  async revokeOverlayToken(
    userId: string,
    widgetId: string,
    tokenId: string,
    context: AuditContext = {},
  ): Promise<void> {
    await this.requireOwned(userId, widgetId);
    const updated = await this.prisma.overlayToken.updateMany({
      where: { id: tokenId, widgetId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Токен не найден');
    }
    await this.audit.record('overlay.token.revoked', userId, {
      ...context,
      metadata: { widgetId, tokenId },
    });

    // Живое соединение по отозванному токену должно оборваться сразу, а не
    // дожить до следующего переподключения OBS.
    await this.bus.publish({ kind: 'overlay-revoked', tokenId, reason: 'token-revoked' });
  }

  /** Проверка токена при подключении overlay-сокета. */
  async resolveOverlayToken(rawToken: string): Promise<ResolvedOverlayToken | null> {
    const row = await this.prisma.overlayToken.findUnique({
      where: { tokenHash: this.crypto.hashToken(rawToken) },
      include: { widget: true },
    });

    if (!row || row.revokedAt) return null;

    return {
      tokenId: row.id,
      widgetId: row.widgetId,
      userId: row.widget.userId,
      name: row.widget.name,
      isEnabled: row.widget.isEnabled,
      widget: parseWidgetConfig(row.widget.type, row.widget.config),
    };
  }

  /** Отметка активности — в дашборде видно, подключён ли оверлей к OBS. */
  async touchOverlayToken(tokenId: string): Promise<void> {
    await this.prisma.overlayToken
      .update({ where: { id: tokenId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  /**
   * Активные виджеты пользователя вместе с активными токенами — по ним
   * раскладывается входящее событие.
   */
  async findDispatchTargets(userId: string) {
    const widgets = await this.prisma.widget.findMany({
      // Только ALERTS. Без фильтра сюда попадали бы цели и таймеры, а
      // `shouldShowAlert` читает у конфига `eventTypes` — поля, которого у них
      // нет: первый же донат после создания цели уронил бы обработчик шины.
      where: { userId, isEnabled: true, type: 'ALERTS' },
      include: { tokens: { where: { revokedAt: null }, select: { id: true } } },
    });

    return widgets.map((widget) => ({
      widgetId: widget.id,
      config: configSchemaFor('alerts').parse(widget.config) as AlertWidgetConfig,
      tokenIds: widget.tokens.map((token) => token.id),
    }));
  }

  buildOverlayUrl(rawToken: string): string {
    const base = this.config.overlayBaseUrl.replace(/\/+$/, '');
    return `${base}/?token=${encodeURIComponent(rawToken)}`;
  }

  /**
   * Владение проверяется в каждом методе отдельно. Чужой виджет отдаёт 404,
   * а не 403: иначе по коду ответа можно перебирать существующие id.
   */
  private async requireOwned(userId: string, widgetId: string): Promise<PrismaWidget> {
    const widget = await this.prisma.widget.findFirst({ where: { id: widgetId, userId } });
    if (!widget) {
      throw new NotFoundException('Виджет не найден');
    }
    return widget;
  }
}

function mergeConfig(current: object, patch: Record<string, unknown>): object {
  const merged: Record<string, unknown> = { ...(current as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const currentValue = merged[key];
    // Вложенные объекты (text, sound) мержим на один уровень, массивы заменяем целиком.
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      currentValue !== null &&
      typeof currentValue === 'object' &&
      !Array.isArray(currentValue)
    ) {
      merged[key] = { ...(currentValue as object), ...(value as object) };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
