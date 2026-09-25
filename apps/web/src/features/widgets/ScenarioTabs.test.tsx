import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { beforeAll, describe, expect, it } from 'vitest';
import { type AlertEventType, type Platform, defaultWidgetConfig } from '@streamkit/contracts';
import { analyticsKeys } from '@/features/analytics/queries';
import i18n from '@/lib/i18n';
import { type SectionId, WidgetConfigForm } from './WidgetConfigForm';
import { visibleScenario } from './useAlertScenarios';

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

function Editor(): React.JSX.Element {
  const form = useForm<FieldValues>({
    defaultValues: defaultWidgetConfig('alerts').config as FieldValues,
  });
  const [section, setSection] = useState<SectionId>('show');
  const [scenario, setScenario] = useState<AlertEventType>('donation');
  return (
    <WidgetConfigForm
      type="alerts"
      form={form}
      state={null}
      currency="RUB"
      section={section}
      onSectionChange={setSection}
      alertScenario={scenario}
      onAlertScenarioChange={setScenario}
      alertTrigger={null}
      onAlertTriggerChange={() => undefined}
    />
  );
}

/** Редактор с уже известным списком подключённых площадок — без запроса. */
function renderWith(platforms: Platform[]): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    analyticsKeys.channels,
    platforms.map((platform, index) => ({ id: `channel-${index}`, platform })),
  );
  render(
    <QueryClientProvider client={client}>
      <Editor />
    </QueryClientProvider>,
  );
}

const tabs = (): string[] => screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');

describe('сценарии по подключённым площадкам', () => {
  it('без площадок — только донат', () => {
    renderWith([]);
    expect(screen.getByRole('tablist', { name: 'Сценарии' })).toBeDefined();
    expect(screen.queryByRole('tab', { name: 'Фолловер' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Донат' })).toBeDefined();
  });

  it('Kick открывает KICKs и общие сценарии, но не биты и рейды', () => {
    renderWith(['kick']);
    const names = tabs();
    expect(names).toContain('KICKs');
    expect(names).toContain('Подписка');
    expect(names).not.toContain('Биты');
    expect(names).not.toContain('Рейд');
  });

  it('YouTube открывает подписки, но не фолловеров', () => {
    renderWith(['youtube']);
    const names = tabs();
    expect(names).toContain('Подарочные подписки');
    expect(names).not.toContain('Фолловер');
  });
});

describe('выбранный сценарий без площадки', () => {
  it('показывается донат, пока площадку не вернут', () => {
    expect(visibleScenario('raid', ['donation', 'follow'])).toBe('donation');
    expect(visibleScenario('follow', ['donation', 'follow'])).toBe('follow');
  });
});
