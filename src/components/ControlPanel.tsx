import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';
import { supportedLanguages } from '../i18n/translations';

interface ConfirmationButtonsProps {
  onSaveImage: () => void;
}

const ConfirmationButtons: React.FC<ConfirmationButtonsProps> = ({ onSaveImage }) => {
  const { confirmationStep, performDetection, resetState } = useCurrencyStore();
  const { t, language } = useTranslationStore();

  if (!confirmationStep) return null;

  const handleYes = () => {
    if (confirmationStep === 'analyze') {
      const selectedLanguage = supportedLanguages.find(lang => lang.code === language);
      const languageForPrompt = selectedLanguage ? selectedLanguage.promptName : 'English';
      performDetection(languageForPrompt);
    } else if (confirmationStep === 'save') {
      onSaveImage();
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
  onCapture: () => void;
  onSaveImage: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ onCapture, onSaveImage }) => {
  const { status, confirmationStep } = useCurrencyStore();
  const { t } = useTranslationStore();

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
        <ConfirmationButtons onSaveImage={onSaveImage} />
      ) : (
        <div className="controls">
          <div className="controls-footer">
            <div className="status-bar">
              <p>{getStatusMessage()}</p>
            </div>
            <button
              id="capture-button"
              className="capture-button"
              aria-label={t('captureTooltip')}
              disabled={isControlDisabled}
              onClick={onCapture}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};