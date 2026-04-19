import { promises as fs } from 'fs';
import path from 'path';
import type { Metadata } from 'next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const metadata: Metadata = {
  title: 'Политика конфиденциальности — GMD',
  description: 'Политика конфиденциальности сервиса GMD в соответствии с 152-ФЗ',
};

export default async function PrivacyPage(): Promise<React.ReactElement> {
  const filePath = path.join(process.cwd(), 'content', 'legal', 'privacy-policy-v1.0.md');
  const content = await fs.readFile(filePath, 'utf-8');

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-6 text-3xl font-bold text-zinc-900">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-3 mt-8 text-xl font-semibold text-zinc-900">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-6 text-lg font-semibold text-zinc-800">{children}</h3>
          ),
          p: ({ children }) => <p className="mb-4 leading-relaxed text-zinc-700">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-4 list-disc space-y-1 pl-6 text-zinc-700">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-4 list-decimal space-y-1 pl-6 text-zinc-700">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} className="text-zinc-900 underline hover:no-underline">
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-zinc-900">{children}</strong>
          ),
          hr: () => <hr className="my-8 border-zinc-200" />,
          code: ({ children }) => (
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm text-zinc-800">
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 border-l-4 border-zinc-300 pl-4 text-zinc-600 italic">
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
