import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useForm, type FieldValues } from 'react-hook-form';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultWidgetConfig, MAX_ROULETTE_SECTORS } from '@streamkit/contracts';
import { Toaster } from 'sonner';
import { RouletteSectors } from './RouletteSectors';
import i18n from '@/lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

function Editor({
  sectors,
  maxSectors = MAX_ROULETTE_SECTORS,
}: {
  sectors?: unknown[];
  maxSectors?: number;
}): React.JSX.Element {
  const config = defaultWidgetConfig('roulette').config as FieldValues;
  const form = useForm<FieldValues>({
    defaultValues: sectors ? { ...config, sectors } : config,
  });
  return (
    <>
      {/* Ошибки разбора файла приходят всплывающей подписью: без неё в тесте
          не видно ровно того, что увидит стример. */}
      <Toaster />
      <RouletteSectors form={form} maxSectors={maxSectors} />
    </>
  );
}

/** Выбор файла в поле: jsdom не даёт присвоить `files` без такого описания. */
function choose(text: string): void {
  const input = screen.getByLabelText('Загрузить из файла') as HTMLInputElement;
  const file = new File([text], 'sectors.csv', { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

const labels = (): string[] =>
  within(screen.getByRole('list', { name: 'Сектора колеса' }))
    .getAllByRole('listitem')
    .map((item) => (within(item).getAllByRole('textbox')[0] as HTMLInputElement).value);

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

  it('файл заменяет список целиком', async () => {
    render(<Editor sectors={[sector('a', 'Старое', 1), sector('b', 'Тоже старое', 1)]} />);
    choose('Спеть песню;3\nОтжимания;1\n');
    await waitFor(() => expect(labels()).toEqual(['Спеть песню', 'Отжимания']));
  });

  it('негодный файл не трогает список и называет строку', async () => {
    render(<Editor sectors={[sector('a', 'Старое', 1), sector('b', 'Тоже старое', 1)]} />);
    choose('Хорошая;1\nПлохая строка без разделителя\n');
    await screen.findByText(/строка 2/);
    expect(labels()).toEqual(['Старое', 'Тоже старое']);
  });

  it('секторов больше, чем помещается: спрашивает, брать ли первые', async () => {
    render(<Editor maxSectors={3} sectors={[sector('a', 'Старое', 1), sector('b', 'Ещё', 1)]} />);
    choose('Раз;1\nДва;1\nТри;1\nЧетыре;1\n');

    // Пока не ответили — список прежний: молчаливая обрезка увела бы половину
    // розыгрыша, и стример заметил бы это уже в эфире.
    await screen.findByText(/В файле 4 секторов, а помещается 3/);
    expect(labels()).toEqual(['Старое', 'Ещё']);

    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(labels()).toEqual(['Раз', 'Два', 'Три']));
  });

  it('«Нет» в предупреждении оставляет список как был', async () => {
    render(<Editor maxSectors={3} sectors={[sector('a', 'Старое', 1), sector('b', 'Ещё', 1)]} />);
    choose('Раз;1\nДва;1\nТри;1\nЧетыре;1\n');
    fireEvent.click(await screen.findByRole('button', { name: 'Нет' }));
    expect(labels()).toEqual(['Старое', 'Ещё']);
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
