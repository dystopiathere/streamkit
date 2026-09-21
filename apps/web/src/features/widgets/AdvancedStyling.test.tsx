import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useForm, type FieldValues } from 'react-hook-form';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultWidgetConfig } from '@streamkit/contracts';
import { AdvancedStylingCard } from './AdvancedStyling';
import i18n from '@/lib/i18n';

/**
 * Раскладка элементов в кадре — единственное место дашборда, где значение
 * задаётся не набором в поле, а перетаскиванием. Два уже допущенных промаха
 * этот тест и стережёт: слушатели указателя, переживающие обработчик, и
 * незаданная позиция, превращающаяся в ноль процентов.
 *
 * Тариф здесь всегда открыт: без настроенной оплаты сервер отдаёт полный набор
 * возможностей, а `useSubscription` в тесте не отвечает вовсе — блок считает
 * доступ открытым, пока подписка не загрузилась.
 */
// Язык браузера в jsdom — английский, а подписи в тесте русские: язык
// интерфейса на раскладку не влияет, и переписывать их на en значило бы
// проверять словарь, а не поведение.
beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

function Editor(): React.JSX.Element {
  const form = useForm<FieldValues>({
    defaultValues: defaultWidgetConfig('goal').config as FieldValues,
  });
  return <AdvancedStylingCard form={form} type="goal" />;
}

function renderEditor(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Editor />
    </QueryClientProvider>,
  );
}

/** Значение поля первого элемента кадра: подписи у слотов одинаковые. */
function firstValue(label: string): string {
  return (screen.getAllByLabelText(label)[0] as HTMLInputElement).value;
}

/** Кадр в jsdom размеров не имеет: задаём их, как это сделал бы браузер. */
function sizeFrame(width = 800, height = 450): void {
  const frame = document.querySelector('.aspect-video');
  if (!frame) throw new Error('Кадр раскладки не найден');
  frame.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
}

describe('раскладка элементов в кадре', () => {
  it('незаданная позиция остаётся пустой, а не нулём процентов', () => {
    renderEditor();
    // Поля X и Y есть у каждого элемента; первый блок — заголовок.
    expect(firstValue('X, % кадра')).toBe('');
    expect(firstValue('Y, % кадра')).toBe('');
    // И сам элемент стоит там, где его рисует поток, а не в углу кадра.
    expect(screen.getByRole('button', { name: /Заголовок:/ }).getAttribute('aria-label')).toContain(
      '50 %',
    );
  });

  it('перетаскивание указателем доводит элемент до конца жеста', () => {
    renderEditor();
    sizeFrame();
    const element = screen.getByRole('button', { name: /Заголовок:/ });
    // jsdom не реализует захват указателя, но код его вызывает.
    element.setPointerCapture = () => undefined;
    element.releasePointerCapture = () => undefined;

    fireEvent.pointerDown(element, { pointerId: 1, clientX: 400, clientY: 225 });
    // Движение приходит УЖЕ ПОСЛЕ того, как обработчик вернул управление, —
    // именно здесь React обнуляет `currentTarget` у синтетического события.
    fireEvent.pointerMove(element, { pointerId: 1, clientX: 200, clientY: 90 });

    expect(firstValue('X, % кадра')).toBe('25');
    expect(firstValue('Y, % кадра')).toBe('20');

    fireEvent.pointerUp(element, { pointerId: 1 });
    // После отпускания элемент за мышью не едет.
    fireEvent.pointerMove(element, { pointerId: 1, clientX: 720, clientY: 400 });
    expect(firstValue('X, % кадра')).toBe('25');
  });

  it('стрелки двигают элемент, а Shift — крупным шагом', () => {
    renderEditor();
    sizeFrame();
    const element = screen.getByRole('button', { name: /Заголовок:/ });

    fireEvent.keyDown(element, { key: 'ArrowRight' });
    // Первое нажатие считается от места в потоке, а не от нуля.
    expect(firstValue('X, % кадра')).toBe('51');

    fireEvent.keyDown(element, { key: 'ArrowRight', shiftKey: true });
    expect(firstValue('X, % кадра')).toBe('61');

    fireEvent.keyDown(element, { key: 'ArrowUp', shiftKey: true });
    expect(firstValue('Y, % кадра')).toBe('10');
  });

  it('за края кадра элемент не уходит', () => {
    renderEditor();
    sizeFrame();
    const element = screen.getByRole('button', { name: /Заголовок:/ });
    for (let press = 0; press < 12; press += 1) {
      fireEvent.keyDown(element, { key: 'ArrowLeft', shiftKey: true });
    }
    expect(firstValue('X, % кадра')).toBe('0');
  });
});
