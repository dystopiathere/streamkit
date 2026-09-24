import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Button,
  Card,
  describeField,
  FieldError,
  FieldHint,
  Input,
  Label,
  StatusPill,
} from '@streamkit/app-kit';
import { ApiError } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth-store';
import { useBeginTotpSetup, useConfirmTotp, useDisableTotp } from './queries';

const errorText = (error: unknown, fallback: string): string =>
  error instanceof ApiError ? error.message : fallback;

/** Секрет группами по четыре: так его переписывают в приложение без ошибок. */
const groupSecret = (secret: string): string => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

/**
 * Двухфакторный вход: код из приложения-аутентификатора при каждом входе.
 *
 * Для стримера — по желанию, для сотрудника — условие входа в админку.
 */
export function TwoFactorCard(): React.JSX.Element | null {
  const { t } = useTranslation();
  const user = useCurrentUser();
  if (!user) return null;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-medium">{t('privacy.totp.title')}</h2>
        <StatusPill tone={user.isTotpEnabled ? 'success' : 'neutral'}>
          {user.isTotpEnabled ? t('privacy.totp.on') : t('privacy.totp.off')}
        </StatusPill>
      </div>
      {user.isTotpEnabled ? <DisableForm /> : <EnableFlow />}
    </Card>
  );
}

function EnableFlow(): React.JSX.Element {
  const { t } = useTranslation();
  const begin = useBeginTotpSetup();
  const confirm = useConfirmTotp();
  const [code, setCode] = useState('');
  const codeId = useId();
  const setup = begin.data;

  if (!setup) {
    return (
      <>
        <p className="text-sm text-muted">{t('privacy.totp.description')}</p>
        <Button
          variant="secondary"
          isLoading={begin.isPending}
          onClick={() =>
            begin.mutate(undefined, {
              onError: (error) => toast.error(errorText(error, t('common.error'))),
            })
          }
        >
          {t('privacy.totp.enable')}
        </Button>
      </>
    );
  }

  const codeError = confirm.error ? errorText(confirm.error, t('common.error')) : undefined;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        confirm.mutate(code);
      }}
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>{t('privacy.totp.stepApp')}</li>
        <li>{t('privacy.totp.stepScan')}</li>
        <li>{t('privacy.totp.stepCode')}</li>
      </ol>

      <div className="flex flex-wrap items-start gap-4">
        {/* Белая подложка: на тёмной теме приложения камера QR не распознаёт. */}
        <img
          src={setup.qrDataUrl}
          alt={t('privacy.totp.qrAlt')}
          width={176}
          height={176}
          className="rounded-lg bg-white p-2"
        />
        <div className="min-w-0 text-sm">
          <p className="text-muted">{t('privacy.totp.manual')}</p>
          <code className="mt-1 block font-mono break-all tabular-nums">
            {groupSecret(setup.secret)}
          </code>
        </div>
      </div>

      <div className="max-w-xs">
        <Label htmlFor={codeId}>{t('auth.totpCode')}</Label>
        <Input
          id={codeId}
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          {...describeField(codeId, { hint: true, error: codeError })}
        />
        <FieldHint id={codeId}>{t('privacy.totp.codeHint')}</FieldHint>
        <FieldError id={codeId} message={codeError} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" isLoading={confirm.isPending} disabled={code.length !== 6}>
          {t('privacy.totp.confirm')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            begin.reset();
            confirm.reset();
            setCode('');
          }}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function DisableForm(): React.JSX.Element {
  const { t } = useTranslation();
  const disable = useDisableTotp();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const passwordId = useId();
  const codeId = useId();
  const error = disable.error ? errorText(disable.error, t('common.error')) : undefined;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        disable.mutate({ password, code });
      }}
    >
      <p className="text-sm text-muted">{t('privacy.totp.enabledDescription')}</p>
      <div className="max-w-xs">
        <Label htmlFor={passwordId}>{t('privacy.deletePasswordLabel')}</Label>
        <Input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          value={password}
          required
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <div className="max-w-xs">
        <Label htmlFor={codeId}>{t('auth.totpCode')}</Label>
        <Input
          id={codeId}
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          {...describeField(codeId, { error })}
        />
        <FieldError id={codeId} message={error} />
      </div>
      <Button
        type="submit"
        variant="secondary"
        isLoading={disable.isPending}
        disabled={password.length === 0 || code.length !== 6}
      >
        {t('privacy.totp.disable')}
      </Button>
    </form>
  );
}
