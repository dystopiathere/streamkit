import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useForm, type FieldValues } from 'react-hook-form';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultWidgetConfig } from '@streamkit/contracts';
import { LayoutSection } from './AdvancedStyling';
import i18n from '@/lib/i18n';

// Тариф без продвинутого оформления. Плашка тарифа здесь не нужна — только гейт.
vi.mock('@/features/billing/PlanPaywall', () => ({
  usePlanAccess: () => false,
  usePlanFeatures: () => null,
  PlanPaywall: () => null,
}));

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

function Editor(): React.JSX.Element {
  const form = useForm<FieldValues>({
    defaultValues: defaultWidgetConfig('goal').config as FieldValues,
  });
  return (
    <>
      <output data-testid="dirty">{String(form.formState.isDirty)}</output>
      <LayoutSection form={form} type="goal" />
    </>
  );
}

/**
 * Без «Про» раскладка видна, но не правится. `fieldset disabled` гасит щелчки и
 * клавиши, а события указателя до кнопки доходят — так и было: элемент
 * перетаскивался, и форма отмечала несохранённые изменения, которые в кадр всё
 * равно не уйдут.
 */
describe('раскладка без тарифа «Про»', () => {
  it('перетаскивание не двигает элемент и не меняет форму', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Editor />
      </QueryClientProvider>,
    );
    const frame = document.querySelector('.aspect-video')!;
    frame.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 800,
        height: 450,
        right: 800,
        bottom: 450,
        x: 0,
        y: 0,
      }) as DOMRect;
    const title = screen.getByRole('button', { name: /^Заголовок:/ });
    title.setPointerCapture = () => undefined;

    fireEvent.pointerDown(title, { pointerId: 1, button: 0, clientX: 400, clientY: 225 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerUp(title, { pointerId: 1 });
    fireEvent.keyDown(title, { key: 'ArrowRight' });

    expect(title.getAttribute('aria-label')).toContain('позиция не задана');
    expect(screen.getByTestId('dirty').textContent).toBe('false');
  });
});
