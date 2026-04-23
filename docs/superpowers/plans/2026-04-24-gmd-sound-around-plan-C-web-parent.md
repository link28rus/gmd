# «Звук вокруг ребёнка» — Plan C: Web-parent UI (SSE + WebRTC playback)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать родителю в web-кабинете кнопку «Звук вокруг», по нажатию которой открывается модалка с live-аудио от child-устройства через WebRTC (TURN-relay), таймером duration и кнопкой Stop.

**Architecture:** Клиент создаёт сессию (`POST /api/audio/sessions` → `turnCreds`), открывает SSE-стрим (`GET /api/audio/sessions/:id/events` через custom `fetch`+`ReadableStream` — нужны Bearer headers), инициализирует `RTCPeerConnection` с force-relay TURN. На SSE-событие `READY` (SDP offer от child) → `setRemoteDescription` + `createAnswer` + `POST /answer`. ICE candidates трикл туда-обратно через SSE+REST. `pc.ontrack` даёт `MediaStream` для HTML5 `<audio autoplay>`. На `ENDED`/`FAILED`/`EXPIRED` / истечение таймера / нажатие Stop — `POST /stop`, закрытие PC, закрытие SSE.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, native WebRTC API (`RTCPeerConnection`), native `fetch`+`ReadableStream` для SSE (НЕ `EventSource` — тот не шлёт Authorization header), Zustand (auth-store уже есть), @tanstack/react-query (уже используется), shadcn Dialog, Sonner toasts, Jest + jsdom + @testing-library/react для тестов.

**Spec:** [docs/superpowers/specs/2026-04-23-gmd-sound-around-design.md](../specs/2026-04-23-gmd-sound-around-design.md)

**API docs:** [docs/audio-api.md](../../audio-api.md) (sections 4.1 parent endpoints, 7 SSE events, 9.1 happy path)

**Preceding plans:**

- Plan A (backend + coturn) — ✅ v0.32.0 + v0.32.1 hotfix
- Plan B (mobile-child Android) — ✅ v0.33.0 + v0.33.1 hotfix

**Out of scope (отдельные plans):**

- Plan C2: mobile-parent Flutter app (сейчас заглушка, требует сначала auth/children/map — не часть Sound Around)
- Plan D: EULA / claim-invite consent UI (152-ФЗ)
- Plan E: E2E + OEM verification + coturn нагрузочный тест

**Key decisions (зафиксированы в этом plan, не в spec):**

1. **SSE-auth через custom `fetch`+`ReadableStream`**, не `EventSource`. Обоснование: JWT в Zustand in-memory, `EventSource` не умеет headers. BFF-proxy с httpOnly cookie — отдельная большая задача (весь `apiFetch` сейчас не через cookie). Query-param `?token=` — токен в server-логах. Custom hook с `fetch` — минимальный инкремент.
2. **VU-meter, не waveform.** Простой horizontal bar от `AnalyserNode.getByteFrequencyData` с усреднением. Полный canvas-waveform — post-MVP.
3. **ICE candidate reconstruct:** `pc.addIceCandidate({ candidate, sdpMid: '0', sdpMLineIndex: 0 })`. Backend шлёт только `candidate:string` (см. spec `IceCandidateSchema`). Для audio-only single m-line достаточно hard-code, расширение до multi-track — отдельная задача.
4. **Force-relay TURN:** `iceTransportPolicy: 'relay'` в `RTCConfiguration`. Защищает parent IP от утечки через STUN (требование privacy, см. spec 5.3).
5. **Proxy routes в Next.js с типом `text/event-stream`** для SSE — тело стрима backend'а передаётся насквозь через `new Response(backendRes.body, {...})`. Next.js 15 App Router поддерживает стриминг в Route Handlers.

---

## File Structure

**Создаём:**

- `apps/web/app/api/audio/sessions/route.ts` — POST proxy: create session
- `apps/web/app/api/audio/sessions/[id]/answer/route.ts` — POST proxy
- `apps/web/app/api/audio/sessions/[id]/ice/route.ts` — POST proxy
- `apps/web/app/api/audio/sessions/[id]/stop/route.ts` — POST proxy
- `apps/web/app/api/audio/sessions/[id]/events/route.ts` — GET SSE proxy (стриминг)
- `apps/web/lib/api/audio.ts` — клиент и типы (`audioApi.createSession/answer/sendIce/stop`)
- `apps/web/lib/hooks/use-audio-sse.ts` — custom SSE hook на `fetch`+`ReadableStream`
- `apps/web/lib/webrtc/audio-session-controller.ts` — класс-оркестратор `RTCPeerConnection`+signaling (чистая логика, легко юнит-тестится)
- `apps/web/lib/hooks/use-audio-session.ts` — React-хук, оборачивает `AudioSessionController`, даёт `{state, error, mediaStream, elapsedSec, stop}`
- `apps/web/lib/webrtc/vu-meter.ts` — RAF-loop для получения level 0..1 из `MediaStream` через `AnalyserNode`
- `apps/web/components/children/audio-listen-dialog.tsx` — модалка с `<audio>`, таймером, VU-meter и кнопкой Stop
- `apps/web/lib/api/audio.test.ts` — unit тесты API-клиента
- `apps/web/lib/hooks/use-audio-sse.test.ts` — unit тесты SSE-хука
- `apps/web/lib/webrtc/audio-session-controller.test.ts` — unit тесты оркестратора

**Модифицируем:**

- `apps/web/components/cabinet/child-actions.tsx` — добавить кнопку «Звук вокруг» (открывает `AudioListenDialog`)
- `apps/web/package.json` — bump version до 0.34.0
- `apps/mobile-child/pubspec.yaml` — bump version 0.33.1+38 → 0.34.0+39 (unified version)
- `apps/mobile-parent/pubspec.yaml` — bump version
- `apps/backend/package.json` — bump version
- `package.json` (root) — bump version до 0.34.0
- `CHANGELOG.md` — новая секция `## v0.34.0 — 2026-04-24`
- `README.md` / `docs/sessions/` — опционально, если есть user-guide

---

## Phase 1: Next.js proxy routes

