// Android installed web app: receive shared links/files without uploading them to our own server.
const DB = 'wdub-mobile-share';
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('inbox');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST' || new URL(event.request.url).pathname !== new URL('share', self.registration.scope).pathname) return;
  event.respondWith((async () => {
    const data = await event.request.formData();
    const db = await openDb();
    const tx = db.transaction('inbox', 'readwrite');
    tx.objectStore('inbox').put({ file: data.get('file'), url: data.get('url') || data.get('text') || '', title: data.get('title') || '' }, 'pending');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
    return Response.redirect(new URL('./?shared=1', self.registration.scope), 303);
  })());
});
