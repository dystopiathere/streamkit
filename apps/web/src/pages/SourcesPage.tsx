import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { DonationServiceView, WebhookSourceView } from '@streamkit/contracts';
import {
  Button,
  Card,
  ConfirmDialog,
  Input,
  Label,
  StatusPill,
  usePageTitle,
} from '@streamkit/app-kit';
import { useChannels } from '@/features/analytics/queries';
import {
  useConnectDonationService,
  useDisconnectDonationService,
  useDonationSources,
  useRotateWebhookSecret,
} from '@/features/sources/queries';
import { ApiError } from '@/lib/api';
import { API_BASE } from '@/lib/config';
import { intlLocale } from '@/lib/locale';

const errorText = (error: unknown, fallback: string): string =>
  error instanceof ApiError ? error.message : fallback;

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Источники донатов.
 *
 * Донат-сервис подключается кнопкой: вход в сервис, возврат сюда, и воркер сам
 * держит соединение. Вебхук — ниже и свёрнут: он для тех, кто пишет свою
 * интеграцию, и без программирования им не воспользоваться.
 */
export function SourcesPage(): React.JSX.Element {
  const { t } = useTranslation();
  const sources = useDonationSources();
  usePageTitle(t('sources.title'));
  useConnectionResult();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('sources.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('sources.lead')}</p>
      </div>

      {sources.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('common.error')}
        </p>
      ) : null}

      <TwitchEventsCard />

      {sources.data?.services.map((service) => (
        <ServiceCard key={service.service} service={service} />
      ))}

      {sources.data ? <WebhookCard webhook={sources.data.webhook} /> : null}
    </div>
  );
}

/**
 * События Twitch — фолловеры, подписки, биты, рейды, баллы.
 *
 * Отдельной кнопки подключения у них нет: они идут вместе с Twitch из
 * «Аналитики», тем же входом. Карточка говорит, откуда они берутся, — иначе
 * стример искал бы их среди донат-сервисов.
 */
function TwitchEventsCard(): React.JSX.Element {
  const { t } = useTranslation();
  const channels = useChannels();
  const twitch = channels.data?.find((channel) => channel.platform === 'twitch');
  const working = twitch && twitch.syncState !== 'auth-expired' && !twitch.needsReconnect;

  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{t('sources.twitch.title')}</h2>
        {channels.data ? (
          <StatusPill tone={working ? 'success' : 'neutral'}>
            {working ? t('sources.twitch.on') : t('sources.twitch.off')}
          </StatusPill>
        ) : null}
      </div>
      <p className="text-sm text-muted">{t('sources.twitch.lead')}</p>
      {channels.data && !working ? (
        <Link to="/analytics" className="text-sm underline">
          {twitch ? t('sources.twitch.fix') : t('sources.twitch.connect')}
        </Link>
      ) : null}
    </Card>
  );
}

/**
 * Итог подключения по метке в адресе. Метку убираем сразу: иначе она переживёт
 * перезагрузку и через сутки снова скажет «подключено».
 */
function useConnectionResult(): void {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const status = params.get('status');

  useEffect(() => {
    if (!status) return;
    if (status === 'connected') toast.success(t('sources.connected'));
    else if (status === 'failed') toast.error(t('sources.connectFailed'));
    setParams(new URLSearchParams(), { replace: true });
  }, [status, setParams, t]);
}

