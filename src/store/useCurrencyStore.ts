import { create } from 'zustand';
import { apiClient, RateData } from '../api/client'; // apiClientをインポート

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
  rates: RateData['rates'] | null; 
  homeCurrency: string;
  localCurrency: string;
  detections: Detection[];
  
  // 状態を更新するためのアクション
  setStatus: (status: 'loading' | 'running' | 'error') => void;
  setBanner: (banner: Banner | null) => void;
  setHomeCurrency: (currency: string) => void;
  setLocalCurrency: (currency: string) => void;
  setDetections: (detections: Detection[]) => void;
  
  // データ取得などの非同期アクション
  fetchRates: () => Promise<void>;
}

// ストアを作成
export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  // --- 初期状態 ---
  status: 'loading',
  banner: null,
  rates: null,
  homeCurrency: 'USD',
  localCurrency: '',
  detections: [],

  // --- 状態更新アクション ---
  setStatus: (status) => set({ status }),
  setBanner: (banner) => set({ banner }),
  setHomeCurrency: (currency) => set({ homeCurrency: currency }),
  setLocalCurrency: (currency) => set({ localCurrency: currency }),
  setDetections: (detections) => set({ detections }),
  
  // --- 非同期アクション ---
  fetchRates: async () => {
    try {
      const data = await apiClient.getExchangeRates();
      set({ rates: data.rates });
      localStorage.setItem('cachedRates', JSON.stringify(data.rates));
      
      // デフォルトの自国通貨を設定するロジック
      if (!data.rates['USD'] && Object.keys(data.rates).length > 0) {
        set({ homeCurrency: Object.keys(data.rates)[0] });
      }
      set({ banner: null }); // 成功したら過去の警告バナーを消す
    } catch (error) {
      console.warn('Failed to fetch new rates, attempting to load from cache.', error);
      const cachedRatesJson = localStorage.getItem('cachedRates');
      if (cachedRatesJson) {
        const cachedRates = JSON.parse(cachedRatesJson) as Record<string, number>;
        set({ rates: cachedRates });
        set({ banner: { message: '為替レートの取得に失敗。前回保存したデータを使用しています。', type: 'warning' } });
      } else {
        set({ status: 'error', banner: { message: '為替レートの取得に失敗し、保存されたデータもありません。', type: 'error' } });
      }
    }
  },
}));