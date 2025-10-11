import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { getExchangeRate } from '../utils/currency';

interface ControlPanelProps {
  currencyOptions: string[];
}

// レート表示部分を別のコンポーネントとして切り出す（オプション）
const ExchangeRateDisplay: React.FC = () => {
  const { rates, homeCurrency, localCurrency } = useCurrencyStore();
  
  if (!rates || !localCurrency || !homeCurrency) return null;
  const rate = getExchangeRate(localCurrency, homeCurrency, rates);

  return (
    <div className="exchange-rate-display">
      {rate ? `1 ${localCurrency} ≈ ${rate.toFixed(2)} ${homeCurrency}` : 'レート情報なし'}
    </div>
  );
};

export const ControlPanel: React.FC<ControlPanelProps> = ({ currencyOptions }) => {
  // isPaused, setIsPaused, debugMessage をストアから直接取得
  const { status, homeCurrency, localCurrency, setHomeCurrency, setLocalCurrency, isPaused, setIsPaused, debugMessage } = useCurrencyStore();

  const getStatusMessage = () => {
    if (isPaused) {
      return '一時停止中';
    }
    switch (status) {
      case 'loading': return '読込中...';
      case 'error': return 'エラー';
      default: return `検出中... (${homeCurrency})`;
    }
  };

  return (
    <div className="bottom-section">
      <div className="controls">
        <div className="status-bar">
        <span>{getStatusMessage()}</span>
          {/* デバッグメッセージをここに追加 */}
          {debugMessage && <span className="debug-message">{debugMessage}</span>}
        </div>
        <div className="currency-settings">
          <div className="currency-selector">
            <label htmlFor="home-currency">自国通貨:</label>
            <select id="home-currency" value={homeCurrency} onChange={(e) => setHomeCurrency(e.target.value)}>
              {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <ExchangeRateDisplay />
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
  );
};