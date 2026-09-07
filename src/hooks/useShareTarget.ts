import { useEffect } from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';

/**
 * Web Share Target APIで共有された画像を処理するフック
 * PWAとしてインストール済みの場合、OSの共有メニューから画像を受け取れる
 */
export const useShareTarget = () => {
    const setCapturedImage = useCurrencyStore((state) => state.setCapturedImage);
    const setConfirmationStep = useCurrencyStore((state) => state.setConfirmationStep);

    useEffect(() => {
        const handleShareTarget = async () => {
            // Service Worker が /?share-target=true にリダイレクトする
            const params = new URLSearchParams(window.location.search);
            if (!params.has('share-target')) return;

            console.log('[ShareTarget] Shared image detected, processing...');

            try {
                const cache = await caches.open('share-target-cache');
                const response = await cache.match('/shared-image');

                if (response) {
                    const blob = await response.blob();
                    console.log(`[ShareTarget] Image blob size: ${blob.size} bytes`);

                    const reader = new FileReader();
                    reader.onload = () => {
                        setCapturedImage(reader.result as string);
                        setConfirmationStep('analyze');
                        console.log('[ShareTarget] Image set, showing confirmation dialog.');
                    };
                    reader.readAsDataURL(blob);

                    // キャッシュをクリア
                    await cache.delete('/shared-image');
                } else {
                    console.warn('[ShareTarget] No shared image found in cache.');
                }
            } catch (error) {
                console.error('[ShareTarget] Failed to handle share target:', error);
            }

            // URLからクエリパラメータを除去
            window.history.replaceState(null, '', '/');
        };

        handleShareTarget();
    }, [setCapturedImage, setConfirmationStep]);
};
