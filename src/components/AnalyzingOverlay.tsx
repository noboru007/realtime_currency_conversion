import React from 'react';
import { useTranslationStore } from '../store/useTranslationStore';

export const AnalyzingOverlay: React.FC = () => {
    const { t } = useTranslationStore();
    return (
        <div className="analyzing-overlay">
            <div className="analyzing-spinner"></div>
            <p>{t('analyzing')}</p>
        </div>
    );
};
