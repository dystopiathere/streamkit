import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, type ConfirmDialogProps } from './dialog';

function renderDialog(overrides: Partial<ConfirmDialogProps> = {}) {
  const props: ConfirmDialogProps = {
    open: true,
    title: 'Заблокировать «Стример»?',
    confirmLabel: 'Заблокировать',
    cancelLabel: 'Отмена',
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ConfirmDialog {...props} />) };
}

describe('ConfirmDialog', () => {
  it('без обязательной причины не подтверждает', () => {
    const { props } = renderDialog({ reason: { label: 'Причина', required: true } });

    const confirm = screen.getByRole('button', { name: 'Заблокировать' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Причина'), { target: { value: '  спам  ' } });
    fireEvent.click(confirm);

    expect(props.onConfirm).toHaveBeenCalledWith({ reason: 'спам' });
  });

  it('необратимое действие ждёт ввода ожидаемого значения', () => {
    const { props } = renderDialog({
      confirmText: { label: 'Введите почту', expected: 'a@b.ru' },
    });
    const confirm = screen.getByRole('button', { name: 'Заблокировать' });

    fireEvent.change(screen.getByLabelText('Введите почту'), { target: { value: 'a@b.r' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Введите почту'), { target: { value: 'a@b.ru' } });
    fireEvent.click(confirm);
    expect(props.onConfirm).toHaveBeenCalledWith({ confirmText: 'a@b.ru' });
  });

  it('Escape закрывает окно через состояние, а не мимо него', () => {
    const { props, container } = renderDialog();
    const dialog = container.querySelector('dialog')!;

    const event = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(event);

    expect(props.onClose).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('фокус по умолчанию — на отмене', () => {
    renderDialog();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' }));
  });

  it('при повторном открытии прежняя причина не подставляется', () => {
    const { props, rerender } = renderDialog({ reason: { label: 'Причина' } });
    fireEvent.change(screen.getByLabelText('Причина'), { target: { value: 'старое' } });

    rerender(<ConfirmDialog {...props} reason={{ label: 'Причина' }} open={false} />);
    rerender(<ConfirmDialog {...props} reason={{ label: 'Причина' }} open />);

    expect((screen.getByLabelText('Причина') as HTMLTextAreaElement).value).toBe('');
  });
});
