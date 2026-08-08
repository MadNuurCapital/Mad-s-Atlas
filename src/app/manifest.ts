import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mad's Atlas",
    short_name: 'Atlas',
    description: 'A private personal AI operating system.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#050c09',
    theme_color: '#07100d',
    orientation: 'any',
    categories: ['productivity', 'utilities'],
    icons: [
      {
        src: '/icons/atlas-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/atlas-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/atlas-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
