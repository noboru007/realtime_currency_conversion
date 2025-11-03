import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // CSSのインポート
import { apiClient } from './src/api/client';
import { useCurrencyStore } from './src/store/useCurrencyStore'; // Zustandストアをインポート
import { CameraView } from './src/components/CameraView';
import { ControlPanel } from './src/components/ControlPanel';
import { localeCurrencyMetadata } from './src/utils/currency';
import { useTranslationStore } from './src/store/useTranslationStore';
import { useUIStore } from './src/store/useUIStore';
import { saveDivAsImage } from './src/utils/canvas'; // ★ saveCanvasAsImage から変更
import { signIn } from './src/firebase';


declare global {
  interface Window {
    saveARImage: () => void;
  }
}

const AnalyzingOverlay: React.FC = () => {
  const { t } = useTranslationStore();
  return (
    <div className="analyzing-overlay">
      <div className="analyzing-spinner"></div>
      <p>{t('analyzing')}</p>
    </div>
  );
};

const GlobalBanner: React.FC = () => {
  const { banner, hideBanner } = useCurrencyStore();
  const { t } = useTranslationStore();

  if (!banner) return null;
  
  const message = t(banner.message as any);

  return (
    <div className="global-banner">
      <div className="global-banner-content">
        <p className="global-banner-message">{message}</p>
        <button onClick={hideBanner} className="global-banner-close">
          OK
        </button>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const {
    rates,
    fetchRates,
    setStatus,
    showBanner,
    setHomeCurrency,
    setLocalCurrency,
    setCapturedImage,
    setConfirmationStep,
    detections,
    capturedImage,
    status,
    banner,
    confirmationStep,
    resetState,
  } = useCurrencyStore();

  const { t } = useTranslationStore(); // ★ フックを使用
  const { setOrientationAngle } = useUIStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // --- カメラ起動ロジック ---
  const startCamera = useCallback(async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const constraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            // 頼りないCursorのAIによると：
            // ブラウザとデバイスは、width, height, aspectRatioの3つのideal（理想値）を総合的に評価し、そのデバイスが提供できるビデオモードの中から最も近い最適なものを自動的に選択してくれます。これにより、様々なデバイスでより自然かつ高解像度な映像を取得できます。
            // --- ▼▼▼ 縦長のアスペクト比を理想値として追加 ▼▼▼ ---
            aspectRatio: { ideal: 9 / 16 }
            // --- ▲▲▲ 縦長のアスペクト比を理想値として追加 ▲▲▲ ---
          }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } else {
        throw new Error('Camera not supported.');
      }
    } catch (error) {
      showBanner(t('cameraAccessFailed'), 'error');
      setStatus('error');
    }
  }, [setStatus, showBanner, t]);

  // --- 画像保存ロジック ---
  const saveARImage = () => {
    const cameraContainer = document.querySelector('.camera-container') as HTMLElement;
    if (cameraContainer) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

      const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}_${milliseconds}`;
      const filename = `OrionX_${timestamp}.png`;

      saveDivAsImage(cameraContainer, filename);

      useCurrencyStore.getState().resetState();
    }
  };

  // Expose the function to the window object
  useEffect(() => {
    window.saveARImage = saveARImage;
  }, [capturedImage, detections]);


  // --- Capture Logic ---
  const handleCapture = () => {
    if (videoRef.current) { // canvasRefへの依存を削除
      const video = videoRef.current;
      // canvasを動的に作成
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (context) {
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;
        const videoAspectRatio = videoWidth / videoHeight;

        const containerWidth = video.clientWidth;
        const containerHeight = video.clientHeight;
        const containerAspectRatio = containerWidth / containerHeight;

        let sx = 0;
        let sy = 0;
        let sWidth = videoWidth;
        let sHeight = videoHeight;

        if (videoAspectRatio > containerAspectRatio) {
          sWidth = videoHeight * containerAspectRatio;
          sx = (videoWidth - sWidth) / 2;
        } else {
          sHeight = videoWidth / containerAspectRatio;
          sy = (videoHeight - sHeight) / 2;
        }

        // --- ▼▼▼ 画像リサイズ処理を追加 ▼▼▼ ---
        const MAX_WIDTH = 1024;
        const MAX_HEIGHT = 1024;
        let targetWidth = sWidth;
        let targetHeight = sHeight;

        if (targetWidth > MAX_WIDTH || targetHeight > MAX_HEIGHT) {
          if (targetWidth / targetHeight > MAX_WIDTH / MAX_HEIGHT) {
            targetWidth = MAX_WIDTH;
            targetHeight = Math.round(targetWidth / (sWidth / sHeight));
          } else {
            targetHeight = MAX_HEIGHT;
            targetWidth = Math.round(targetHeight * (sWidth / sHeight));
          }
        }
        
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        
        // リサイズ後のCanvasにビデオの表示部分を描画
        context.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, targetWidth, targetHeight);
        // --- ▲▲▲ 画像リサイズ処理を追加 ▲▲▲ ---
        
        const imageData = canvas.toDataURL('image/png');
        
        setCapturedImage(imageData);
        setConfirmationStep('analyze');
      }
    }
  };

  // --- Visibility Changeイベントを監視するEffect ---
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && videoRef.current) {
        const stream = videoRef.current.srcObject as MediaStream;
        // ストリームが存在しない、アクティブでない、またはビデオが一時停止している場合に再起動
        if (!stream || !stream.active || videoRef.current.paused) {
          console.log('Camera stream is inactive or paused. Restarting camera...');
          startCamera();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startCamera]);

  // デバイスの向きを監視するEffect
  useEffect(() => {
    const handleOrientationChange = () => {
      const orientation = window.screen.orientation.type;
      if (orientation === "landscape-primary" || orientation === "landscape-secondary") {
        setOrientationAngle(0);
      } else {
        setOrientationAngle(0);
      }
    };
    window.screen.orientation.addEventListener("change", handleOrientationChange);
    handleOrientationChange();
    return () => {
      window.screen.orientation.removeEventListener("change", handleOrientationChange);
    };
  }, [setOrientationAngle]);

  // 初期化処理のEffect
  useEffect(() => {
    const initialize = async () => {
      setStatus('loading');
      
      const user = await signIn();
      useCurrencyStore.getState().setUserId(user.uid);
      
      await startCamera();

      // Firestoreから設定を読み込む
      const settingsLoaded = await useCurrencyStore.getState().loadUserSettings();

      let detectedLocalCurrency: string | null = null;
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!navigator.geolocation) return reject(new Error('Geolocation is not supported.'));
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        const { latitude, longitude } = position.coords;
        const data = await apiClient.getCurrencyFromLocation(latitude, longitude);
        if (data.currency_code) {
          detectedLocalCurrency = data.currency_code;
          setLocalCurrency(data.currency_code);
        }
      } catch (error) {
        console.warn('Could not get geolocation.', error);
        showBanner(t('geolocationCurrencyFailed'), 'warning');
      }

      // Firestoreから設定が読み込まれなかった場合のみ、ロケールから自国通貨を推定
      if (!settingsLoaded) {
        try {
          const userLocale = navigator.language; // 例: "ja" または "ja-JP"
          let localeInfo = localeCurrencyMetadata[userLocale];

          // 完全一致で見つからない場合、言語コード部分で前方一致検索を試みる
          if (!localeInfo) {
            const languagePart = userLocale.split('-')[0];
            const matchingKey = Object.keys(localeCurrencyMetadata).find(key => key.startsWith(languagePart));
            if (matchingKey) {
              localeInfo = localeCurrencyMetadata[matchingKey];
            }
          }
          
          // 常にロケールから通貨を設定し、現地通貨と重複してもUSDに変更しない
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
  }, []); // 依存配列を空にして、初回マウント時のみ実行

  // 優先通貨のリスト
  const priorityCurrencies = [
    'EUR', 'GBP', 'USD', 'JPY', 
    'CNY', 'HKD', 'IDR', 'INR', 'KRW', 'MYR', 
    'PHP', 'SGD', 'THB', 'TWD', 'VND', 'ISK'
  ].sort();
  
  const allCurrencies = rates 
    ? [...new Set(Object.keys(rates).flatMap(pair => pair.split('/')))] 
    : [];

  const otherCurrencies = allCurrencies
    .filter(c => !priorityCurrencies.includes(c))
    .sort();

  const currencyOptions = rates 
    ? [...priorityCurrencies, ...otherCurrencies]
    : ['USD', 'EUR', 'JPY'];

  return (
    <div className="app-container">
        <CameraView videoRef={videoRef} />
        <ControlPanel currencyOptions={currencyOptions} onCapture={handleCapture} />
        {status === 'analyzing' && <AnalyzingOverlay />}
        {banner && !confirmationStep && <GlobalBanner />}
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);