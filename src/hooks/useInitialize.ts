import { useEffect } from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';
import { localeCurrencyMetadata } from '../utils/currency';
import { apiClient } from '../api/client';
import { signIn } from '../firebase';

/**
 * アプリの初期化処理を管理するカスタムフック
 * - Firebase匿名認証
 * - カメラ起動
 * - ユーザー設定の読み込み
 * - ジオロケーションによる現地通貨検出
 * - 為替レートの取得
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

            const user = await signIn();
            useCurrencyStore.getState().setUserId(user.uid);

            await startCamera();

            // Firestoreから設定を読み込む
            const settingsLoaded = await useCurrencyStore.getState().loadUserSettings();

            // ジオロケーションから現地通貨を検出
            try {
                const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                    if (!navigator.geolocation) return reject(new Error('Geolocation is not supported.'));
                    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
                });
                const { latitude, longitude } = position.coords;
                const data = await apiClient.getCurrencyFromLocation(latitude, longitude);
                if (data.currency_code) {
                    setLocalCurrency(data.currency_code);
                }
            } catch (error) {
                console.warn('Could not get geolocation.', error);
                showBanner(t('geolocationCurrencyFailed'), 'warning');
            }

            // Firestoreに設定がない場合、ブラウザロケールからホーム通貨を推定
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

            await fetchRates();
            setStatus('running');
        };

        initialize();
    }, []); // 初回マウント時のみ実行
};
