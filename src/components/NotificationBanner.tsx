import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';

export const NotificationBanner: React.FC = () => {
  const { banner, setBanner } = useCurrencyStore();
  const { t } = useTranslationStore();

  if (!banner) {
    return null;
  }

  // banner.messageが翻訳キーかどうかを判定し、そうであれば翻訳する
  const message = typeof banner.message === 'string' 
  ? t(banner.message as any) // as any は型エラーを回避するため
  : banner.message;

  return (
    <div className="top-section">
      <div className={`banner ${banner.type}`}>
      <p>{message}</p> {/* ← メッセージを<p>タグで囲む */}
      <button onClick={() => setBanner(null)}>×</button>
      </div>
    </div>
  );
};