/// <reference lib="webworker" />

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { NetworkFirst } from 'workbox-strategies';
import { registerRoute } from 'workbox-routing';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

// 新しいSWがインストールされたら即座にアクティベート
self.skipWaiting();
clientsClaim();

// 古いキャッシュをクリーンアップ
cleanupOutdatedCaches();

// Workbox precache (VitePWA injectManifest が自動挿入)
precacheAndRoute(self.__WB_MANIFEST);

// 汎用キャッシュ戦略
registerRoute(
    ({ request }) => request.destination !== '',
    new NetworkFirst({
        cacheName: 'all-resources',
        plugins: [
            new ExpirationPlugin({
                maxEntries: 50,
                maxAgeSeconds: 60 * 60,
            }),
        ],
        networkTimeoutSeconds: 5,
    })
);

// Web Share Target API: POST /share-target を処理
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.pathname === '/share-target' && event.request.method === 'POST') {
        event.respondWith(
            (async () => {
                try {
                    const formData = await event.request.formData();
                    const imageFile = formData.get('image');
                    if (imageFile) {
                        const cache = await caches.open('share-target-cache');
                        await cache.put('/shared-image', new Response(imageFile));
                    }
                } catch (e) {
                    console.error('Share target handler error:', e);
                }
                // メインページにリダイレクト（/share-target パスを付与してクライアント側で検知）
                return Response.redirect('/?share-target=true', 303);
            })()
        );
    }
});
