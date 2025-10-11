import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';

export const NotificationBanner: React.FC = () => {
  const { banner, setBanner } = useCurrencyStore();

  if (!banner) {
    return null;
  }

  return (
    <div className="top-section">
      <div className={`banner ${banner.type}`}>
        {banner.message}
        <button onClick={() => setBanner(null)}>×</button>
      </div>
    </div>
  );
};