# Cookie Policy

Version No. 4 of 26.09.2026

This is an English translation provided for convenience. The governing text is
the [Russian version](https://stream-kit.ru/legal/cookies?lang=ru); if the two
differ, the Russian version prevails.

## 1. Strictly necessary

These are set because the service does not work without them. They do not
require consent.

| Name | Purpose | Lifetime |
|---|---|---|
| `sk_refresh` | Session renewal token. Not accessible to page scripts (httpOnly), sent only to `/api/auth` addresses. | 30 days |
| `sk_oauth_state` | One-time marker for connecting a platform (Twitch, YouTube): confirms that the same browser that started the connection has returned. Sent only to `/api/integrations` addresses. | 10 minutes, deleted on return |
| `sk_device` | A random browser tag. It lets us tell you by email about a sign-in to your account from a browser never used with it before. It says nothing about you; the server stores only its hash. Not accessible to page scripts (httpOnly), sent only to `/api/auth` addresses. | 400 days after the last sign-in |
| `sk_admin_refresh` | The same as `sk_refresh`, but for an employee signing in to the admin panel on a separate address. It is never set for visitors or streamers. | 30 days |

In the browser's local storage (not a cookie; it is not sent to the server by
itself), the service stores:

- `streamkit.cookie-choice` and `streamkit.cookie-choice-at` — your choice in the
  banner and its date, so as not to ask again; after a year the banner asks
  again;
- `streamkit.visitor-id` — a random browser identifier. It is sent to the server
  only when you click “Accept all” or withdraw consent, to link the consent log
  entry to this browser. It is linked neither to an account nor to visit
  statistics;
- `streamkit.microphone-processing` — the voice processing you chose for the
  microphone in a private room: it relates to this computer's microphone;
- `streamkit.mirror-camera` — whether to mirror your camera in a private room:
  the choice relates to this camera on this computer;
- `streamkit.language` — the interface language you picked with the switcher;
- `streamkit.legal-notice` — the “later” mark on the notice about a new version
  of the documents, so that it is not shown again in this browser.

## 2. Visit statistics

Visit statistics are collected by **Umami** — software installed on our own
servers in Yandex Cloud in the Russian Federation. The data is not shared with
ad networks, the Umami developer or any other third parties.

**It works only after your consent** in the banner. Until you click “Accept
all”, the statistics script is neither loaded nor run.

**The statistics do not use cookies.** Technically, the browser stores only the
`umami.disabled` marker: the service sets it when you decline and removes it
when you consent, so that an already loaded script stops sending data.

**Where it counts:** the home page and the document, sign-in and sign-up pages.
There are no statistics in the dashboard, in rooms or on the guest page.

**What is sent:** the page address without parameters (except `utm_*` ad tags),
the site and page you came from without parameters, the page title, screen
size, browser language, and the facts of signing up and proceeding to pay for
the plan — without data about you. Country and city are determined by IP
address; the IP address itself is not stored. Visitors are distinguished by a
hash of the IP address, the browser and a secret value that changes once a
month: the next month the same visitor counts as new.

**Retention period** — 13 months.

**How to withdraw consent:** the “Cookie settings” link in the footer of public
pages, or the Privacy section of your dashboard.

## 3. Advertising

Not used.

## 4. How to change your choice

You can change your decision with the “Cookie settings” link in the footer of
public pages, in the Privacy section of your dashboard, or by clearing the
site's data in your browser settings — the banner will then appear again.

## 5. What we don't do

We do not use cookies to track your behavior on other websites and do not share
their contents with ad networks.
