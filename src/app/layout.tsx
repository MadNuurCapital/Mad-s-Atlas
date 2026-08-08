import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://madsatlas.netlify.app'),
  title: {
    default: "Mad's Atlas",
    template: "%s · Mad's Atlas",
  },
  description: 'A private personal AI operating system.',
  applicationName: "Mad's Atlas",
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-48.png', sizes: '48x48', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Atlas',
    statusBarStyle: 'black-translucent',
  },
  // Private application: never index, never follow.
  robots: { index: false, follow: false, nocache: true },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0c0b' },
    { media: '(prefers-color-scheme: light)', color: '#f5f0e6' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Allow zoom — pinch-to-zoom is an accessibility need, not a bug.
  maximumScale: 5,
};

/**
 * Applied before first paint so the theme never flashes.
 * Defaults to dark, which is the intended look for a command centre.
 */
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('atlas-theme');
    document.documentElement.dataset.theme = stored === 'light' ? 'light' : 'dark';
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
`.trim();

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-SG" suppressHydrationWarning>
      <head>
        {/* Next 16 emits the standards-based mobile-web-app-capable tag.
            Keep Apple's legacy tag too: older iOS Home Screen releases still
            use it to suppress normal Safari chrome. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