Все роуты следуют существующему паттерну [apps/web/app/api/children/[id]/signal/route.ts](../../../apps/web/app/api/children/[id]/signal/route.ts) — используют `proxy()` из [\_helpers.ts](../../../apps/web/app/api/children/_helpers.ts).

### Task 1: POST /api/audio/sessions proxy route

**Files:**

- Create: `apps/web/app/api/audio/sessions/route.ts`

- [ ] **Step 1: Написать роут**

Create `apps/web/app/api/audio/sessions/route.ts`:

```typescript
import type { NextRequest } from 'next/server';
import { proxy } from '../../children/_helpers';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as unknown;
  return proxy('POST', '/audio/sessions', req, body);
}
```

- [ ] **Step 2: Проверить типы**

Run: `pnpm --filter @gmd/web typecheck`
Expected: no errors.

- [ ] **Step 3: Smoke-test через curl (dev-backend должен быть запущен)**

Вручную, если запущен backend:

```bash
# Получить access token через /api/auth/login, потом:
curl -X POST http://localhost:3003/api/audio/sessions \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"childId":"<CHILD_ID>","durationSec":60,"hiddenMode":true}'
```

Expected: `201` + JSON с `id/state/expiresAt/turnCreds`. Если child не связан — 403 PERMISSION_DENIED, это норм.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/audio/sessions/route.ts
git commit -m "feat(web): proxy route POST /api/audio/sessions для Plan C"
```

---

### Task 2: POST /api/audio/sessions/:id/answer proxy route

**Files:**

- Create: `apps/web/app/api/audio/sessions/[id]/answer/route.ts`

- [ ] **Step 1: Написать роут**

Create `apps/web/app/api/audio/sessions/[id]/answer/route.ts`:

```typescript
import type { NextRequest } from 'next/server';
import { proxy } from '../../../../children/_helpers';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as unknown;
  return proxy('POST', `/audio/sessions/${id}/answer`, req, body);
}
```

- [ ] **Step 2: Проверить типы**

Run: `pnpm --filter @gmd/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/audio/sessions/\[id\]/answer/route.ts
git commit -m "feat(web): proxy route POST /api/audio/sessions/:id/answer"
```

---

### Task 3: POST /api/audio/sessions/:id/ice proxy route

**Files:**

- Create: `apps/web/app/api/audio/sessions/[id]/ice/route.ts`

- [ ] **Step 1: Написать роут**

Create `apps/web/app/api/audio/sessions/[id]/ice/route.ts`:

```typescript
import type { NextRequest } from 'next/server';
import { proxy } from '../../../../children/_helpers';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as unknown;
  return proxy('POST', `/audio/sessions/${id}/ice`, req, body);
}
```

- [ ] **Step 2: Проверить типы**

Run: `pnpm --filter @gmd/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/audio/sessions/\[id\]/ice/route.ts
git commit -m "feat(web): proxy route POST /api/audio/sessions/:id/ice"
```

---

### Task 4: POST /api/audio/sessions/:id/stop proxy route

**Files:**

- Create: `apps/web/app/api/audio/sessions/[id]/stop/route.ts`

- [ ] **Step 1: Написать роут**

Create `apps/web/app/api/audio/sessions/[id]/stop/route.ts`:

```typescript
import type { NextRequest } from 'next/server';
import { proxy } from '../../../../children/_helpers';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy('POST', `/audio/sessions/${id}/stop`, req);
}
```

- [ ] **Step 2: Проверить типы**

Run: `pnpm --filter @gmd/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/audio/sessions/\[id\]/stop/route.ts
git commit -m "feat(web): proxy route POST /api/audio/sessions/:id/stop"
```

---

### Task 5: GET /api/audio/sessions/:id/events SSE proxy route

SSE особенный: `proxy()` из `_helpers.ts` не подходит (оно буферизует `res.text()`). Нужно пробросить `ReadableStream` насквозь.

**Files:**

- Create: `apps/web/app/api/audio/sessions/[id]/events/route.ts`

- [ ] **Step 1: Написать SSE-роут**

Create `apps/web/app/api/audio/sessions/[id]/events/route.ts`:

```typescript
import type { NextRequest } from 'next/server';
import { getBearer, unauthorizedResponse } from '../../../../children/_helpers';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:3001';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const token = getBearer(req);
  if (!token) return unauthorizedResponse();

  const { id } = await ctx.params;

  const upstream = await fetch(`${BACKEND_URL}/audio/sessions/${id}/events`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    },
    // Критично: cache: 'no-store' + signal для abort при закрытии клиента
    cache: 'no-store',
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return new Response(text || '{"error":{"code":"upstream_error"}}', {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Стрим насквозь. Next.js 15 Route Handlers поддерживают ReadableStream в Response.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Отключить buffering у возможных промежуточных proxy:
      'X-Accel-Buffering': 'no',
    },
  });
}
```

- [ ] **Step 2: Проверить типы**

Run: `pnpm --filter @gmd/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/audio/sessions/\[id\]/events/route.ts
git commit -m "feat(web): SSE proxy route GET /api/audio/sessions/:id/events (стриминг через ReadableStream)"
```

---

## Phase 2: Client API + SSE hook

### Task 6: Client API `audioApi` + типы

**Files:**

- Create: `apps/web/lib/api/audio.ts`
- Create: `apps/web/lib/api/audio.test.ts`

- [ ] **Step 1: Написать тест (фиктивный fetch)**

Create `apps/web/lib/api/audio.test.ts`:

```typescript
import { audioApi } from './audio';

// Mock apiFetch
jest.mock('./client', () => ({
  apiFetch: jest.fn(),
}));
import { apiFetch } from './client';

