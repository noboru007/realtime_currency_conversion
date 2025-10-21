import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';

const NotificationBanner: React.FC = () => {
  const { banner, hideBanner } = useCurrencyStore();
  const { t } = useTranslationStore();

  if (!banner) return null;

  // メッセージキーを翻訳
  const message = t(banner.message as any);

  return (
    <div className={`notification-banner ${banner.type}`}>
      <span>{message}</span>
      <button onClick={hideBanner}>×</button>
    </div>
  );
};

export default NotificationBanner;