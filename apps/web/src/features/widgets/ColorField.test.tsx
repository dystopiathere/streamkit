import { fireEvent, render, screen } from '@testing-library/react';
import { useForm, useWatch, type FieldValues } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { ColorField, NullableColorField } from './fields';

function Editor({ initial }: { initial: string }): React.JSX.Element {
  const form = useForm<FieldValues>({ defaultValues: { color: initial, bg: initial } });
  const color = useWatch({ control: form.control, name: 'color' }) as string;
  return (
    <>
      <output data-testid="value">{color}</output>
      <ColorField form={form} name="color" label="Цвет" />
      <NullableColorField form={form} name="bg" label="Фон" />
    </>
  );
}

const picker = (label: string) => document.getElementById(label) as HTMLInputElement;

/**
 * Палитра и код текстом — одно значение. Раньше выбор в палитре менял форму,
 * а поле с кодом показывало старый цвет, и казалось, что палитра не работает.
 */
describe('поле цвета', () => {
  it('выбор в палитре виден в поле с кодом и уходит в форму', () => {
    render(<Editor initial="#FFFFFF" />);
    fireEvent.input(picker('color'), { target: { value: '#ff0000' } });

    expect((screen.getByLabelText('Цвет, HEX') as HTMLInputElement).value).toBe('#FF0000');
    expect(screen.getByTestId('value').textContent).toBe('#FF0000');
  });

  it('код, набранный текстом, двигает палитру', () => {
    render(<Editor initial="#FFFFFF" />);
    fireEvent.change(screen.getByLabelText('Цвет, HEX'), { target: { value: '#00ff00' } });
    expect(picker('color').value).toBe('#00ff00');
  });

  it('палитра не стирает прозрачность: она её не знает', () => {
    render(<Editor initial="#00000080" />);
    // Палитра показывает цвет без прозрачности, а не чёрный «не понял».
    expect(picker('color').value).toBe('#000000');
    fireEvent.input(picker('color'), { target: { value: '#123456' } });
    expect(screen.getByTestId('value').textContent).toBe('#12345680');
  });

  it('необязательный цвет из палитры тоже доходит до поля с кодом', () => {
    render(<Editor initial="#FFFFFF" />);
    fireEvent.input(picker('bg'), { target: { value: '#0000ff' } });
    expect((screen.getByLabelText('Фон, HEX') as HTMLInputElement).value).toBe('#0000FF');
  });
});
