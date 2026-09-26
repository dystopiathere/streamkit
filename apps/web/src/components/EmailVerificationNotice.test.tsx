import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { PublicUser } from '@streamkit/contracts';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import i18n from '@/lib/i18n';
import { EmailVerificationNotice } from './EmailVerificationNotice';

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ accessToken: null, user: null });
});

const USER: PublicUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'streamer@example.com',
  displayName: 'Стример',
  isTotpEnabled: false,
  emailVerified: false,
  createdAt: '2026-09-26T00:00:00.000Z',
};

function renderNotice(user: PublicUser): void {
  useAuthStore.setState({ accessToken: 'token', user });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EmailVerificationNotice />
    </QueryClientProvider>,
  );
}

describe('EmailVerificationNotice', () => {
  it('подтверждённой почте плашка не нужна', () => {
    renderNotice({ ...USER, emailVerified: true });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('называет адрес и уходит сама, когда почту подтвердили в другом месте', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ...USER, emailVerified: true });
    renderNotice(USER);
    expect(screen.getByRole('status').textContent).toContain('streamer@example.com');

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(useAuthStore.getState().user?.emailVerified).toBe(true);
  });
});
