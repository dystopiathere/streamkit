import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { useForm, useWatch, type FieldValues } from 'react-hook-form';
import { beforeAll, describe, expect, it } from 'vitest';
import { type AlertEventType, defaultWidgetConfig } from '@streamkit/contracts';
import { type SectionId, WidgetConfigForm } from './WidgetConfigForm';
import { triggerSampleAmount } from './WidgetPreview';
import i18n from '@/lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

function Editor({ triggers = [] }: { triggers?: unknown[] }): React.JSX.Element {
  const config = defaultWidgetConfig('alerts').config as FieldValues;
  const form = useForm<FieldValues>({
    defaultValues: {
      ...config,
      scenarios: {
        ...config.scenarios,
        donation: { ...config.scenarios.donation, titleTemplate: 'основной', triggers },
      },
    },
  });
  const [section, setSection] = useState<SectionId>('triggers');
  const [trigger, setTrigger] = useState<string | null>(null);
  const [scenario, setScenario] = useState<AlertEventType>('donation');
  const values = useWatch({ control: form.control, name: 'scenarios.donation' }) as {
    titleTemplate: string;
    triggers: { titleTemplate: string; condition: { amountMinor: number } }[];
  };
  return (
    <>
      <output data-testid="base-title">{values.titleTemplate}</output>
      <output data-testid="trigger-titles">
        {values.triggers.map((item) => item.titleTemplate).join('|')}
      </output>
      <WidgetConfigForm
        type="alerts"
        form={form}
        state={null}
        currency="RUB"
        section={section}
        onSectionChange={setSection}
        alertScenario={scenario}
        onAlertScenarioChange={(next) => {
          setScenario(next);
          setTrigger(null);
        }}
        alertTrigger={trigger}
        onAlertTriggerChange={setTrigger}
      />
    </>
  );
}

function renderEditor(triggers?: unknown[]): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Editor triggers={triggers} />
    </QueryClientProvider>,
  );
}

const trigger = (id: string, operator: string, amountMinor: number) => ({
  ...(defaultWidgetConfig('alerts').config as { scenarios: { donation: object } }).scenarios
    .donation,
  id,
  name: '',
  titleTemplate: id,
  condition: { operator, currency: 'RUB', amountMinor, toMinor: null },
});

describe('триггеры доната', () => {
  it('новый триггер берёт вид сценария, а его правка не трогает основной вид', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить триггер' }));
    expect(screen.getByTestId('trigger-titles').textContent).toBe('основной');

    // «Настроить вид» переключает разделы на триггер и подписывает это словом.
    fireEvent.click(screen.getAllByRole('button', { name: 'Настроить вид' })[0]!);
    expect(screen.getByText(/Вид триггера:/)).toBeTruthy();
    // Списка триггеров среди вкладок нет: пока правят триггер, вкладки — его.
    expect(screen.queryByRole('tab', { name: 'Триггеры' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Текст' }));
    fireEvent.change(screen.getByLabelText('Заголовок'), { target: { value: 'от тысячи' } });

    expect(screen.getByTestId('trigger-titles').textContent).toBe('от тысячи');
    expect(screen.getByTestId('base-title').textContent).toBe('основной');

    // «К списку триггеров» и выводит к списку, и выходит из триггера: пока он
    // выбран, те же поля правили бы его, а не основной вид.
    fireEvent.click(screen.getByRole('button', { name: /К списку триггеров/ }));
    expect(screen.getByRole('list', { name: 'Триггеры по приоритету' })).toBeTruthy();
    expect(screen.queryByText(/Вид триггера:/)).toBeNull();

    // И теперь те же разделы правят основной вид.
    fireEvent.click(screen.getByRole('tab', { name: 'Текст' }));
    fireEvent.change(screen.getByLabelText('Заголовок'), { target: { value: 'обычный' } });
    expect(screen.getByTestId('base-title').textContent).toBe('обычный');
    expect(screen.getByTestId('trigger-titles').textContent).toBe('от тысячи');
  });

  it('в списке нет карточки основного вида: выход из триггера и есть возврат к нему', () => {
    renderEditor([trigger('first', 'gte', 100_000)]);
    const items = within(screen.getByRole('list', { name: 'Триггеры по приоритету' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(1);
    expect(screen.queryByText('Основной вид')).toBeNull();
  });

  it('стёртая сумма не роняет страницу: NaN сам себе не равен', () => {
    // Раньше поле сверяло значение через `!==`, а `NaN !== NaN` истинно всегда:
    // состояние правилось на каждом рендере, и страница падала React #301.
    renderEditor([trigger('first', 'gte', 100_000)]);
    const amount = screen.getByLabelText('Сумма, ₽');
    fireEvent.change(amount, { target: { value: '' } });
    expect((amount as HTMLInputElement).value).toBe('');
    fireEvent.change(amount, { target: { value: '2000' } });
    expect((amount as HTMLInputElement).value).toBe('2000');
  });

  it('стрелки меняют приоритет', () => {
    renderEditor([trigger('first', 'gte', 100_000), trigger('second', 'eq', 50_000)]);
    fireEvent.click(screen.getByRole('button', { name: /Поднять «ровно 500/ }));
    expect(screen.getByTestId('trigger-titles').textContent).toBe('second|first');
  });

  it('предупреждает, что триггер выше ловит суммы этого', () => {
    // «от 500» стоит выше «ровно 1000» — до второго донат на тысячу не дойдёт.
    renderEditor([trigger('wide', 'gte', 50_000), trigger('exact', 'eq', 100_000)]);
    const items = within(screen.getByRole('list', { name: 'Триггеры по приоритету' })).getAllByRole(
      'listitem',
    );
    expect(items[0]!.textContent).not.toMatch(/заберёт триггер выше/);
    expect(items[1]!.textContent).toMatch(/заберёт триггер выше — «от 500/);
  });

  it('настройка всего виджета не повторяется в разделах сценария', () => {
    // «События YouTube» — настройка виджета, а не сценария: в разделах она
    // стояла бы в каждом сценарии и читалась бы как настройка доната.
    renderEditor();
    expect(screen.queryByLabelText(/События YouTube/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Показ' }));
    expect(screen.queryByLabelText(/События YouTube/)).toBeNull();
  });

  it('вкладка триггеров — только у доната', () => {
    renderEditor();
    expect(screen.getByRole('tab', { name: 'Триггеры' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Фолловер' }));
    expect(screen.queryByRole('tab', { name: 'Триггеры' })).toBeNull();
  });

  it('пример суммы подходит под условие: строго больше и меньше — на рубль от границы', () => {
    const at = (operator: string) =>
      triggerSampleAmount({
        condition: { operator, currency: 'RUB', amountMinor: 100_000, toMinor: null },
      } as never).amountMinor;
    expect(at('gt')).toBe(100_100);
    expect(at('lt')).toBe(99_900);
    expect(at('eq')).toBe(100_000);
  });
});
