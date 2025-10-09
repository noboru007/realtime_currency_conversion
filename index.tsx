import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { apiClient } from './src/api/client';

const DETECTION_INTERVAL_MS = 2500;

interface RateData {
  rates: { [currency: string]: number };
  timestamp: string;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Detection {
  amount: number;
  currency?: string;
  boundingBox: BoundingBox;
}

interface Banner {
    message: React.ReactNode;
    type: 'error' | 'warning';
}

const App: React.FC = () => {
  const [status, setStatus] = useState<'loading' | 'running' | 'error' | 'missing_api_key'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [rates, setRates] = useState<{ [currency: string]: number } | null>(null);
  const [homeCurrency, setHomeCurrency] = useState<string>('USD'); // 自国通貨
  const [localCurrency, setLocalCurrency] = useState<string>(''); // 現地通貨
  const [detections, setDetections] = useState<Detection[]>([]);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isFileUploadMode, setIsFileUploadMode] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isProcessingRef = useRef<boolean>(false);

  useEffect(() => {
    initialize();
  }, []);

  const initialize = async () => {
    setStatus('loading');
    setErrorMessage('');
    try {
      // カメラ機能を有効化（エラーハンドリング付き）
      await startCamera();
      
      try {
        await fetchRates();
      } catch (fetchError) {
        console.warn('Failed to fetch new rates, attempting to load from cache.', fetchError);
        const cachedRatesJson = localStorage.getItem('cachedRates');
        if (cachedRatesJson) {
            const cachedRates = JSON.parse(cachedRatesJson) as { [currency: string]: number };
            setRates(cachedRates);
                if (!cachedRates['USD'] && Object.keys(cachedRates).length > 0) {
                    setHomeCurrency(Object.keys(cachedRates)[0]);
                }
            setBanner({ message: '為替レートの取得に失敗しました。前回保存したデータを使用しています。', type: 'warning' });
        } else {
            throw new Error('為替レートの取得に失敗し、保存されたデータもありません。');
        }
      }

      setStatus('running');

      // Run detection once on startup, then pause.
      detectPrices().finally(() => {
        setIsPaused(true);
      });

    } catch (err) {
      let message = err instanceof Error ? err.message : 'An unknown error occurred.';
      setStatus('error');
      setErrorMessage(message);
    }
  };


  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const imageData = e.target?.result as string;
              const response = await apiClient.detectPrices(imageData, homeCurrency);
        setDetections(response.detections);
        setBanner(null);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('File upload error:', error);
      setBanner({ message: 'ファイルの処理に失敗しました。', type: 'error' });
    }
  };

  const startCamera = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        console.log('カメラアクセスを試行中...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          console.log('カメラアクセス成功');
        }
      } else {
        throw new Error('Camera not supported by this browser.');
      }
    } catch (error) {
      console.error('カメラエラー:', error);
      // カメラエラーを無視して続行
      setBanner({ 
        message: 'カメラアクセスに失敗しました。ファイルアップロード機能を使用してください。', 
        type: 'warning' 
      });
    }
  };

  const fetchRates = async () => {
    try {
      const data = await apiClient.getExchangeRates();
      setRates(data.rates);
      localStorage.setItem('cachedRates', JSON.stringify(data.rates));

              if (!data.rates['USD'] && Object.keys(data.rates).length > 0) {
                setHomeCurrency(Object.keys(data.rates)[0]);
              }
    } catch (error) {
      throw new Error('Failed to fetch exchange rates.');
    }
  };

  const detectPrices = async () => {
    if (isProcessingRef.current || !videoRef.current || !canvasRef.current) {
      return;
    }

    isProcessingRef.current = true;
    setIsAnalyzing(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
        isProcessingRef.current = false;
        setIsAnalyzing(false);
        return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      const imageData = canvas.toDataURL('image/jpeg');
      
              const response = await apiClient.detectPrices(imageData, homeCurrency);
      
      setBanner(null); // Clear previous errors on success
      setDetections(response.detections);
    } catch (error) {
      console.error('Error detecting prices:', error);
      if (error instanceof Error && (error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED'))) {
        setBanner({ 
            message: (
                <>
                    APIの利用上限に達しました。
                    <a href="https://console.cloud.google.com/apis/dashboard" target="_blank" rel="noopener noreferrer">
                    利用状況と請求設定
                    </a>
                    をご確認ください。
                </>
            ),
            type: 'error'
        });
      } else {
        setBanner({ message: `価格の検出中にAPIエラーが発生しました。`, type: 'error' });
      }
      setDetections([]);
    } finally {
      isProcessingRef.current = false;
      setIsAnalyzing(false);
    }
  };

  const togglePause = () => {
    // When paused, pressing the button will trigger a single detection run.
    if (isPaused) {
      setIsPaused(false); // Visually show that we are running
      detectPrices().finally(() => {
        setIsPaused(true); // Go back to paused state after completion
      });
    }
    // If it's already running (isPaused is false), do nothing.
    // The button will show a pause icon, but clicking it has no effect
    // as it will automatically pause after the current run.
  };

  const formatCurrency = (amount: number, currency: string) => {
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency,
            maximumFractionDigits: 2,
        }).format(amount);
    } catch (e) {
        return `${currency} ${amount.toFixed(2)}`;
    }
  };

  const getCurrencyFromSymbol = (symbol: string): string => {
    const symbolMap: { [key: string]: string } = {
      '¥': 'JPY',
      '$': 'USD',
      '€': 'EUR',
      '£': 'GBP',
      '₩': 'KRW',
      '₹': 'INR',
      '₽': 'RUB',
      '₪': 'ILS',
      '₦': 'NGN',
      '₨': 'PKR',
      '₫': 'VND',
      '₱': 'PHP',
      '₴': 'UAH',
      '₸': 'KZT',
      '₼': 'AZN',
      '₾': 'GEL',
      '₿': 'BTC'
    };
    return symbolMap[symbol] || 'USD';
  };

  const convertCurrency = (amount: number, fromCurrency: string, toCurrency: string): number => {
    if (!rates || fromCurrency === toCurrency) return amount;
    
    const pairKey = `${fromCurrency}/${toCurrency}`;
    const reversePairKey = `${toCurrency}/${fromCurrency}`;
    
    // Ask/Bidレートの適用
    // ユーザーが海外で現地通貨建ての商品を自国通貨で購入する状況
    // 現地通貨を買う（Askレート）または自国通貨を売る（Bidレート）
    if (rates[pairKey]) {
      // 現地通貨を買う場合：Askレートを適用
      return amount * rates[pairKey];
    } else if (rates[reversePairKey]) {
      // 自国通貨を売る場合：Bidレートを適用（1/Askレート）
      return amount / rates[reversePairKey];
    }
    
    return 0;
  };

  const getExchangeRateDisplay = () => {
    if (!rates || !homeCurrency || !localCurrency) return null;
    
    const pairKey = `${localCurrency}/${homeCurrency}`;
    const reversePairKey = `${homeCurrency}/${localCurrency}`;
    
    let rate1 = 0;
    let rate2 = 0;
    
    if (rates[pairKey]) {
      rate1 = rates[pairKey];
      rate2 = 1 / rate1;
    } else if (rates[reversePairKey]) {
      rate2 = rates[reversePairKey];
      rate1 = 1 / rate2;
    }
    
    if (rate1 === 0 || rate2 === 0) return null;
    
    // JPYやKRWのような低価値通貨の調整
    const adjustForLowValueCurrency = (currency: string, amount: number) => {
      if (currency === 'JPY' || currency === 'KRW') {
        return (amount * 100).toFixed(2);
      }
      return amount.toFixed(4);
    };
    
    return (
      <div className="exchange-rate-display">
        <div className="rate-line">
          1 {localCurrency} = {adjustForLowValueCurrency(localCurrency, rate1)} {homeCurrency}
        </div>
        <div className="rate-line">
          1 {homeCurrency} = {adjustForLowValueCurrency(homeCurrency, rate2)} {localCurrency}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (status === 'loading') {
      return (
        <div className="status-overlay">
          <div className="loader"></div>
          <p>カメラを起動し、為替レートを取得しています...</p>
        </div>
      );
    }

    if (status === 'missing_api_key') {
      return (
        <div className="status-overlay">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          <h2>APIキーが必要です</h2>
          {errorMessage && <p className="error-message">{errorMessage}</p>}
          <p>
            <code>index.tsx</code> ファイルの先頭にある <code>YOUR_API_KEY</code> 定数に、<br/>
            ご自身のGoogle AI APIキーを設定してください。
          </p>
          <p>
            キーは<a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">こちら</a>で取得できます。
          </p>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="status-overlay">
          <h2>エラーが発生しました</h2>
          <p>{errorMessage}</p>
        </div>
      );
    }

    return (
      <>
        <div className="overlay-container">
          {detections.map((detection, index) => {
            // 通貨記号から通貨コードを推定
            const detectedCurrency = detection.currency ? 
              getCurrencyFromSymbol(detection.currency) : 
              (localCurrency || 'JPY');
            
            // 現地通貨から自国通貨への換算
            const convertedAmount = rates && homeCurrency && detectedCurrency ? 
              convertCurrency(detection.amount, detectedCurrency, homeCurrency) : 0;
            
            return (
              <div
                key={index}
                className="detection-box"
                style={{
                  left: `${detection.boundingBox.x}%`,
                  top: `${detection.boundingBox.y}%`,
                  width: `${detection.boundingBox.width}%`,
                  height: `${detection.boundingBox.height}%`,
                }}
                aria-live="polite"
              >
                <div className="converted-amount">{formatCurrency(convertedAmount, homeCurrency)}</div>
                <div className="original-price">{formatCurrency(detection.amount, detectedCurrency)}</div>
              </div>
            );
          })}
        </div>
        {rates && (
          <div className="controls">
            <div className="currency-settings">
              <div className="currency-selector">
                <label htmlFor="home-currency">自国通貨:</label>
                <select
                  id="home-currency"
                  value={homeCurrency}
                  onChange={(e) => setHomeCurrency(e.target.value)}
                  aria-label="Select home currency"
                >
                  {Object.keys(rates).sort().map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </div>
              {getExchangeRateDisplay()}
              <div className="currency-selector">
                <label htmlFor="local-currency">現地通貨:</label>
                <select
                  id="local-currency"
                  value={localCurrency}
                  onChange={(e) => setLocalCurrency(e.target.value)}
                  aria-label="Select local currency"
                >
                  <option value="">選択してください</option>
                  {Object.keys(rates).sort().map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button onClick={togglePause} className="pause-button" aria-label={isPaused ? 'スキャンを再開' : 'スキャンを一時停止'}>
              {isPaused ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              )}
            </button>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="app-container">
      {banner && (
        <div className={`error-banner ${banner.type}`}>
            <p>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                {banner.message}
            </p>
            <button onClick={() => setBanner(null)} aria-label="Dismiss error message">&times;</button>
        </div>
      )}
      {isAnalyzing && (
        <div className="analyzing-indicator">
          <div className="analyzing-spinner"></div>
          <span>Analyzing data...</span>
        </div>
      )}
      <video id="video-feed" ref={videoRef} autoPlay playsInline muted />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {renderContent()}
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);