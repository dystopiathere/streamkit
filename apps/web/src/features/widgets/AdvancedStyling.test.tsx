import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useForm, type FieldValues } from 'react-hook-form';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultWidgetConfig } from '@streamkit/contracts';
import { LayoutSection } from './AdvancedStyling';
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
  return <LayoutSection form={form} type="goal" />;
}

function renderEditor(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Editor />
    </QueryClientProvider>,
  );
}

/** Точное значение ползунка выбранного элемента — в поле числа рядом с ним. */
function value(label: string): string {
  return (screen.getByLabelText(`${label}, %`) as HTMLInputElement).value;
}

/** Кадр в jsdom размеров не имеет: задаём их, как это сделал бы браузер. */
function sizeFrame(width = 800, height = 450): void {
  const frame = document.querySelector('.aspect-video');
  if (!frame) throw new Error('Кадр раскладки не найден');
  frame.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
}

function element(name: string): HTMLElement {
  const button = screen.getByRole('button', { name: new RegExp(`^${name}:`) });
  // jsdom не реализует захват указателя, но код его вызывает.
  button.setPointerCapture = () => undefined;
  button.releasePointerCapture = () => undefined;
  return button;
}

describe('раскладка элементов в кадре', () => {
  it('щелчок выбирает элемент и ничего не сдвигает', () => {
    // Раньше выбор ничем не отмечался: элемент подсвечивался только в движении,
    // и после щелчка было непонятно, выбран он или щелчок пропал.
    renderEditor();
    sizeFrame();
    const bar = element('Полоса');
    expect(bar.getAttribute('aria-pressed')).toBe('false');

    fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 400, clientY: 225 });
    fireEvent.pointerUp(bar, { pointerId: 1 });

    expect(bar.getAttribute('aria-pressed')).toBe('true');
    expect(element('Заголовок').getAttribute('aria-pressed')).toBe('false');
    // Дрожь руки при щелчке не ставит позицию элементу, стоящему в потоке.
    expect(bar.getAttribute('aria-label')).toContain('позиция не задана');
  });

  it('перетаскивание указателем доводит элемент до конца жеста', () => {
    renderEditor();
    sizeFrame();
    const title = element('Заголовок');

    fireEvent.pointerDown(title, { pointerId: 1, button: 0, clientX: 400, clientY: 225 });
    // Движение приходит УЖЕ ПОСЛЕ того, как обработчик вернул управление, —
    // именно здесь React обнуляет `currentTarget` у синтетического события.
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 200, clientY: 90 });

    expect(value('По горизонтали')).toBe('25');
    expect(value('По вертикали')).toBe('20');

    fireEvent.pointerUp(title, { pointerId: 1 });
    // После отпускания элемент за мышью не едет.
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 720, clientY: 400 });
    expect(value('По горизонтали')).toBe('25');
  });

  it('стрелки двигают элемент, а Shift — крупным шагом', () => {
    renderEditor();
    const title = element('Заголовок');

    fireEvent.keyDown(title, { key: 'ArrowRight' });
    // Первое нажатие считается от места в потоке, а не от нуля.
    expect(value('По горизонтали')).toBe('51');

    fireEvent.keyDown(title, { key: 'ArrowRight', shiftKey: true });
    expect(value('По горизонтали')).toBe('61');

    fireEvent.keyDown(title, { key: 'ArrowUp', shiftKey: true });
    expect(value('По вертикали')).toBe('10');
  });

  it('за края кадра элемент не уходит', () => {
    renderEditor();
    const title = element('Заголовок');
    for (let press = 0; press < 12; press += 1) {
      fireEvent.keyDown(title, { key: 'ArrowLeft', shiftKey: true });
    }
    expect(value('По горизонтали')).toBe('0');
  });

  it('«Сбросить раскладку» возвращает все элементы в поток', () => {
    renderEditor();
    const reset = screen.getByRole('button', { name: 'Сбросить раскладку' });
    // Сбрасывать нечего — кнопка не притворяется рабочей.
    expect((reset as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(element('Заголовок'), { key: 'ArrowRight' });
    fireEvent.keyDown(element('Полоса'), { key: 'ArrowDown' });
    expect((reset as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(reset);

    expect(element('Заголовок').getAttribute('aria-label')).toContain('позиция не задана');
    expect(element('Полоса').getAttribute('aria-label')).toContain('позиция не задана');
    expect((reset as HTMLButtonElement).disabled).toBe(true);
  });
});
