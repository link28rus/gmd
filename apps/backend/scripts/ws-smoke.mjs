#!/usr/bin/env node
// Smoke-тест /audio/ws gateway. Проверяет правильные close-коды для разных
// сценариев auth-фейла. НЕ тестирует полный audio-flow (нужен JWT с реальной
// сессией) — только защитный слой gateway.
//
// Usage: AUDIO_WS_SECRET=... node apps/backend/scripts/ws-smoke.mjs ws://localhost:3001/audio/ws

import WebSocket from 'ws';
import { SignJWT } from 'jose';

const URL = process.argv[2] ?? 'ws://localhost:3001/audio/ws';
const SECRET = process.env.AUDIO_WS_SECRET;
if (!SECRET) {
  console.error('AUDIO_WS_SECRET env required');
  process.exit(2);
}
const key = new TextEncoder().encode(SECRET);

function connect(label, url, expectedCode, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ws.terminate();
      resolve({ label, ok: false, reason: 'timeout' });
    }, timeoutMs);
    ws.on('close', (code, reason) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      const ok = code === expectedCode;
      resolve({
        label,
        ok,
        actualCode: code,
        expectedCode,
        reason: reason?.toString() ?? '',
      });
    });
    ws.on('error', () => {
      // close-event прилетит и без error — игнорируем здесь
    });
  });
}

async function main() {
  const cases = [];

  // 1) Нет query → 4400 missing_query_params
  cases.push(await connect('no-query', URL, 4400));

  // 2) Только role, нет sessionId/token → 4400
  cases.push(await connect('partial-query', `${URL}?role=parent`, 4400));

  // 3) Невалидный role → 4400 invalid_role
  cases.push(
    await connect(
      'bad-role',
      `${URL}?role=admin&sessionId=s1&token=x`,
      4400,
    ),
  );

  // 4) Невалидный JWT → 4401 invalid_token
  cases.push(
    await connect(
      'bad-token',
      `${URL}?role=parent&sessionId=s1&token=not-a-jwt`,
      4401,
    ),
  );

  // 5) Валидный JWT, но sid в claim != sessionId в URL → 4401 token_session_mismatch
  const tokSidMismatch = await new SignJWT({
    sid: 'session_OTHER',
    role: 'parent',
    sub: 'user_smoke',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(key);
  cases.push(
    await connect(
      'sid-mismatch',
      `${URL}?role=parent&sessionId=session_REQUESTED&token=${tokSidMismatch}`,
      4401,
    ),
  );

  // 6) Валидный JWT с правильным sid, но сессии в БД нет → 4404 session_not_active
  const tokGoodSig = await new SignJWT({
    sid: 'session_does_not_exist_xyz',
    role: 'parent',
    sub: 'user_smoke',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(key);
  cases.push(
    await connect(
      'no-such-session',
      `${URL}?role=parent&sessionId=session_does_not_exist_xyz&token=${tokGoodSig}`,
      4404,
    ),
  );

  // Печать
  let allOk = true;
  for (const c of cases) {
    const status = c.ok ? '✓' : '✗';
    if (!c.ok) allOk = false;
    console.log(
      `${status} ${c.label.padEnd(20)} expected=${c.expectedCode} actual=${c.actualCode ?? '?'} ${c.reason ? '(' + c.reason + ')' : ''}`,
    );
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke failed:', e);
  process.exit(2);
});
