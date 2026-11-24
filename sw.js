// Network-first: always try the latest version online; fall back to the cached copy if offline.
const CACHE = "alko-v7";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return; // never touch Supabase / CDN requests
  e.respondWith(fetch(new Request(r.url, { cache: "no-cache", credentials: "same-origin" })).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); return res; })
    .catch(() => caches.match(r).then(m => m || caches.match("./index.html"))));
});

// Daily reminder pushes (sent by GitHub Actions, see .github/notify/notify.mjs)
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "غیابا کرێکاران", {
    body: d.body || "", tag: d.tag || "alko", renotify: true, dir: "rtl", lang: "ckb",
    icon: "icon-192.png", badge: "icon-192.png", data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(L => {
    for (const c of L) if ("focus" in c) { c.navigate && c.url !== url ? c.focus() : c.focus(); return; }
    return clients.openWindow(url);
  }));
});
