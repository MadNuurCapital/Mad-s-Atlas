import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from '@/app/manifest';

describe('Atlas PWA contract', () => {
  it('installs as the private standalone Atlas application', () => {
    const value = manifest();
    expect(value).toMatchObject({
      name: "Mad's Atlas",
      short_name: 'Atlas',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#050c09',
      theme_color: '#07100d',
    });
  });

  it('ships canonical regular, Apple and maskable icon assets', () => {
    const value = manifest();
    const icons = value.icons ?? [];
    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icons/atlas-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/icons/atlas-512.png', sizes: '512x512' }),
        expect.objectContaining({ src: '/icons/atlas-maskable-512.png', purpose: 'maskable' }),
      ]),
    );

    for (const path of [
      'public/icons/atlas-192.png',
      'public/icons/atlas-512.png',
      'public/icons/atlas-maskable-512.png',
      'public/icons/apple-touch-icon.png',
      'public/icons/favicon-32.png',
    ]) {
      expect(existsSync(join(process.cwd(), path)), `${path} should exist`).toBe(true);
    }
  });

  it('removes the legacy push worker and never registers another one', () => {
    expect(existsSync(join(process.cwd(), 'public/sw.js'))).toBe(false);
    const bootstrap = readFileSync(
      join(process.cwd(), 'src/components/pwa/PwaBootstrap.tsx'),
      'utf8',
    );
    expect(bootstrap).toContain('getRegistrations()');
    expect(bootstrap).toContain('registration.unregister()');
    expect(bootstrap).not.toContain('serviceWorker.register(');
  });
});
