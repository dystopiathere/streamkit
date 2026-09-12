import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodSchema } from 'zod';

/**
 * Ошибка разбора схемы в виде 400 с тем же телом, что отдаёт пайп.
 *
 * Вынесено отдельно, потому что разбор случается не только на границе запроса:
 * конфиг виджета валидируется уже в сервисе — схемой типа, который известен
 * только после чтения из БД. Без этого ZodError доезжал бы до Nest как
 * необработанное исключение, то есть пятисоткой на кривом поле формы.
 */
export function validationError(error: ZodError): BadRequestException {
  return new BadRequestException({
    message: 'Ошибка валидации',
    errors: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

/**
 * Валидация входа схемой из @streamkit/contracts.
 *
 * Используем Zod, а не class-validator: та же схема уже описывает данные для
 * фронта и overlay, и дублировать её декораторами значит завести второй,
 * расходящийся источник правды.
 *
 * Пайп ещё и очищает объект: наружу уходит результат `parse`, то есть ровно поля
 * схемы. Лишнее из тела запроса до сервиса не доезжает.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }

    throw validationError(result.error);
  }
}

/** Сахар: `@Body(zodBody(loginSchema)) body: LoginInput`. */
export function zodBody<T>(schema: ZodSchema<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

/**
 * То же для строки запроса: `@Query(zodQuery(analyticsQuerySchema)) query: AnalyticsQuery`.
 *
 * Отдельное имя, хотя пайп тот же: в схеме для query числа и булевы обязаны
 * идти через `z.coerce`, потому что из строки запроса всё приезжает строками.
 * Разные имена напоминают об этом на месте вызова.
 */
export function zodQuery<T>(schema: ZodSchema<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}