const apiFetchMock = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe('audioApi', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('createSession отправляет POST с childId/durationSec/hiddenMode', async () => {
    apiFetchMock.mockResolvedValueOnce({
      id: 'sess-1',
      state: 'PENDING',
      expiresAt: '2026-04-24T10:00:00.000Z',
      turnCreds: { url: 'turn:t', username: 'u', password: 'p', ttl: 360 },
    });

    const res = await audioApi.createSession({ childId: 'c1', durationSec: 120, hiddenMode: true });

    expect(apiFetchMock).toHaveBeenCalledWith('/api/audio/sessions', {
      method: 'POST',
      body: JSON.stringify({ childId: 'c1', durationSec: 120, hiddenMode: true }),
    });
    expect(res.id).toBe('sess-1');
  });

  it('sendAnswer отправляет SDP на /:id/answer', async () => {
    apiFetchMock.mockResolvedValueOnce(undefined);
    await audioApi.sendAnswer('sess-1', 'v=0\r\n...');
    expect(apiFetchMock).toHaveBeenCalledWith('/api/audio/sessions/sess-1/answer', {
      method: 'POST',
      body: JSON.stringify({ sdp: 'v=0\r\n...' }),
    });
  });

  it('sendIce отправляет candidate на /:id/ice', async () => {
    apiFetchMock.mockResolvedValueOnce(undefined);
    await audioApi.sendIce('sess-1', 'candidate:0 1 UDP ...');
    expect(apiFetchMock).toHaveBeenCalledWith('/api/audio/sessions/sess-1/ice', {
      method: 'POST',
      body: JSON.stringify({ candidate: 'candidate:0 1 UDP ...' }),
    });
  });

  it('stopSession делает POST на /:id/stop', async () => {
    apiFetchMock.mockResolvedValueOnce(undefined);
    await audioApi.stopSession('sess-1');
    expect(apiFetchMock).toHaveBeenCalledWith('/api/audio/sessions/sess-1/stop', {
      method: 'POST',
    });
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `pnpm --filter @gmd/web test -- audio.test.ts`
Expected: FAIL с «Cannot find module './audio'».

- [ ] **Step 3: Написать клиент**

Create `apps/web/lib/api/audio.ts`:

```typescript
// apps/web/lib/api/audio.ts
import { apiFetch } from './client';

export interface TurnCreds {
  url: string;
  username: string;
  password: string;
  ttl: number;
}

export interface CreateAudioSessionInput {
  childId: string;
  durationSec?: number;
  hiddenMode?: boolean;
}

export interface CreateAudioSessionResponse {
  id: string;
  state: 'PENDING';
  expiresAt: string;
  turnCreds: TurnCreds;
}

export type AudioSseState =
  | 'PENDING'
  | 'READY'
  | 'ACTIVE'
  | 'ICE_FROM_CHILD'
  | 'ENDED'
  | 'FAILED'
  | 'EXPIRED';

export type AudioSsePayload =
  | null
  | { sdp: string }
  | { candidate: string }
  | { actualSec: number }
  | { reason: string };

export interface AudioSseEvent {
  state: AudioSseState;
  payload: AudioSsePayload;
}

export const audioApi = {
  createSession: (input: CreateAudioSessionInput) =>
    apiFetch<CreateAudioSessionResponse>('/api/audio/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  sendAnswer: (sessionId: string, sdp: string) =>
    apiFetch<void>(`/api/audio/sessions/${sessionId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ sdp }),
    }),
  sendIce: (sessionId: string, candidate: string) =>
    apiFetch<void>(`/api/audio/sessions/${sessionId}/ice`, {
      method: 'POST',
      body: JSON.stringify({ candidate }),
    }),
  stopSession: (sessionId: string) =>
    apiFetch<void>(`/api/audio/sessions/${sessionId}/stop`, {
      method: 'POST',
    }),
};
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `pnpm --filter @gmd/web test -- audio.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api/audio.ts apps/web/lib/api/audio.test.ts
git commit -m "feat(web): audioApi client + типы SSE-событий"
```

---

### Task 7: useAudioSSE hook (fetch + ReadableStream + NDJSON parser)

SSE-формат: `data: <json>\n\n`. Парсим построчно, откидываем пустые строки, JSON.parse после `data: `.

**Files:**

- Create: `apps/web/lib/hooks/use-audio-sse.ts`
- Create: `apps/web/lib/hooks/use-audio-sse.test.ts`

- [ ] **Step 1: Написать тест**

Create `apps/web/lib/hooks/use-audio-sse.test.ts`:

