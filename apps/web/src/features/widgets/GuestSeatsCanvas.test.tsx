import { DEFAULT_GUEST_SEATS, defaultWidgetConfig } from '@streamkit/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { useForm, useWatch, type FieldValues } from 'react-hook-form';
import { beforeAll, describe, expect, it } from 'vitest';
import { fit, GuestSeatsCanvas } from './GuestSeatsCanvas';
import i18n from '@/lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

/** Значения формы выводятся в разметку: читать их снаружи компонента линтер не даёт. */
function Editor(): React.JSX.Element {
  const form = useForm<FieldValues>({
    defaultValues: {
      ...(defaultWidgetConfig('guests').config as FieldValues),
      layout: 'free',
      maxTiles: 2,
    },
  });
  const x = useWatch({ control: form.control, name: 'seats.0.x' }) as number;
  const width = useWatch({ control: form.control, name: 'seats.0.width' }) as number;
  return (
    <>
      <output data-testid="seat-x">{String(x)}</output>
      <output data-testid="seat-width">{String(width)}</output>
      <GuestSeatsCanvas form={form} canvas={null} />
    </>
  );
}

describe('места гостей в свободной раскладке', () => {
  it('показывает столько мест, сколько гостей может быть в кадре', () => {
    render(<Editor />);
    expect(screen.getAllByRole('button', { name: /^Место \d/ })).toHaveLength(2);
  });

  it('стрелки двигают место, Alt со стрелками — растит, и всё с клавиатуры', () => {
    render(<Editor />);
    const seat = screen.getByRole('button', { name: /^Место 1/ });
    const start = DEFAULT_GUEST_SEATS[0]!;

    fireEvent.keyDown(seat, { key: 'ArrowRight' });
    expect(screen.getByTestId('seat-x').textContent).toBe(String(start.x + 1));

    fireEvent.keyDown(seat, { key: 'ArrowDown', altKey: true });
    expect(screen.getByTestId('seat-width').textContent).toBe(String(start.width + 1));
  });

  it('рамка не уезжает за край кадра: плитку, обрезанную в OBS, видно только в эфире', () => {
    expect(fit({ x: 99, y: 1, width: 20 })).toEqual({ x: 90, y: 10, width: 20 });
    expect(fit({ x: 50, y: 50, width: 400 })).toEqual({ x: 50, y: 50, width: 100 });
    expect(fit({ x: 50, y: 50, width: 1 }).width).toBe(5);
  });
});
