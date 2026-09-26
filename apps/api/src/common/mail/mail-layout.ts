import type { MailLanguage } from '@streamkit/contracts';

/**
 * Вёрстка служебных писем.
 *
 * Письмо читают в Gmail, Outlook (включая настольный на Word-движке),
 * Mail.ru, Яндекс Почте и Apple Mail, и общего у них мало. Поэтому здесь
 * почтовая вёрстка, а не веб-вёрстка:
 *
 * - раскладка — таблицами с `role="presentation"`: flex и grid половина
 *   клиентов не знает, а Outlook не знает даже `max-width` у `div`, для него —
 *   таблица фиксированной ширины в условном комментарии `[if mso]`;
 * - стили — только в атрибуте `style` каждого элемента: Mail.ru и Gmail в
 *   части сценариев (пересылка, IMAP-ящики) выбрасывают `<style>` целиком.
 *   Блок `<style>` дублирует только то, без чего письмо остаётся читаемым, —
 *   поля на узком экране;
 * - цвет фона — ещё и атрибутом `bgcolor`: Outlook игнорирует `background-color`
 *   у `body` и `div`;
 * - шрифты — системные: веб-шрифты грузят только Apple Mail и часть мобильных
 *   клиентов, а Oswald остаётся первым в списке для них;
 * - картинок нет вовсе: большинство клиентов их не показывает до разрешения, и
 *   знак из полос собран из ячеек таблицы.
 *
 * Письмо тёмное, как дашборд, и объявляет `color-scheme: light dark`: так Apple
 * Mail и Outlook не перекрашивают его своим тёмным режимом — оно уже тёмное.
 *
 * Весь текст, пришедший не из этого файла, экранируется (`escapeHtml`): в
 * письмо попадает имя, которое человек вписал при регистрации, и оно не должно
 * становиться разметкой. Условные комментарии Outlook — не пояснения, а
 * разметка для его движка: без них письмо у него растягивается на всю ширину.
 */

/** Цвета — токены темы дашборда (`packages/app-kit/src/theme.css`), переведённые из oklch в hex: oklch почтовые клиенты не понимают. */
const COLOR = {
  bg: '#100f0d',
  surface: '#1a1917',
  border: '#31302d',
  borderStrong: '#76746f',
  fg: '#f1eee6',
  muted: '#adaba4',
  accent: '#f5d336',
  accentFg: '#181611',
} as const;

/** Полосы знака — те же, что в `Logo` из app-kit: белый, жёлтый, голубой, зелёный, пурпурный, красный, синий. */
const SIGN_STRIPES = ['#eeeae2', '#f5d336', '#2ea3b4', '#40a85a', '#d0509c', '#e0473d', '#6b84ea'];

/** Серая шкала нижнего ряда испытательной таблицы (`step-0` … `step-7`). */
const GRAY_SCALE = [
  '#0d0d0c',
  '#262523',
  '#403f3b',
  '#5c5a55',
  '#7a7872',
  '#9b9891',
  '#c2bfb7',
  '#eeeae2',
];

const FONT_BODY = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_PLATE =
  "Oswald, 'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif";

/** Ширина письма. 600 — ширина, которую держат все клиенты без горизонтальной прокрутки. */
const WIDTH = 600;

export type MailBlock =
  | { kind: 'paragraph'; text: string }
  /** Сведения «подпись — значение»: когда, какое устройство, сколько. */
  | { kind: 'details'; rows: ReadonlyArray<{ label: string; value: string }> }
  /** Главное действие письма — жёлтая кнопка; адрес дублируется текстом под ней. */
  | { kind: 'action'; label: string; url: string }
  /** «Если это были не вы» — выделено нейтральной чертой слева: жёлтый занят действием. */
  | { kind: 'notice'; text: string }
  | { kind: 'links'; items: ReadonlyArray<{ label: string; url: string; note?: string }> };

