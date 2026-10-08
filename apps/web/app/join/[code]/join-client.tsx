'use client';

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { AuthMapBackground } from '@/components/auth/auth-map-background';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api/client';
import { refreshSession } from '@/lib/auth/refresh-session';
import {
  acceptMemberInvite,
  familyErrorMessage,
  formatInviteCode,
  isValidInviteCode,
  joinBlockFromError,
  normalizeInviteCode,
  previewMemberInvite,
  type InvitePreview,
} from '@/lib/api/family';
import { clearPendingFamilyInvite, savePendingFamilyInvite } from '@/lib/family/pending-invite';

type View =
  | { kind: 'checking' }
  | { kind: 'guest' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }
  | { kind: 'preview'; preview: InvitePreview };

interface Props {
  rawCode: string;
  hasSession: boolean;
}

function formatUntil(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const primaryBtn =
  'inline-flex items-center justify-center rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-60';
const secondaryBtn =
  'inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-950/60 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-sky-400/50 hover:text-white';

export default function JoinClient({ rawCode, hasSession }: Props): ReactElement {
  const code = normalizeInviteCode(rawCode);
  const codeOk = isValidInviteCode(code);
  const myFamilyName = useAuthStore((s) => s.family?.name ?? null);

  const [view, setView] = useState<View>({ kind: 'checking' });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  // StrictMode в dev монтирует дважды — не дёргаем refresh/preview повторно.
  const started = useRef(false);

  async function loadPreview(): Promise<void> {
    setView({ kind: 'checking' });
    try {
      setView({ kind: 'preview', preview: await previewMemberInvite(code) });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invite_invalid') {
        setView({ kind: 'invalid' });
      } else if (e instanceof ApiError && e.status === 401) {
        // apiFetch уже пробовал refresh — сессии нет.
        savePendingFamilyInvite(code);
        setView({ kind: 'guest' });
      } else {
        setView({ kind: 'error', message: familyErrorMessage(e) });
      }
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!codeOk) {
      clearPendingFamilyInvite();
      setView({ kind: 'invalid' });
      return;
    }

    (async () => {
      let authed = hasSession && useAuthStore.getState().accessToken !== null;
      if (hasSession && !authed) {
        try {
          authed = await refreshSession();
          if (authed && !useAuthStore.getState().user) authed = false;
        } catch {
          authed = false;
        }
      }
      if (!authed) {
        savePendingFamilyInvite(code);
        setView({ kind: 'guest' });
        return;
      }
      // Пользователь вошёл и видит приглашение — дальше кабинет не должен возвращать сюда.
      clearPendingFamilyInvite();
      await loadPreview();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onJoin(): Promise<void> {
    if (view.kind !== 'preview') return;
    setJoining(true);
    setJoinError(null);
    try {
      await acceptMemberInvite(code);
    } catch (e) {
      setJoining(false);
      if (e instanceof ApiError && e.code === 'invite_invalid') {
        setView({ kind: 'invalid' });
        return;
      }
      const block = joinBlockFromError(e);
      if (block) {
        setView({ kind: 'preview', preview: { ...view.preview, canJoin: false, ...block } });
        return;
      }
      setJoinError(familyErrorMessage(e));
      return;
    }
    // Членство сменилось — новый токен с новой семьёй и полная перезагрузка кабинета.
    const ok = await refreshSession().catch(() => false);
    // Refresh не прошёл — сбрасываем устаревший токен: кабинет сам обновит сессию
    // или отправит на вход.
    if (!ok) useAuthStore.getState().clear();
    window.location.assign('/cabinet');
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050a15] text-slate-100">
      <AuthMapBackground />
      <main className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <div
          className="w-full max-w-md rounded-xl border border-slate-700/60 bg-slate-900/70 p-8 shadow-2xl backdrop-blur-xl"
          style={{ animation: 'fade-up 0.6s ease-out both' }}
        >
          {view.kind === 'checking' && (
            <div className="text-center">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
              <p className="text-sm text-slate-400">Проверяем приглашение…</p>
            </div>
          )}

          {view.kind === 'guest' && (
            <>
              <h1 className="mb-2 text-xl font-semibold text-white">
                Вас пригласили в семью в Перископ
              </h1>
              <p className="mb-5 text-sm text-slate-300">
                Войдите или зарегистрируйтесь, чтобы присоединиться. После входа мы вернём вас к
                этому приглашению.
              </p>
              <CodeBox code={code} />
              <div className="mt-6 flex flex-col gap-2">
                <Link href="/login" className={primaryBtn}>
                  Войти
                </Link>
                <Link href="/register" className={secondaryBtn}>
                  Зарегистрироваться
                </Link>
              </div>
            </>
          )}

          {view.kind === 'invalid' && (
            <>
              <h1 className="mb-2 text-xl font-semibold text-white">
                Приглашение не найдено, истекло или уже использовано
              </h1>
              <p className="mb-6 text-sm text-slate-300">
                Проверьте ссылку или попросите владельца семьи прислать новое приглашение — оно
                действует 7 дней и подходит только для одного человека.
              </p>
              <Link href={hasSession ? '/cabinet' : '/'} className={secondaryBtn}>
                {hasSession ? 'В кабинет' : 'На главную'}
              </Link>
            </>
          )}

          {view.kind === 'error' && (
            <>
              <h1 className="mb-2 text-xl font-semibold text-white">
                Не удалось проверить приглашение
              </h1>
              <p className="mb-6 text-sm text-slate-300">{view.message}</p>
              <div className="flex flex-col gap-2">
                <button type="button" className={primaryBtn} onClick={() => void loadPreview()}>
                  Повторить
                </button>
                <Link href="/cabinet" className={secondaryBtn}>
                  В кабинет
                </Link>
              </div>
            </>
          )}

          {view.kind === 'preview' && (
            <PreviewBody
              preview={view.preview}
              myFamilyName={myFamilyName}
              joining={joining}
              joinError={joinError}
              onJoin={() => void onJoin()}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function CodeBox({ code }: { code: string }): ReactElement {
  return (
    <div>
      <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Код приглашения</p>
      <p className="select-all rounded-md bg-slate-950/60 px-4 py-3 text-center font-mono text-2xl tracking-[0.2em] text-white">
        {formatInviteCode(code)}
      </p>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'warn' | 'info'; children: ReactNode }): ReactElement {
  const cls =
    tone === 'warn'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
      : 'border-sky-500/40 bg-sky-500/10 text-sky-100';
  return <div className={`rounded-md border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

function PreviewBody({
  preview,
  myFamilyName,
  joining,
  joinError,
  onJoin,
}: {
  preview: InvitePreview;
  myFamilyName: string | null;
  joining: boolean;
  joinError: string | null;
  onJoin: () => void;
}): ReactElement {
  const target = preview.family.name;
  const current = preview.currentFamilyName ?? myFamilyName;

  return (
    <>
      <h1 className="mb-2 text-xl font-semibold text-white">
        {preview.invitedBy} приглашает вас в семью «{target}»
      </h1>
      <p className="mb-5 text-sm text-slate-400">
        Приглашение действует до {formatUntil(preview.expiresAt)}.
      </p>

      {preview.canJoin ? (
        <>
          <Notice tone="warn">
            Ваша текущая пустая семья{myFamilyName ? ` «${myFamilyName}»` : ''} будет удалена, вы
            получите доступ к детям семьи «{target}»: карте, геозонам, «Звуку вокруг» и
            уведомлениям.
          </Notice>
          {joinError && <p className="mt-3 text-sm text-red-300">{joinError}</p>}
          <div className="mt-6 flex flex-col gap-2">
            <button type="button" className={primaryBtn} onClick={onJoin} disabled={joining}>
              {joining ? 'Присоединяемся…' : 'Присоединиться'}
            </button>
            <Link href="/cabinet" className={secondaryBtn}>
              Не сейчас
            </Link>
          </div>
        </>
      ) : preview.reason === 'already_member' ? (
        <>
          <Notice tone="info">Вы уже в этой семье.</Notice>
          <div className="mt-6 flex flex-col gap-2">
            <Link href="/cabinet" className={primaryBtn}>
              В кабинет
            </Link>
          </div>
        </>
      ) : preview.reason === 'has_members' ? (
        <>
          <Notice tone="warn">
            В вашей семье{current ? ` «${current}»` : ''} есть другие взрослые. Сначала выйдите из
            неё (владельцу — передать права другому участнику), затем снова откройте это
            приглашение.
          </Notice>
          <div className="mt-6 flex flex-col gap-2">
            <Link href="/cabinet/family" className={primaryBtn}>
              Управление семьёй
            </Link>
            <Link href="/cabinet" className={secondaryBtn}>
              В кабинет
            </Link>
          </div>
        </>
      ) : (
        <>
          <Notice tone="warn">
            В вашей семье{current ? ` «${current}»` : ''} есть дети
            {typeof preview.children === 'number' ? ` (${preview.children})` : ''}. Чтобы перейти,
            сначала удалите их в кабинете, затем снова откройте это приглашение.
          </Notice>
          <div className="mt-6 flex flex-col gap-2">
            <Link href="/cabinet" className={primaryBtn}>
              В кабинет
            </Link>
          </div>
        </>
      )}
    </>
  );
}
