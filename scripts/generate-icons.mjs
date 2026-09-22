// Иконки приложения и картинка для соцсетей из знака StreamKit — тех же семи
// полос испытательной таблицы, что в шапке (`Logo` в
// packages/app-kit/src/primitives.tsx).
//
// Растры рисуются здесь, а не экспортом из редактора: знак — прямоугольники, и
// каждая полоса ложится на целые пиксели своего размера. Масштабированная
// картинка на 16 px размыла бы полосы в серую кашу. Зависимостей нет — PNG и ICO
// собираются вручную, поэтому скрипт запускается голым Node:
//
//   node scripts/generate-icons.mjs
//
// Меняешь цвета знака — меняй их и в `Logo`, и здесь, и перезапускай скрипт.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

/** Полосы в порядке `Logo`: белый, жёлтый, голубой, зелёный, пурпурный, красный, синий. */
const BARS = ['#eeeae2', '#f5d336', '#2ea3b4', '#40a85a', '#d0509c', '#e0473d', '#6b84ea'];
/** Фон дашборда: `--color-bg` из theme.css (oklch 0.17 0.004 90) в sRGB. */
const GROUND = '#100f0d';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Геометрия знака на квадрате `size`.
 *
 * Полосы — целой ширины, блок 3:2, как в `Logo` (21 × 14). `inset` — доля
 * стороны под поля: у маскируемой иконки система обрезает края кругом, и знак
 * обязан уместиться в безопасную зону (круг в 80 % стороны).
 */
function layout(size, inset) {
  const pad = Math.max(1, Math.round(size * inset));
  const bar = Math.max(1, Math.floor((size - 2 * pad) / BARS.length));
  const width = bar * BARS.length;
  const height = Math.round((width * 2) / 3);
  return {
    bar,
    x: Math.floor((size - width) / 2),
    y: Math.floor((size - height) / 2),
    width,
    height,
  };
}

function hex(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * RGBA-пиксели иконки. Скруглённые углы плитки сглаживаются подвыборкой 4 × 4;
 * полосы стоят на целых пикселях и в сглаживании не нуждаются.
 */
function draw(size, { inset, radius }) {
  const mark = layout(size, inset);
  const ground = hex(GROUND);
  const bars = BARS.map(hex);
  const r = size * radius;
  const pixels = Buffer.alloc(size * size * 4);

  const insideTile = (px, py) => {
    if (r === 0) return true;
    const cx = Math.min(Math.max(px, r), size - r);
    const cy = Math.min(Math.max(py, r), size - r);
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          if (insideTile(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) covered += 1;
        }
      }
      const inMark =
        x >= mark.x && x < mark.x + mark.width && y >= mark.y && y < mark.y + mark.height;
      const color = inMark ? bars[Math.floor((x - mark.x) / mark.bar)] : ground;
      const offset = (y * size + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = Math.round((covered / 16) * 255);
    }
  }
  return pixels;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function png(size, pixels, height = size) {
  const width = size;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // бит на канал
  header[9] = 6; // RGBA
  // Каждая строка — с байтом фильтра «без фильтра» впереди.
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO с PNG внутри: так его понимают все браузеры, которым вообще нужен .ico. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // тип: иконка
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size % 256;
    entry[1] = size % 256;
    entry.writeUInt16LE(1, 4); // плоскости
    entry.writeUInt16LE(32, 6); // бит на пиксель
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
}

/**
 * Картинка для соцсетей и мессенджеров (og:image), 1200 × 630.
 *
 * Та же таблица крупно: полосы знака и под ними ступени серой шкалы — как на
 * настоящей испытательной таблице и на главной. Текста нет намеренно: название
 * и описание ссылки мессенджер печатает сам из og:title и og:description, а
 * надпись в картинке пришлось бы рисовать без шрифтового движка.
 */
function ogImage() {
  const width = 1200;
  const height = 630;
  const bar = 120;
  const barsWidth = bar * BARS.length;
  const barsHeight = 330;
  const steps = 8;
  const stripHeight = 60;
  const gap = 24;
  const x0 = (width - barsWidth) / 2;
  const y0 = Math.round((height - barsHeight - gap - stripHeight) / 2);
  const ground = hex(GROUND);
  const bars = BARS.map(hex);
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let color = ground;
      const inColumn = x >= x0 && x < x0 + barsWidth;
      if (inColumn && y >= y0 && y < y0 + barsHeight) {
        color = bars[Math.floor((x - x0) / bar)];
      } else if (
        inColumn &&
        y >= y0 + barsHeight + gap &&
        y < y0 + barsHeight + gap + stripHeight
      ) {
        // Серая шкала от чёрного к белому ровными ступенями.
        const step = Math.floor(((x - x0) * steps) / barsWidth);
        const level = Math.round(24 + (step * (238 - 24)) / (steps - 1));
        color = [level, level, level - 4];
      }
      const offset = (y * width + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
  return { width, height, pixels };
}

/** Векторная иконка вкладки: геометрия та же, что у растра 32 px. */
function svg() {
  const size = 32;
  const mark = layout(size, 0.06);
  const bars = BARS.map(
    (color, index) =>
      `<rect x="${mark.x + index * mark.bar}" y="${mark.y}" width="${mark.bar}" height="${mark.height}" fill="${color}"/>`,
  ).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${size * 0.18}" fill="${GROUND}"/>${bars}</svg>\n`
  );
}

/** Вкладка браузера: плитка со скруглёнными углами на прозрачном. */
const TAB = { inset: 0.06, radius: 0.18 };
/** iOS и Android скругляют сами: плитка во весь квадрат, без прозрачности. */
const FULL_BLEED = { inset: 0.12, radius: 0 };
/** Маскируемая: знак целиком в безопасном круге. */
const MASKABLE = { inset: 0.2, radius: 0 };

function write(path, data) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  process.stdout.write(`${path} — ${data.length} Б\n`);
}

const tabIco = ico([16, 32, 48].map((size) => ({ size, data: png(size, draw(size, TAB)) })));

for (const app of ['apps/web/public', 'apps/admin/public']) {
  write(`${app}/favicon.svg`, svg());
  write(`${app}/favicon.ico`, tabIco);
  write(`${app}/apple-touch-icon.png`, png(180, draw(180, FULL_BLEED)));
}
// Установка как приложения — только у дашборда: админку ставить на рабочий стол
// незачем, и манифест ей не нужен.
write('apps/web/public/icon-192.png', png(192, draw(192, TAB)));
write('apps/web/public/icon-512.png', png(512, draw(512, TAB)));
write('apps/web/public/icon-maskable-512.png', png(512, draw(512, MASKABLE)));

const og = ogImage();
write('apps/web/public/og-image.png', png(og.width, og.pixels, og.height));