```typescript
/** @jest-environment jsdom */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAudioSse } from './use-audio-sse';

jest.mock('@/lib/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ accessToken: 'test-token' }),
  },
}));

function chunks(...parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i < parts.length) {
        ctrl.enqueue(enc.encode(parts[i++]));
      } else {
        ctrl.close();
      }
    },
  });
}

describe('useAudioSse', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('парсит цепочку data:-строк и вызывает onEvent для каждой', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: chunks(
        'data: {"state":"PENDING","payload":null}\n\n',
        'data: {"state":"READY","payload":{"sdp":"v=0"}}\n\n',
        'data: {"state":"ENDED","payload":{"actualSec":12}}\n\n',
      ),
    }) as unknown as typeof fetch;

    const onEvent = jest.fn();
    const onError = jest.fn();

    renderHook(() => useAudioSse({ sessionId: 'sess-1', enabled: true, onEvent, onError }));

    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(3));

    expect(onEvent).toHaveBeenNthCalledWith(1, { state: 'PENDING', payload: null });
    expect(onEvent).toHaveBeenNthCalledWith(2, { state: 'READY', payload: { sdp: 'v=0' } });
    expect(onEvent).toHaveBeenNthCalledWith(3, {
      state: 'ENDED',
      payload: { actualSec: 12 },
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('склеивает event через два chunk (data: половина + остаток)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: chunks('data: {"state":"REA', 'DY","payload":{"sdp":"v=0"}}\n\n'),
    }) as unknown as typeof fetch;

    const onEvent = jest.fn();
    renderHook(() =>
      useAudioSse({ sessionId: 'sess-2', enabled: true, onEvent, onError: jest.fn() }),
    );
    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
    expect(onEvent).toHaveBeenCalledWith({ state: 'READY', payload: { sdp: 'v=0' } });
  });

  it('не открывает соединение при enabled=false', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    renderHook(() =>
      useAudioSse({ sessionId: 'x', enabled: false, onEvent: jest.fn(), onError: jest.fn() }),
    );
    await act(() => Promise.resolve());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('вызывает onError при HTTP 4xx/5xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      body: null,
    }) as unknown as typeof fetch;
    const onError = jest.fn();
    renderHook(() => useAudioSse({ sessionId: 'x', enabled: true, onEvent: jest.fn(), onError }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `pnpm --filter @gmd/web test -- use-audio-sse.test.ts`
Expected: FAIL (модуль не существует).

- [ ] **Step 3: Написать хук**

Create `apps/web/lib/hooks/use-audio-sse.ts`:

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import type { AudioSseEvent } from '@/lib/api/audio';

interface Params {
  sessionId: string | null;
  enabled: boolean;
  onEvent: (event: AudioSseEvent) => void;
  onError: (err: Error) => void;
}

/**
 * Custom SSE-хук через fetch + ReadableStream.
 * Не использует EventSource — тот не умеет слать Authorization header,
 * а JWT хранится в Zustand in-memory.
 *
 * Формат backend-событий: `data: <json>\n\n` (см. docs/audio-api.md §7).
 * Парсим построчно, буферизуем между chunk'ами.
 */
export function useAudioSse({ sessionId, enabled, onEvent, onError }: Params): void {
  // Кладём колбэки в ref'ы, чтобы переоткрытие SSE не триггерилось их пересозданием
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  onEventRef.current = onEvent;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const controller = new AbortController();
    const token = useAuthStore.getState().accessToken;

    (async () => {
      try {
        const res = await fetch(`/api/audio/sessions/${sessionId}/events`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
          cache: 'no-store',
        });

        if (!res.ok || !res.body) {
          onErrorRef.current(new Error(`SSE upstream error: HTTP ${res.status}`));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE event separator: "\n\n"
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data: '));
            if (!dataLine) continue;
            const jsonStr = dataLine.slice('data: '.length);
            try {
              const parsed = JSON.parse(jsonStr) as AudioSseEvent;
              onEventRef.current(parsed);
            } catch (e) {
              onErrorRef.current(
                new Error(`SSE parse error: ${e instanceof Error ? e.message : String(e)}`),
              );
            }
          }
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        onErrorRef.current(e instanceof Error ? e : new Error(String(e)));
      }
    })();

    return () => controller.abort();
  }, [sessionId, enabled]);
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `pnpm --filter @gmd/web test -- use-audio-sse.test.ts`
Expected: PASS (4 tests). Если `ReadableStream`/`TextEncoder`/`TextDecoder` не доступны в jsdom-окружении — добавить в `apps/web/jest.setup.ts`:

```typescript
import { TextEncoder, TextDecoder } from 'node:util';
// @ts-expect-error — глобальные полифилы для jsdom
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
// @ts-expect-error
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;
```

Проверь сначала — возможно уже настроено.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/hooks/use-audio-sse.ts apps/web/lib/hooks/use-audio-sse.test.ts
git commit -m "feat(web): useAudioSse hook (fetch + ReadableStream, поддержка Authorization header)"
```

---

## Phase 3: WebRTC session controller + React-хук

### Task 8: AudioSessionController (чистая логика)

Отделяем WebRTC-оркестрацию от React. Контроллер живёт вне хуков, принимает callbacks, легко тестируется.

**Files:**

- Create: `apps/web/lib/webrtc/audio-session-controller.ts`
- Create: `apps/web/lib/webrtc/audio-session-controller.test.ts`

- [ ] **Step 1: Написать тест**

Create `apps/web/lib/webrtc/audio-session-controller.test.ts`:

