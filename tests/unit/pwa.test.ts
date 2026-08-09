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

  it('ships a push-only worker with plan deep links and no offline cache of private data', () => {
    const worker = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');
    expect(worker).toContain("addEventListener('push'");
    expect(worker).toContain("addEventListener('notificationclick'");
    expect(worker).toContain('/api/ideas/step-action');
    expect(worker).toContain('#idea-command');
    expect(worker).not.toMatch(/caches\.open|cache\.put/);
  });
});
