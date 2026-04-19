/**
 * @jest-environment node
 */
import { proxyResponse } from '@/app/api/children/_helpers';

describe('proxyResponse', () => {
  it('возвращает пустое тело при 204', async () => {
    const res = proxyResponse({ status: 204, body: null });
    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe('');
  });

  it('возвращает JSON при 200', async () => {
    const res = proxyResponse({ status: 200, body: { foo: 'bar' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ foo: 'bar' });
  });

  it('возвращает error JSON для 404', async () => {
    const res = proxyResponse({ status: 404, body: { error: { code: 'child_not_found' } } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'child_not_found' } });
  });
});
