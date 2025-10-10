import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // CSSのインポート
import { apiClient } from './src/api/client';
import { useCurrencyStore } from './src/store/useCurrencyStore'; // Zustandストアをインポート

const App: React.FC = () => {
  const {
    status, banner, rates, homeCurrency, localCurrency, detections,
    setStatus, setBanner, setHomeCurrency, setLocalCurrency, setDetections,
    fetchRates
  } = useCurrencyStore();

  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // --- 初期化処理 ---
  useEffect(() => {
    const initialize = async () => {
      setStatus('loading');
      await startCamera();
      await fetchRates();
      setStatus('running');
    };
    initialize();
  }, [fetchRates, setStatus]);

  // カメラ起動ロジック
  const startCamera = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // カメラが再生を開始したらスキャンループを開始
          videoRef.current.oncanplay = () => {
            setIsPaused(false); // 自動的にスキャン開始
            requestAnimationFrame(scanLoop);
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
  const scanLoop = () => {
    if (isPaused || isAnalyzing) {
      requestAnimationFrame(scanLoop);
      return;
    }
    detectPrices();
    setTimeout(() => requestAnimationFrame(scanLoop), 1000); // 1秒ごとに実行
  };

  // 価格検出ロジック
  const detectPrices = async () => {
    if (!videoRef.current || !canvasRef.current || !videoRef.current.srcObject) return;
    
    setIsAnalyzing(true);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    
    if (!context) {
        setIsAnalyzing(false);
        return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      const imageData = canvas.toDataURL('image/jpeg');
      const response = await apiClient.detectPrices(imageData, homeCurrency);
      setDetections(response.detections);
      // 成功したらエラーバナーを消す
      if (banner?.type === 'error') setBanner(null);
    } catch (error) {
      console.error('Error detecting prices:', error);
      setBanner({ message: '価格の検出中にAPIエラーが発生しました。', type: 'error' });
      setDetections([]);
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  // --- レンダリング用のヘルパー関数 ---
  
  const getExchangeRate = (from: string, to: string): number | null => {
    if (!rates) return null;
    if (from === to) return 1;
    const directRate = rates[`${from}/${to}`];
    if (directRate) return directRate;
    const inverseRate = rates[`${to}/${from}`];
    if (inverseRate) return 1 / inverseRate;
    
    // クロスレート計算 (例: USD/JPY と EUR/USD から EUR/JPY を計算)
    const usdRateFrom = rates[`${from}/USD`];
    const usdRateTo = rates[`USD/${to}`];
    if (usdRateFrom && usdRateTo) return usdRateFrom * usdRateTo;

    return null;
  };

  const convertCurrency = (amount: number, fromCurrency: string, toCurrency: string): number => {
    const rate = getExchangeRate(fromCurrency, toCurrency);
    if (rate === null) return 0;
    
    // 低額通貨の調整
    const converted = amount * rate;
    if (['JPY', 'KRW', 'VND'].includes(toCurrency)) {
        return Math.round(converted);
    }
    return parseFloat(converted.toFixed(2));
  };

  const formatCurrency = (amount: number, currency: string): string => {
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: currency,
            currencyDisplay: 'symbol'
        }).format(amount);
    } catch (e) {
        return `${amount.toFixed(2)} ${currency}`;
    }
  };

  const getCurrencyFromSymbol = (symbol: string): string => {
      const map: { [key: string]: string } = { '¥': 'JPY', '$': 'USD', '€': 'EUR', '£': 'GBP', '₩': 'KRW' };
      return map[symbol] || symbol;
  };

  const getExchangeRateDisplay = () => {
    if (!rates || !localCurrency || !homeCurrency) return null;
    const rate = getExchangeRate(localCurrency, homeCurrency);
    return (
        <div className="exchange-rate-display">
            {rate ? `1 ${localCurrency} ≈ ${rate.toFixed(2)} ${homeCurrency}` : 'レート情報なし'}
        </div>
    );
  };
  
  // 通貨オプションを生成
  const currencyOptions = rates ? ['USD', 'EUR', 'JPY', 'GBP', ...Object.keys(rates).flatMap(pair => pair.split('/'))].filter((v, i, a) => a.indexOf(v) === i) : ['USD', 'EUR', 'JPY'];

  return (
    <div className="app-container">
      {/* ... (JSXの構造はほぼ変更なし、イベントハンドラや値をストアのものに置き換え) ... */}
      <div className="top-section">
        {banner && (
          <div className={`banner ${banner.type}`}>
            {banner.message}
            <button onClick={() => setBanner(null)}>×</button>
          </div>
        )}
      </div>

      <div className="middle-section">
        <video ref={videoRef} autoPlay playsInline className="video-feed" />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <div className="overlay-container">
          {detections.map((detection, index) => {
            const detectedCurrency = detection.currency ? getCurrencyFromSymbol(detection.currency) : localCurrency;
            if (!detectedCurrency) return null;
            const convertedAmount = convertCurrency(detection.amount, detectedCurrency, homeCurrency);
            return (
              <div key={index} className="detection-box" style={{ left: `${detection.boundingBox.x}%`, top: `${detection.boundingBox.y}%`, width: `${detection.boundingBox.width}%`, height: `${detection.boundingBox.height}%` }}>
                <div className="converted-amount">{formatCurrency(convertedAmount, homeCurrency)}</div>
                <div className="original-price">{formatCurrency(detection.amount, detectedCurrency)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bottom-section">
        <div className="controls">
          <div className="status-bar">{status === 'loading' ? '読込中...' : status === 'error' ? 'エラー' : `検出中... (${homeCurrency})`}</div>
          <div className="currency-settings">
            <div className="currency-selector">
              <label htmlFor="home-currency">自国通貨:</label>
              <select id="home-currency" value={homeCurrency} onChange={(e) => setHomeCurrency(e.target.value)}>
                {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {getExchangeRateDisplay()}
            <div className="currency-selector">
              <label htmlFor="local-currency">現地通貨:</label>
              <select id="local-currency" value={localCurrency} onChange={(e) => setLocalCurrency(e.target.value)}>
                {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <button onClick={() => setIsPaused(!isPaused)} className="pause-button" aria-label={isPaused ? 'スキャンを再開' : 'スキャンを一時停止'}>
            {isPaused ? 
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> : 
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            }
          </button>
        </div>
      </div>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);