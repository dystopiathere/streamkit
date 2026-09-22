# StreamKit Privacy Policy

Version No. 12 of 24.09.2026

This is an English translation provided for convenience. The governing text is
the [Russian version](https://stream-kit.ru/legal/privacy?lang=ru); if the two
differ, the Russian version prevails.

## 1. Who processes the data

The personal data operator is {{SELLER_NAME}}, a professional income tax payer
(self-employed), Taxpayer ID (INN) {{SELLER_INN}}. Send questions about the
processing of personal data to {{SELLER_EMAIL}}.

This Policy applies to the StreamKit service at https://stream-kit.ru.

## 2. What data we process

**Account:** email address, display name, password hash (the password itself is
not stored and cannot be recovered), and the encrypted two-factor authentication
secret, if it is enabled.

**Operation of the service:**

- widget settings and room names;
- session details and the security log: IP address hash, User-Agent string,
  time of sign-in and of significant actions;
- the consent log: which document, which version, and when it was accepted or
  withdrawn.

**Connected platforms** (Twitch, YouTube, DonationAlerts): access tokens issued
by these services (stored encrypted and not shown even to the owner), the
channel ID, handle, name and image, channel metrics (viewers, subscribers, total
views, whether the channel is live), the title, category and start time of the
current stream, and for DonationAlerts, the account ID and name. From Twitch the
service also receives channel events for alerts — follows, subscriptions, gifted
subscriptions, Bits, raids and Channel Points rewards — and from Twitch and
YouTube, the channel's chat messages while the user has a chat widget or the
stream window open; we process the data of their authors on behalf of the user
(section 4). We do not store or use
the email address of the platform account. DonationAlerts sends it together with
the profile, without which donations cannot be connected — we discard it
immediately without storing it. What exactly we receive from Google and how we
use it is described in section 5.

**Payment for the Pro plan:** amount and billing period, payment and refund
history, the encrypted identifier of the saved payment method and its label such
as “Card \*4444”. Card details are entered on the YooKassa page and are not
passed to us.

**Service emails:** the account email address and display name — for emails
about an upcoming automatic charge.

**Private room guests** (no sign-up): the guest's consent log — invite link,
version of the terms, time, IP address hash and User-Agent. We process the
guest's name, image and voice on behalf of the user, see section 4.

**Visit statistics** (only with consent, on the home page, document pages and
the sign-in and sign-up pages): the page address without parameters except
`utm_*` tags, the referring site and page without parameters, the page title,
screen size, language, browser, operating system and device type, country and
city by IP address (the IP address itself is not stored), and the facts of
signing up and proceeding to payment. Visitors are distinguished by a hash whose
secret changes once a month. The consent log of a visitor without an account: a
random browser identifier, document version, time, IP address hash and
User-Agent. Details are in the Cookie Policy.

## 3. Purposes and legal grounds

| Purpose | Legal ground |
|---|---|
| Providing the service: widgets, events, analytics, rooms | Performance of the contract (Terms of Service) |
| Sign-up, sign-in, account protection | Performance of the contract |
| Plan payment, automatic renewal, refunds | Performance of the contract (Pro plan offer) |
| Emails about an upcoming charge | Performance of the contract |
| Security logs, incident investigation | The Operator's legitimate interest |
| Proof of consents given | Requirement of Federal Law No. 152-FZ |
| Visit statistics for public pages | Consent in the banner; withdrawn via the “Cookie settings” link or in the Privacy section |

The purposes and legal grounds for processing the data in section 4 are
determined by the user as its operator.

## 4. Viewer and guest data: processing on behalf of the user

4.1. Some data enters the service not from the user but from people the user
works with on stream. **The operator of this data is the user**, and we process
it on the user's behalf under section 13 of the Terms of Service (Part 3 of
Article 6 of Federal Law No. 152-FZ):

- **event participants** from services connected by the user (donations;
  follows, subscriptions, gifted subscriptions, Bits, raids and Channel Points
  rewards on Twitch): name or nickname, message text, amount and currency or a
  quantity (Bits, raid viewers, months subscribed, number of gifts), time. For a
  voice donation we receive a link to the recording instead of text: the
  recording stays with the service the donation was made through, we neither
  copy nor store it and only play it on the widget page. Stored in the user's event history. The Top donors widget shows names on
  the widget page, which the user adds to the stream;
- **Twitch and YouTube chat viewers** on the channels the user has connected to
  the service: username or name, for YouTube the author's channel ID, and message
  text. Pass through the service
  in real time and are **not stored**;
- **private room guests**: name, image and voice. Transmitted in real time and
  **not recorded**. The decision to show a guest on stream is made by the user,
  who also obtains the guest's consent to it.

4.2. We use this data only to run the user's widgets, stream window, event
history and video calls, and for no purposes of our own. Chat messages reach the
stream window only while it is open and are not stored anywhere.

4.3. If you are a donor, viewer or guest and want to learn about, correct or
delete your data, contact the streamer: they are the operator and respond to
such requests. A request sent to us at {{SELLER_EMAIL}} will be forwarded to the
streamer within 3 business days, and on the streamer's instruction we will
correct or delete the data within 5 business days.

## 5. Data from Google (YouTube)

5.1. When connecting a YouTube channel, the user grants the service a single
Google permission — `youtube.readonly`, viewing YouTube data. Through the
YouTube Data API we receive the channel ID, handle, name and image, the number
of subscribers and total views, and whether a stream is live, when it started,
its title and the number of its concurrent viewers. During a stream, while the user
has a chat widget or the stream window open, we receive that stream's chat
messages through the YouTube Live Streaming API: the author's name and channel ID,
badges (owner, moderator, member) and text. We do not request the email address, name or
any other Google account data. The service never publishes, changes or deletes
anything on the channel.

