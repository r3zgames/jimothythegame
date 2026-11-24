// The web demo's service worker: keeps the engine and the packs (about 94 MB, plus the phone and tablet art on phones)
// on the device, per version, so a repeat visit does not download them again.
// tools/web_pwa.py stamps the version in at export; a new release has a new
// worker file, whose cache name differs, and on activation every older cache
// is deleted. The page itself (index.html) is always tried on the network
// first, so a new release is picked up; the cache answers only when offline.
// After a release, the first visit's page is new but the worker controlling
// it is the old one: the page asks this worker its version and, on a
// mismatch, waits for the new worker to take over before the engine loads,
// so the old version's packs are never served to the new page.
const VERSION = '0.9.72';
const CACHE = 'jimothy-' + VERSION;
const KEPT = /(^|\/)(index\.[^/]*\.(png|js|webp)|index\.(js|wasm|pck)|index\.extras\.pck|index\.mobile[0-9]+\.pck|manifest\.webmanifest|icons\/[^/]+)$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		for (const k of await caches.keys()) {
			if (k.startsWith('jimothy-') && k !== CACHE) await caches.delete(k);
		}
		await self.clients.claim();
	})());
});

// The page names the files it loaded; they are in the browser's own cache
// still, so this costs no second download.
self.addEventListener('message', (event) => {
	// The page asks which version this worker keeps (shell.html, jimothySwFresh).
	if (event.data && event.data.version && event.ports && event.ports[0]) {
		event.ports[0].postMessage(VERSION);
		return;
	}
	const urls = (event.data && event.data.cache) || [];
	event.waitUntil((async () => {
		const cache = await caches.open(CACHE);
		for (const raw of urls) {
			const link = new URL(raw);
			const u = link.origin + link.pathname;
			if (!KEPT.test(link.pathname) || await cache.match(u)) continue;
			try {
				const res = await fetch(u, { cache: 'force-cache' });
				if (res.ok && res.status === 200) await cache.put(u, res);
			} catch (e) {}
		}
	})());
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET' || req.headers.has('range')) return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;
	if (req.mode === 'navigate') {
		if (!/\/(index\.html)?$/.test(url.pathname) || url.pathname.includes('/stats/')) return;
		event.respondWith((async () => {
			try {
				const res = await fetch(req);
				const cache = await caches.open(CACHE);
				if (res.ok) cache.put(new Request(url.origin + url.pathname), res.clone());
				return res;
			} catch (e) {
				const hit = await caches.match(new Request(url.origin + url.pathname));
				if (hit) return hit;
				throw e;
			}
		})());
		return;
	}
	if (!KEPT.test(url.pathname)) return;
	event.respondWith((async () => {
		const cache = await caches.open(CACHE);
		const hit = await cache.match(url.origin + url.pathname);
		if (hit) return hit;
		const res = await fetch(req);
		if (res.ok && res.status === 200) cache.put(url.origin + url.pathname, res.clone()).catch(() => {});
		return res;
	})());
});