```typescript
/** @jest-environment jsdom */
import { AudioSessionController } from './audio-session-controller';
import type { TurnCreds } from '@/lib/api/audio';

class FakeRTCPeerConnection {
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((e: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((e: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  addedCandidates: RTCIceCandidateInit[] = [];
  closed = false;

  constructor(public readonly config: RTCConfiguration) {}

  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    this.remoteDescription = desc;
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'v=0\r\n[answer sdp]' };
  }
  async setLocalDescription(desc: RTCSessionDescriptionInit) {
    this.localDescription = desc;
  }
  async addIceCandidate(c: RTCIceCandidateInit) {
    this.addedCandidates.push(c);
  }
  addTransceiver(_kind: string, _init: RTCRtpTransceiverInit) {}
  close() {
    this.closed = true;
  }
}

describe('AudioSessionController', () => {
  const turnCreds: TurnCreds = {
    url: 'turn:t.example:3478',
    username: 'u',
    password: 'p',
    ttl: 360,
  };
  let pcFactory: jest.Mock;
  let pc: FakeRTCPeerConnection;

  beforeEach(() => {
    pc = new FakeRTCPeerConnection({});
    pcFactory = jest.fn((cfg: RTCConfiguration) => {
      (pc as unknown as { config: RTCConfiguration }).config = cfg;
      return pc as unknown as RTCPeerConnection;
    });
  });

  it('init создаёт PC с iceServers=[turnCreds] и policy=relay', () => {
    const c = new AudioSessionController({
      sessionId: 'sess-1',
      turnCreds,
      sendAnswer: jest.fn(),
      sendIce: jest.fn(),
      onStateChange: jest.fn(),
      onRemoteStream: jest.fn(),
      pcFactory,
    });
    c.init();

    expect(pcFactory).toHaveBeenCalledTimes(1);
    const cfg = pcFactory.mock.calls[0][0] as RTCConfiguration;
    expect(cfg.iceTransportPolicy).toBe('relay');
    expect(cfg.iceServers).toEqual([
      { urls: 'turn:t.example:3478', username: 'u', credential: 'p' },
    ]);
  });

  it('handleReady: setRemoteDescription(offer) → createAnswer → setLocalDescription → sendAnswer', async () => {
    const sendAnswer = jest.fn().mockResolvedValue(undefined);
    const c = new AudioSessionController({
      sessionId: 'sess-1',
      turnCreds,
      sendAnswer,
      sendIce: jest.fn(),
      onStateChange: jest.fn(),
      onRemoteStream: jest.fn(),
      pcFactory,
    });
    c.init();
    await c.handleReadyOffer('v=0\r\n[offer]');

    expect(pc.remoteDescription).toEqual({ type: 'offer', sdp: 'v=0\r\n[offer]' });
    expect(pc.localDescription).toEqual({ type: 'answer', sdp: 'v=0\r\n[answer sdp]' });
    expect(sendAnswer).toHaveBeenCalledWith('sess-1', 'v=0\r\n[answer sdp]');
  });

  it('handleIceFromChild: addIceCandidate с sdpMid="0" и sdpMLineIndex=0', async () => {
    const c = new AudioSessionController({
      sessionId: 'sess-1',
      turnCreds,
      sendAnswer: jest.fn(),
      sendIce: jest.fn(),
      onStateChange: jest.fn(),
      onRemoteStream: jest.fn(),
      pcFactory,
    });
    c.init();
    await c.handleIceFromChild('candidate:0 1 UDP ...');
    expect(pc.addedCandidates).toEqual([
      { candidate: 'candidate:0 1 UDP ...', sdpMid: '0', sdpMLineIndex: 0 },
    ]);
  });

  it('onicecandidate пробрасывает candidate в sendIce', () => {
    const sendIce = jest.fn();
    const c = new AudioSessionController({
      sessionId: 'sess-1',
      turnCreds,
      sendAnswer: jest.fn(),
      sendIce,
      onStateChange: jest.fn(),
      onRemoteStream: jest.fn(),
      pcFactory,
    });
    c.init();

    const fakeCand = { candidate: 'candidate:1 1 UDP ...' } as unknown as RTCIceCandidate;
    pc.onicecandidate?.({ candidate: fakeCand } as RTCPeerConnectionIceEvent);

    expect(sendIce).toHaveBeenCalledWith('sess-1', 'candidate:1 1 UDP ...');
  });

  it('ontrack → onRemoteStream вызывается с MediaStream', () => {
    const onRemoteStream = jest.fn();
    const c = new AudioSessionController({
      sessionId: 'sess-1',
      turnCreds,
      sendAnswer: jest.fn(),
      sendIce: jest.fn(),
      onStateChange: jest.fn(),
      onRemoteStream,
      pcFactory,
    });
    c.init();

    const fakeStream = {} as MediaStream;
    pc.ontrack?.({ streams: [fakeStream] } as RTCTrackEvent);

    expect(onRemoteStream).toHaveBeenCalledWith(fakeStream);
  });

  it('stop() закрывает PC', () => {
    const c = new AudioSessionController({
      sessionId: 'sess-1',
      turnCreds,
      sendAnswer: jest.fn(),
      sendIce: jest.fn(),
      onStateChange: jest.fn(),
      onRemoteStream: jest.fn(),
      pcFactory,
    });
    c.init();
    c.stop();
    expect(pc.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `pnpm --filter @gmd/web test -- audio-session-controller.test.ts`
Expected: FAIL (модуль не существует).

- [ ] **Step 3: Написать контроллер**

Create `apps/web/lib/webrtc/audio-session-controller.ts`:

```typescript
// apps/web/lib/webrtc/audio-session-controller.ts
import type { TurnCreds } from '@/lib/api/audio';

export type AudioControllerState = 'idle' | 'negotiating' | 'active' | 'ended' | 'failed';

type PcFactory = (config: RTCConfiguration) => RTCPeerConnection;

interface Params {
  sessionId: string;
  turnCreds: TurnCreds;
  sendAnswer: (sessionId: string, sdp: string) => Promise<void>;
  sendIce: (sessionId: string, candidate: string) => Promise<void>;
  onStateChange: (state: AudioControllerState) => void;
  onRemoteStream: (stream: MediaStream) => void;
  /** Инъекция фабрики для тестов. По умолчанию native RTCPeerConnection. */
  pcFactory?: PcFactory;
}

/**
 * Инкапсулирует WebRTC state-machine на стороне parent.
 * НЕ завязан на React — легко тестируется.
 *
 * Протокол signaling (см. docs/audio-api.md §9.1):
 *   1. Backend → SSE event READY {sdp}     → handleReadyOffer(sdp)
 *   2. Backend → SSE event ICE_FROM_CHILD  → handleIceFromChild(candidate)
 *   3. Local onicecandidate                → sendIce(candidate)
 *   4. Remote ontrack                      → onRemoteStream(stream)
 *   5. Backend → ENDED/FAILED/EXPIRED      → stop()
 */
export class AudioSessionController {
  private pc: RTCPeerConnection | null = null;
  private readonly factory: PcFactory;

  constructor(private readonly params: Params) {
    this.factory = params.pcFactory ?? ((cfg) => new RTCPeerConnection(cfg));
  }

  init(): void {
    const config: RTCConfiguration = {
      iceServers: [
        {
          urls: this.params.turnCreds.url,
          username: this.params.turnCreds.username,
          credential: this.params.turnCreds.password,
        },
      ],
      iceTransportPolicy: 'relay', // privacy: не светить parent IP
    };

    this.pc = this.factory(config);

    // recvonly — parent только слушает
    this.pc.addTransceiver('audio', { direction: 'recvonly' });

    this.pc.onicecandidate = (e) => {
      if (e.candidate?.candidate) {
        void this.params.sendIce(this.params.sessionId, e.candidate.candidate).catch(() => {
          // ICE-кандидаты лучше терять, чем ломать сессию. Игнор.
        });
      }
    };

    this.pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (stream) this.params.onRemoteStream(stream);
    };

    this.pc.onconnectionstatechange = () => {
      const s = this.pc?.connectionState;
      if (s === 'connected') this.params.onStateChange('active');
      else if (s === 'failed' || s === 'disconnected') this.params.onStateChange('failed');
      else if (s === 'closed') this.params.onStateChange('ended');
    };

