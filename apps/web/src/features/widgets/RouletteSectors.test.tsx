import { fireEvent, render, screen } from '@testing-library/react';
import { useForm, type FieldValues } from 'react-hook-form';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultWidgetConfig } from '@streamkit/contracts';
import { RouletteSectors } from './RouletteSectors';
import i18n from '@/lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

function Editor({ sectors }: { sectors?: unknown[] }): React.JSX.Element {
  const config = defaultWidgetConfig('roulette').config as FieldValues;
  const form = useForm<FieldValues>({
    defaultValues: sectors ? { ...config, sectors } : config,
  });
  return <RouletteSectors form={form} />;
}

const sector = (id: string, label: string, weight: number) => ({
  id,
  label,
  weight,
  color: '#A3850F',
});

describe('сектора рулетки', () => {
  it('шанс — вес от суммы весов', () => {
    render(<Editor sectors={[sector('a', 'Редкий', 1), sector('b', 'Частый', 3)]} />);
    expect(screen.getByRole('list', { name: 'Сектора колеса' }).textContent).toMatch(/25\s%/);
    expect(screen.getByRole('list', { name: 'Сектора колеса' }).textContent).toMatch(/75\s%/);
    fireEvent.change(screen.getByLabelText('Вес сектора «Редкий»'), { target: { value: '3' } });
    expect(screen.getByRole('list', { name: 'Сектора колеса' }).textContent).toMatch(/50\s%/);
  });

  it('последние два сектора не удалить: меньше — не колесо', () => {
    render(<Editor sectors={[sector('a', 'Один', 1), sector('b', 'Два', 1)]} />);
    const remove = screen.getByRole('button', { name: 'Удалить «Один»' }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить сектор' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(
      (screen.getByRole('button', { name: 'Удалить «Один»' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
