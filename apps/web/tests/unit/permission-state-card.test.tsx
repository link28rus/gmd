import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PermissionStateCard } from '@/components/children/permission-state-card';
import { permissionStateApi } from '@/lib/api/permission-state';

jest.mock('@/lib/api/permission-state', () => ({
  permissionStateApi: { get: jest.fn(), refresh: jest.fn() },
}));
const get = permissionStateApi.get as jest.Mock;
const refresh = permissionStateApi.refresh as jest.Mock;
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PermissionStateCard childId="child-1" />
    </QueryClientProvider>,
  );
}
afterEach(() => jest.resetAllMocks());
test('показывает неизвестное состояние без зелёного ОК', async () => {
  get.mockResolvedValue({ status: 'unknown', reportedAt: null, missing: [] });
  show();
  expect(await screen.findByText(/Нет отчёта/)).toBeInTheDocument();
  expect(screen.queryByText('Разрешения в порядке')).not.toBeInTheDocument();
});
test('показывает отключённую функцию и дату последней проверки', async () => {
  get.mockResolvedValue({
    status: 'degraded',
    reportedAt: '2026-11-17T10:00:00Z',
    missing: [{ key: 'microphone', label: 'Микрофон' }],
  });
  show();
  expect(await screen.findByText(/Отключено: Микрофон/)).toBeInTheDocument();
  expect(screen.getByText(/Проверено/)).toBeInTheDocument();
});
test('не обещает обновления при недоставленном запросе', async () => {
  get.mockResolvedValue({ status: 'stale', reportedAt: '2026-11-10T10:00:00Z', missing: [] });
  refresh.mockResolvedValue({ requested: false });
  show();
  expect(await screen.findByText(/Данные устарели/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Проверить сейчас' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledWith('child-1'));
  expect(await screen.findByText(/Телефон недоступен/)).toBeInTheDocument();
});
