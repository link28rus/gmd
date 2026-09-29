/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ChildAvatar } from '@/components/avatar/child-avatar';
import { ChildStatusCard } from '@/components/locations/child-status-card';
import { parseAvatarKey } from '@/lib/avatar/presets';

jest.mock('@/lib/api/children', () => ({
  childrenApi: { fetchAvatar: jest.fn(() => new Promise(() => {})) },
}));

describe('parseAvatarKey', () => {
  it('null/пусто — буква', () => {
    expect(parseAvatarKey(null)).toEqual({ kind: 'letter' });
    expect(parseAvatarKey('')).toEqual({ kind: 'letter' });
  });

  it('известный пресет', () => {
    expect(parseAvatarKey('preset:fox')).toEqual({ kind: 'preset', id: 'fox' });
  });

  it('неизвестный пресет и мусор — буква', () => {
    expect(parseAvatarKey('preset:dragon')).toEqual({ kind: 'letter' });
    expect(parseAvatarKey('whatever')).toEqual({ kind: 'letter' });
    expect(parseAvatarKey('photo:')).toEqual({ kind: 'letter' });
  });

  it('фото с версией', () => {
    expect(parseAvatarKey('photo:abc123def456')).toEqual({
      kind: 'photo',
      version: 'abc123def456',
    });
  });
});

describe('ChildAvatar', () => {
  function wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }

  it('без avatarKey — первая буква имени', () => {
    render(<ChildAvatar name="маша" avatarKey={null} />);
    expect(screen.getByText('М')).toBeInTheDocument();
  });

  it('пресет — svg из public/avatars', () => {
    const { container } = render(<ChildAvatar name="Маша" avatarKey="preset:owl" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/avatars/owl.svg');
  });

  it('фото, пока грузится — буква', () => {
    render(<ChildAvatar name="Маша" avatarKey="photo:abc" childId="c1" />, { wrapper });
    expect(screen.getByText('М')).toBeInTheDocument();
  });
});

describe('ChildStatusCard — аватар', () => {
  it('клик по аватару вызывает onAvatarClick', () => {
    const onAvatarClick = jest.fn();
    render(
      <ChildStatusCard
        childName="Артем"
        avatarKey="preset:fox"
        onAvatarClick={onAvatarClick}
        ageSec={30}
        accuracy={null}
        batteryLevel={null}
        isCharging={null}
        provider={null}
        networkType={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Фото профиля' }));
    expect(onAvatarClick).toHaveBeenCalledTimes(1);
  });
});
