import { LiveKitRoom, useMediaDeviceSelect, usePreviewTracks } from '@livekit/components-react';
import { guestDisplayNameSchema, type GuestJoinResult } from '@streamkit/contracts';
import { DisconnectReason, type LocalVideoTrack, Track } from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  Input,
  Label,
  MainContent,
  NewTabHint,
  selectClasses,
  usePageTitle,
} from '@streamkit/app-kit';
import { MicrophoneSettings } from '@/features/rooms/MicrophoneSettings';
import { RoomStage } from '@/features/rooms/RoomStage';
import { ROOM_OPTIONS } from '@/features/rooms/room-options';
import { useGuestJoin } from '@/features/rooms/queries';
import { ApiError } from '@/lib/api';
import { usePageMeta } from '@/lib/seo';

type Ended = 'removed' | 'closed' | 'left';

/**
 * Страница гостя: имя, камера, согласие — и в комнату.
 *
 * Токен приглашения берётся из фрагмента адреса (`#…`). Фрагмент браузер не
 * отправляет на сервер, поэтому ссылка не оседает в журналах nginx и прокси.
 * Из адресной строки он не убирается: гость, перезагрузивший вкладку из-за
 * камеры, должен вернуться, а не искать ссылку в мессенджере заново.
 */
export function JoinPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [token] = useState(() => window.location.hash.replace(/^#/, ''));
  const [session, setSession] = useState<GuestJoinResult | null>(null);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [devices, setDevices] = useState<{ video?: string; audio?: string }>({});
  // Имя живёт здесь, а не в форме: форма монтируется заново после выхода из
  // комнаты, и гость, вернувшийся после обрыва, не должен вписывать его снова.
  // Согласие, наоборот, отмечается при каждом входе — каждый вход пишет свою
  // запись в журнал.
  const [name, setName] = useState('');
  usePageTitle(session ? session.roomName : t('join.title'));
  // Страница гостя — по личной ссылке-приглашению, поиску там делать нечего.
  usePageMeta({ noindex: true });

  // Стабильный обработчик: `LiveKitRoom` держит его в зависимостях эффектов.
  const handleDisconnected = useCallback((reason?: DisconnectReason) => {
    setSession(null);
    setEnded(
      reason === DisconnectReason.PARTICIPANT_REMOVED
        ? 'removed'
        : reason === DisconnectReason.ROOM_DELETED
          ? 'closed'
          : 'left',
    );
  }, []);

  return (
    <MainContent className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-semibold">
        {session ? t('join.inRoom', { room: session.roomName }) : t('join.title')}
      </h1>

      {!token ? (
        <Card>
          <p className="text-sm">{t('join.noToken')}</p>
        </Card>
      ) : session ? (
        <Card>
          <LiveKitRoom
            serverUrl={session.url}
            token={session.token}
            connect
            options={ROOM_OPTIONS}
            // Микрофон и камеру публикует сцена, а не LiveKitRoom: камера так
            // включается без повторного открытия устройства, а микрофон — с
            // выбранной гостем обработкой голоса и качеством передачи.
            audio={false}
            video={false}
            onDisconnected={handleDisconnected}
          >
            <RoomStage
              onLeave={() => setSession(null)}
              cameraOnJoin
              cameraDeviceId={devices.video}
              microphoneDeviceId={devices.audio}
            />
          </LiveKitRoom>
        </Card>
      ) : (
        <JoinForm
          token={token}
          ended={ended}
          name={name}
          onNameChange={setName}
          onJoined={(result, chosen) => {
            setDevices(chosen);
            setEnded(null);
            setSession(result);
          }}
        />
      )}
    </MainContent>
  );
}

function JoinForm({
  token,
  ended,
  name,
  onNameChange,
  onJoined,
}: {
  token: string;
  ended: Ended | null;
  name: string;
  onNameChange: (name: string) => void;
  onJoined: (result: GuestJoinResult, devices: { video?: string; audio?: string }) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const join = useGuestJoin();
  const [accepted, setAccepted] = useState(false);
  const [mediaDenied, setMediaDenied] = useState(false);

  const cameras = useMediaDeviceSelect({ kind: 'videoinput', requestPermissions: true });
  const microphones = useMediaDeviceSelect({ kind: 'audioinput', requestPermissions: true });

  // Опции мемоизируются: хук пересоздаёт дорожки на каждый новый объект, а
  // пересоздание камеры — это мигающий индикатор и секундная пауза в превью.
  const previewOptions = useMemo(
    () => ({
      video: cameras.activeDeviceId ? { deviceId: cameras.activeDeviceId } : true,
      audio: microphones.activeDeviceId ? { deviceId: microphones.activeDeviceId } : true,
    }),
    [cameras.activeDeviceId, microphones.activeDeviceId],
  );
  // Обработчик ошибки стабилен не для порядка: он входит в зависимости эффекта
  // внутри хука. Новая стрелка на каждый рендер пересоздавала камеру по кругу —
  // каждое обновление состояния останавливало дорожку, и превью оставалось чёрным.
  const onMediaError = useCallback(() => setMediaDenied(true), []);
  const tracks = usePreviewTracks(previewOptions, onMediaError);
  const videoTrack = tracks?.find((track) => track.kind === Track.Kind.Video) as
    LocalVideoTrack | undefined;

  const nameValid = guestDisplayNameSchema.safeParse(name).success;

  const errorText = (() => {
    if (!(join.error instanceof ApiError)) return join.error ? t('common.error') : null;
    if (join.error.status === 404) return t('join.invalid');
    if (join.error.status === 409) return t('join.full');
    // Тариф стримера кончился. Гостю причина ни к чему — ему важно, что войти
    // сейчас нельзя и дело не в ссылке.
    if (join.error.status === 402) return t('join.ownerUnavailable');
    if (join.error.status === 503) return t('join.unavailable');
    return t('common.error');
  })();

  const handleSubmit = async (): Promise<void> => {
    if (!nameValid || !accepted) return;
    const result = await join.mutateAsync({ token, displayName: name, acceptTerms: true });
    // Превью отпускает камеру до входа: иначе на части устройств вторая попытка
    // открыть ту же камеру получает отказ, и гость входит без видео.
    for (const track of tracks ?? []) track.stop();
    onJoined(result, {
      video: cameras.activeDeviceId || undefined,
      audio: microphones.activeDeviceId || undefined,
    });
  };

  return (
    <Card className="space-y-5">
      {ended ? (
        <p role="status" className="rounded-lg border border-border bg-bg p-3 text-sm">
          {t(`join.${ended}`)}
        </p>
      ) : (
        <p className="text-sm text-muted">{t('join.lead')}</p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <div className="aspect-video overflow-hidden rounded-lg bg-black">
            {videoTrack ? (
              <PreviewVideo track={videoTrack} />
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted">
                {t('join.previewOff')}
              </div>
            )}
          </div>
          {mediaDenied ? (
            <p role="alert" className="text-xs text-danger">
              {t('join.cameraDenied')}
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="guest-name">{t('join.name')}</Label>
            <Input
              id="guest-name"
              value={name}
              maxLength={40}
              placeholder={t('join.namePlaceholder')}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </div>

          <DeviceSelect
            id="guest-camera"
            label={t('join.camera')}
            empty={t('join.noDevice')}
            select={cameras}
          />
          <DeviceSelect
            id="guest-microphone"
            label={t('join.microphone')}
            empty={t('join.noDevice')}
            select={microphones}
          />

          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm">{t('rooms.microphone.title')}</summary>
            <div className="mt-3">
              <MicrophoneSettings />
            </div>
          </details>

          <label className="flex items-start gap-2 text-sm" htmlFor="guest-terms">
            <input
              id="guest-terms"
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span>
              {t('join.terms')}{' '}
              <Link to="/legal/room-guest" target="_blank" className="underline">
                {t('join.termsLink')}
                <NewTabHint />
              </Link>
              <span className="mt-1 block text-xs text-muted">{t('join.termsHint')}</span>
            </span>
          </label>

          {errorText ? (
            <p role="alert" className="text-sm text-danger">
              {errorText}
            </p>
          ) : null}

          <Button
            onClick={() => void handleSubmit().catch(() => undefined)}
            isLoading={join.isPending}
            disabled={!nameValid || !accepted}
          >
            {t('join.submit')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DeviceSelect({
  id,
  label,
  empty,
  select,
}: {
  id: string;
  label: string;
  empty: string;
  select: ReturnType<typeof useMediaDeviceSelect>;
}): React.JSX.Element {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={selectClasses}
        value={select.activeDeviceId}
        onChange={(event) => void select.setActiveMediaDevice(event.target.value)}
      >
        {select.devices.length === 0 ? <option value="">{empty}</option> : null}
        {select.devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || device.deviceId.slice(0, 8)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Своё превью зеркально — как в любом созвоне. */
function PreviewVideo({ track }: { track: LocalVideoTrack }): React.JSX.Element {
  const { t } = useTranslation();
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return (
    <video
      ref={ref}
      aria-label={t('join.preview')}
      muted
      playsInline
      className="h-full w-full object-cover"
      style={{ transform: 'scaleX(-1)' }}
    />
  );
}
