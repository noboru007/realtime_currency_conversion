import { create } from 'zustand';
import { translations, supportedLanguages } from '../i18n/translations';

// キーの型を定義
type TranslationKey = keyof (typeof translations)['en'];

interface TranslationState {
  language: string;
  setLanguage: (language: string) => void;
  t: (key: TranslationKey) => string;
}

// ブラウザの言語設定から初期言語を決定
const getDefaultLanguage = (): string => {
  const browserLang = navigator.language.split('-')[0]; // 'ja-JP' -> 'ja'
  const isSupported = supportedLanguages.some(lang => lang.code === browserLang);
  const defaultLang = isSupported ? browserLang : 'en'; // サポート外なら英語をデフォルトに
  return defaultLang;
};

export const useTranslationStore = create<TranslationState>((set, get) => ({
  language: getDefaultLanguage(),
  
  setLanguage: (language: string) => set({ language }),
  
  t: (key: TranslationKey): string => {
    const { language } = get();
    // 型安全性を確保
    const langTranslations = translations[language as keyof typeof translations] || translations.en;
    return langTranslations[key] || translations.en[key] || key;
  },
}));