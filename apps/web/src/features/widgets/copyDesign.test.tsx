import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useForm, useWatch, type FieldValues } from 'react-hook-form';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultWidgetConfig } from '@streamkit/contracts';
import { WidgetConfigForm } from './WidgetConfigForm';
import i18n from '@/lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

function Editor(): React.JSX.Element {
  const config = defaultWidgetConfig('alerts').config as FieldValues;
  const form = useForm<FieldValues>({
    defaultValues: {
      ...config,
      scenarios: {
        ...config.scenarios,
        donation: {
          ...config.scenarios.donation,
          imageUrl: 'https://cdn.example/alert.webm',
          sound: { enabled: true, source: 'video', url: null, volume: 0.4 },
        },
      },
    },
  });
  const followImage = useWatch({ control: form.control, name: 'scenarios.follow.imageUrl' });
  const followSound = useWatch({ control: form.control, name: 'scenarios.follow.sound' });
  return (
    <>
      <output data-testid="follow-image">{String(followImage)}</output>
      <output data-testid="follow-sound">{JSON.stringify(followSound)}</output>
      <WidgetConfigForm
        type="alerts"
        form={form}
        state={null}
        currency="RUB"
        section="show"
        onSectionChange={() => undefined}
        alertScenario="donation"
        onAlertScenarioChange={() => undefined}
      />
    </>
  );
}

describe('копирование оформления во все сценарии', () => {
  it('переносит картинку и звук: у видео это одна дорожка', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Editor />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('follow-image').textContent).toBe('null');

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать оформление во все сценарии' }));

    expect(screen.getByTestId('follow-image').textContent).toBe('https://cdn.example/alert.webm');
    expect(JSON.parse(screen.getByTestId('follow-sound').textContent!)).toEqual({
      enabled: true,
      source: 'video',
      url: null,
      volume: 0.4,
    });
  });
});