5.2. This data is used only to show the user the analytics, live status and chat
of their own channel in their dashboard, and chat messages also in the chat widget
that the user themselves adds to their stream. Chat messages pass through the
service in real time and are not stored. We do not use it for advertising, do not sell it, do not use
it to train artificial intelligence models, and do not transfer it to third
parties — except for hosting of the service (section 7) and cases expressly
provided for by law.

5.3. People do not read this data, with two exceptions. Staff see the channel
handle and name and the metrics collection status in the admin panel — to
resolve a failure at the user's request and for security purposes; the metrics
themselves and stream titles are not shown in the panel. The second exception
is when required by law.

5.4. Google access tokens are stored encrypted until the channel is disconnected
or the account is deleted; metrics are kept for 90 days. Disconnecting the
channel in the Analytics section immediately deletes the tokens, the channel
details and all collected metrics. Access can also be revoked on the Google side
at https://myaccount.google.com/permissions.

5.5. StreamKit's use and transfer of information received from Google APIs to
any other app will adhere to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

5.6. The service uses YouTube API Services. By connecting a YouTube channel, the
user agrees to the YouTube Terms of Service (https://www.youtube.com/t/terms), and
Google's own processing of data is governed by the Google Privacy Policy
(https://policies.google.com/privacy).

## 6. Where the data is stored

Databases and the media server are hosted on Yandex Cloud servers in the Russian
Federation, in accordance with Part 5 of Article 18 of Federal Law No. 152-FZ.

## 7. Who the data is shared with

We do not sell personal data. Data is shared only with:

- **Yandex.Cloud LLC** — hosting of the service, including visit statistics
  (Umami on the Operator's servers in Yandex Cloud), and sending service emails
  (Yandex Cloud Postbox), on the Operator's behalf, in the Russian Federation;
- **YooMoney NCO LLC** (YooKassa) — processing payments and refunds: payment
  amount, email address for the receipt;
- **Twitch and Google (YouTube)** — only if the user has connected the platform:
  the service calls their APIs with the tokens these platforms issued to the
  user in order to obtain channel metrics, events and chat messages. These companies' servers are located
  outside the Russian Federation; we do not share any other user data with them.
  How we handle data received from Google is described in section 5;
- authorized public authorities on request — in cases expressly provided for by
  law.

## 8. Retention periods

| Data | Period |
|---|---|
| Account | Until the account is deleted |
| Donation events | Until the account is deleted, then anonymized |
| Security log (audit), including staff actions | 180 days |
| Sign-in sessions | Until sign-out or expiry, no more than 30 days |
| Platform channel metrics | 90 days |
| Platform tokens | Until the platform is disconnected or the account is deleted |
| Saved payment method | Until the account is deleted; earlier if access to it is revoked or the card expires |
| Payment and refund history | 5 years from the payment date |
| Users' consent log | 3 years after processing ends |
| Room guests' consent log | 180 days |
| Visit statistics | 13 months |
| Consent log of visitors without an account | 3 years from the date of consent |
| Guest image, sound and name | Not stored |
| Twitch and YouTube chat messages | Not stored |

## 9. Your rights

You have the right to receive information about the processing of your data, to
demand its correction, blocking or destruction, to withdraw consent, and to
export your data in a machine-readable format.

You can export your data, withdraw optional consents and delete your account
yourself in the Privacy section of your dashboard. Send other requests to
{{SELLER_EMAIL}}; we respond within no more than 10 business days.

Requests about data we process on behalf of the user are handled as described
in clause 4.3.

## 10. Account deletion

Deletion is confirmed with the password. The email address and display name are
anonymized, the password and the second factor are deleted, sessions are ended,
widget links are revoked, platform connections with their tokens and metrics are
deleted, rooms and invites are deleted, auto-renewal is turned off, and the
saved payment method is erased. Donors' names and messages are anonymized, and links to voice donations are
deleted.
Event amounts and dates and the payment history are kept in anonymized form for
the periods in section 8 — for accounting and dispute resolution.

## 11. Data protection

Passwords are stored as argon2id hashes. Platform tokens, two-factor
authentication secrets and payment method identifiers are encrypted with
AES-256-GCM. Session tokens and widget and room links are stored only as
hashes. Connections are protected with TLS. Access to servers is restricted by
keys and logged.

The operator's staff work with accounts through the admin panel. Access to it
is role-based: support sees account data and can end sessions and revoke widget
links and room invites; an administrator can in addition suspend access,
anonymize an account and assign roles. Signing in to the panel requires
two-factor authentication. Every view of an account and every staff action is
recorded in the security log with the staff member's identity and kept for 180
days.

Data we process on behalf of the user (section 4) — event participants' names
and messages, guests' names — is not shown in the panel: staff see only the
number of events.

## 12. Cookies

The cookies used by the service are described in the Cookie Policy
(https://stream-kit.ru/legal/cookies).

## 13. Changes to this Policy

13.1. When the text changes, a new version is published with its number and
date. This Policy is a document the operator is required to publish (Article
18.1 of Federal Law No. 152-FZ), not a consent: its versions do not have to be
accepted, and access to the service does not depend on that.

13.2. We notify you of a new version in the dashboard on the first sign-in after
publication. The list of documents, their current versions and the marks of
acknowledgement are in the Privacy section.

13.3. If the changes affect the purposes or scope of processing that requires
your consent, we will ask for consent again: consent previously given applies to
a specific version of the document, and silence is not consent. Until new
consent is given, processing continues within the scope of the previous
version.
