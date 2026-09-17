import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, describeField, FieldHint, Input, Label } from './primitives';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  variant?: 'primary' | 'danger';
  isPending?: boolean;
  /** Поле причины. Причина уходит в журнал действий вместе с решением. */
  reason?: { label: string; hint?: string; required?: boolean; maxLength?: number };
  /**
   * Подтверждение вводом: для необратимого действия недостаточно одного нажатия,
   * кнопка включается, только когда введено ожидаемое значение.
   */
  confirmText?: { label: string; expected: string };
  onConfirm: (input: { reason?: string; confirmText?: string }) => void;
  onClose: () => void;
}

/**
 * Подтверждение действия на нативном `<dialog>`.
 *
 * `showModal` даёт то, что вручную делается долго и с ошибками: фон недоступен
 * для клавиатуры и скринридера, Escape закрывает окно, фокус уходит внутрь.
 * Фокус по умолчанию — на «Отмена»: Enter на опасном действии не должен
 * выполнять его сразу.
 */
export function ConfirmDialog(props: ConfirmDialogProps): React.JSX.Element {
  const { open, onClose } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // jsdom и старые движки без showModal получают хотя бы видимое окно.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape: браузер закрывает окно сам, а состояние живёт в React —
      // без отмены события они разошлись бы.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-0 text-fg backdrop:bg-black/60"
    >
      {/* Содержимое монтируется заново при каждом открытии: введённая прошлый
          раз причина не должна подставиться к другому объекту. */}
      {open ? <DialogBody {...props} titleId={titleId} /> : null}
    </dialog>
  );
}

function DialogBody({
  title,
  children,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  isPending = false,
  reason,
  confirmText,
  onConfirm,
  onClose,
  titleId,
}: ConfirmDialogProps & { titleId: string }): React.JSX.Element {
  const [reasonValue, setReasonValue] = useState('');
  const [typed, setTyped] = useState('');
  const reasonId = useId();
  const typedId = useId();

  const reasonMissing = Boolean(reason?.required) && reasonValue.trim().length === 0;
  const typedWrong = confirmText !== undefined && typed.trim() !== confirmText.expected;

  return (
    <form
      className="flex flex-col gap-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (reasonMissing || typedWrong || isPending) return;
        onConfirm({
          ...(reason ? { reason: reasonValue.trim() } : {}),
          ...(confirmText ? { confirmText: typed.trim() } : {}),
        });
      }}
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      {children ? <div className="text-sm text-muted">{children}</div> : null}

      {reason ? (
        <div>
          <Label htmlFor={reasonId}>{reason.label}</Label>
          <textarea
            id={reasonId}
            value={reasonValue}
            maxLength={reason.maxLength}
            required={reason.required}
            onChange={(event) => setReasonValue(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-border-strong bg-bg px-3 py-2 text-sm text-fg"
            {...describeField(reasonId, { hint: Boolean(reason.hint) })}
          />
          {reason.hint ? <FieldHint id={reasonId}>{reason.hint}</FieldHint> : null}
        </div>
      ) : null}

      {confirmText ? (
        <div>
          <Label htmlFor={typedId}>{confirmText.label}</Label>
          <Input
            id={typedId}
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
            className="mt-1"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose} autoFocus>
          {cancelLabel}
        </Button>
        <Button
          type="submit"
          variant={variant}
          isLoading={isPending}
          disabled={reasonMissing || typedWrong}
        >
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}
