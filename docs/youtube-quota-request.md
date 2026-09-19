# Заявка на повышение квоты YouTube Data API — черновик

Форма: Google Cloud Console → APIs & Services → YouTube Data API v3 → Quotas →
«Apply for higher quota» (форма «YouTube API Services — Audit and Quota
Extension Form»). Заполняется по-английски; ниже — готовые ответы и что
проверить перед отправкой.

## Перед отправкой

- [ ] Новые редакции документов выкачены и открываются по прямым ссылкам:
      соглашение (раздел 2.4 — Условия YouTube) и политика (разделы 5 и 5.6 —
      API-сервисы YouTube, Политика Google, Limited Use, отзыв доступа).
- [ ] Экран согласия OAuth в Google Cloud: описание использования
      `youtube.readonly` упоминает чат эфира, а не только аналитику.
- [ ] Цена `streamList` измерена на живом эфире, `YOUTUBE_CHAT_STREAM_COST`
      выставлен по факту, расчёт ниже пересчитан.
- [ ] Скринкаст (2–3 минуты): подключение YouTube → аналитика → окно эфира с
      чатом → виджет чата в OBS → отключение канала (удаляет данные).

## Ответы для формы

**Describe your API client / use case**

> StreamKit (https://stream-kit.ru) is a toolkit for live streamers: on-stream
> widgets (alerts, donation goal, chat overlay), a stream dashboard and channel
> analytics. A streamer connects their own YouTube channel with the
> `youtube.readonly` scope. We use the YouTube Data API to show the streamer
> their own channel analytics (subscribers, views, concurrent viewers while
> live) and the YouTube Live Streaming API (`liveChatMessages.streamList`) to
> show the live chat of their own current broadcast in their dashboard and in a
> chat overlay that the streamer adds to their own stream. Chat messages are not
> stored; they pass through the service in real time.

**Which API methods do you call and how often**

> - `channels.list` (mine=true): on connect and every 15 minutes (every minute
>   while live) for analytics.
> - `liveBroadcasts.list` (mine=true, broadcastStatus=active): same cadence for
>   analytics; additionally every 2 minutes only while the streamer has the chat
>   overlay or the stream window open and no broadcast is live yet.
> - `videos.list` (liveStreamingDetails): only while a broadcast is live.
> - `liveChatMessages.streamList`: one server-streaming connection per live
>   broadcast, only while the streamer has the chat overlay or the stream window
>   open; resumed with `pageToken` after a disconnect.
> We never call `search.list`.

**Quota calculation** (пересчитать после измерения цены потока)

| На одного активного стримера в сутки | Единиц |
|---|---|
| Метрики вне эфира: 3 ед. × 4 в час × 20 ч | 240 |
| Метрики в эфире: 3 ед. × 60 в час × 4 ч | 720 |
| Поиск эфира перед стартом: 1 ед. × 30 в час × 1 ч | 30 |
| Поток чата: `YOUTUBE_CHAT_STREAM_COST` × открытий за 4 ч (оценка — 24) | 120 |
| **Итого** | **≈ 1 110** |

> We expect around 1,000 active streamers within the next 6 months, which is
> about 1.1M units per day. We request **1,200,000 units per day**.

**How is data stored, shared and deleted**

> Access tokens are stored encrypted (AES-256-GCM). Channel metrics are kept for
> 90 days and deleted automatically; live chat messages are not stored at all.
> Data is shown only to the streamer who connected the channel (and chat
> messages in the overlay they add to their own stream). We do not use YouTube
> data for advertising, do not sell it, do not use it to train AI models and do
> not share it with third parties. Disconnecting the channel immediately deletes
> tokens, channel data and all metrics; access can also be revoked at
> https://myaccount.google.com/permissions. Our Terms reference the YouTube
> Terms of Service and our Privacy Policy references the Google Privacy Policy.

**Ссылки**

- Terms of Service: https://stream-kit.ru/legal/terms (EN: `?lang=en`)
- Privacy Policy: https://stream-kit.ru/legal/privacy (EN: `?lang=en`)
- Устройство и расчёт квоты — `docs/adr/0007`, `docs/adr/0014`.