export interface MailContent {
  language: MailLanguage;
  subject: string;
  /** Строка, которую клиент показывает в списке писем рядом с темой. */
  preheader: string;
  /** Заголовок-табличка. Короткий: набирается прописными. */
  heading: string;
  greeting: string;
  blocks: readonly MailBlock[];
  /** Почему пришло письмо. Внизу, мелко. */
  footnote: string;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Текст как текст: имя вида `<b>` в письме — пять символов, а не жирный шрифт. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

const SIGNATURE: Record<MailLanguage, string> = {
  ru: 'Команда StreamKit',
  en: 'The StreamKit team',
};

const LINK_HINT: Record<MailLanguage, string> = {
  ru: 'Если кнопка не открывается, скопируйте адрес в браузер:',
  en: 'If the button does not open, copy this address into your browser:',
};

/**
 * Письмо целиком: HTML и текстовая версия из одного содержимого.
 *
 * Текстовую версию письмо несёт всегда (`multipart/alternative`): её
 * показывают клиенты с выключенным HTML, часы и уведомления, а спам-фильтры
 * смотрят косо на письмо без неё.
 */
export function renderMail(content: MailContent): RenderedMail {
  return { subject: content.subject, html: renderHtml(content), text: renderText(content) };
}

function renderText(content: MailContent): string {
  const lines: string[] = [content.greeting, ''];
  for (const block of content.blocks) {
    switch (block.kind) {
      case 'paragraph':
      case 'notice':
        lines.push(block.text, '');
        break;
      case 'details':
        for (const row of block.rows) lines.push(`${row.label}: ${row.value}`);
        lines.push('');
        break;
      case 'action':
        lines.push(`${block.label}:`, block.url, '');
        break;
      case 'links':
        for (const item of block.items) {
          lines.push(`${item.label}${item.note ? ` (${item.note})` : ''}: ${item.url}`);
        }
        lines.push('');
        break;
    }
  }
  lines.push(`— ${SIGNATURE[content.language]}`, '', content.footnote);
  return lines.join('\n');
}

function renderHtml(content: MailContent): string {
  const body = content.blocks.map((block) => renderBlock(block, content.language)).join('');

  return `<!DOCTYPE html>
<html lang="${content.language}" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(content.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
@media only screen and (max-width:620px){
.sk-pad{padding-left:20px!important;padding-right:20px!important}
.sk-outer{padding-left:8px!important;padding-right:8px!important}
.sk-button{width:100%!important}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.bg};" bgcolor="${COLOR.bg}">
${preheader(content.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.bg}" style="width:100%;background-color:${COLOR.bg};border-collapse:collapse;">
<tr><td class="sk-outer" align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="${WIDTH}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<div style="max-width:${WIDTH}px;margin:0 auto;text-align:left;">
${header()}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.surface}" style="width:100%;background-color:${COLOR.surface};border:1px solid ${COLOR.border};border-collapse:separate;border-radius:12px;">
<tr><td class="sk-pad" style="padding:32px 40px 8px 40px;">
${plate(content.heading)}
${paragraph(content.greeting)}
${body}
${paragraph(`— ${SIGNATURE[content.language]}`, COLOR.muted)}
</td></tr>
</table>
${footer(content.footnote)}
</div>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Скрытая строка превью. Хвост из невидимых символов не даёт клиенту
 * дописать в превью начало письма («Здравствуйте, …» после темы).
 */
function preheader(text: string): string {
  const filler = '&#847;&zwnj;&nbsp;'.repeat(60);
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${COLOR.bg};">${escapeHtml(text)}${filler}</div>`;
}

/** Знак: семь полос и надпись, как в шапке дашборда. */
function header(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr><td align="left" style="padding:0 0 20px 0;">${sign()}</td></tr></table>`;
}

function sign(): string {
  const stripes = SIGN_STRIPES.map(
    (color) =>
      `<td width="6" height="18" bgcolor="${color}" style="width:6px;height:18px;background-color:${color};font-size:0;line-height:0;">&nbsp;</td>`,
  ).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>${stripes}<td style="padding:0 0 0 10px;font-family:${FONT_PLATE};font-size:18px;line-height:18px;font-weight:600;letter-spacing:0.04em;color:${COLOR.fg};text-transform:uppercase;mso-line-height-rule:exactly;">StreamKit</td></tr>
</table>`;
}

/** Табличка заголовка: светлая плашка с тёмными прописными, как h1 дашборда. */
function plate(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 24px 0;">
<tr><td bgcolor="${COLOR.fg}" style="background-color:${COLOR.fg};border-radius:2px;padding:4px 10px 5px 10px;font-family:${FONT_PLATE};font-size:22px;line-height:26px;font-weight:600;letter-spacing:0.01em;text-transform:uppercase;color:${COLOR.bg};mso-line-height-rule:exactly;">${escapeHtml(text)}</td></tr>
</table>`;
}

function paragraph(text: string, color: string = COLOR.fg): string {
  return `<p style="margin:0 0 16px 0;font-family:${FONT_BODY};font-size:16px;line-height:24px;color:${color};mso-line-height-rule:exactly;">${escapeHtml(text)}</p>`;
}

function renderBlock(block: MailBlock, language: MailLanguage): string {
  switch (block.kind) {
    case 'paragraph':
      return paragraph(block.text);
    case 'details':
      return details(block.rows);
    case 'action':
      return action(block.label, block.url, language);
    case 'notice':
      return notice(block.text);
    case 'links':
      return links(block.items);
  }
}

function details(rows: ReadonlyArray<{ label: string; value: string }>): string {
  const cells = rows
    .map(
      (row, index) =>
        `<tr><td style="padding:${index === 0 ? '0' : '12px'} 0 0 0;font-family:${FONT_BODY};mso-line-height-rule:exactly;">` +
        `<div style="font-size:13px;line-height:18px;color:${COLOR.muted};">${escapeHtml(row.label)}</div>` +
        `<div style="font-size:16px;line-height:24px;font-weight:600;color:${COLOR.fg};font-variant-numeric:tabular-nums;">${escapeHtml(row.value)}</div>` +
        `</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.bg}" style="width:100%;background-color:${COLOR.bg};border-collapse:separate;border-radius:8px;margin:0 0 20px 0;">
<tr><td style="padding:16px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${cells}</table></td></tr>
</table>`;
}

/**
 * Кнопка — ячейка с фоном и ссылкой внутри: так она кликабельна целиком и в
 * Outlook, который не рисует ни `padding` у ссылки, ни скруглений (там она
 * просто прямоугольная). Адрес текстом под кнопкой — для клиентов, где
 * кнопку не нажать: в текстовом режиме, в предпросмотре, с блокировкой ссылок.
 */
function action(label: string, url: string, language: MailLanguage): string {
  const href = escapeHtml(url);
  return `<table role="presentation" class="sk-button" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:4px 0 12px 0;">
<tr><td align="center" bgcolor="${COLOR.accent}" style="background-color:${COLOR.accent};border-radius:8px;mso-padding-alt:12px 24px;">
<a href="${href}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${FONT_BODY};font-size:16px;line-height:20px;font-weight:600;color:${COLOR.accentFg};text-decoration:none;border-radius:8px;mso-line-height-rule:exactly;">${escapeHtml(label)}</a>
</td></tr>
</table>
<p style="margin:0 0 20px 0;font-family:${FONT_BODY};font-size:13px;line-height:18px;color:${COLOR.muted};word-break:break-all;mso-line-height-rule:exactly;">${escapeHtml(LINK_HINT[language])}<br><a href="${href}" target="_blank" style="color:${COLOR.fg};text-decoration:underline;">${href}</a></p>`;
}

function notice(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 20px 0;">
<tr><td width="2" bgcolor="${COLOR.borderStrong}" style="width:2px;background-color:${COLOR.borderStrong};font-size:0;line-height:0;">&nbsp;</td>
<td style="padding:2px 0 2px 14px;font-family:${FONT_BODY};font-size:15px;line-height:22px;color:${COLOR.fg};mso-line-height-rule:exactly;">${escapeHtml(text)}</td></tr>
</table>`;
}