    this.params.onStateChange('negotiating');
  }

  async handleReadyOffer(sdpOffer: string): Promise<void> {
    if (!this.pc) throw new Error('Controller not initialized');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: sdpOffer });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    if (answer.sdp) {
      await this.params.sendAnswer(this.params.sessionId, answer.sdp);
    }
  }

  async handleIceFromChild(candidate: string): Promise<void> {
    if (!this.pc) return;
    // Backend шлёт только candidate-string без sdpMid/sdpMLineIndex.
    // Для audio-only single m-line hard-code sdpMid='0', sdpMLineIndex=0.
    await this.pc.addIceCandidate({ candidate, sdpMid: '0', sdpMLineIndex: 0 }).catch(() => {
      // Поздние ICE-кандидаты иногда приходят после закрытия PC — игнор.
    });
  }

  stop(): void {
    this.pc?.close();
    this.pc = null;
  }
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `pnpm --filter @gmd/web test -- audio-session-controller.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/webrtc/audio-session-controller.ts apps/web/lib/webrtc/audio-session-controller.test.ts
git commit -m "feat(web): AudioSessionController — WebRTC state-machine для parent"
```

---

### Task 9: useAudioSession React hook

Оркестрирует: `createSession` → SSE → controller → handling всех SSE-событий → timers → auto-stop.

**Files:**

- Create: `apps/web/lib/hooks/use-audio-session.ts`

- [ ] **Step 1: Написать хук (без тестов — интеграция через AudioListenDialog в Task 11)**

Create `apps/web/lib/hooks/use-audio-session.ts`:

```typescript
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { audioApi, type AudioSseEvent, type TurnCreds } from '@/lib/api/audio';
import { AudioSessionController } from '@/lib/webrtc/audio-session-controller';
import { useAudioSse } from './use-audio-sse';

export type AudioUiState =
  | 'idle'
  | 'starting' // create session → ждём первый ответ
  | 'waiting' // PENDING — ждём child
  | 'negotiating' // READY получен, отправляем answer
  | 'active' // ACTIVE — аудио идёт
  | 'ended' // штатное завершение
  | 'failed' // ошибка (см. errorReason)
  | 'expired'; // timeout child

export interface UseAudioSessionResult {
  state: AudioUiState;
  sessionId: string | null;
  error: string | null;
  /** Причина failed/expired (из SSE event.payload.reason). */
  errorReason: string | null;
  mediaStream: MediaStream | null;
  elapsedSec: number;
  durationSec: number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

interface Params {
  childId: string;
  durationSec: number; // запрошенная длительность — для таймера
}

export function useAudioSession({ childId, durationSec }: Params): UseAudioSessionResult {
  const [state, setState] = useState<AudioUiState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const controllerRef = useRef<AudioSessionController | null>(null);
  const turnCredsRef = useRef<TurnCreds | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeStartRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    controllerRef.current?.stop();
    controllerRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    activeStartRef.current = null;
  }, []);

  const stop = useCallback(async () => {
    const id = sessionId;
    cleanup();
    setState((prev) => (prev === 'active' || prev === 'negotiating' ? 'ended' : prev));
    if (id) {
      try {
        await audioApi.stopSession(id);
      } catch {
        /* best-effort */
      }
    }
  }, [sessionId, cleanup]);

  const start = useCallback(async () => {
    setState('starting');
    setError(null);
    setErrorReason(null);
    setMediaStream(null);
    setElapsedSec(0);

    try {
      const res = await audioApi.createSession({ childId, durationSec, hiddenMode: true });
      setSessionId(res.id);
      turnCredsRef.current = res.turnCreds;
      setState('waiting');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать сессию');
      setState('failed');
    }
  }, [childId, durationSec]);

  // Очистка при unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // SSE handler
  useAudioSse({
    sessionId,
    enabled: sessionId !== null && state !== 'ended' && state !== 'failed' && state !== 'expired',
    onError: (err) => {
      setError(err.message);
      setState('failed');
      cleanup();
    },
    onEvent: (event: AudioSseEvent) => {
      if (event.state === 'PENDING') {
        setState((prev) => (prev === 'starting' ? 'waiting' : prev));
      } else if (event.state === 'READY') {
        const payload = event.payload as { sdp: string };
        if (!turnCredsRef.current || !sessionId) return;
        if (!controllerRef.current) {
          controllerRef.current = new AudioSessionController({
            sessionId,
            turnCreds: turnCredsRef.current,
            sendAnswer: audioApi.sendAnswer,
            sendIce: audioApi.sendIce,
            onStateChange: () => {
              /* реагируем через backend-side ACTIVE event */
            },
            onRemoteStream: (stream) => setMediaStream(stream),
          });
          controllerRef.current.init();
        }
        setState('negotiating');
        void controllerRef.current.handleReadyOffer(payload.sdp).catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'Ошибка WebRTC');
          setState('failed');
          cleanup();
        });
      } else if (event.state === 'ICE_FROM_CHILD') {
        const payload = event.payload as { candidate: string };
        void controllerRef.current?.handleIceFromChild(payload.candidate);
      } else if (event.state === 'ACTIVE') {
        activeStartRef.current = Date.now();
        setState('active');
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          if (activeStartRef.current) {
            const sec = Math.floor((Date.now() - activeStartRef.current) / 1000);
            setElapsedSec(sec);
            if (sec >= durationSec) {
              void stop();
            }
          }
        }, 250);
      } else if (event.state === 'ENDED') {
        setState('ended');
        cleanup();
      } else if (event.state === 'FAILED') {
        const reason = (event.payload as { reason?: string } | null)?.reason ?? 'UNKNOWN';
        setErrorReason(reason);
        setState('failed');
        cleanup();
      } else if (event.state === 'EXPIRED') {
        setState('expired');
        cleanup();
      }
    },
  });

  return {
    state,
    sessionId,
    error,
    errorReason,
    mediaStream,
    elapsedSec,
    durationSec,
    start,
    stop,
  };
}
```

- [ ] **Step 2: Проверить типы**

Run: `pnpm --filter @gmd/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/hooks/use-audio-session.ts
git commit -m "feat(web): useAudioSession — React-хук оркестрации SSE + WebRTC + таймер"
```

---

## Phase 4: UI — dialog + VU-meter + button

### Task 10: VU-meter утилита

Простой RAF-loop, считает RMS-level из `AnalyserNode`, вызывает колбэк.

**Files:**

- Create: `apps/web/lib/webrtc/vu-meter.ts`

- [ ] **Step 1: Написать утилиту**

Create `apps/web/lib/webrtc/vu-meter.ts`:

