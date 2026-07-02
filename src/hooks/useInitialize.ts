import { useEffect } from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { getCurrencyForLocale } from '../utils/localeCurrency';
import { apiClient } from '../api/client';
import { signIn } from '../firebase';

/** 現在地の座標を取得する（タイムアウト5秒） */
const getCurrentPosition = (): Promise<GeolocationPosition> =>
    new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Geolocation is not supported.'));
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
    });

/**
 * アプリの初期化処理を管理するカスタムフック
 * - Firebase匿名認証
 * - カメラ起動
 * - ユーザー設定の読み込み
 * - ジオロケーションによる現地通貨検出
 * - 為替レートの取得
 */
export const useInitialize = (startCamera: () => Promise<void>) => {
    useEffect(() => {
        const {
            setStatus,
            setUserId,
            setHomeCurrency,
            setLocalCurrency,
            loadUserSettings,
            fetchRates,
            showBanner,
        } = useCurrencyStore.getState();

        const initialize = async () => {
            setStatus('loading');

            const user = await signIn();
            setUserId(user.uid);

            await startCamera();

            // Firestoreから設定を読み込む
            const settingsLoaded = await loadUserSettings();

            // ジオロケーションから現地通貨を検出
            try {
                const position = await getCurrentPosition();
                const { latitude, longitude } = position.coords;
                const data = await apiClient.getCurrencyFromLocation(latitude, longitude);
                if (data.currency_code) {
                    setLocalCurrency(data.currency_code);
                }
            } catch (error) {
                console.warn('Could not get geolocation.', error);
                showBanner('geolocationCurrencyFailed', 'warning');
            }

            // Firestoreに設定がない場合、ブラウザロケールからホーム通貨を推定
            if (!settingsLoaded) {
                setHomeCurrency(getCurrencyForLocale(navigator.language));
            }

            await fetchRates();
            setStatus('running');
        };

        initialize();
    }, []); // 初回マウント時のみ実行
};
