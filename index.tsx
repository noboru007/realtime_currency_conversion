import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { useCurrencyStore } from './src/store/useCurrencyStore';
import { CameraView } from './src/components/CameraView';
import { ControlPanel } from './src/components/ControlPanel';
import { HamburgerMenu } from './src/components/HamburgerMenu';
import { AnalyzingOverlay } from './src/components/AnalyzingOverlay';
import { GlobalBanner } from './src/components/GlobalBanner';
import { SaveConfirmationModal } from './src/components/SaveConfirmationModal';
import { useCamera } from './src/hooks/useCamera';
import { useSaveImage } from './src/hooks/useSaveImage';
import { useInitialize } from './src/hooks/useInitialize';

const App: React.FC = () => {
  const {
    rates,
    status,
    banner,
    confirmationStep,
  } = useCurrencyStore();

  const { videoRef, startCamera, handleCapture } = useCamera();
  const { saveARImage } = useSaveImage();

  // 初期化処理
  useInitialize(startCamera);

  // Visibility Changeイベントを監視（タブ復帰時にカメラ再起動）
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && videoRef.current) {
        const stream = videoRef.current.srcObject as MediaStream;
        if (!stream || !stream.active || videoRef.current.paused) {
          console.log('Camera stream is inactive or paused. Restarting camera...');
          startCamera();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [startCamera, videoRef]);

  // デバイスの向きを監視
  useEffect(() => {
    const { setDeviceOrientation } = useCurrencyStore.getState();
    const handleOrientationChange = () => {
      const orientation = window.screen.orientation.type;
      setDeviceOrientation(orientation.includes('landscape') ? 'landscape' : 'portrait');
    };

    const screenOrientation = window.screen.orientation;
    screenOrientation.addEventListener('change', handleOrientationChange);
    handleOrientationChange();

    return () => screenOrientation.removeEventListener('change', handleOrientationChange);
  }, []);

  // 優先通貨リスト
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
      <HamburgerMenu currencyOptions={currencyOptions} />
      <ControlPanel
        onCapture={handleCapture}
        onSaveImage={saveARImage}
      />
      {status === 'analyzing' && <AnalyzingOverlay />}
      {banner && !confirmationStep && <GlobalBanner />}
      <SaveConfirmationModal />
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);