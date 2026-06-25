import Link from 'next/link';

export function Footer(): React.ReactElement {
  return (
    <footer className="border-t border-zinc-200 bg-white py-4 text-center text-sm text-zinc-500">
      <span>© 2026 Перископ</span>
      <span className="mx-2">·</span>
      <Link href="/privacy" className="hover:text-zinc-900 hover:underline">
        Политика
      </Link>
      <span className="mx-2">·</span>
      <Link href="/terms" className="hover:text-zinc-900 hover:underline">
        Условия
      </Link>
    </footer>
  );
}
