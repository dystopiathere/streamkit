import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button, Card, Input, Label, usePageTitle } from '@streamkit/app-kit';
import { api } from '@/lib/api';
import { API_BASE } from '@/lib/config';

/**
 * Подключение источников событий.
 *
 * В первой версии здесь только собственный вебхук — универсальный вход, который
 * закрывает и интеграции своими силами, и отладку. Кнопки подключения
 * DonationAlerts и DonatePay появятся здесь же, когда будут готовы коннекторы.
 */
export function SourcesPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [secret, setSecret] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  usePageTitle(t('sources.title'));

  const rotate = useMutation({
    mutationFn: () => api.post<{ sourceId: string; secret: string }>('/events/webhook/secret'),
    onSuccess: (data) => {
      setSecret(data.secret);
      setSourceId(data.sourceId);
    },
    onError: () => toast.error(t('common.error')),
  });

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{t('sources.title')}</h1>

      <Card className="space-y-4">
        <div>
          <h2 className="font-medium">{t('sources.webhookTitle')}</h2>
          <p className="mt-1 text-sm text-muted">{t('sources.webhookDescription')}</p>
        </div>

        {sourceId ? (
          <div>
            <Label htmlFor="webhook-url">{t('sources.urlLabel')}</Label>
            <Input id="webhook-url" readOnly value={`${API_BASE}/webhooks/${sourceId}`} />
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
            onClick={() => rotate.mutate()}
            isLoading={rotate.isPending}
            aria-describedby="rotate-warning"
          >
            {t('sources.rotate')}
          </Button>
          <p id="rotate-warning" className="mt-2 text-xs text-muted">
            {t('sources.rotateWarning')}
          </p>
        </div>

        {/* Формат подписи вынесен на экран сознательно: без него интеграцию
            невозможно сделать, не открывая исходники сервера. */}
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
      </Card>
    </div>
  );
}
