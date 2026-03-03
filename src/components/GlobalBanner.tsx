import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';

export const GlobalBanner: React.FC = () => {
    const { banner, hideBanner } = useCurrencyStore();
    const { t } = useTranslationStore();

    if (!banner) return null;

    const message = t(banner.message as any);

    return (
        <div className="global-banner">
            <div className="global-banner-content">
                <p className="global-banner-message">{message}</p>
                <button onClick={hideBanner} className="global-banner-close">
                    OK
                </button>
            </div>
        </div>
    );
};