```typescript
// apps/web/lib/webrtc/vu-meter.ts
/**
 * Запускает RAF-loop, считающий RMS-level (0..1) из MediaStream audio track.
 * Колбэк вызывается ~60 fps. Возвращает функцию для остановки.
 */
export function createVuMeter(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const audioCtx = new (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  )();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Uint8Array(analyser.fftSize);
  let raf = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    // Нормализация: типичный речевой RMS ≈ 0.1-0.3, приводим к 0..1
    onLevel(Math.min(1, rms * 3));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    source.disconnect();
    void audioCtx.close();
  };
}
```

- [ ] **Step 2: Проверить типы**

Run: `pnpm --filter @gmd/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/webrtc/vu-meter.ts
git commit -m "feat(web): vu-meter utility — RMS-level из MediaStream через AnalyserNode"
```

---

### Task 11: AudioListenDialog компонент

**Files:**

- Create: `apps/web/components/children/audio-listen-dialog.tsx`

- [ ] **Step 1: Написать компонент**

Create `apps/web/components/children/audio-listen-dialog.tsx`:

```typescript
'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Ear, Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Child } from '@/lib/api/children';
import { useAudioSession, type AudioUiState } from '@/lib/hooks/use-audio-session';
import { createVuMeter } from '@/lib/webrtc/vu-meter';

interface Props {
  child: Child;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const DURATION_SEC = 300; // 5 мин — совпадает с backend default

function formatMmSs(sec: number): string {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

function stateLabel(s: AudioUiState): string {
  switch (s) {
    case 'idle':
      return 'Готово к подключению';
    case 'starting':
      return 'Создаём сессию…';
    case 'waiting':
      return 'Ожидаем ответ от устройства ребёнка…';
    case 'negotiating':
      return 'Устанавливаем соединение…';
    case 'active':
      return 'Подключено';
    case 'ended':
      return 'Сессия завершена';
    case 'failed':
      return 'Ошибка соединения';
    case 'expired':
      return 'Устройство не отвечает';
  }
}

function failReasonLabel(reason: string | null): string {
  switch (reason) {
    case 'PERMISSION_DENIED':
      return 'На устройстве ребёнка отключено разрешение на микрофон.';
    case 'MIC_BUSY':
      return 'Микрофон занят другим приложением (например, звонком). Попробуйте позже.';
    case 'OEM_BLOCKED':
      return 'Оболочка устройства заблокировала работу в фоне. Откройте инструкции для Xiaomi/Honor.';
    case 'NETWORK_ERROR':
      return 'Сетевая ошибка на устройстве ребёнка.';
    default:
      return 'Не удалось установить соединение. Попробуйте снова.';
  }
}

export function AudioListenDialog({ child, open, onOpenChange }: Props): ReactElement {
  const session = useAudioSession({ childId: child.id, durationSec: DURATION_SEC });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [level, setLevel] = useState(0);

  // Привязываем MediaStream к <audio>
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (session.mediaStream) {
      el.srcObject = session.mediaStream;
      void el.play().catch(() => {
        // autoplay может быть заблокирован, но dialog открыт по клику — обычно ок
      });
    } else {
      el.srcObject = null;
    }
  }, [session.mediaStream]);

  // VU-meter
  useEffect(() => {
    if (!session.mediaStream) {
      setLevel(0);
      return;
    }
    const stop = createVuMeter(session.mediaStream, setLevel);
    return stop;
  }, [session.mediaStream]);

  // Автостарт при открытии
  useEffect(() => {
    if (open && session.state === 'idle') {
      void session.start();
    }
  }, [open, session.state, session]);

  // Toast на FAILED
  useEffect(() => {
    if (session.state === 'failed') {
      toast.error(failReasonLabel(session.errorReason));
    } else if (session.state === 'expired') {
      toast.error('Устройство ребёнка не отвечает. Возможно, оно офлайн.');
    }
  }, [session.state, session.errorReason]);

  const handleClose = async (v: boolean) => {
    if (!v) {
      // Закрытие диалога = явный стоп
      if (session.state === 'active' || session.state === 'negotiating' || session.state === 'waiting' || session.state === 'starting') {
        await session.stop();
      }
    }
    onOpenChange(v);
  };

  const elapsed = formatMmSs(session.elapsedSec);
  const total = formatMmSs(session.durationSec);
  const levelPct = Math.round(level * 100);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ear className="h-5 w-5 text-emerald-600" />
            Звук вокруг — {child.name}
          </DialogTitle>
          <DialogDescription>
            Слушаем микрофон устройства ребёнка. На устройстве появится системный индикатор
            использования микрофона.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              {session.state === 'active' ? (
                <Mic className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              ) : (
                <MicOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
              <span aria-live="polite">{stateLabel(session.state)}</span>
            </div>
            <span className="font-mono text-sm tabular-nums">
              {elapsed} / {total}
            </span>
          </div>

          {/* VU-meter */}
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={levelPct}
            aria-label="Уровень звука"
          >
            <div
              className="h-full bg-emerald-500 transition-[width] duration-75"
              style={{ width: `${levelPct}%` }}
            />
          </div>

          {/* Скрытый audio для playback */}
          <audio ref={audioRef} autoPlay playsInline className="sr-only" />

          {(session.state === 'failed' || session.state === 'expired') && (
            <p className="text-sm text-red-600">
              {session.state === 'expired'
                ? 'Устройство ребёнка не ответило. Проверьте интернет на телефоне ребёнка.'
                : failReasonLabel(session.errorReason)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => void handleClose(false)}>
            {session.state === 'active' || session.state === 'negotiating' ? 'Остановить' : 'Закрыть'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Проверить типы**

Run: `pnpm --filter @gmd/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/children/audio-listen-dialog.tsx
git commit -m "feat(web): AudioListenDialog — модалка с audio playback, таймером, VU-meter"
```

---

### Task 12: Кнопка «Звук вокруг» в child-actions.tsx

**Files:**

- Modify: `apps/web/components/cabinet/child-actions.tsx`

- [ ] **Step 1: Модификация**

Edit `apps/web/components/cabinet/child-actions.tsx`. Нужно добавить:

1. Импорт `Ear` из `lucide-react` и `AudioListenDialog`.
2. State `const [audioOpen, setAudioOpen] = useState(false);`
3. Кнопка в UI (между «Отправить сигнал» и «Отвязать устройство»), показывать только когда `canSignal` (устройство привязано).
4. Рендер `<AudioListenDialog>` в конце компонента (после `SendSignalDialog`).

Патч:

```tsx
// Строка 5 (импорты lucide):
import { Bell, Clock, Ear, RotateCcw, Shield, Trash2 } from 'lucide-react';