function links(items: ReadonlyArray<{ label: string; url: string; note?: string }>): string {
  const rows = items
    .map(
      (item) =>
        `<tr><td valign="top" width="14" style="width:14px;padding:5px 0 0 0;font-size:0;line-height:0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="6" height="12" bgcolor="${COLOR.borderStrong}" style="width:6px;height:12px;background-color:${COLOR.borderStrong};border-radius:1px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td>` +
        `<td style="padding:0 0 12px 0;font-family:${FONT_BODY};font-size:16px;line-height:24px;color:${COLOR.fg};mso-line-height-rule:exactly;">` +
        `<a href="${escapeHtml(item.url)}" target="_blank" style="color:${COLOR.fg};text-decoration:underline;">${escapeHtml(item.label)}</a>` +
        (item.note
          ? `<div style="font-size:13px;line-height:18px;color:${COLOR.muted};">${escapeHtml(item.note)}</div>`
          : '') +
        `</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 8px 0;">${rows}</table>`;
}

/** Подвал: серая шкала таблицы и строка о том, почему пришло письмо. */
function footer(footnote: string): string {
  const steps = GRAY_SCALE.map(
    (color) =>
      `<td width="12.5%" height="6" bgcolor="${color}" style="height:6px;background-color:${color};font-size:0;line-height:0;">&nbsp;</td>`,
  ).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:24px 0 16px 0;">
<tr>${steps}</tr>
</table>
<p style="margin:0;padding:0 4px;text-align:left;font-family:${FONT_BODY};font-size:12px;line-height:18px;color:${COLOR.muted};mso-line-height-rule:exactly;">${escapeHtml(footnote)}</p>`;
}
