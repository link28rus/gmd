import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
