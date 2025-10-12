import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // CSSのインポート
import { apiClient } from './src/api/client';
import { useCurrencyStore } from './src/store/useCurrencyStore'; // Zustandストアをインポート
import { NotificationBanner } from './src/components/NotificationBanner';
import { convertCurrency, formatCurrency, getCurrencyFromSymbol, getExchangeRate } from './src/utils/currency';
import { CameraView } from './src/components/CameraView';
import { ControlPanel } from './src/components/ControlPanel';
import { localeCurrencyMetadata } from './src/utils/currency';

const App: React.FC = () => {
  const {
    status, banner, rates, homeCurrency, localCurrency, detections,
    setStatus, setBanner, setDebugMessage, isPaused, setIsPaused,
    setHomeCurrency, setLocalCurrency, setDetections,
    fetchRates
  } = useCurrencyStore();

  // const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // --- 初期化処理 ---
  useEffect(() => {
    const initialize = async () => {
      setStatus('loading');// <-- 初期化処理が終わるまでUIは操作不可になる
      startCamera();
      // --- ▼▼▼ 自国通貨設定ロジックをライブラリ使用に書き換え ▼▼▼ ---
      try {
        const userLocale = navigator.language; // 例: "ja-JP"
        const localeInfo = localeCurrencyMetadata[userLocale];
        
        if (localeInfo) {
          setHomeCurrency(localeInfo.currency);
          console.log(`Home currency set to ${localeInfo.currency} based on browser locale ${userLocale}.`);
        } else {
          // マップにない場合はUSDをデフォルトに設定
          setHomeCurrency('USD');
          console.warn(`No currency mapping found for locale: ${userLocale}. Defaulting to USD.`);
        }
      } catch (error) {
        console.warn('Could not determine home currency from locale. Defaulting to USD.', error);
        setHomeCurrency('USD'); // エラー時もUSDをデフォルトに
      }
      // --- ▼▼▼ 位置情報取得ロジックを追加 ▼▼▼ ---
      const getLocation = (): Promise<GeolocationPosition> => {
        return new Promise((resolve, reject) => {
          if (!navigator.geolocation) {
            return reject(new Error('Geolocation is not supported.'));
          }
          navigator.geolocation.getCurrentPosition(resolve, reject);
        });
      };

      try {
        const position = await getLocation();
        const { latitude, longitude } = position.coords;
        const data = await apiClient.getCurrencyFromLocation(latitude, longitude);
        if (data.currency_code) {
          setLocalCurrency(data.currency_code);
          console.log(`Local currency set to ${data.currency_code} based on location.`);
        }
      } catch (error) {
        // ユーザーが許可しなかった場合(Permission denied)や、その他のエラーの場合
        console.warn('Could not get geolocation or determine currency from it.', error);
        setBanner({ message: '位置情報から現地通貨を自動設定できませんでした。手動で設定してください。', type: 'warning' });
      }
      await fetchRates();
      // すべての初期化処理が完了
      setStatus('running'); // <-- この時点でUIが操作可能になる
    };
    initialize();
  }, [fetchRates, setStatus, setLocalCurrency, setBanner, setHomeCurrency]); // 依存配列を元に戻します

  // カメラ起動ロジック
  const startCamera = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // カメラが再生を開始したらスキャンループを開始
          videoRef.current.oncanplay = () => {
            // setIsPaused(false); // この行を削除またはコメントアウト
            scanLoop();
          };
        }
      } else {
        throw new Error('Camera not supported.');
      }
    } catch (error) {
      setBanner({ message: 'カメラアクセスに失敗。ページをリロードするか、設定を確認してください。', type: 'error' });
      setStatus('error');
    }
  };
  
  // スキャンループ
  const scanLoop = async () => {
    // ストアから直接、最新の isPaused 状態を取得します
    if (!useCurrencyStore.getState().isPaused) {
      await detectPrices();
    }
    // 処理が完了、もしくはPause中だった場合、次のループをスケジュールする
    // Pause中は200msごとに状態をチェックし、復帰に素早く反応できるようにする
    // 次のループをスケジュールする際も、ストアから最新の状態を取得します
    const delay = useCurrencyStore.getState().isPaused ? 200 : 1000; 
    setTimeout(scanLoop, delay);
  };

  // 価格検出ロジック
  const detectPrices = async () => {
    if (!videoRef.current || !canvasRef.current || !videoRef.current.srcObject) return;
    
    setIsAnalyzing(true);
    setDebugMessage('API request sent...'); // API呼び出し開始ログ

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // --- ▼▼▼ 画像リサイズ処理を追加 ▼▼▼ ---
    const MAX_DIMENSION = 512; // 画像の最も長い辺を768pxにリサイズ
    let width = video.videoWidth;
    let height = video.videoHeight;

    if (width > height) {
      if (width > MAX_DIMENSION) {
        height = Math.round(height * (MAX_DIMENSION / width));
        width = MAX_DIMENSION;
      }
    } else {
      if (height > MAX_DIMENSION) {
        width = Math.round(width * (MAX_DIMENSION / height));
        height = MAX_DIMENSION;
      }
    }
    canvas.width = width;
    canvas.height = height;
    // --- ▲▲▲ ここまで追加 ▲▲▲ ---    
    const context = canvas.getContext('2d');
    
    if (!context) {
        setIsAnalyzing(false);
        return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      //const imageData = canvas.toDataURL('image/jpeg');
      const imageData = canvas.toDataURL('image/jpeg', 0.7); // 第2引数で画質を70%に指定
      const response = await apiClient.detectPrices(imageData, homeCurrency);
      setDebugMessage(`API response received. Detections: ${response.detections.length}`); // API応答受信ログ
      setDetections(response.detections);
      // 成功したらエラーバナーを消す
      if (banner?.type === 'error') setBanner(null);
    } catch (error) {
      console.error('Error detecting prices:', error);
      setDebugMessage('API request failed.'); // APIエラーログ
      setBanner({ message: '価格の検出中にAPIエラーが発生しました。', type: 'error' });
      setDetections([]);
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  // 通貨ドロップダウンリストの選択肢を生成
  const priorityCurrencies = [
    'EUR', 'GBP', 'USD', 'JPY', 
    'CNY', 'HKD', 'IDR', 'INR', 'KRW', 'MYR', 
    'PHP', 'SGD', 'THB', 'TWD', 'VND'
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
        <NotificationBanner /> 
        <CameraView videoRef={videoRef} canvasRef={canvasRef} />
        <ControlPanel currencyOptions={currencyOptions} />
      </div>
    );
  };
  

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);