'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isValidInviteCode, normalizeInviteCode } from '@/lib/api/family';

export function JoinCodeCard(): ReactElement {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const code = normalizeInviteCode(value);
    if (!isValidInviteCode(code)) {
      setError('Код — 8 букв и цифр, например ABCD-EFGH. Проверьте, что он переписан без ошибок.');
      return;
    }
    setError(null);
    router.push(`/join/${code}`);
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold text-foreground">Есть код приглашения?</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Если вас пригласили в другую семью, введите код из приглашения — перед вступлением мы
        покажем, в какую семью вы переходите.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Код приглашения"
          placeholder="ABCD-EFGH"
          value={value}
          maxLength={16}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          className="font-mono uppercase tracking-widest sm:max-w-xs"
        />
        <Button type="submit" variant="outline" disabled={value.trim().length === 0}>
          Продолжить
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}
