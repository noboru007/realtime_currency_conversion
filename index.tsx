import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { apiClient } from './src/api/client';
import { useCurrencyStore } from './src/store/useCurrencyStore'; // Zustandストアをインポート

// DetectionとBoundingBoxの型定義はストアから取得できるので不要になる場合がありますが、
// 可読性のために残しても良いでしょう。
interface BoundingBox {
  x: number; y: number; width: number; height: number;
}
interface Detection {
  amount: number; currency?: string; boundingBox: BoundingBox;
}

const App: React.FC = () => {
  // --- ストアからグローバルな状態とアクションを取得 ---
  const {
    status, banner, rates, homeCurrency, localCurrency, detections,
    setStatus, setBanner, setHomeCurrency, setLocalCurrency, setDetections,
    fetchRates
  } = useCurrencyStore();

  // --- このコンポーネント内でのみ使用するローカルな状態 ---
  const [isPaused, setIsPaused] = useState<boolean>(true); // 初期状態をPausedに
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isProcessingRef = useRef<boolean>(false);

  // --- 初期化処理 ---
  useEffect(() => {
    const initialize = async () => {
      setStatus('loading');
      await startCamera(); // カメラの起動はUIに密接なのでここで行う
      await fetchRates();   // ストアのアクションを呼び出してレートを取得
      setStatus('running');
    };
    initialize();
  }, [fetchRates, setStatus]); // 依存配列にストアのアクションを追加

  // --- カメラ起動ロジック ---
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
      setBanner({ message: 'カメラアクセスに失敗。ファイルアップロード機能を使用してください。', type: 'warning' });
    }
  };
  
  // --- 価格検出ロジック ---
  const detectPrices = async () => {
    if (isProcessingRef.current || !videoRef.current || !canvasRef.current || !videoRef.current.srcObject) return;
    
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
      setDetections(response.detections); // ストアの状態を更新
      setBanner(null);
    } catch (error) {
      console.error('Error detecting prices:', error);
      setBanner({ message: '価格の検出中にAPIエラーが発生しました。', type: 'error' });
      setDetections([]);
    } finally {
      isProcessingRef.current = false;
      setIsAnalyzing(false);
    }
  };
  
  // --- UIイベントハンドラ ---
  const togglePause = () => {
    if (isPaused) {
      setIsPaused(false);
      detectPrices().finally(() => setIsPaused(true));
    }
  };

  // --- レンダリング用のヘルパー関数 ---
  // formatCurrency, getCurrencyFromSymbol, convertCurrency, getExchangeRateDisplayは
  // 内部でratesやhomeCurrencyを直接ストアから参照するため、引数として渡す必要がなくなる。
  // (内容は変更ないので省略)
  const formatCurrency = (amount: number, currency: string) => { /* ...内容は変更なし... */ };
  const getCurrencyFromSymbol = (symbol: string): string => { /* ...内容は変更なし... */ };
  const convertCurrency = (amount: number, fromCurrency: string, toCurrency: string): number => { /* ...内容は変更なし... */ };
  const getExchangeRateDisplay = () => { /* ...内容は変更なし... */ };
  
  // --- レンダリング部分 ---
  const renderContent = () => {
    // ... (内容はほぼ変更なし)
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
      
      {status === 'loading' && (
        <div className="status-overlay">
          <div className="loader"></div>
          <p>カメラを起動し、為替レートを取得しています...</p>
        </div>
      )}
      {status === 'error' && (
        <div className="status-overlay">
          <h2>エラーが発生しました</h2>
          {/* バナーメッセージを直接表示 */}
          <p>{banner?.message}</p>
        </div>
      )}
      {status === 'running' && (
        <>
          <div className="overlay-container">
            {detections.map((detection, index) => {
              const detectedCurrency = detection.currency ? getCurrencyFromSymbol(detection.currency) : (localCurrency || 'JPY');
              const convertedAmount = rates && homeCurrency && detectedCurrency ? convertCurrency(detection.amount, detectedCurrency, homeCurrency) : 0;
              return (
                <div key={index} className="detection-box" style={{ left: `${detection.boundingBox.x}%`, top: `${detection.boundingBox.y}%`, width: `${detection.boundingBox.width}%`, height: `${detection.boundingBox.height}%` }}>
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
                  <select id="home-currency" value={homeCurrency} onChange={(e) => setHomeCurrency(e.target.value)}>
                    {/* レートの通貨ペアから通貨リストを生成 */}
                    {Object.keys(rates).flatMap(pair => pair.split('/')).filter((v, i, a) => a.indexOf(v) === i).sort().map(currency => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                </div>
                {getExchangeRateDisplay()}
                <div className="currency-selector">
                  <label htmlFor="local-currency">現地通貨:</label>
                  <select id="local-currency" value={localCurrency} onChange={(e) => setLocalCurrency(e.target.value)}>
                    <option value="">選択してください</option>
                    {Object.keys(rates).flatMap(pair => pair.split('/')).filter((v, i, a) => a.indexOf(v) === i).sort().map(currency => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button onClick={togglePause} className="pause-button" aria-label={isPaused ? 'スキャンを再開' : 'スキャンを一時停止'}>
                {isPaused ? <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);
