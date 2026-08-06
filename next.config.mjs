/**
 * Mad's Atlas — Next.js configuration.
 *
 * The Content-Security-Policy lives here rather than in netlify.toml so it can
 * differ between development and production without touching deploy config.
 * See SECURITY.md § Headers.
 */

const isDev = process.env.NODE_ENV === 'development';

/**
 * `connect-src` is deliberately narrow: Supabase and the Gemini endpoints only.
 * The WebSocket scheme needs its own entry — `https:` does not imply `wss:`,
 * and omitting it is why voice tends to work locally but fail in production.
 */
const csp = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts; dev additionally needs eval for HMR.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  [
    'connect-src',
    "'self'",
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://generativelanguage.googleapis.com',
    'wss://generativelanguage.googleapis.com',
    isDev ? 'ws://localhost:*' : '',
  ]
    .filter(Boolean)
    .join(' '),
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Fail the production build on type errors rather than shipping them.
  // (Next 16 removed the `eslint` config key — linting runs as its own gate
  // via `npm run lint`, which is where it belongs anyway.)
  typescript: { ignoreBuildErrors: false },

  // Never leak the framework version in response headers.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            // Voice needs the microphone. Nothing else is granted.
            value: 'microphone=(self), camera=(), geolocation=(), payment=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
