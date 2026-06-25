import type { ReactElement } from 'react';

interface Props {
  params: Promise<{ code: string }>;
}

export default async function ClaimLanding({ params }: Props): Promise<ReactElement> {
  const { code } = await params;
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="mb-4 text-center text-2xl font-semibold text-zinc-900">
          Привязать устройство ребёнка
        </h1>
        <p className="mb-4 text-sm text-zinc-600">
          Установите приложение <b>Перископ для ребёнка</b> из RuStore или Google Play и
          отсканируйте QR-код, который показан у родителя.
        </p>
        <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Код приглашения</p>
        <p className="select-all rounded-md bg-zinc-100 px-4 py-3 text-center font-mono text-xl tracking-widest text-zinc-900">
          {code}
        </p>
        <p className="mt-6 text-xs text-zinc-500">
          Код действителен 10 минут. Если он не подошёл — попросите родителя создать новый.
        </p>
      </div>
    </main>
  );
}
