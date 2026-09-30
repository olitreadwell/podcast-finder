import type { NextConfig } from 'next';

// Baseline security headers for every response. CSP is split: /docs loads
// Swagger UI from unpkg, so it gets a looser policy than the app pages.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const appCsp = [
  "default-src 'self'",
  // 'unsafe-inline' lets Next.js hydration and next-themes inline scripts
  // run under static rendering. The nonce-based strict CSP in the Next.js
  // docs is the upgrade path if pages move to dynamic rendering.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const docsCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

// Vercel's platform build sets NEXT_ADAPTER_PATH to its own Next adapter. When
// an adapter is present Next runs handleBuildComplete for it and, under
// Turbopack, stops writing .next/next-server.js.nft.json, but `output:
// 'standalone'` still runs the standalone copy step that reads that file, so
// the build dies with ENOENT. Keep standalone output for the local smoke script
// and the Dockerfile, and let the platform adapter own the output on Vercel.
const standaloneOutput: Pick<NextConfig, 'output'> = process.env.NEXT_ADAPTER_PATH
  ? {}
  : { output: 'standalone' };

const nextConfig: NextConfig = {
  ...standaloneOutput,
  reactStrictMode: true,
  allowedDevOrigins: ['127.0.0.1'],
  // better-sqlite3 is a native module; keep it external so the standalone
  // build traces it (with its .node binary) instead of trying to bundle it.
  serverExternalPackages: ['better-sqlite3'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [...securityHeaders, { key: 'Content-Security-Policy', value: appCsp }],
      },
      // Later rules override earlier ones for the same key, so /docs must
      // come after the catch-all to replace the app CSP with the looser one.
      {
        source: '/docs',
        headers: [{ key: 'Content-Security-Policy', value: docsCsp }],
      },
    ];
  },
};

export default nextConfig;
