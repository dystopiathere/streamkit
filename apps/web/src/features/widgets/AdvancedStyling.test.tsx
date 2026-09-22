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

/**
 * Точное значение ползунка выбранного элемента — в поле числа рядом с ним.
 * В пикселях окна виджета: у новых виджетов окно 800 × 600.
 */
function value(label: string): string {
  return (screen.getByLabelText(`${label}, px`) as HTMLInputElement).value;
}

/** Кадр в jsdom размеров не имеет: задаём их, как это сделал бы браузер. */
function sizeFrame(width = 800, height = 600): void {
  const frame = document.querySelector('[data-testid="layout-frame"]');
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

    fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
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

    fireEvent.pointerDown(title, { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
    // Движение приходит УЖЕ ПОСЛЕ того, как обработчик вернул управление, —
    // именно здесь React обнуляет `currentTarget` у синтетического события.
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 200, clientY: 90 });

    // Кадр 800 × 600 на экране — окно 800 × 600: пиксели совпадают.
    expect(value('По горизонтали')).toBe('200');
    expect(value('По вертикали')).toBe('90');

    fireEvent.pointerUp(title, { pointerId: 1 });
    // После отпускания элемент за мышью не едет.
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 720, clientY: 400 });
    expect(value('По горизонтали')).toBe('200');
  });

  it('стрелки двигают элемент, а Shift — крупным шагом', () => {
    renderEditor();
    const title = element('Заголовок');

    fireEvent.keyDown(title, { key: 'ArrowRight' });
    // Первое нажатие считается от места в потоке, а не от нуля: 51 % от 800.
    expect(value('По горизонтали')).toBe('408');

    fireEvent.keyDown(title, { key: 'ArrowRight', shiftKey: true });
    expect(value('По горизонтали')).toBe('488');

    fireEvent.keyDown(title, { key: 'ArrowUp', shiftKey: true });
    expect(value('По вертикали')).toBe('60');
  });

  it('за края кадра элемент не уходит', () => {
    renderEditor();
    const title = element('Заголовок');
    for (let press = 0; press < 12; press += 1) {
      fireEvent.keyDown(title, { key: 'ArrowLeft', shiftKey: true });
    }
    expect(value('По горизонтали')).toBe('0');
  });

  it('перемещение одного элемента закрепляет остальные на их местах', () => {
    // Раньше закреплялся только тронутый: он выходил из потока, а соседи
    // съезжали на освободившееся место.
    renderEditor();
    fireEvent.keyDown(element('Заголовок'), { key: 'ArrowRight' });

    for (const name of ['Заголовок', 'Полоса', 'Суммы']) {
      expect(element(name).getAttribute('aria-label')).not.toContain('позиция не задана');
    }
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
