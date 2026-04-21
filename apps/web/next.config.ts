import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    APP_VERSION: pkg.version,
  },
  // standalone нужен только для prod-docker (multi-stage build).
  // Локально на Windows он падает с EPERM при создании symlinks (без admin-прав).
  ...(process.env.NEXT_STANDALONE === 'true' ? { output: 'standalone' } : {}),
};

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
  disableLogger: true,
  tunnelRoute: '/api/sentry-tunnel',
});
