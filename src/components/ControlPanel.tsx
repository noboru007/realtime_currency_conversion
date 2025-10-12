import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { getExchangeRate } from '../utils/currency';

interface ControlPanelProps {
  currencyOptions: string[];
}

const ExchangeRateDisplay: React.FC = () => {
  const { rates, homeCurrency, localCurrency } = useCurrencyStore();
  
  if (!rates || !localCurrency || !homeCurrency || localCurrency === homeCurrency) {
    return null;
  }

  const localToHomeRateInfo = getExchangeRate(localCurrency, homeCurrency, rates);
  const homeToLocalRateInfo = getExchangeRate(homeCurrency, localCurrency, rates);

  if (!localToHomeRateInfo || !homeToLocalRateInfo) {
    return <div className="exchange-rate-display">レート情報なし</div>;
  }

  const localToHomeRate = localToHomeRateInfo.bid;
  const homeToLocalRate = homeToLocalRateInfo.bid;

  const getAdjustedRate = (baseCurrency: string, rate: number) => {
    if (['JPY', 'KRW', 'VND'].includes(baseCurrency)) {
      return { unit: 100, value: (rate * 100).toFixed(2) };
    }
    return { unit: 1, value: rate.toFixed(4) };
  };

  const localRateDisplay = getAdjustedRate(localCurrency, localToHomeRate);
  const homeRateDisplay = getAdjustedRate(homeCurrency, homeToLocalRate);

  return (
    <div className="exchange-rate-display">
      <span>{localRateDisplay.unit} {localCurrency} ≈ {localRateDisplay.value} {homeCurrency}</span>
      <span>{homeRateDisplay.unit} {homeCurrency} ≈ {homeRateDisplay.value} {localCurrency}</span>
    </div>
  );
};

export const ControlPanel: React.FC<ControlPanelProps> = ({ currencyOptions }) => {
  const { status, homeCurrency, localCurrency, setHomeCurrency, setLocalCurrency, isPaused, setIsPaused } = useCurrencyStore();

  const getStatusMessage = () => {
    if (isPaused) { return '一時停止中'; }
    switch (status) {
      case 'loading': return '読込中...';
      case 'error': return 'エラー';
      // default: return `検出中... (${homeCurrency})`;
      default: return `検出中...`;
    }
  };

  return (
    <div className="bottom-section">
      <div className="controls">
        {/* --- ▼▼▼ メインコントロール部分を新しいdivで囲む ▼▼▼ --- */}
        <div className="controls-main">
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
        </div>
        {/* --- ▼▼▼ status-barとbuttonをdivでグルーピング ▼▼▼ --- */}
        <div className="controls-footer">
          <div className="status-bar">
            <span>{getStatusMessage()}</span>
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