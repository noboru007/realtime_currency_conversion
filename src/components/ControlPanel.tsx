import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';
import { getExchangeRate } from '../utils/currency';
import { supportedLanguages } from '../i18n/translations';
import { NotificationBanner } from './NotificationBanner'; // ← NotificationBannerをインポート

// 新しい確認ボタン用のコンポーネント
const ConfirmationButtons: React.FC = () => {
  const { confirmationStep, performDetection, resetState } = useCurrencyStore();
  const { t } = useTranslationStore();

  if (!confirmationStep) return null;

  const handleYes = () => {
    if (confirmationStep === 'analyze') {
      performDetection();
    } else if (confirmationStep === 'save') {
      if (window.saveARImage) {
        window.saveARImage();
      } else {
        console.error("Save function not found.");
        resetState(); // Fallback to reset state
      }
    }
  };

  const handleNo = () => {
    resetState();
  };

  const message = confirmationStep === 'analyze' ? t('confirmAnalysis') : t('confirmSave');

  return (
    <div className="confirmation-dialog">
      <p>{message}</p>
      <div className="confirmation-buttons">
        <button onClick={handleNo} className="confirmation-button no">{t('no')}</button>
        <button onClick={handleYes} className="confirmation-button yes">{t('yes')}</button>
      </div>
    </div>
  );
};


interface ControlPanelProps {
  currencyOptions: string[];
  onCapture: () => void; // ★ onCapture propの型定義を追加
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

export const ControlPanel: React.FC<ControlPanelProps> = ({ currencyOptions, onCapture }) => { // ★ onCaptureをpropsから受け取る
  const { 
    status, 
    homeCurrency, 
    localCurrency, 
    setHomeCurrency, 
    setLocalCurrency,
    confirmationStep
  } = useCurrencyStore();
  const { setLanguageForPrompt } = useCurrencyStore();
  const { t, language, setLanguage } = useTranslationStore();

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedCode = event.target.value;
    const selectedLanguage = supportedLanguages.find(lang => lang.code === selectedCode);
    
    if (selectedLanguage) {
      setLanguage(selectedLanguage.code); // For UI translation
      setLanguageForPrompt(selectedLanguage.promptName); // For backend prompt
    }
    else {
      console.log("No language found for code:", selectedCode);
    }
  };

  const getStatusMessage = () => {
    if (status === 'loading') return t('loading');
    if (status === 'analyzing') return t('analyzing');
    if (status === 'error') return t('errorOccurred');
    if (confirmationStep) return t('waitingForInput');
    return t('readyToScan');
  };

  const isControlDisabled = status === 'loading' || status === 'analyzing' || !!confirmationStep;

  return (
    <div className="bottom-section">
      {confirmationStep ? (
        <ConfirmationButtons />
      ) : (
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

          {/* 下段: 言語、ステータス、ボタン */}
          <div className="controls-footer">
            <div className="language-selector">
              {/* ラベルを削除 */}
              <select id="language-select" value={language} onChange={handleLanguageChange}>
                {supportedLanguages.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.name}</option>
                ))}
              </select>
            </div>

            <div className="status-and-button">
              <div className="status-bar">
                
              </div>
              <button
                id="capture-button" // IDを追加
                className="capture-button" // クラス名を変更
                aria-label={t('captureTooltip')}
                disabled={isControlDisabled}
                onClick={onCapture} // ★ onClickイベントハンドラを追加
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};