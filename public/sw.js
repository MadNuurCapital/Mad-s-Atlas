/* Mad's Atlas service worker: push only, deliberately no application caching. */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : 'Atlas has an update.' };
  }

  const url = typeof payload.url === 'string' && payload.url.startsWith('/') ? payload.url : '/today';
  event.waitUntil(self.registration.showNotification(payload.title || 'Mad’s Atlas', {
    body: payload.body || 'Atlas has an update.',
    icon: '/icons/atlas-192.png',
    badge: '/icons/atlas-192.png',
    tag: payload.tag || 'atlas-update',
    renotify: false,
    data: { url, stepId: payload.stepId, ideaId: payload.ideaId },
    actions: Array.isArray(payload.actions) ? payload.actions : [],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const ideaUrl = data.ideaId ? `/ideas/${data.ideaId}` : (data.url || '/today');

  if (event.action === 'done' && data.stepId) {
    event.waitUntil(fetch('/api/ideas/step-action', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: data.stepId, action: 'done' }),
    }).then(() => self.clients.openWindow(ideaUrl)));
    return;
  }

  const destination = event.action === 'reschedule' ? `${ideaUrl}#idea-command` : ideaUrl;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if ('focus' in client) {
        void client.navigate(destination);
        return client.focus();
      }
    }
    return self.clients.openWindow(destination);
  }));
});
