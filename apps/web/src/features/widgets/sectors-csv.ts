/**
 * Разбор списка секторов из CSV.
 *
 * Формат — `название;вес`, разделитель точка с запятой: так по умолчанию
 * сохраняет CSV Excel с русскими настройками, и стример получает файл, который
 * уже лежит у него, а не «экспортируйте с запятой».
 *
 * Файл разбирается ЦЕЛИКОМ и только потом попадает в форму: список, заполненный
 * наполовину и оборванный на ошибке в середине, пришлось бы разбирать руками —
 * а он мог быть на сотню строк.
 */
export interface CsvSector {
  label: string;
  weight: number;
}

export type CsvIssue =
  | { line: number; kind: 'fields' }
  | { line: number; kind: 'label' }
  | { line: number; kind: 'weight' };

export type CsvParse =
  | { ok: true; sectors: CsvSector[] }
  | { ok: false; issues: CsvIssue[] }
  | { ok: false; issues: []; empty: true };

/** Сколько ошибок показываем: список на сто строк даёт сто одинаковых жалоб. */
export const MAX_CSV_ISSUES = 5;

export const MAX_SECTOR_LABEL = 40;
export const MAX_SECTOR_WEIGHT = 1000;

export function parseSectorsCsv(text: string): CsvParse {
  const lines = text
    .split(/\r?\n/)
    .map((line, index) => ({ text: line.trim(), line: index + 1 }))
    .filter((row) => row.text.length > 0);

  // Шапка `название;вес` — то, что Excel показывает первой строкой: она не
  // сектор, и падать на ней было бы придиркой.
  const rows = lines.filter((row, index) => !(index === 0 && isHeader(row.text)));
  if (rows.length === 0) return { ok: false, issues: [], empty: true };

  const issues: CsvIssue[] = [];
  const sectors: CsvSector[] = [];
  for (const row of rows) {
    const fields = row.text.split(';');
    if (fields.length !== 2) {
      issues.push({ line: row.line, kind: 'fields' });
      continue;
    }
    const label = fields[0]!
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .trim();
    // Дробную часть и пробелы внутри числа не додумываем: «1 000» и «2,5» —
    // это не вес, а чужой формат, и молча округлить его значило бы изменить
    // шансы, о которых стример не просил.
    const weight = Number(
      fields[1]!
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .trim(),
    );
    if (label.length === 0 || label.length > MAX_SECTOR_LABEL) {
      issues.push({ line: row.line, kind: 'label' });
      continue;
    }
    if (!Number.isInteger(weight) || weight < 1 || weight > MAX_SECTOR_WEIGHT) {
      issues.push({ line: row.line, kind: 'weight' });
      continue;
    }
    sectors.push({ label, weight });
  }

  if (issues.length > 0) return { ok: false, issues: issues.slice(0, MAX_CSV_ISSUES) };
  return { ok: true, sectors };
}

function isHeader(line: string): boolean {
  const [first, second] = line.split(';').map((value) => value.trim().toLowerCase());
  if (second === undefined) return false;
  return (
    ['название', 'сектор', 'label', 'name'].includes(first ?? '') &&
    ['вес', 'weight', 'шанс'].includes(second)
  );
}

/**
 * Текст файла из байтов.
 *
 * Excel в русской Windows сохраняет CSV в windows-1251, и прочитанные как UTF-8
 * подписи приезжают крокозябрами — это выглядит как поломка сервиса, а не как
 * чужая кодировка. Поэтому сначала строгий UTF-8, и только если он не сходится —
 * windows-1251. BOM снимается: иначе первая подпись начинается с невидимого
 * знака, и «Ничего» не равно «Ничего».
 */
export function decodeCsv(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes);
  try {
    return strip(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } catch {
    try {
      return strip(new TextDecoder('windows-1251').decode(data));
    } catch {
      // Движок без старых кодировок: читаем как UTF-8 с заменой негодных байт.
      return strip(new TextDecoder().decode(data));
    }
  }
}

function strip(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
