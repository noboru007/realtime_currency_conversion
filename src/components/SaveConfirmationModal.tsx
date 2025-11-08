import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';

export const SaveConfirmationModal: React.FC = () => {
  const { 
    isSaveModalOpen, 
    savedImageURL, 
    resetState 
  } = useCurrencyStore();
  const { t } = useTranslationStore();

  const handleClose = () => {
    resetState();
  };

  const handlePreview = async () => {
    if (savedImageURL) {
      try {
        // Create a blob from the data URL
        const response = await fetch(savedImageURL);
        const blob = await response.blob();
        
        // Create a temporary URL for the blob
        const url = URL.createObjectURL(blob);
        
        // Open the URL in a new tab
        const newWindow = window.open(url, '_blank');
        
        // Revoke the temporary URL after the new tab has loaded to free up memory
        if (newWindow) {
          newWindow.onload = () => {
            URL.revokeObjectURL(url);
          };
        } else {
          // Fallback for browsers that block popups
          URL.revokeObjectURL(url);
        }
      } catch (error) {
        console.error("Error creating blob for preview:", error);
        // Fallback to opening the data URL directly if blob creation fails
        window.open(savedImageURL, '_blank');
      }
    }
  };

  if (!isSaveModalOpen || !savedImageURL) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>{t('imageSavedTitle')}</h2>
        <p>{t('imageSavedMessage')}</p>
        <div className="modal-thumbnail-container">
          <img src={savedImageURL} alt="Saved" className="modal-thumbnail" />
        </div>
        <div className="modal-actions">
          <button onClick={handlePreview} className="button-secondary">
            {t('previewButton')}
          </button>
          <button onClick={handleClose} className="button-primary">
            {t('closeButton')}
          </button>
        </div>
      </div>
    </div>
  );
};
