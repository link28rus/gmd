import {
  buildDiagTxt,
  debugState,
  diagFileName,
  filterLogLines,
  formatSize,
  initialDebugDuration,
  normalizeCategories,
  parseAppVersion,
  prettySnapshot,
  resolveDebugUntil,
  supportsDiag,
  uploadReasonLabel,
} from '@/lib/admin/diag';
import type { DiagCategory, DiagConfig, DiagUploadDetail } from '@/lib/api/admin';

const ORDER: DiagCategory[] = [
  'audio',
  'location',
  'realtime',
  'push',
  'update',
  'system',
  'other',
];

const BASE: DiagConfig = {
  send: [...ORDER],
  debug: [],
  debugUntil: null,
  logcat: false,
  snapshot: true,
  autoUpload: true,
};

const NOW = Date.parse('2026-09-29T12:00:00.000Z');

describe('версия приложения', () => {
  it('разбирает X.Y.Z+N', () => {
    expect(parseAppVersion('0.60.0+6100')).toEqual([0, 60, 0]);
    expect(parseAppVersion('abc')).toBeNull();
    expect(parseAppVersion(null)).toBeNull();
  });

  it('0.60.0 и новее поддерживают журнал, старее — нет, неизвестная — null', () => {
    expect(supportsDiag('0.60.0+1')).toBe(true);
    expect(supportsDiag('0.61.2')).toBe(true);
    expect(supportsDiag('1.0.0')).toBe(true);
    expect(supportsDiag('0.59.1+6099')).toBe(false);
    expect(supportsDiag('0.9.99')).toBe(false);
    expect(supportsDiag(null)).toBeNull();
  });
});

describe('срок подробного режима', () => {
  it('resolveDebugUntil: keep / none / сроки', () => {
    expect(resolveDebugUntil('keep', '2026-10-01T00:00:00.000Z', NOW)).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(resolveDebugUntil('none', '2026-10-01T00:00:00.000Z', NOW)).toBeNull();
    expect(resolveDebugUntil('1h', null, NOW)).toBe('2026-09-29T13:00:00.000Z');
    expect(resolveDebugUntil('24h', null, NOW)).toBe('2026-09-30T12:00:00.000Z');
    expect(resolveDebugUntil('3d', null, NOW)).toBe('2026-10-02T12:00:00.000Z');
  });

  it('initialDebugDuration', () => {
    expect(initialDebugDuration(BASE)).toBe('24h');
    expect(initialDebugDuration({ ...BASE, debug: ['audio'] })).toBe('none');
    expect(
      initialDebugDuration({ ...BASE, debug: ['audio'], debugUntil: '2026-10-01T00:00:00Z' }),
    ).toBe('keep');
  });

  it('debugState: off / forever / until / expired', () => {
    expect(debugState(BASE, NOW).kind).toBe('off');
    expect(debugState({ ...BASE, debug: ['audio'] }, NOW).kind).toBe('forever');
    expect(
      debugState({ ...BASE, debug: ['audio'], debugUntil: '2026-09-29T13:00:00Z' }, NOW).kind,
    ).toBe('until');
    expect(
      debugState({ ...BASE, debug: ['audio'], debugUntil: '2026-09-29T11:00:00Z' }, NOW).kind,
    ).toBe('expired');
  });

  it('normalizeCategories убирает дубли и сортирует по канону', () => {
    expect(normalizeCategories(['other', 'audio', 'audio'], ORDER)).toEqual(['audio', 'other']);
  });
});

describe('filterLogLines', () => {
  const LOG = [
    '09-29 10:00:00.001 I [sound] start requested',
    '09-29 10:00:00.002 D [sound] prewarm state=idle',
    '09-29 10:00:00.003 I [realtime] connected',
    'java.lang.IllegalStateException: boom',
    '\tat com.example.Foo.bar(Foo.kt:10)',
    '09-29 10:00:00.004 D [bg] fix accepted',
    '',
  ].join('\n');

  it('без фильтров — все строки, пустой хвост отброшен', () => {
    const r = filterLogLines(LOG, '', 'all');
    expect(r.total).toBe(6);
    expect(r.lines).toHaveLength(6);
  });

  it('по уровню: продолжения наследуют уровень предыдущей записи', () => {
    const info = filterLogLines(LOG, '', 'I');
    expect(info.lines).toEqual([
      '09-29 10:00:00.001 I [sound] start requested',
      '09-29 10:00:00.003 I [realtime] connected',
      'java.lang.IllegalStateException: boom',
      '\tat com.example.Foo.bar(Foo.kt:10)',
    ]);
    const debug = filterLogLines(LOG, '', 'D');
    expect(debug.lines).toEqual([
      '09-29 10:00:00.002 D [sound] prewarm state=idle',
      '09-29 10:00:00.004 D [bg] fix accepted',
    ]);
  });

  it('по подстроке без учёта регистра, вместе с уровнем', () => {
    expect(filterLogLines(LOG, '[SOUND]', 'all').lines).toHaveLength(2);
    expect(filterLogLines(LOG, 'sound', 'D').lines).toEqual([
      '09-29 10:00:00.002 D [sound] prewarm state=idle',
    ]);
  });

  it('CRLF тоже режется на строки', () => {
    expect(filterLogLines('a\r\nb\r\n', '', 'all')).toEqual({ lines: ['a', 'b'], total: 2 });
  });
});

describe('отображение и экспорт', () => {
  const DETAIL: DiagUploadDetail = {
    id: 'u1',
    childId: 'abcdef12-3456',
    reason: 'auto',
    trigger: 'audio_start_failed',
    commandId: null,
    appVersion: '0.60.0+6100',
    sizeBytes: 1536,
    createdAt: '2026-09-29T10:11:12.345Z',
    snapshot: '{"a":1}',
    log: '09-29 10:00:00.001 I [sound] x',
    logcat: null,
  };

  it('formatSize и причина', () => {
    expect(formatSize(1536)).toBe('1,5 КБ');
    expect(uploadReasonLabel({ reason: 'manual', trigger: null })).toBe('По запросу');
    expect(uploadReasonLabel(DETAIL)).toBe('Автоматически: audio_start_failed');
  });

  it('prettySnapshot форматирует JSON и не трогает текст', () => {
    expect(prettySnapshot('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettySnapshot('plain text')).toBe('plain text');
    expect(prettySnapshot('{broken')).toBe('{broken');
  });

  it('buildDiagTxt собирает все секции', () => {
    const txt = buildDiagTxt(DETAIL);
    expect(txt).toContain('===== Снимок состояния =====\n{\n  "a": 1\n}');
    expect(txt).toContain('===== Журнал =====\n09-29 10:00:00.001 I [sound] x');
    expect(txt).toContain('===== logcat =====\n(нет данных)');
    expect(txt).toContain('причина: Автоматически: audio_start_failed');
  });

  it('diagFileName', () => {
    expect(diagFileName(DETAIL)).toBe('periscop-diag-abcdef12-2026-09-29T10-11-12.txt');
  });
});
