import { useEffect } from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';
import { localeCurrencyMetadata } from '../utils/currency';
import { apiClient } from '../api/client';
import { signIn } from '../firebase';

interface LocationCurrencyCache {
    lat: number;
    lon: number;
    currencyCode: string;
    timestamp: number;
}

/**
 * アプリの初期化処理を管理するカスタムフック
 * - Firebase匿名認証（先行実行）
 * - 以下を並列実行:
 *   - カメラ起動
 *   - ユーザー設定の読み込み
 *   - ジオロケーションによる現地通貨検出（FEキャッシュ付き）
 *   - 為替レートの取得（1時間FEキャッシュ付き）
 */
export const useInitialize = (startCamera: () => Promise<void>) => {
    const {
        setStatus,
        setHomeCurrency,
        setLocalCurrency,
        fetchRates,
        showBanner,
    } = useCurrencyStore();
    const { t } = useTranslationStore();

    useEffect(() => {
        const initialize = async () => {
            setStatus('loading');

            // signIn のみ先行（userIdが他の処理に必要）
            const user = await signIn();
            useCurrencyStore.getState().setUserId(user.uid);

            // 残りの処理を並列実行
            const [settingsResult] = await Promise.allSettled([
                // 1. Firestoreから設定を読み込む
                useCurrencyStore.getState().loadUserSettings(),
                // 2. カメラ起動
                startCamera(),
                // 3. ジオロケーションから現地通貨を検出（FEキャッシュ付き）
                detectLocalCurrency(),
                // 4. 為替レートの取得（1時間FEキャッシュ付き）
                fetchRates(),
            ]);

            // Firestoreに設定がない場合、ブラウザロケールからホーム通貨を推定
            const settingsLoaded = settingsResult.status === 'fulfilled' && settingsResult.value;
            if (!settingsLoaded) {
                try {
                    const userLocale = navigator.language;
                    let localeInfo = localeCurrencyMetadata[userLocale];

                    if (!localeInfo) {
                        const languagePart = userLocale.split('-')[0];
                        const matchingKey = Object.keys(localeCurrencyMetadata).find(key => key.startsWith(languagePart));
                        if (matchingKey) {
                            localeInfo = localeCurrencyMetadata[matchingKey];
                        }
                    }

                    const potentialHomeCurrency = localeInfo ? localeInfo.currency : 'USD';
                    setHomeCurrency(potentialHomeCurrency);
                } catch (error) {
                    console.warn('Could not determine home currency from locale.', error);
                    setHomeCurrency('USD');
                }
            }

            setStatus('running');
        };

        /**
         * ジオロケーション → 通貨コード検出（FEキャッシュ付き）
         * 24時間以内 & 5km以内ならlocalStorageキャッシュを使い、Cloud Function呼び出しスキップ
         */
        const detectLocalCurrency = async () => {
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                if (!navigator.geolocation) return reject(new Error('Geolocation is not supported.'));
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    timeout: 15000,
                    maximumAge: 300000,
                    enableHighAccuracy: false,
                });
            });
            const { latitude, longitude } = position.coords;
            console.log(`[Geo] Position obtained: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);

            // FEキャッシュ判定
            const cachedJson = localStorage.getItem('localCurrencyCache');
            if (cachedJson) {
                try {
                    const cached: LocationCurrencyCache = JSON.parse(cachedJson);
                    const near = Math.abs(cached.lat - latitude) < 0.05 && Math.abs(cached.lon - longitude) < 0.05;
                    const fresh = Date.now() - cached.timestamp < 24 * 60 * 60 * 1000;
                    if (near && fresh) {
                        setLocalCurrency(cached.currencyCode);
                        console.log(`[Geo] Cache HIT → ${cached.currencyCode} (${Math.round((Date.now() - cached.timestamp) / 60000)}min old)`);
                        return;
                    }
                } catch (e) {
                    // キャッシュ破損 → 通常フローへ
                }
            }

            // キャッシュMISS → Cloud Function呼び出し
            console.log('[Geo] Cache MISS → calling API');
            const data = await apiClient.getCurrencyFromLocation(latitude, longitude);
            if (data.currency_code) {
                setLocalCurrency(data.currency_code);
                localStorage.setItem('localCurrencyCache', JSON.stringify({
                    lat: latitude,
                    lon: longitude,
                    currencyCode: data.currency_code,
                    timestamp: Date.now(),
                } as LocationCurrencyCache));
                console.log(`[Geo] Currency set: ${data.currency_code}`);
            }
        };

        initialize().catch((error) => {
            console.error('Initialization failed:', error);
            showBanner(t('geolocationCurrencyFailed'), 'warning');
            setStatus('running'); // エラーがあっても使えるようにする
        });
    }, []); // 初回マウント時のみ実行
};
