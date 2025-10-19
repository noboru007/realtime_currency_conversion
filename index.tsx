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
  const banner = useCurrencyStore((state) => state.banner);
  if (!banner) return null;
  
  // ★ バナーを閉じる際の処理を関数にまとめる
  const handleClose = () => {
    // onCloseコールバックを呼び出すだけにする
    if (banner.onClose) {
      banner.onClose();
    }
  };

  return (
    <div className="global-banner">
      <p className="global-banner-message">{banner.message}</p>
      <button onClick={handleClose} className="global-banner-close">
        OK
      </button>
    </div>
  );
};

const App: React.FC = () => {
  const {
    rates,
    fetchRates,
    setStatus,
    setBanner,
    setHomeCurrency,
    setLocalCurrency,
    setCapturedImage,
    setConfirmationStep,
    detections,
    capturedImage,
    status,
    banner,
    confirmationStep,
  } = useCurrencyStore();

  const { t } = useTranslationStore();
  const { setOrientationAngle } = useUIStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // --- カメラ起動ロジック ---
  const startCamera = useCallback(async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } else {
        throw new Error('Camera not supported.');
      }
    } catch (error) {
      setBanner({ message: t('cameraAccessFailed'), type: 'error' });
      setStatus('error');
    }
  }, [setBanner, setStatus, t]);

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
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      if (context) {
        // video要素の現在の表示サイズをそのままCanvasのサイズとして使用
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // videoのフレームをCanvasに描画
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        
        // EXIF情報を含まないPNG形式で画像データを取得
        const imageData = canvas.toDataURL('image/png');
        
        // ストアを更新
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
        if (!stream || !stream.active) {
          console.log('Camera stream is inactive. Restarting camera...');
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
      await startCamera();

      let detectedLocalCurrency: string | null = null;
      const getLocation = (): Promise<GeolocationPosition> => new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Geolocation is not supported.'));
          navigator.geolocation.getCurrentPosition(resolve, reject);
        });

      try {
        const position = await getLocation();
        const { latitude, longitude } = position.coords;
        const data = await apiClient.getCurrencyFromLocation(latitude, longitude);
        if (data.currency_code) {
          detectedLocalCurrency = data.currency_code;
          setLocalCurrency(data.currency_code);
        }
      } catch (error) {
        console.warn('Could not get geolocation.', error);
        setBanner({ message: t('geolocationCurrencyFailed'), type: 'warning' });
      }

      try {
        const userLocale = navigator.language;
        const localeInfo = localeCurrencyMetadata[userLocale];
        let potentialHomeCurrency = localeInfo ? localeInfo.currency : 'USD';
        if (detectedLocalCurrency && potentialHomeCurrency === detectedLocalCurrency) {
          setHomeCurrency('USD');
        } else {
          setHomeCurrency(potentialHomeCurrency);
        }
      } catch (error) {
        console.warn('Could not determine home currency from locale.', error);
        setHomeCurrency('USD');
      }

      await fetchRates();
      setStatus('running');
    };

    initialize();
  }, [fetchRates, setStatus, setLocalCurrency, setBanner, setHomeCurrency, t, startCamera]);

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
        <CameraView videoRef={videoRef} canvasRef={canvasRef} />
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