/**
 * @jest-environment node
 */
import { POST } from './route';

const OLD_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...OLD_ENV,
    NEXT_PUBLIC_SENTRY_DSN: 'http://abc@glitchtip-web:8000/2',
  };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
});

afterEach(() => {
  process.env = OLD_ENV;
  jest.restoreAllMocks();
});

function mkEnvelope(dsn: string, payload: object): string {
  const header = JSON.stringify({ dsn, event_id: 'e' });
  const itemHeader = JSON.stringify({ type: 'event' });
  const item = JSON.stringify(payload);
  return `${header}\n${itemHeader}\n${item}\n`;
}

function req(body: string): Request {
  return new Request('http://localhost/api/sentry-tunnel', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-sentry-envelope' },
  });
}

describe('POST /api/sentry-tunnel', () => {
  it('проксирует валидный envelope в GlitchTip', async () => {
    const envelope = mkEnvelope('http://abc@glitchtip-web:8000/2', { error: 'boom' });
    const resp = await POST(req(envelope));
    expect(resp.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('http://glitchtip-web:8000/api/2/envelope/?sentry_key=abc');
    expect(call[1].method).toBe('POST');
    expect(call[1].body).toBe(envelope);
  });

  it('отклоняет envelope с левым DSN', async () => {
    const envelope = mkEnvelope('http://attacker@evil.com/99', { error: 'pwn' });
    const resp = await POST(req(envelope));
    expect(resp.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('отклоняет пустой body', async () => {
    const resp = await POST(req(''));
    expect(resp.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('возвращает 200 даже при фейле upstream (не блокируем клиента)', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const envelope = mkEnvelope('http://abc@glitchtip-web:8000/2', { error: 'boom' });
    const resp = await POST(req(envelope));
    expect(resp.status).toBe(200);
  });
});
