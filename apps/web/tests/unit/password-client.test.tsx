/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import PasswordClient from '@/app/cabinet/password/password-client';
import { useAuthStore } from '@/lib/auth-store';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/lib/auth/refresh-singleflight', () => ({ refreshAccessToken: jest.fn() }));

const fetchMock = jest.fn();

/** В jsdom нет Response — минимальный ответ fetch. */
function jsonRes(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function login(hasPassword: boolean): void {
  useAuthStore.setState({
    accessToken: 'at1',
    user: { id: 'u1', email: 'a@b.c', name: 'A', locale: 'ru', hasPassword },
    family: { id: 'f1', name: 'Семья' },
  });
}

function fill(id: string, value: string): void {
  fireEvent.change(document.getElementById(id)!, { target: { value } });
}

describe('PasswordClient', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    (toast.error as jest.Mock).mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('без пароля поле «Текущий пароль» не показывается, currentPassword не шлётся', async () => {
    login(false);
    fetchMock.mockResolvedValue(jsonRes({ accessToken: 'at2' }));
    render(<PasswordClient />);
    expect(screen.queryByLabelText('Текущий пароль')).toBeNull();
    fill('pwd', 'newPassword1');
    fill('pwd2', 'newPassword1');
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ password: 'newPassword1' });
    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('at2'));
  });

  it('с паролем: шлёт currentPassword и показывает ошибку неверного текущего', async () => {
    login(true);
    fetchMock.mockResolvedValue(
      jsonRes({ error: { code: 'invalid_current_password', message: 'x' } }, 400),
    );
    render(<PasswordClient />);
    fill('pwd0', 'oldPassword');
    fill('pwd', 'newPassword1');
    fill('pwd2', 'newPassword1');
    fireEvent.submit(document.querySelector('form')!);
    await screen.findByText('Неверный текущий пароль');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ password: 'newPassword1', currentPassword: 'oldPassword' });
    expect(useAuthStore.getState().accessToken).toBe('at1');
  });
});
