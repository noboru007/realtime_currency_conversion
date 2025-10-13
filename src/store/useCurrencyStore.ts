import React from 'react'; // Reactをインポート
import { create } from 'zustand';
import { apiClient, RateData } from '../api/client';

// バナーの型定義
interface Banner {
  message: React.ReactNode;
  type: 'error' | 'warning';
}

// 検出結果の型定義
interface Detection {
  amount: number;
  currency?: string;
  boundingBox: { x: number; y: number; width: number; height: number; };
}

// ストアの状態とアクションの型を定義
interface CurrencyState {
  status: 'loading' | 'running' | 'error';
  banner: Banner | null;
  debugMessage: string | null;
  isPaused: boolean;
  localToHomeRate: number | null; // ← この行を追加
  homeToLocalRate: number | null; // ← この行を追加
  rates: RateData['rates'] | null; // 型を更新
  homeCurrency: string;
  localCurrency: string;
  detections: Detection[];
  
  // 状態を更新するためのアクション
  setStatus: (status: 'loading' | 'running' | 'error') => void;
  setBanner: (banner: Banner | null) => void;
  setDebugMessage: (message: string | null) => void;
  setIsPaused: (isPaused: boolean) => void;
  setHomeCurrency: (currency: string) => void;
  setLocalCurrency: (currency: string) => void;
  setDetections: (detections: Detection[]) => void;
  
  // データ取得などの非同期アクション
  fetchRates: () => Promise<void>;
  setCalculatedRates: (rates: { localToHome: number | null, homeToLocal: number | null }) => void; // ← この行を追加
}

// ストアを作成
export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  // --- 初期状態 ---
  status: 'loading',
  banner: null,
  debugMessage: null,
  isPaused: true, // 初期状態を一時停止に設定
  localToHomeRate: null, // ← この行を追加
  homeToLocalRate: null, // ← この行を追加
  rates: null,
  homeCurrency: 'USD',
  localCurrency: '',
  detections: [],

  // --- 状態更新アクション ---
  setStatus: (status) => set({ status }),
  setBanner: (banner) => set({ banner }),
  setDebugMessage: (message) => set({ debugMessage: message }), 
  setIsPaused: (isPaused) => set({ isPaused }),
  setHomeCurrency: (currency) => set({ homeCurrency: currency }),
  setLocalCurrency: (currency) => set({ localCurrency: currency }),
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
  setCalculatedRates: (rates) => set({ localToHomeRate: rates.localToHome, homeToLocalRate: rates.homeToLocal }), // ← この行を追加
}));