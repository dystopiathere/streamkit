import { describe, expect, it } from 'vitest';
import { decodeCsv, parseSectorsCsv } from './sectors-csv';

/**
 * Разбор CSV с секторами. Файл приходит от стримера из Excel, то есть с чем
 * угодно внутри: чужой кодировкой, шапкой, пустыми строками и запятой вместо
 * точки с запятой.
 */
describe('список секторов из CSV', () => {
  it('читает «название;вес» и пропускает пустые строки', () => {
    const result = parseSectorsCsv('Спеть песню;3\n\nОтжимания;1\n');
    expect(result).toEqual({
      ok: true,
      sectors: [
        { label: 'Спеть песню', weight: 3 },
        { label: 'Отжимания', weight: 1 },
      ],
    });
  });

  it('пропускает шапку, если она есть', () => {
    const result = parseSectorsCsv('Название;Вес\nЧеллендж;2');
    expect(result).toEqual({ ok: true, sectors: [{ label: 'Челлендж', weight: 2 }] });
  });

  it('называет строку с ошибкой, а не заполняет список наполовину', () => {
    const result = parseSectorsCsv(
      'Первый;1\nВторой, без точки с запятой\nТретий;0\nЧетвёртый;2,5',
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        { line: 2, kind: 'fields' },
        { line: 3, kind: 'weight' },
        { line: 4, kind: 'weight' },
      ],
    });
  });

  it('пустой файл — это не список из нуля секторов', () => {
    expect(parseSectorsCsv('\n\n')).toEqual({ ok: false, issues: [], empty: true });
    expect(parseSectorsCsv('Название;Вес')).toEqual({ ok: false, issues: [], empty: true });
  });

  it('подпись длиннее сорока знаков не берётся молча обрезанной', () => {
    const result = parseSectorsCsv(`${'я'.repeat(41)};1`);
    expect(result).toEqual({ ok: false, issues: [{ line: 1, kind: 'label' }] });
  });

  it('кавычки вокруг полей снимаются: их ставит Excel', () => {
    expect(parseSectorsCsv('"Выбор игры";"4"')).toEqual({
      ok: true,
      sectors: [{ label: 'Выбор игры', weight: 4 }],
    });
  });
});

describe('кодировка файла', () => {
  const utf8 = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

  it('читает UTF-8 и снимает BOM', () => {
    expect(decodeCsv(utf8('﻿Ничего;1'))).toBe('Ничего;1');
  });

  it('читает windows-1251: так Excel сохраняет CSV в русской Windows', () => {
    // «Ничего;1» в windows-1251 — именно эти байты, крокозябры из них
    // получились бы при чтении как UTF-8.
    const bytes = new Uint8Array([0xcd, 0xe8, 0xf7, 0xe5, 0xe3, 0xee, 0x3b, 0x31]);
    expect(decodeCsv(bytes.buffer as ArrayBuffer)).toBe('Ничего;1');
  });
});
