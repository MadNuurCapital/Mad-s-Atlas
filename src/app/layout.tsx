import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: "Mad's Atlas",
    template: "%s · Mad's Atlas",
  },
  description: 'A private personal AI operating system.',
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
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