function ServiceCard({ service }: { service: DonationServiceView }): React.JSX.Element {
  const { t } = useTranslation();
  const connect = useConnectDonationService();
  const disconnect = useDisconnectDonationService();
  const [confirming, setConfirming] = useState(false);

  const state = !service.isConnected ? 'off' : service.isEnabled ? 'on' : 'broken';
  const onConnect = (): void =>
    connect.mutate(service.service, {
      onError: (error) => toast.error(errorText(error, t('common.error'))),
    });

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-medium">{service.title}</h2>
        <StatusPill tone={state === 'on' ? 'success' : state === 'broken' ? 'warning' : 'neutral'}>
          {t(`sources.state.${state}`)}
        </StatusPill>
      </div>

      {!service.isConfigured ? (
        <p className="text-sm text-muted">{t('sources.notConfigured')}</p>
      ) : state === 'off' ? (
        <>
          <p className="text-sm text-muted">{t('sources.donationalerts.description')}</p>
          <Button isLoading={connect.isPending} onClick={onConnect}>
            {t('sources.connect', { service: service.title })}
          </Button>
        </>
      ) : (
        <>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted">{t('sources.account')}</dt>
            <dd className="m-0">{service.accountName ?? '—'}</dd>
            <dt className="text-muted">{t('sources.lastEvent')}</dt>
            <dd className="m-0">
              {service.lastEventAt ? formatDate(service.lastEventAt) : t('sources.noEvents')}
            </dd>
          </dl>

          {state === 'broken' ? (
            <p role="alert" className="text-sm text-warning">
              {service.disabledReason ?? t('sources.brokenFallback')}
            </p>
          ) : (
            <p className="text-sm text-muted">{t('sources.donationalerts.check')}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {state === 'broken' ? (
              <Button isLoading={connect.isPending} onClick={onConnect}>
                {t('sources.reconnect')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              aria-label={t('sources.disconnectNamed', { service: service.title })}
              onClick={() => setConfirming(true)}
            >
              {t('sources.disconnect')}
            </Button>
          </div>

          <ConfirmDialog
            open={confirming}
            title={t('sources.disconnectTitle', { service: service.title })}
            confirmLabel={t('sources.disconnect')}
            cancelLabel={t('common.cancel')}
            isPending={disconnect.isPending}
            onClose={() => setConfirming(false)}
            onConfirm={() =>
              disconnect.mutate(service.service, {
                onSuccess: () => {
                  setConfirming(false);
                  toast.success(t('sources.disconnected'));
                },
                onError: (error) => toast.error(errorText(error, t('common.error'))),
              })
            }
          >
            {t('sources.disconnectText')}
          </ConfirmDialog>
        </>
      )}
    </Card>
  );
}

function WebhookCard({ webhook }: { webhook: WebhookSourceView | null }): React.JSX.Element {
  const { t } = useTranslation();
  const rotate = useRotateWebhookSecret();
  const [secret, setSecret] = useState<string | null>(null);
  const sourceId = webhook?.sourceId ?? null;

  return (
    <Card className="space-y-3">
      {/* Свёрнуто по умолчанию, пока вебхука нет: это инструмент разработчика, и
          стримеру без своей программы он ничего не даёт. */}
      <details open={webhook !== null}>
        <summary className="font-medium">{t('sources.webhookTitle')}</summary>
        <div className="mt-3 space-y-4">
          <p className="text-sm text-muted">{t('sources.webhookDescription')}</p>

          {sourceId ? (
            <div>
              <Label htmlFor="webhook-url">{t('sources.urlLabel')}</Label>
              <Input
                id="webhook-url"
                readOnly
                value={`${API_BASE}/webhooks/${sourceId}`}
                onFocus={(event) => event.target.select()}
              />
              <p className="mt-1 text-xs text-muted">
                {webhook?.lastEventAt
                  ? t('sources.lastEventAt', { date: formatDate(webhook.lastEventAt) })
                  : t('sources.noEvents')}
              </p>
            </div>
          ) : null}

          {secret ? (
            <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/10 p-3">
              <Label htmlFor="webhook-secret">{t('sources.secretLabel')}</Label>
              <p id="webhook-secret-hint" className="text-xs text-muted">
                {t('sources.secretShownOnce')}
              </p>
              <Input
                id="webhook-secret"
                readOnly
                value={secret}
                aria-describedby="webhook-secret-hint"
                onFocus={(event) => event.target.select()}
              />
            </div>
          ) : null}

          <div>
            <Button
              variant="secondary"
              isLoading={rotate.isPending}
              aria-describedby={sourceId ? 'rotate-warning' : undefined}
              onClick={() =>
                rotate.mutate(undefined, {
                  onSuccess: (data) => setSecret(data.secret),
                  onError: (error) => toast.error(errorText(error, t('common.error'))),
                })
              }
            >
              {sourceId ? t('sources.rotate') : t('sources.createWebhook')}
            </Button>
            {sourceId ? (
              <p id="rotate-warning" className="mt-2 text-xs text-muted">
                {t('sources.rotateWarning')}
              </p>
            ) : null}
          </div>

          {/* Формат подписи — на экране: без него интеграцию не сделать, не
              открывая исходники сервера. */}
          <pre
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-border bg-bg p-3 text-xs text-muted"
          >
            {`POST /api/webhooks/<sourceId>
x-streamkit-timestamp: <unix seconds>
x-streamkit-signature: hex(hmac_sha256(secret, timestamp + "." + body))

{
  "type": "donation",
  "externalId": "уникальный-id-события",
  "username": "Зритель",
  "message": "Текст",
  "amount": { "amountMinor": 50000, "currency": "RUB" }
}`}
          </pre>
        </div>
      </details>
    </Card>
  );
}