// Строка 10 (импорты компонентов):
import { SendSignalDialog } from '@/components/children/send-signal-dialog';
import { AudioListenDialog } from '@/components/children/audio-listen-dialog';

// После `const [signalOpen, setSignalOpen] = useState(false);`:
const [audioOpen, setAudioOpen] = useState(false);

// В JSX, после блока «Отправить сигнал», перед «Отвязать устройство»:
{
  canSignal && (
    <button
      type="button"
      onClick={() => setAudioOpen(true)}
      className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
    >
      <Ear className="h-4 w-4 text-muted-foreground" />
      Звук вокруг
    </button>
  );
}

// В конце (после SendSignalDialog, перед DeleteChildDialog):
{
  canSignal && <AudioListenDialog child={child} open={audioOpen} onOpenChange={setAudioOpen} />;
}
```

- [ ] **Step 2: Проверить типы и lint**

Run: `pnpm --filter @gmd/web typecheck && pnpm --filter @gmd/web lint`
Expected: no errors, no warnings.

- [ ] **Step 3: Smoke-test вручную**

Run: `pnpm dev` (backend + web).
Открыть в браузере: http://localhost:3003/cabinet → клик по child card → раскрыть actions → увидеть кнопку «Звук вокруг». (Плюс-минус полный end-to-end не проверяется без реального child-устройства с запущенным APK, но UI должен рендериться без ошибок.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/cabinet/child-actions.tsx
git commit -m "feat(web): кнопка «Звук вокруг» в child-actions.tsx"
```

---

## Phase 5: Release

### Task 13: Bump version + CHANGELOG + release

**Files:**

- Modify: `package.json` (root)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Обновить CHANGELOG.md — добавить блок сверху**

Edit `CHANGELOG.md`, добавить новую секцию на самом верху (под заголовком `# Changelog` и перед предыдущей версией):

```markdown
## v0.34.0 — 2026-04-24

### Новые возможности

- **Звук вокруг ребёнка (web-кабинет)** — родитель может в один клик включить прослушку окружения с телефона ребёнка. Работает в Chrome/Edge/Firefox через WebRTC с TURN-relay, ограниченная длительность 5 мин, индикатор уровня звука, таймер обратного отсчёта. Дополняет mobile-child из v0.33.x и backend из v0.32.x — фича готова end-to-end на web.

### Изменения

- docs: Plan C — web-parent UI (SSE + WebRTC) добавлен в `docs/superpowers/plans/`.
```

- [ ] **Step 2: Bump root version**

Run:

```bash
npm version 0.34.0 --no-git-tag-version --workspaces=false
pnpm version:sync
pnpm version:check
```

Expected: `version:check` → PASS.

- [ ] **Step 3: Прогнать полные проверки**

Run: `pnpm --filter @gmd/web typecheck && pnpm --filter @gmd/web lint && pnpm --filter @gmd/web test`
Expected: all PASS.

- [ ] **Step 4: Commit + tag**

```bash
git add CHANGELOG.md package.json apps/*/package.json apps/mobile-*/pubspec.yaml
git commit -m "chore: release v0.34.0 — «Звук вокруг» web-parent (Plan C)"
git tag v0.34.0
```

- [ ] **Step 5: Smoke-test в dev**

Запустить `pnpm dev`, пройти путь:

1. Открыть http://localhost:3003/cabinet.
2. Найти ребёнка с привязанным устройством.
3. Раскрыть меню действий → кликнуть «Звук вокруг».
4. Убедиться что модалка открывается, показывает «Создаём сессию…» → «Ожидаем ответ от устройства…» (т.к. child-устройство может быть недоступно, ок если перейдёт в `expired` через 45 сек).
5. Закрыть модалку — убедиться что отправляется `POST /stop`.
6. Открыть DevTools Network → проверить что `/api/audio/sessions` → 201, SSE `/events` держит соединение.

Если всё рендерится без ошибок в консоли — plan C выполнен.

---

## Self-Review checklist

Выполняется после реализации последнего task.

- [ ] Все spec-требования покрыты (см. [spec §5-6](../specs/2026-04-23-gmd-sound-around-design.md))
  - Parent UI web ✓ (Task 11-12)
  - RTCPeerConnection с TURN-creds ✓ (Task 8)
  - SSE-подписка ✓ (Task 7)
  - Auto-stop по истечении duration ✓ (Task 9)
  - VU-индикатор ✓ (Task 10-11)
  - Обработка FAILED/EXPIRED с понятными сообщениями ✓ (Task 11)
- [ ] Нет placeholders/TODO в коде.
- [ ] Типы согласованы: `TurnCreds`, `AudioSseEvent`, `AudioSseState` — одинаковые везде.
- [ ] Force-relay TURN (`iceTransportPolicy: 'relay'`) — privacy (см. Plan A §10.3).
- [ ] ICE reconstruct с `sdpMid='0', sdpMLineIndex=0` (see Task 8).
- [ ] SSE-хук поддерживает Authorization header (см. Task 7 — не `EventSource`).
- [ ] Cleanup на unmount `AudioListenDialog` закрывает PC + шлёт stop (Task 9+11).
- [ ] CHANGELOG обновлён (Task 13).
- [ ] Все тесты (`audio.test.ts`, `use-audio-sse.test.ts`, `audio-session-controller.test.ts`) проходят.

---

## Оценка и темп

- 13 tasks × ~2 subagent calls (implementer + review) ≈ **25-28 subagent calls**.
- 1-2 hotfixes по итогам финального review (по опыту Plan B).
- Итого — **1 рабочий день** в формате subagent-driven-development, или ~4-5 часов inline.
