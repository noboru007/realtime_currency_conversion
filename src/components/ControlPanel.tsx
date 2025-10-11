import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { getExchangeRate } from '../utils/currency'; // getExchangeRateをインポート

interface ControlPanelProps {
  currencyOptions: string[];
}

// --- ▼▼▼ 新しいコンポーネント ▼▼▼ ---
const ExchangeRateDisplay: React.FC = () => {
  const { rates, homeCurrency, localCurrency } = useCurrencyStore();
  
  // レート計算に必要な情報が揃っていない場合は何も表示しない
  if (!rates || !localCurrency || !homeCurrency || localCurrency === homeCurrency) {
    return null;
  }

  // 現地通貨 -> 自国通貨 のレートを取得
  const localToHomeRateInfo = getExchangeRate(localCurrency, homeCurrency, rates);
  // 自国通貨 -> 現地通貨 のレートを取得
  const homeToLocalRateInfo = getExchangeRate(homeCurrency, localCurrency, rates);

  if (!localToHomeRateInfo || !homeToLocalRateInfo) {
    return <div className="exchange-rate-display">レート情報なし</div>;
  }

  // ユーザーは現地通貨を売る -> Bidレートが適用される
  const localToHomeRate = localToHomeRateInfo.bid;
  // ユーザーは自国通貨を売る -> Bidレートが適用される
  const homeToLocalRate = homeToLocalRateInfo.bid;

  // JPYなど低額通貨の場合、表示桁数を調整する
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
// --- ▲▲▲ ここまで追加 ▲▲▲ ---

export const ControlPanel: React.FC<ControlPanelProps> = ({ currencyOptions }) => {
  const { status, homeCurrency, localCurrency, setHomeCurrency, setLocalCurrency, isPaused, setIsPaused, debugMessage } = useCurrencyStore();

  const getStatusMessage = () => {
    // ... (変更なし)
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
          {debugMessage && <span className="debug-message">{debugMessage}</span>}
        </div>
        <div className="currency-settings">
          <div className="currency-selector">
            <label htmlFor="home-currency">自国通貨:</label>
            <select id="home-currency" value={homeCurrency} onChange={(e) => setHomeCurrency(e.target.value)}>
              {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {/* ▼▼▼ ここにレート表示コンポーネントを挿入 ▼▼▼ */}
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