// service-worker.js
const CACHE_NAME = 'lembrete-medicamentos-v1';
const FILES_TO_CACHE = [
  'index.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', event => {
  console.log('SW: instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  console.log('SW: ativado');
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k !== CACHE_NAME) ? caches.delete(k) : null)))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request).then(resp => resp || fetch(event.request)));
});

// Quando receber mensagem do cliente, mostra notificação
self.addEventListener('message', event => {
  const data = event.data;
  if(!data) return;
  if(data.type === 'SHOW_NOTIFICATION') {
    const title = data.title || 'Alerta';
    const body = data.body || '';
    const icon = data.icon || 'icons/icon-192.png';
    const options = {
      body,
      icon,
      badge: 'icons/icon-192.png',
      vibrate: [200,100,200],
      requireInteraction: true,
      data: data.data || {}
    };
    self.registration.showNotification(title, options);
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Se o usuário clicou em notificação, abre o app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if(clientList.length > 0){
        const client = clientList[0];
        return client.focus();
      }
      return clients.openWindow('index.html');
    })
  );
});
