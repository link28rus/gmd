#!/usr/bin/env node
/**
 * Публикация приложений «Перископ» в RuStore через Public API.
 * Основной способ публикации (вместо ручного прохода Console wizard).
 *
 * Один RuStore API-ключ («Claude», аккаунт Четверик Дмитрий) авторизует
 * управление ВСЕМИ приложениями аккаунта (и Перископ, и др.). Ключ НЕ хранится
 * в репозитории — берётся из memory-compiler (секрет «RuStore API приватный
 * ключ "Claude"») и передаётся через env:
 *   RUSTORE_KEY_B64 — приватный ключ (base64 PKCS#8 DER, без PEM-заголовков)
 *   RUSTORE_KEY_ID  — ID ключа (по умолчанию 2351029107)
 *
 * Приложения (применяется --app child|parent или явный --package):
 *   child  -> pro.periscop.child   («Перископ Ребёнка»)
 *   parent -> pro.periscop.parent  («Перископ Родителя»)
 *
 * Команды:
 *   node tools/rustore/rustore-publish.mjs status  --app child
 *   node tools/rustore/rustore-publish.mjs publish --app child  --aab <path> --whatsnew "..." [--draft-only]
 *   node tools/rustore/rustore-publish.mjs publish --app parent --apk <path> --whatsnew "..."
 *   node tools/rustore/rustore-publish.mjs delete-draft --app child <versionId>
 *
 * ВАЖНО (ограничение Public API): API управляет ВЕРСИЯМИ уже СУЩЕСТВУЮЩЕГО в
 * Console приложения. Создать запись нового package (pro.periscop.*) через API
 * НЕЛЬЗЯ — первую запись приложения создаём один раз в RuStore Console, дальше
 * все версии — этим скриптом.
 *
 * Native Flutter -> загружаем AAB (--aab). RuStore переподпишет его своим ключом
 * (для native это нормально; ограничение про APK-only актуально только для TWA).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://public-api.rustore.ru';
const KEY_ID = process.env.RUSTORE_KEY_ID || '2351029107';

const APPS = {
  child: 'pro.periscop.child',
  parent: 'pro.periscop.parent',
};

// Комментарий модератору (<=180 симв.) — тест-доступ обязателен, иначе отказ.
// Многоразовый invite + тест-аккаунт родителя. Обновлять перед подачей child.
const MODER_INFO = {
  child:
    'Приложение ребёнка сервиса родительского контроля «Перископ». Привязка к семье ' +
    'по коду от родителя. Тест-код и инструкция — в комментарии к версии родителя.',
  parent:
    'Личный кабинет родителя «Перископ» (геолокация ребёнка, геозоны, SOS). ' +
    'Тестовый вход: см. test-credentials в описании версии. Аккаунт многоразовый.',
};

function fail(msg) {
  console.error('ОШИБКА: ' + msg);
  process.exit(1);
}

function resolvePackage(args) {
  const pkgIdx = args.indexOf('--package');
  if (pkgIdx >= 0) return args[pkgIdx + 1];
  const appIdx = args.indexOf('--app');
  if (appIdx >= 0) {
    const app = args[appIdx + 1];
    if (!APPS[app]) fail(`неизвестный --app ${app} (доступно: ${Object.keys(APPS).join(', ')})`);
    return APPS[app];
  }
  fail('укажи --app child|parent или --package <packageName>');
}

function moderInfo(pkg) {
  const app = Object.keys(APPS).find((k) => APPS[k] === pkg);
  return MODER_INFO[app] || 'Сервис родительского контроля «Перископ».';
}

async function getToken() {
  const keyB64 = process.env.RUSTORE_KEY_B64;
  if (!keyB64) {
    fail('нет env RUSTORE_KEY_B64 (ключ — в memory-compiler, секрет «RuStore API приватный ключ Claude»)');
  }
  const key = crypto.createPrivateKey({ key: Buffer.from(keyB64, 'base64'), format: 'der', type: 'pkcs8' });
  const timestamp = new Date().toISOString();
  const signature = crypto.sign('RSA-SHA512', Buffer.from(KEY_ID + timestamp), key).toString('base64');
  const r = await fetch(`${BASE}/public/auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId: KEY_ID, timestamp, signature }),
  }).then((x) => x.json());
  if (!r.body?.jwe) fail('auth не прошёл: ' + JSON.stringify(r));
  return r.body.jwe; // живёт 900 секунд
}

async function api(token, method, url, body, isJson = true) {
  const headers = { 'Public-Token': token };
  if (isJson && body) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: body ? (isJson ? JSON.stringify(body) : body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { http: r.status, ...data };
}

async function cmdStatus(args) {
  const pkg = resolvePackage(args);
  const token = await getToken();
  const r = await api(token, 'GET', `/public/v1/application/${pkg}/version`);
  if (r.code !== 'OK') fail(JSON.stringify(r));
  console.log(`# ${pkg}`);
  for (const v of r.body.content) {
    console.log(
      `${v.versionName}(${v.versionCode})  versionId=${v.versionId}  статус=${v.versionStatus}  публикация=${v.publishType}  подана=${v.sendDateForModer ?? '—'}  опубликована=${v.publishDateTime ?? '—'}`,
    );
  }
}

async function cmdPublish(args) {
  const pkg = resolvePackage(args);
  const aabIdx = args.indexOf('--aab');
  const apkIdx = args.indexOf('--apk');
  const wnIdx = args.indexOf('--whatsnew');
  const whatsNew = wnIdx >= 0 ? args[wnIdx + 1] : null;
  const miIdx = args.indexOf('--moderinfo');
  const moderInfoArg = miIdx >= 0 ? args[miIdx + 1] : null;
  const anIdx = args.indexOf('--appname');
  const appNameArg = anIdx >= 0 ? args[anIdx + 1] : null;
  const draftOnly = args.includes('--draft-only');
  if (!whatsNew) fail('укажи --whatsnew "текст что нового" (до 5000 симв.)');
  if (aabIdx < 0 && apkIdx < 0) fail('укажи --aab <path> (native) или --apk <path>');
  const isAab = aabIdx >= 0;
  const artifactPath = isAab ? args[aabIdx + 1] : args[apkIdx + 1];
  if (!fs.existsSync(artifactPath)) fail('артефакт не найден: ' + artifactPath);

  const token = await getToken();

  // 1. Черновик версии. Описание/медиа/категории наследуются от прошлой версии —
  //    передаём только то, что меняется. Один черновик на приложение!
  console.log('1/3 Создаю черновик…');
  const draft = await api(token, 'POST', `/public/v1/application/${pkg}/version`, {
    whatsNew,
    moderInfo: moderInfoArg || moderInfo(pkg),
    publishType: 'INSTANTLY',
    // appName задаёт отображаемое в каталоге имя приложения (для смены бренда
    // существующей записи — напр. «GMD: родительский контроль» → «Перископ Родителя»).
    ...(appNameArg ? { appName: appNameArg } : {}),
  });
  if (draft.code !== 'OK') {
    // Если черновик уже есть — в message обычно его ID; удалить: delete-draft <id>
    fail('черновик не создан: ' + JSON.stringify(draft));
  }
  const versionId = draft.body;
  console.log('   versionId=' + versionId);

  // 2. Артефакт (multipart, поле file). versionCode должен расти монотонно.
  const endpoint = isAab
    ? `/public/v1/application/${pkg}/version/${versionId}/aab`
    : `/public/v1/application/${pkg}/version/${versionId}/apk?servicesType=Unknown&isMainApk=true`;
  console.log(`2/3 Загружаю ${isAab ? 'AAB' : 'APK'}…`);
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(artifactPath)]), path.basename(artifactPath));
  const up = await api(token, 'POST', endpoint, form, false);
  if (up.code !== 'OK') fail('артефакт не загрузился: ' + JSON.stringify(up));
  console.log('   OK');

  if (draftOnly) {
    console.log('Черновик готов (без отправки). Отправить позже без --draft-only либо commit в Console.');
    return;
  }

  // 3. На модерацию
  console.log('3/3 Отправляю на модерацию…');
  const commit = await api(token, 'POST', `/public/v1/application/${pkg}/version/${versionId}/commit?priorityUpdate=0`);
  if (commit.code !== 'OK') fail('commit не прошёл: ' + JSON.stringify(commit));
  console.log(`Готово! ${pkg} versionId=${versionId} на модерации (обычно 12–24 ч). Статус: status --app …`);
}

async function cmdDeleteDraft(args) {
  const pkg = resolvePackage(args);
  const versionId = args.filter((a) => /^\d+$/.test(a)).pop();
  if (!versionId) fail('укажи versionId (число)');
  const token = await getToken();
  const r = await api(token, 'DELETE', `/public/v1/application/${pkg}/version/${versionId}`);
  console.log(JSON.stringify(r));
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'status') await cmdStatus(rest);
else if (cmd === 'publish') await cmdPublish(rest);
else if (cmd === 'delete-draft') await cmdDeleteDraft(rest);
else {
  console.log(
    'Команды:\n' +
      '  status       --app child|parent\n' +
      '  publish      --app child|parent --aab <path> --whatsnew "..." [--draft-only]\n' +
      '  delete-draft --app child|parent <versionId>\n' +
      'Ключ: export RUSTORE_KEY_B64=... (из memory-compiler секрет «RuStore API приватный ключ Claude»)',
  );
  process.exit(1);
}
