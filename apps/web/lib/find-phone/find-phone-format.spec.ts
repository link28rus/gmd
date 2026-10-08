import type { PhoneSignal, PhoneTrackPoint } from '@/lib/api/find-phone';
import {
  FAST_POLL_MS,
  SLOW_POLL_MS,
  ageSecSince,
  batteryText,
  dayRangeIso,
  drawableTrack,
  isSignalActive,
  phoneLabel,
  phoneOwnerLabel,
  platformLabel,
  pollIntervalMs,
  signalStatusText,
} from './find-phone-format';

function sig(status: PhoneSignal['status'], ackedAt: string | null = null): PhoneSignal {
  return { id: 's1', requestedAt: '2026-10-09T10:00:00.000Z', ackedAt, status };
}

describe('phoneLabel', () => {
  it('имя устройства', () => {
    expect(phoneLabel({ deviceName: 'Pixel 8', customName: null })).toBe('Pixel 8');
  });
  it('своё имя важнее модели', () => {
    expect(phoneLabel({ deviceName: 'Pixel 8', customName: ' Рабочий ' })).toBe('Рабочий');
    expect(phoneLabel({ deviceName: 'Pixel 8', customName: '  ' })).toBe('Pixel 8');
  });
  it('пустое или null имя → «Телефон»', () => {
    expect(phoneLabel({ deviceName: null, customName: null })).toBe('Телефон');
    expect(phoneLabel({ deviceName: '   ', customName: null })).toBe('Телефон');
  });
});

describe('phoneOwnerLabel', () => {
  it('свой → «Вы», чужой → имя взрослого', () => {
    expect(phoneOwnerLabel({ isMine: true, ownerName: 'Мама' })).toBe('Вы');
    expect(phoneOwnerLabel({ isMine: false, ownerName: 'Папа' })).toBe('Папа');
  });
});

describe('platformLabel', () => {
  it('android/ios → человеческое имя, прочее как есть', () => {
    expect(platformLabel('android')).toBe('Android');
    expect(platformLabel('IOS')).toBe('iOS');
    expect(platformLabel('web')).toBe('web');
    expect(platformLabel(null)).toBeNull();
  });
});

describe('isSignalActive / pollIntervalMs', () => {
  it('pending и ringing — активные, done/expired/null — нет', () => {
    expect(isSignalActive(sig('pending'))).toBe(true);
    expect(isSignalActive(sig('ringing'))).toBe(true);
    expect(isSignalActive(sig('done'))).toBe(false);
    expect(isSignalActive(sig('expired'))).toBe(false);
    expect(isSignalActive(null)).toBe(false);
  });

  it('быстрый опрос, пока хоть один сигнал активен', () => {
    expect(pollIntervalMs([{ signal: null }, { signal: sig('ringing') }])).toBe(FAST_POLL_MS);
    expect(pollIntervalMs([{ signal: sig('done') }, { signal: null }])).toBe(SLOW_POLL_MS);
    expect(pollIntervalMs([])).toBe(SLOW_POLL_MS);
  });
});

describe('signalStatusText', () => {
  it('тексты по статусам', () => {
    expect(signalStatusText(null)).toBeNull();
    expect(signalStatusText(sig('pending'))).toBe('Сигнал отправлен, ждём ответа телефона…');
    expect(signalStatusText(sig('ringing'))).toBe('Телефон звонит — 60 секунд');
    expect(signalStatusText(sig('expired'))).toBe(
      'Телефон не ответил за 5 минут — вероятно, выключен или без интернета',
    );
  });

  it('done — время подтверждения в локальной TZ', () => {
    const acked = new Date(2026, 9, 9, 7, 5).toISOString();
    expect(signalStatusText(sig('done', acked))).toBe('Телефон прозвонил в 07:05');
  });
});

describe('batteryText', () => {
  it('уровень и зарядка', () => {
    expect(batteryText(64, false)).toBe('64%');
    expect(batteryText(64, null)).toBe('64%');
    expect(batteryText(15, true)).toBe('15% · заряжается');
    expect(batteryText(null, true)).toBeNull();
  });
});

describe('ageSecSince', () => {
  it('секунды от момента, не меньше 0', () => {
    const now = Date.parse('2026-10-09T10:05:00.000Z');
    expect(ageSecSince('2026-10-09T10:00:00.000Z', now)).toBe(300);
    expect(ageSecSince('2026-10-09T10:06:00.000Z', now)).toBe(0);
  });
});

describe('dayRangeIso', () => {
  it('от начала локального дня до начала следующего', () => {
    const [from, to] = dayRangeIso('2026-10-09');
    expect(from).toBe(new Date(2026, 9, 9).toISOString());
    expect(to).toBe(new Date(2026, 9, 10).toISOString());
  });

  it('переход через конец месяца', () => {
    const [, to] = dayRangeIso('2026-10-31');
    expect(to).toBe(new Date(2026, 10, 1).toISOString());
  });
});

describe('drawableTrack', () => {
  it('отбрасывает точки грубее 50 м, неизвестную точность оставляет', () => {
    const p = (accuracy: number | null): PhoneTrackPoint => ({
      lat: 55,
      lon: 37,
      recordedAt: '2026-10-09T10:00:00.000Z',
      accuracy,
      speed: null,
    });
    expect(drawableTrack([p(10), p(50), p(51), p(null)]).map((x) => x.accuracy)).toEqual([
      10,
      50,
      null,
    ]);
  });
});
