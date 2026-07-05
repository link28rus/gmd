import Link from 'next/link';

export function Footer(): React.ReactElement {
  return (
    <footer className="border-t border-slate-800 bg-[#050a15] py-4 text-center text-sm text-slate-500">
      <span>© 2026 Перископ</span>
      <span className="mx-2">·</span>
      <Link href="/privacy" className="text-slate-400 hover:text-slate-200 hover:underline">
        Политика
      </Link>
      <span className="mx-2">·</span>
      <Link href="/terms" className="text-slate-400 hover:text-slate-200 hover:underline">
        Условия
      </Link>
    </footer>
  );
}
