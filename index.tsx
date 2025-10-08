import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from '@google/genai';

// EDIT THIS: ご自身のAPIキーをここに貼り付けてください。
// このキーは、環境に設定されたキーよりも優先して使用されます。
const YOUR_API_KEY = "";

const API_URL = 'https://corsproxy.io/?https://forex-api.coin.z.com/public/v1/ticker';
const DETECTION_INTERVAL_MS = 2500;

interface RateData {
  [currency: string]: number;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Detection {
  amount: number;
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
  const [rates, setRates] = useState<RateData | null>(null);
  const [targetCurrency, setTargetCurrency] = useState<string>('USD');
  const [detections, setDetections] = useState<Detection[]>([]);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isProcessingRef = useRef<boolean>(false);
  const aiRef = useRef<GoogleGenAI | null>(null);

  const responseSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        amount: { type: Type.NUMBER, description: 'The numeric value of the price.' },
        boundingBox: {
          type: Type.OBJECT,
          properties: {
            x: { type: Type.NUMBER, description: 'Left position as a percentage (0-100)' },
            y: { type: Type.NUMBER, description: 'Top position as a percentage (0-100)' },
            width: { type: Type.NUMBER, description: 'Width as a percentage (0-100)' },
            height: { type: Type.NUMBER, description: 'Height as a percentage (0-100)' },
          },
          required: ['x', 'y', 'width', 'height'],
        },
      },
      required: ['amount', 'boundingBox'],
    },
  };

  useEffect(() => {
    const apiKey = (YOUR_API_KEY && !YOUR_API_KEY.includes('ご自身のAPIキーをここに貼り付けてください'))
      ? YOUR_API_KEY
      : process.env.API_KEY;

    if (apiKey) {
      initialize(apiKey);
    } else {
      setStatus('missing_api_key');
    }
  }, []);

  const initialize = async (apiKey: string) => {
    setStatus('loading');
    setErrorMessage('');
    try {
      aiRef.current = new GoogleGenAI({ apiKey });

      await startCamera();
      
      try {
        await fetchRates();
      } catch (fetchError) {
        console.warn('Failed to fetch new rates, attempting to load from cache.', fetchError);
        const cachedRatesJson = localStorage.getItem('cachedRates');
        if (cachedRatesJson) {
            const cachedRates = JSON.parse(cachedRatesJson) as RateData;
            setRates(cachedRates);
            if (!cachedRates['USD'] && Object.keys(cachedRates).length > 0) {
                setTargetCurrency(Object.keys(cachedRates)[0]);
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
      if (message.includes('API key not valid') || message.includes('API_KEY_INVALID')) {
        message = `APIキーが無効です。index.tsx ファイルの YOUR_API_KEY 定数が正しいか確認してください。`;
        setStatus('missing_api_key');
      } else {
        setStatus('error');
      }
      setErrorMessage(message);
    }
  };


  const startCamera = async () => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } else {
      throw new Error('Camera not supported by this browser.');
    }
  };

  const fetchRates = async () => {
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error('Failed to fetch exchange rates.');
    }
    const data = await response.json();
    const processedRates: RateData = {};
    data.data.forEach((item: any) => {
      const [currency] = item.symbol.split('/');
      if (currency !== 'JPY') {
        processedRates[currency] = parseFloat(item.last);
      }
    });
    setRates(processedRates);
    localStorage.setItem('cachedRates', JSON.stringify(processedRates));

    if (!processedRates['USD'] && Object.keys(processedRates).length > 0) {
      setTargetCurrency(Object.keys(processedRates)[0]);
    }
  };

  const detectPrices = async () => {
    if (isProcessingRef.current || !videoRef.current || !canvasRef.current || !aiRef.current) {
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
      const base64Data = canvas.toDataURL('image/jpeg').split(',')[1];
      const imagePart = {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Data,
        },
      };
      const textPart = {
        text: `Analyze the image to find any visible prices. Prices may be preceded by '¥' or end with '円'. Assume the currency is Japanese Yen (JPY) if no symbol is present. For each price found, provide the numeric amount and its location as a bounding box (x, y, width, height) in percentages relative to the image dimensions. Return the data in the specified JSON format. If no prices are found, return an empty array.`
      };

      const response = await aiRef.current.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, textPart] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
        },
      });
      
      setBanner(null); // Clear previous errors on success
      const parsedDetections = JSON.parse(response.text);
      setDetections(parsedDetections);
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
            const convertedAmount = rates && rates[targetCurrency] ? detection.amount / rates[targetCurrency] : 0;
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
                <div>{formatCurrency(convertedAmount, targetCurrency)}</div>
                <div className="original-price">{formatCurrency(detection.amount, 'JPY')}</div>
              </div>
            );
          })}
        </div>
        {rates && (
          <div className="controls">
            <label htmlFor="currency-select">変換先:</label>
            <select
              id="currency-select"
              value={targetCurrency}
              onChange={(e) => setTargetCurrency(e.target.value)}
              aria-label="Select target currency for conversion"
            >
              {Object.keys(rates).sort().map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
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