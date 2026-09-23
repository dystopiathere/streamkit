import {
  MIN_ROULETTE_SECTORS,
  type RouletteSector,
  rouletteSectorColor,
} from '@streamkit/contracts';
import { ArrowDown, ArrowUp, Plus, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  Controller,
  type FieldValues,
  useFieldArray,
  type UseFormReturn,
  useWatch,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, FieldError, Input } from '@streamkit/app-kit';
import { toast } from 'sonner';
import { intlLocale } from '@/lib/locale';
import { IconButton } from './AlertTriggers';
import { type CsvSector, decodeCsv, parseSectorsCsv } from './sectors-csv';

/**
 * Сектора колеса: подпись, вес и цвет.
 *
 * Шанс показан рядом с весом процентом — стример задаёт вес, а думает о шансе,
 * и «вес 3» без подсказки ничего не говорит. Доля круга на колесе та же, что
 * шанс: что видят зрители, то и выпадает.
 *
 * Порядок — стрелками, как у триггеров: перетаскивание не повторить с
 * клавиатуры, а соседство секторов на колесе стример расставляет сознательно
 * (чтобы «ничего» не стояло рядом с главным призом).
 */
export function RouletteSectors({
  form,
  maxSectors,
}: {
  form: UseFormReturn<FieldValues>;
  /** Сколько секторов помещается: у колеса и у ленты по-разному. */
  maxSectors: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { fields, append, remove, move, replace } = useFieldArray({
    control: form.control,
    name: 'sectors',
  });
  const file = useRef<HTMLInputElement>(null);
  // Секторов в файле больше, чем влезает: спрашиваем, брать ли первые.
  const [tooMany, setTooMany] = useState<CsvSector[] | null>(null);
  const sectors = (useWatch({ control: form.control, name: 'sectors' }) ?? []) as RouletteSector[];
  const total = sectors.reduce((sum, sector) => sum + (Number(sector.weight) || 0), 0);
  const percent = new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1 });
  const listError = (form.formState.errors.sectors as { message?: string } | undefined)?.message;

  const add = (): void => {
    append({
      id: crypto.randomUUID(),
      label: t('widgets.roulette.newSector', { number: fields.length + 1 }),
      weight: 1,
      color: rouletteSectorColor(fields.length, fields.length + 1),
    });
  };

  // Список из файла заменяет сектора целиком, а не дописывается: файл — это
  // весь список, и «добавить к тому, что было» дало бы дубли.
  const load = (sectors: CsvSector[]): void => {
    replace(
      sectors.map((sector, index) => ({
        id: crypto.randomUUID(),
        label: sector.label,
        weight: sector.weight,
        color: rouletteSectorColor(index, sectors.length),
      })),
    );
    toast.success(t('widgets.roulette.csvLoaded', { count: sectors.length }));
  };

  const read = async (chosen: File): Promise<void> => {
    const parsed = parseSectorsCsv(decodeCsv(await chosen.arrayBuffer()));
    if (!parsed.ok) {
      if ('empty' in parsed) {
        toast.error(t('widgets.roulette.csvEmpty'));
        return;
      }
      toast.error(
        [
          t('widgets.roulette.csvBad'),
          ...parsed.issues.map((issue) =>
            t(`widgets.roulette.csvIssue.${issue.kind}`, { line: issue.line }),
          ),
        ].join('\n'),
      );
      return;
    }
    if (parsed.sectors.length < MIN_ROULETTE_SECTORS) {
      toast.error(t('widgets.roulette.csvTooFew', { min: MIN_ROULETTE_SECTORS }));
      return;
    }
    // Предупреждение с выбором, а не молчаливая обрезка: в файле мог быть не
    // тот список, и потерю половины розыгрыша стример заметил бы в эфире.
    if (parsed.sectors.length > maxSectors) {
      setTooMany(parsed.sectors);
      return;
    }
    load(parsed.sectors);
  };

  // Цвета по кругу проверенной палитры: после перестановок и удалений соседние
  // сектора могли получить неразличимые цвета.
  const recolor = (): void => {
    sectors.forEach((_, index) => {
      form.setValue(`sectors.${index}.color`, rouletteSectorColor(index, sectors.length), {
        shouldDirty: true,
      });
    });
  };

  return (
    <div className="space-y-4">
      <div
        aria-hidden="true"
        className="hidden grid-cols-[2.25rem_minmax(0,1fr)_4.5rem_3.5rem_7.25rem] gap-2 px-1 text-xs text-muted sm:grid"
      >
        <span>{t('widgets.roulette.color')}</span>
        <span>{t('widgets.roulette.label')}</span>
        <span>{t('widgets.roulette.weight')}</span>
        <span className="text-right">{t('widgets.roulette.chance')}</span>
      </div>

      <ol className="space-y-2" aria-label={t('widgets.roulette.listLabel')}>
        {fields.map((field, index) => {
          const sector = sectors[index];
          const label =
            sector?.label?.trim() || t('widgets.roulette.unnamed', { number: index + 1 });
          const weight = Number(sector?.weight) || 0;
          const chance = total > 0 ? (weight / total) * 100 : 0;
          const errors = (
            form.formState.errors.sectors as
              | Record<number, { label?: { message?: string }; weight?: { message?: string } }>
              | undefined
          )?.[index];

          return (
            <li key={field.id}>
              <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_4.5rem] items-center gap-2 sm:grid-cols-[2.25rem_minmax(0,1fr)_4.5rem_3.5rem_7.25rem]">
                <Controller
                  control={form.control}
                  name={`sectors.${index}.color`}
                  render={({ field: color }) => (
                    <input
                      type="color"
                      aria-label={t('widgets.roulette.colorOf', { name: label })}
                      className="h-9 w-9 rounded border border-border-strong bg-bg"
                      value={
                        /^#[0-9a-fA-F]{6}/.test(String(color.value))
                          ? String(color.value).slice(0, 7)
                          : '#000000'
                      }
                      onChange={(event) => color.onChange(event.target.value.toUpperCase())}
                      onBlur={color.onBlur}
                    />
                  )}
                />
                <Input
                  aria-label={t('widgets.roulette.labelOf', { number: index + 1 })}
                  aria-invalid={errors?.label ? true : undefined}
                  maxLength={40}
                  {...form.register(`sectors.${index}.label`)}
                />
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  aria-label={t('widgets.roulette.weightOf', { name: label })}
                  aria-invalid={errors?.weight ? true : undefined}
                  className="tabular-nums"
                  {...form.register(`sectors.${index}.weight`, { valueAsNumber: true })}
                />
                <span className="col-start-2 text-xs text-muted tabular-nums sm:col-start-auto sm:text-right">
                  <span className="sm:sr-only">{t('widgets.roulette.chance')}: </span>
                  {percent.format(chance)} %
                </span>
                <div className="col-span-3 flex justify-end gap-1 sm:col-span-1">
                  <IconButton
                    label={t('widgets.roulette.up', { name: label })}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp aria-hidden="true" className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={t('widgets.roulette.down', { name: label })}
                    disabled={index === fields.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown aria-hidden="true" className="h-4 w-4" />
                  </IconButton>
                  {/* Меньше двух секторов — не колесо: удалить последнюю пару нельзя. */}
                  <IconButton
                    label={t('common.deleteNamed', { name: label })}
                    disabled={fields.length <= MIN_ROULETTE_SECTORS}
                    onClick={() => remove(index)}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
              <FieldError
                id={`sectors.${index}`}
                message={errors?.label?.message ?? errors?.weight?.message}
              />
            </li>
          );
        })}
      </ol>
      <FieldError id="sectors" message={listError} />

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button variant="secondary" onClick={add} disabled={fields.length >= maxSectors}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          {t('widgets.roulette.add')}
        </Button>
        <Button variant="ghost" onClick={() => file.current?.click()}>
          <Upload aria-hidden="true" className="h-4 w-4" />
          {t('widgets.roulette.csvLoad')}
        </Button>
        <Button variant="ghost" onClick={recolor}>
          {t('widgets.roulette.recolor')}
        </Button>
        <span className="ml-auto text-xs text-muted tabular-nums">
          {t('widgets.roulette.count', { used: fields.length, max: maxSectors })}
        </span>
        <input
          ref={file}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          aria-label={t('widgets.roulette.csvLoad')}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            // Поле очищается сразу: тот же файл, выбранный второй раз (его
            // поправили в Excel), иначе не даёт события.
            event.target.value = '';
            if (chosen) void read(chosen);
          }}
        />
      </div>

      <ConfirmDialog
        open={tooMany !== null}
        title={t('widgets.roulette.csvTooManyTitle')}
        confirmLabel={t('common.yes')}
        cancelLabel={t('common.no')}
        onConfirm={() => {
          if (tooMany) load(tooMany.slice(0, maxSectors));
          setTooMany(null);
        }}
        onClose={() => setTooMany(null)}
      >
        <p>{t('widgets.roulette.csvTooMany', { count: tooMany?.length ?? 0, max: maxSectors })}</p>
      </ConfirmDialog>
      <p className="max-w-prose text-xs text-muted">{t('widgets.roulette.weightHint')}</p>
      <p className="max-w-prose text-xs text-muted">{t('widgets.roulette.csvHint')}</p>
    </div>
  );
}
