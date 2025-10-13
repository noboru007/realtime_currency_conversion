import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';
import { getExchangeRate } from '../utils/currency';
import { supportedLanguages } from '../i18n/translations';
import { NotificationBanner } from './NotificationBanner'; // ← NotificationBannerをインポート

interface ControlPanelProps {
  currencyOptions: string[];
}

const ExchangeRateDisplay: React.FC = () => {
  const { rates, homeCurrency, localCurrency, setCalculatedRates, localToHomeRate, homeToLocalRate } = useCurrencyStore();
  const { t } = useTranslationStore();

  React.useEffect(() => {
    if (!rates || !localCurrency || !homeCurrency || localCurrency === homeCurrency) {
      setCalculatedRates({ localToHome: null, homeToLocal: null });
      return;
    }

    const localToHome = getExchangeRate(localCurrency, homeCurrency, rates);
    // const homeToLocal = getExchangeRate(homeCurrency, localCurrency, rates);

    if (localToHome) {
      // ストアに計算結果を保存
       // Local:USD, Home:JPYの時、1USDをより不利なレートで買うのでUSD/JPYのレートをaskで取得
      setCalculatedRates({ localToHome: localToHome.ask, homeToLocal: 1 / localToHome.ask });
    } else {
      setCalculatedRates({ localToHome: null, homeToLocal: null });
    }
  }, [rates, localCurrency, homeCurrency, setCalculatedRates]);

  if (localToHomeRate === null || homeToLocalRate === null) {
    return <div className="exchange-rate-display">{t('rateInfoUnavailable')}</div>;
  }

  const getAdjustedRate = (rate: number) => {
    // レートが0.01未満の場合、100単位で表示
    if (rate < 0.01) {
      return { unit: 100, value: (rate * 100).toFixed(4) };
    }
    // それ以外の場合は1単位で表示
    return { unit: 1, value: rate.toFixed(4) };
  };

  const localRateDisplay = getAdjustedRate(localToHomeRate);
  const homeRateDisplay = getAdjustedRate(homeToLocalRate);

  return (
    <div className="exchange-rate-display">
      <span>{localRateDisplay.unit} {localCurrency} ≈ {localRateDisplay.value} {homeCurrency}</span>
      <span>{homeRateDisplay.unit} {homeCurrency} ≈ {homeRateDisplay.value} {localCurrency}</span>
    </div>
  );
};

export const ControlPanel: React.FC<ControlPanelProps> = ({ currencyOptions }) => {
  const { status, homeCurrency, localCurrency, setHomeCurrency, setLocalCurrency, isPaused, setIsPaused } = useCurrencyStore();
  const { t, language, setLanguage } = useTranslationStore();

  const getStatusMessage = () => {
    if (status === 'loading') return t('loading');
    if (status === 'error') return t('errorOccurred');
    return isPaused ? t('standby') : t('scanning');
  };

  const isControlDisabled = status !== 'running';

  return (
    <div className="bottom-section">
      <div className="controls">
        {/* 上段: 通貨選択と為替レート */}
        <div className="controls-main">
          <div className="currency-selector">
            <label htmlFor="home-currency">{t('homeCurrencyLabel')}</label>
            <select id="home-currency" value={homeCurrency} onChange={(e) => setHomeCurrency(e.target.value)} disabled={isControlDisabled}>
              {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <ExchangeRateDisplay />

          <div className="currency-selector">
            <label htmlFor="local-currency">{t('localCurrencyLabel')}</label>
            <select id="local-currency" value={localCurrency} onChange={(e) => setLocalCurrency(e.target.value)} disabled={isControlDisabled}>
              {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* 下段: 言語、バナー、ステータス、ボタン */}
        <div className="controls-footer">
          <div className="language-selector">
            {/* ラベルを削除 */}
            <select id="language-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {supportedLanguages.map(lang => (
                <option key={lang.code} value={lang.code}>{lang.name}</option>
              ))}
            </select>
          </div>

          <div className="banner-container-footer">
            <NotificationBanner />
          </div>

          <div className="status-and-button">
            <div className="status-bar">
              <span>{getStatusMessage()}</span>
            </div>
            <button
              onClick={() => setIsPaused(!isPaused)}
              className="pause-button"
              aria-label={isPaused ? t('resumeScanTooltip') : t('pauseScanTooltip')}
              disabled={isControlDisabled}
            >
              {isPaused ?
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> :
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};