import { z } from 'zod';
import { isoDateSchema, uuidSchema } from './common.js';

/**
 * Требования к паролю. Длина важнее символьного зоопарка, поэтому минимум 12
 * символов и запрет на пароль из одного повторяющегося символа.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Минимум 12 символов')
  .max(128, 'Максимум 128 символов')
  .refine((value) => !/^(.)\1*$/.test(value), 'Пароль не может состоять из одного символа');

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2).max(40),
  /**
   * Принятие документов сервиса. Литерал `true`: запрос без него отвергается
   * схемой, до всякой логики.
   *
   * Одно поле вместо трёх галочек. Активное действие пользователя — нажатие
   * кнопки «Создать аккаунт» под фразой, которая называет документы и говорит,
   * что нажатие означает их принятие; это и есть форма акцепта договора и
   * однозначное действие для согласия по 152-ФЗ. Три отдельные галочки
   * добавляли не законности, а три клика: отказаться от любой из них означало
   * не зарегистрироваться, то есть выбора они не давали.
   *
   * Версии принятых документов проставляет бэкенд из актуального реестра — из
   * запроса они не приходят и приходить не должны.
   */
  acceptDocuments: z.literal(true),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  totpCode: z
    .string()
    .regex(/^\d{6}$/, 'Код из 6 цифр')
    .optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const publicUserSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  displayName: z.string(),
  isTotpEnabled: z.boolean(),
  createdAt: isoDateSchema,
});
export type PublicUser = z.infer<typeof publicUserSchema>;

/**
 * Access-токен живёт только в памяти фронта. Refresh-токен в теле ответа НЕ приходит:
 * он ставится httpOnly-cookie, чтобы его не мог прочитать JS.
 */
export const authResultSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: publicUserSchema,
});
export type AuthResult = z.infer<typeof authResultSchema>;

/** Логин требует второй фактор — клиент показывает форму ввода кода. */
export const totpRequiredSchema = z.object({
  totpRequired: z.literal(true),
});

export const loginResponseSchema = z.union([authResultSchema, totpRequiredSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const enableTotpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Код из 6 цифр'),
});

export const sessionSchema = z.object({
  id: uuidSchema,
  createdAt: isoDateSchema,
  lastUsedAt: isoDateSchema,
  userAgent: z.string().nullable(),
  ipHash: z.string().nullable(),
  isCurrent: z.boolean(),
});
export type SessionInfo = z.infer<typeof sessionSchema>;
