import React from 'react'; // Reactをインポート
import { create } from 'zustand';
import { apiClient, RateData } from '../api/client';
import { useTranslationStore } from './useTranslationStore'; // ★ この行を追加

// バナーの型定義
interface Banner {
  message: React.ReactNode;
  type: 'error' | 'warning' | 'info';
  onClose?: () => void; // ★ onCloseコールバックをオプションとして追加
}

// 検出結果の型定義
export interface Detection {
  amount: number;
  boundingBox: { x: number; y: number; width: number; height: number; };
}

// ストアの状態とアクションの型を定義
interface CurrencyState {
  status: 'loading' | 'running' | 'analyzing' | 'confirming' | 'saving' | 'error';
  banner: Banner | null;
  capturedImage: string | null;
  processedImage: string | null; // Add this line
  confirmationStep: 'analyze' | 'save' | null;
  localToHomeRate: number | null;
  homeToLocalRate: number | null;
  rates: RateData['rates'] | null;
  homeCurrency: string;
  localCurrency: string;
  languageForPrompt: string; // language を追加
  detections: Detection[];
  
  // 状態を更新するためのアクション
  setStatus: (status: CurrencyState['status']) => void;
  setBanner: (banner: Banner | null) => void;
  setCapturedImage: (image: string | null) => void;
  setProcessedImage: (image: string | null) => void; // Add this line
  setConfirmationStep: (step: CurrencyState['confirmationStep']) => void;
  setHomeCurrency: (currency: string) => void;
  setLocalCurrency: (currency: string) => void;
  setLanguageForPrompt: (language: string) => void;
  setDetections: (detections: Detection[]) => void;
  
  // データ取得などの非同期アクション
  fetchRates: () => Promise<void>;
  performDetection: () => Promise<void>;
  resetState: () => void;
  setCalculatedRates: (rates: { localToHome: number | null, homeToLocal: number | null }) => void; // ← この行を追加
}

// ストアを作成
export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  // --- 初期状態 ---
  status: 'loading',
  banner: null,
  capturedImage: null,
  processedImage: null, // Add this line
  confirmationStep: null,
  localToHomeRate: null,
  homeToLocalRate: null,
  rates: null,
  homeCurrency: 'USD',
  localCurrency: '',
  languageForPrompt: 'English',
  detections: [],

  // --- 状態更新アクション ---
  setStatus: (status) => set({ status }),
  setBanner: (banner) => set({ banner }),
  setCapturedImage: (image) => set({ capturedImage: image, detections: [], processedImage: null }), // Reset processedImage
  setProcessedImage: (image) => set({ processedImage: image }), // Add this line
  setConfirmationStep: (step) => set({ confirmationStep: step }),
  setHomeCurrency: (currency) => set({ homeCurrency: currency }),
  setLocalCurrency: (currency) => set({ localCurrency: currency }),
  setLanguageForPrompt: (language) => set({ languageForPrompt: language }),
  setDetections: (detections) => set({ detections }),
  
  // --- 非同期アクション ---
  fetchRates: async () => {
    try {
      const data = await apiClient.getExchangeRates();
      // レスポンスの構造が変わったため、 'USD' が存在するかどうかでチェック
      if (data.rates && data.base_currency === 'USD') {
        set({ rates: data.rates });
        localStorage.setItem('cachedRates', JSON.stringify(data.rates));
        set({ banner: null }); // 成功したら過去の警告バナーを消す
      } else {
        // もし古い形式のキャッシュが残っていた場合に備える
        throw new Error('Fetched rates data is not in the expected format.');
      }
    } catch (error) {
      console.warn('Failed to fetch new rates, attempting to load from cache.', error);
      const cachedRatesJson = localStorage.getItem('cachedRates');
      if (cachedRatesJson) {
        try {
            const cachedRates = JSON.parse(cachedRatesJson);
            // 簡単なキャッシュの形式チェック
            const firstKey = Object.keys(cachedRates)[0];
            if (firstKey && cachedRates[firstKey].hasOwnProperty('bid')) {
              set({ rates: cachedRates });
              set({ banner: { message: 'rateFetchFailedCacheUsed', type: 'warning' } }); // t() を外してキーを直接渡す
            } else {
                // 古い形式のキャッシュは使えないのでエラーとする
                localStorage.removeItem('cachedRates');
                throw new Error('Cached rates data is outdated format.');
            }
        } catch (cacheError) {
          set({ status: 'error', banner: { message: 'rateFetchFailedNoCache', type: 'error' } }); // t() を外してキーを直接渡す
        }
      } else {
        set({ status: 'error', banner: { message: 'rateFetchFailedNoCache', type: 'error' } });
      }
    }
  },

  performDetection: async () => {
    const { capturedImage, homeCurrency, languageForPrompt, localToHomeRate, resetState } = get();
    const t = useTranslationStore.getState().t;

    if (!capturedImage) return;
      
    set({ status: 'analyzing', confirmationStep: null, detections: [] });

    try {
      const response = await apiClient.detectPrices(
        capturedImage,
        homeCurrency,
        localToHomeRate,
        languageForPrompt
      );
      if (response.success && response.image) {
        set({ 
          detections: response.detections || [], 
          processedImage: response.image,
          status: 'confirming', 
          confirmationStep: 'save' 
        });
      } else {
        // 検出結果が0件だった場合は、エラーとして処理する
        set({
          status: 'running',
          banner: {
            message: t('priceDetectionError'), // 「価格を検出できませんでした」
            type: 'error',
            onClose: () => {
              // OK を押したら、状態を完全にリセットし、バナーを閉じる
              set({
                capturedImage: null,
                detections: [],
                confirmationStep: null,
                status: 'running',
                banner: null,
              });
            }
          }
        });
      }
    } catch (error:any) {
      // ★ デバッグ用にエラーオブジェクト全体をコンソールに出力
      console.log("Caught an error in performDetection:", error);

      // ★ エラーレスポンスの存在をより安全にチェック
      const errorData = error?.response?.data;

      // if (error.response && error.response.data && error.response.data.error === 'timeout') {
        if (errorData && errorData.error === 'timeout') {
          // --- タイムアウトエラーの処理 ---
          set({
            status: 'running',
            banner: {
              message: t('priceDetectionTimeout'),
              type: 'error',
              onClose: () => {
                // OK を押したら、解析確認ステップに戻り、バナーを閉じる
                set({ confirmationStep: 'analyze', banner: null });
              }
            }
          });
        } else {
          // --- タイムアウト以外の一般的なエラー処理 ---
          set({
            status: 'running',
            banner: {
              message: t('priceDetectionError'),
              type: 'error',
              onClose: () => {
                // OK を押したら、状態を完全にリセットし、バナーを閉じる
                set({
                  capturedImage: null,
                  detections: [],
                  confirmationStep: null,
                  status: 'running',
                  banner: null,
                });
              }
            }
          });
        }
    }
},

  resetState: () => {
    set({
      capturedImage: null,
      processedImage: null, // Add this line
      detections: [],
      confirmationStep: null,
      status: 'running',
    });
  },

  setCalculatedRates: (rates) => set({ localToHomeRate: rates.localToHome, homeToLocalRate: rates.homeToLocal }), // ← この行を追加
}));