/**
 * @jest-environment node
 */
jest.mock('@/lib/backend', () => ({
  backend: jest.fn(),
}));
import { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';
import { GET as getDiag } from '@/app/api/admin/children/[id]/diag/route';
import { PATCH as patchConfig } from '@/app/api/admin/children/[id]/diag/config/route';
import { POST as postRequest } from '@/app/api/admin/children/[id]/diag/request/route';
import {
  DELETE as deleteUpload,
  GET as getUpload,
} from '@/app/api/admin/diag/uploads/[uploadId]/route';

const backendMock = backend as jest.MockedFunction<typeof backend>;

function req(
  url: string,
  {
    token = 'tkn',
    method = 'GET',
    body,
  }: { token?: string | null; method?: string; body?: unknown } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const childCtx = { params: Promise.resolve({ id: 'c1' }) };
const uploadCtx = { params: Promise.resolve({ uploadId: 'u1' }) };

const CONFIG = {
  send: ['audio', 'location'],
  debug: ['audio'],
  debugUntil: '2026-09-30T10:00:00.000Z',
  logcat: true,
  snapshot: true,
  autoUpload: true,
};

describe('admin diag proxy routes', () => {
  beforeEach(() => backendMock.mockReset());

  it('GET /api/admin/children/:id/diag → GET /admin/children/:id/diag', async () => {
    const payload = { device: null, config: CONFIG, pendingRequest: null, uploads: [] };
    backendMock.mockResolvedValue({ status: 200, body: payload });
    const res = await getDiag(req('http://localhost/api/admin/children/c1/diag'), childCtx);
    expect(backendMock).toHaveBeenCalledWith('GET', '/admin/children/c1/diag', undefined, 'tkn');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it('PATCH config передаёт полный DiagConfig без изменений', async () => {
    backendMock.mockResolvedValue({ status: 200, body: { config: CONFIG, delivered: false } });
    const res = await patchConfig(
      req('http://localhost/api/admin/children/c1/diag/config', { method: 'PATCH', body: CONFIG }),
      childCtx,
    );
    expect(backendMock).toHaveBeenCalledWith(
      'PATCH',
      '/admin/children/c1/diag/config',
      CONFIG,
      'tkn',
    );
    expect(await res.json()).toEqual({ config: CONFIG, delivered: false });
  });

  it('POST request → POST /admin/children/:id/diag/request', async () => {
    const out = { commandId: 'cmd1', delivered: true, expiresAt: '2026-09-30T10:00:00.000Z' };
    backendMock.mockResolvedValue({ status: 201, body: out });
    const res = await postRequest(
      req('http://localhost/api/admin/children/c1/diag/request', { method: 'POST' }),
      childCtx,
    );
    const [method, path] = backendMock.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/admin/children/c1/diag/request');
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(out);
  });

  it('GET upload → GET /admin/diag/uploads/:uploadId', async () => {
    backendMock.mockResolvedValue({ status: 200, body: { id: 'u1', log: 'x' } });
    const res = await getUpload(req('http://localhost/api/admin/diag/uploads/u1'), uploadCtx);
    expect(backendMock).toHaveBeenCalledWith('GET', '/admin/diag/uploads/u1', undefined, 'tkn');
    expect(await res.json()).toEqual({ id: 'u1', log: 'x' });
  });

  it('DELETE upload → DELETE без тела, ответ {ok:true}', async () => {
    backendMock.mockResolvedValue({ status: 200, body: { ok: true } });
    const res = await deleteUpload(
      req('http://localhost/api/admin/diag/uploads/u1', { method: 'DELETE' }),
      uploadCtx,
    );
    expect(backendMock).toHaveBeenCalledWith('DELETE', '/admin/diag/uploads/u1', undefined, 'tkn');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('DELETE upload: 204 от бекенда отдаётся пустым ответом, без падения', async () => {
    backendMock.mockResolvedValue({ status: 204, body: null });
    const res = await deleteUpload(
      req('http://localhost/api/admin/diag/uploads/u1', { method: 'DELETE' }),
      uploadCtx,
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('ошибки бекенда пробрасываются со статусом', async () => {
    backendMock.mockResolvedValue({
      status: 404,
      body: { error: { code: 'device_not_found', message: 'Нет устройства' } },
    });
    const res = await postRequest(
      req('http://localhost/api/admin/children/c1/diag/request', { method: 'POST' }),
      childCtx,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'device_not_found', message: 'Нет устройства' },
    });
  });

  it('401 без Bearer — бекенд не вызывается', async () => {
    const res = await getDiag(
      req('http://localhost/api/admin/children/c1/diag', { token: null }),
      childCtx,
    );
    expect(res.status).toBe(401);
    const res2 = await deleteUpload(
      req('http://localhost/api/admin/diag/uploads/u1', { method: 'DELETE', token: null }),
      uploadCtx,
    );
    expect(res2.status).toBe(401);
    expect(backendMock).not.toHaveBeenCalled();
  });
});
