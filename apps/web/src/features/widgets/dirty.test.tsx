import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useForm, type FieldValues } from 'react-hook-form';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultWidgetConfig, type WidgetType } from '@streamkit/contracts';
import { type SectionId, WidgetConfigForm, sectionsFor } from './WidgetConfigForm';
import { isChanged } from './config-changes';
import i18n from '@/lib/i18n';

/**
 * Отметка «есть несохранённые изменения».
 *
 * Стережёт то, из-за чего она врала: слежение за полями считало изменением
 * смену НАПИСАНИЯ, а не смысла. Стёртая сумма шлёт ноль, а в сохранённом
 * конфиге ключа валюты просто нет; поле валюты, которого там нет, появляется в
 * значениях формы при первом открытии раздела — и отметка залипала до
 * перезагрузки страницы, потому что «Отменить» сбрасывала значения, а поля
 * регистрировались заново сразу после сброса.
 */
beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

function Editor({
  type,
  config,
  start,
}: {
  type: WidgetType;
  config?: FieldValues;
  start?: SectionId;
}): React.JSX.Element {
  // Значения «с сервера» считаются один раз: у цели `defaultWidgetConfig`
  // ставит время старта на момент вызова, и на каждом рендере оно было бы новым.
  const [values] = useState<FieldValues>(
    () => config ?? (defaultWidgetConfig(type).config as FieldValues),
  );
  const form = useForm<FieldValues>({ defaultValues: values });
  const [section, setSection] = useState<SectionId>(start ?? sectionsFor(type)[0]!.id);
  return (
    <>
      <output data-testid="dirty">{String(isChanged(type, values, form.watch()))}</output>
      <button type="button" onClick={() => form.reset()}>
        сбросить
      </button>
      <WidgetConfigForm
        type={type}
        form={form}
        state={null}
        currency="RUB"
        section={section}
        onSectionChange={setSection}
        alertScenario="donation"
        onAlertScenarioChange={() => undefined}
        alertTrigger={null}
        onAlertTriggerChange={() => undefined}
      />
    </>
  );
}

function renderEditor(type: WidgetType, config?: FieldValues, start?: SectionId): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Editor type={type} config={config} start={start} />
    </QueryClientProvider>,
  );
}

const dirty = (): string => screen.getByTestId('dirty').textContent!;

describe('несохранённые изменения', () => {
  it.each(['alerts', 'goal', 'timer', 'top-donors', 'chat', 'latest', 'roulette'] as const)(
    '%s: открытая форма чистая',
    (type) => {
      renderEditor(type);
      expect(dirty()).toBe('false');
    },
  );

  it('порог: стёртая сумма равна незаданной', () => {
    renderEditor('alerts');
    const field = screen.getByLabelText(/RUB/);
    fireEvent.change(field, { target: { value: '500' } });
    expect(dirty()).toBe('true');
    fireEvent.change(field, { target: { value: '' } });
    expect(dirty()).toBe('false');
  });

  it('сумма цели: набрана заново та же', () => {
    renderEditor('goal');
    const field = screen.getByLabelText(/Цель, ₽/) as HTMLInputElement;
    const before = field.value;
    fireEvent.change(field, { target: { value: '777' } });
    expect(dirty()).toBe('true');
    fireEvent.change(field, { target: { value: before } });
    expect(dirty()).toBe('false');
  });

  it('текст: возвращён прежний', () => {
    renderEditor('alerts', undefined, 'text');
    const field = screen.getByLabelText('Заголовок') as HTMLInputElement;
    const before = field.value;
    fireEvent.change(field, { target: { value: 'другое' } });
    expect(dirty()).toBe('true');
    fireEvent.change(field, { target: { value: before } });
    expect(dirty()).toBe('false');
  });

  it('галочка: снята и поставлена', () => {
    renderEditor('alerts');
    const field = screen.getByLabelText('Показывать это оповещение');
    fireEvent.click(field);
    expect(dirty()).toBe('true');
    fireEvent.click(field);
    expect(dirty()).toBe('false');
  });

  it('список: выбран другой и прежний', () => {
    renderEditor('alerts');
    const field = screen.getByLabelText('Анимация появления') as HTMLSelectElement;
    const before = field.value;
    fireEvent.change(field, { target: { value: 'bounce' } });
    expect(dirty()).toBe('true');
    fireEvent.change(field, { target: { value: before } });
    expect(dirty()).toBe('false');
  });

  it('ползунок: сдвинут и возвращён', () => {
    renderEditor('alerts');
    const field = screen.getByLabelText('Длительность показа') as HTMLInputElement;
    const before = field.value;
    fireEvent.change(field, { target: { value: '9' } });
    expect(dirty()).toBe('true');
    fireEvent.change(field, { target: { value: before } });
    expect(dirty()).toBe('false');
  });

  it('«Отменить» возвращает форму к сохранённому', () => {
    renderEditor('alerts');
    fireEvent.change(screen.getByLabelText(/RUB/), { target: { value: '500' } });
    fireEvent.click(screen.getByLabelText('Показывать это оповещение'));
    expect(dirty()).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'сбросить' }));
    expect(dirty()).toBe('false');
  });
});
