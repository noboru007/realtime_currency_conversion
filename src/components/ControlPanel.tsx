import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';
import { supportedLanguages } from '../i18n/translations';

interface ConfirmationButtonsProps {
  onSaveImage: () => void;
}

const ConfirmationButtons: React.FC<ConfirmationButtonsProps> = ({ onSaveImage }) => {
  const { confirmationStep, performDetection, performTranslation, resetState } = useCurrencyStore();
  const { t, language } = useTranslationStore();

  if (!confirmationStep) return null;

  const getLanguageForPrompt = () => {
    const selectedLanguage = supportedLanguages.find(lang => lang.code === language);
    return selectedLanguage ? selectedLanguage.promptName : 'English';
  };

  const handleOverlay = () => {
    if (confirmationStep === 'analyze') {
      performDetection(getLanguageForPrompt());
    } else if (confirmationStep === 'save') {
      onSaveImage();
    }
  };

  const handleImageGeneration = () => {
    if (confirmationStep === 'analyze') {
      performTranslation(getLanguageForPrompt());
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
        {confirmationStep === 'analyze' && (
          <button onClick={handleImageGeneration} className="confirmation-button generate">
            {t('imageGeneration')}
          </button>
        )}
        <button onClick={handleOverlay} className="confirmation-button yes">
          {confirmationStep === 'analyze' ? t('overlay') : t('yes')}
        </button>
      </div>
    </div>
  );
};

interface ControlPanelProps {
  onCapture: () => void;
  onSaveImage: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ onCapture, onSaveImage }) => {
  const { status, confirmationStep, setCapturedImage, setConfirmationStep } = useCurrencyStore();
  const { t } = useTranslationStore();

  const getStatusMessage = () => {
    if (status === 'loading') return t('loading');
    if (status === 'analyzing') return t('generating');
    if (status === 'error') return t('errorOccurred');
    if (confirmationStep) return t('waitingForInput');
    return t('readyToScan');
  };

  const isControlDisabled = status === 'loading' || status === 'analyzing' || !!confirmationStep;

  // ファイルアップロード
  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setCapturedImage(reader.result as string);
        setConfirmationStep('analyze');
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

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
            <div className="capture-row">
              <button
                id="upload-button"
                className="upload-button"
                aria-label={t('uploadImage')}
                disabled={isControlDisabled}
                onClick={handleUpload}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </button>
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
        </div>
      )}
    </div>
  );
};