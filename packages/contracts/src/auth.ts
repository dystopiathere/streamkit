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

/**
 * Язык писем.
 *
 * Письмо восстановления пароля уходит на языке страницы, с которой его
 * запросили: её читает тот же человек, который сейчас будет читать письмо.
 * Остальные письма уходят без запроса — по расписанию или по событию, — и их
 * язык берётся из аккаунта: это язык страницы, с которой в него последний раз
 * вошли или зарегистрировались.
 */
export const MAIL_LANGUAGES = ['ru', 'en'] as const;
export const mailLanguageSchema = z.enum(MAIL_LANGUAGES);
export type MailLanguage = z.infer<typeof mailLanguageSchema>;

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
  /** Язык страницы регистрации — язык будущих писем. */
  language: mailLanguageSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  totpCode: z
    .string()
    .regex(/^\d{6}$/, 'Код из 6 цифр')
    .optional(),
  /** Язык страницы входа — с ним аккаунт получает следующие письма. */
  language: mailLanguageSchema.optional(),
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

/**
 * Выключение второго фактора — паролем И кодом. Одного пароля мало: второй
 * фактор нужен ровно на случай, когда пароль уже у чужого, и снимать его
 * должен тот, у кого телефон.
 */
export const disableTotpSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/, 'Код из 6 цифр'),
});
export type DisableTotpInput = z.infer<typeof disableTotpSchema>;

export const sessionSchema = z.object({
  id: uuidSchema,
  createdAt: isoDateSchema,
  lastUsedAt: isoDateSchema,
  userAgent: z.string().nullable(),
  ipHash: z.string().nullable(),
  isCurrent: z.boolean(),
});
export type SessionInfo = z.infer<typeof sessionSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  language: mailLanguageSchema.default('ru'),
});
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

/**
 * Сколько живёт ссылка восстановления пароля.
 *
 * Час — с запасом на письмо, застрявшее в очереди почтового сервиса, и мало
 * для того, кто позже доберётся до чужого ящика: ссылка в старом письме к
 * тому времени уже ничего не открывает.
 */
export const PASSWORD_RESET_TTL_MINUTES = 60;

/**
 * Новый пароль по ссылке из письма.
 *
 * Токен — base64url от 32 случайных байт, то есть 43 символа. Длину держим
 * строго: всё остальное заведомо не наш токен, и в хэш его отправлять незачем.
 */
export const resetPasswordSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Ссылка недействительна или устарела'),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

const PASSWORDS_DIFFER = 'Пароли не совпадают';

/**
 * Формы нового пароля — с повтором. Повтор серверу не нужен и в запрос не
 * уходит: он ловит опечатку в пароле, которого никто не видит, до того, как
 * её обнаружат на следующем входе.
 */
export const changePasswordFormSchema = changePasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((values) => values.confirmPassword === values.newPassword, {
    path: ['confirmPassword'],
    message: PASSWORDS_DIFFER,
  });
export type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>;

export const resetPasswordFormSchema = z
  .object({ newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((values) => values.confirmPassword === values.newPassword, {
    path: ['confirmPassword'],
    message: PASSWORDS_DIFFER,
  });
export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

const BROWSER_MARKERS: ReadonlyArray<readonly [marker: string, name: string]> = [
  ['Edg/', 'Edge'],
  ['OPR/', 'Opera'],
  ['YaBrowser/', 'Yandex Browser'],
  ['Firefox/', 'Firefox'],
  ['Chrome/', 'Chrome'],
  ['Safari/', 'Safari'],
];

const SYSTEM_MARKERS: ReadonlyArray<readonly [marker: string, name: string]> = [
  ['Windows', 'Windows'],
  ['Android', 'Android'],
  ['iPhone', 'iOS'],
  ['iPad', 'iPadOS'],
  ['Mac OS X', 'macOS'],
  ['Linux', 'Linux'],
];

/**
 * Браузер и система по строке User-Agent — коротко, для узнавания.
 *
 * Точный разбор не нужен: человек ищет «это мой ноутбук или нет», и «Chrome,
 * Windows» на это отвечает. Строка целиком длинная и ничего не говорит. Общая
 * для списка устройств в дашборде и письма о входе с нового устройства: одно и
 * то же устройство в них должно называться одинаково.
 *
 * @returns «Chrome, Windows» или null, если ничего не узнано.
 */
export function describeUserAgent(agent: string | null | undefined): string | null {
  if (!agent) return null;
  const browser = BROWSER_MARKERS.find(([marker]) => agent.includes(marker))?.[1] ?? null;
  const system = SYSTEM_MARKERS.find(([marker]) => agent.includes(marker))?.[1] ?? null;
  const parts = [browser, system].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(', ') : null;
}
