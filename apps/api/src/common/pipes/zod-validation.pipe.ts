import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

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

    throw new BadRequestException({
      message: 'Ошибка валидации',
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
}

/** Сахар: `@Body(zodBody(loginSchema)) body: LoginInput`. */
export function zodBody<T>(schema: ZodSchema<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}
