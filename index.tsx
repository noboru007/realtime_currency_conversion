import React, { useState, useEffect, useRef } from 'react';
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
  
  // --- AR Drawing and Saving Logic ---
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

      saveDivAsImage(cameraContainer, filename); // ★ 動的なファイル名を使用

      // Reset the state after saving
      useCurrencyStore.getState().resetState();
    }
  };

  // Expose the function to the window object
  useEffect(() => {
    window.saveARImage = saveARImage;
  }, [capturedImage, detections]); // Dependencies are still useful to ensure the function has the right context


  // --- Capture Logic ---
  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      if (context) {
        // 1. リサイズ後の最大寸法を定義
        const MAX_DIMENSION = 1280; // 単位はピクセル

        // 2. 元のビデオの寸法とアスペクト比を取得
        const originalWidth = video.videoWidth;
        const originalHeight = video.videoHeight;

        let newWidth, newHeight;

        // 3. アスペクト比を保ったまま新しい寸法を計算
        // originalWidthとoriginalHeightのどちらかがMAX_DIMENSIONより大きい場合は、それをMAX_DIMENSIONに合わせる
        if (originalWidth > MAX_DIMENSION || originalHeight > MAX_DIMENSION) {
          if (originalWidth > originalHeight) {
            // 横長の画像
            newWidth = MAX_DIMENSION;
            newHeight = (originalHeight / originalWidth) * MAX_DIMENSION;
          } else {
            // 縦長または正方形の画像
            newHeight = MAX_DIMENSION;
            newWidth = (originalWidth / originalHeight) * MAX_DIMENSION;
          }
        } else {
          newWidth = originalWidth;
          newHeight = originalHeight;
        }
        // console.log('Resized (width, height):', newWidth, newHeight);

        // 4. Canvasの寸法を新しいサイズに設定
        canvas.width = newWidth;
        canvas.height = newHeight;

        // 5. 元のビデオフレームを、新しいサイズのCanvasに縮小して描画
        context.drawImage(video, 0, 0, newWidth, newHeight);
        
        // 6. リサイズ後の画像データを取得（品質は90%でも十分小さくなる）
        const imageData = canvas.toDataURL('image/jpeg', 0.9);

        // Update the store
        setCapturedImage(imageData);
        setConfirmationStep('analyze');
      }
    }
  };

  // Set up capture button event listener
  useEffect(() => {
    const captureButton = document.getElementById('capture-button');
    if (captureButton) {
      captureButton.addEventListener('click', handleCapture);
    }
    return () => {
      if (captureButton) {
        captureButton.removeEventListener('click', handleCapture);
      }
    };
    // This effect should run once to set up the event listener.
  }, []);


  // デバイスの向きを監視するEffect
  useEffect(() => {
    const handleOrientationChange = () => {
      const orientation = window.screen.orientation.type; // デバイスの向きを取得。アプリ全体で使える。
      if (orientation === "landscape-primary") {
        // console.log('Landscape primary');
        //setOrientationAngle(90);  // 横長の場合は90度回転
        setOrientationAngle(0);
      } else if (orientation === "landscape-secondary") {
        // console.log('Landscape secondary');
        //setOrientationAngle(-90);  // 横長の場合は-90度回転
        setOrientationAngle(0);
      } else {
        // console.log('Portrait');
        setOrientationAngle(0);  // 縦長の場合は0度回転
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
    const startCamera = async () => {
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
    };

    const initialize = async () => {
      setStatus('loading');
      await startCamera(); // startCameraが完了するのを待つ

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
  }, [fetchRates, setStatus, setLocalCurrency, setBanner, setHomeCurrency, t]);

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