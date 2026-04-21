/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { ChildStatusCard } from '@/components/locations/child-status-card';

describe('ChildStatusCard', () => {
  it('имя и «был тут N мин назад»', () => {
    render(
      <ChildStatusCard
        childName="Артем"
        ageSec={180}
        accuracy={18}
        batteryLevel={73}
        isCharging={false}
        provider="gps"
      />,
    );
    expect(screen.getByText('Артем')).toBeInTheDocument();
    expect(screen.getByText(/Был тут .* мин назад/)).toBeInTheDocument();
  });

  it('батарея % и точность ±м', () => {
    render(
      <ChildStatusCard
        childName="Артем"
        ageSec={30}
        accuracy={18}
        batteryLevel={30}
        isCharging={false}
        provider="gps"
      />,
    );
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('±18 м')).toBeInTheDocument();
    expect(screen.getByText('GPS')).toBeInTheDocument();
  });

  it('точность координат с словесной оценкой', () => {
    render(
      <ChildStatusCard
        childName="Артем"
        ageSec={30}
        accuracy={18}
        batteryLevel={null}
        isCharging={null}
        provider={null}
      />,
    );
    expect(screen.getByText(/Точность координат высокая \(18 метров\)/)).toBeInTheDocument();
  });

  it('провайдер network → «сеть»', () => {
    render(
      <ChildStatusCard
        childName="Артем"
        ageSec={30}
        accuracy={null}
        batteryLevel={null}
        isCharging={null}
        provider="network"
      />,
    );
    expect(screen.getByText('сеть')).toBeInTheDocument();
  });
});
