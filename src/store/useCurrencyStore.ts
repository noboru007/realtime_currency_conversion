// Zustand store for currency conversion state management
import { create } from 'zustand';
import { apiClient, RateData } from '../api/client';
import { useTranslationStore } from './useTranslationStore';
import { db } from '../firebase';
import { doc, onSnapshot, Unsubscribe, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

// ユーザー設定の有効期限（7日間）
const USER_SETTINGS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// バナーの型定義（messageには翻訳キーを渡す）
interface Banner {
  message: string;
  type: 'error' | 'warning' | 'info';
}

// 検出結果の型定義
export interface Detection {
  itemText: string;
  itemBox: number[];
  priceText: string;
  priceBox: number[];
}

// ストアの状態とアクションの型を定義
interface CurrencyState {
  status: 'loading' | 'running' | 'analyzing' | 'processed' | 'error';
  banner: Banner | null;
  capturedImage: string | null;
  confirmationStep: 'analyze' | 'save' | null;
  localToHomeRate: number | null;
  homeToLocalRate: number | null;
  rates: RateData['rates'] | null;
  homeCurrency: string;
  localCurrency: string;
  detections: Detection[];
  jobId: string | null;
  unsubscribe: Unsubscribe | null;
  userId: string | null;
  isSaveModalOpen: boolean;
  savedImageURL: string | null;
  deviceOrientation: 'portrait' | 'landscape';
  thinkingLevel: string;

  // 状態を更新するためのアクション
  setUserId: (userId: string) => void;
  setThinkingLevel: (level: string) => void;
  setStatus: (status: CurrencyState['status']) => void;
  setBanner: (banner: Banner | null) => void;
  setCapturedImage: (image: string | null) => void;
  setConfirmationStep: (step: CurrencyState['confirmationStep']) => void;
  setHomeCurrency: (currency: string) => void;
  setLocalCurrency: (currency: string) => void;
  setDetections: (detections: Detection[]) => void;
  setJobId: (jobId: string | null) => void;
  setSaveModalOpen: (isOpen: boolean) => void;
  setSavedImageURL: (url: string | null) => void;
  setDeviceOrientation: (orientation: 'portrait' | 'landscape') => void;
  listenToJobUpdates: (jobId: string) => void;
  showBanner: (message: string, type: Banner['type']) => void;
  hideBanner: () => void;

  // データ取得などの非同期アクション
  fetchRates: () => Promise<void>;
  loadUserSettings: () => Promise<boolean>;
  saveUserSettings: () => Promise<void>;
  performDetection: (language: string) => Promise<void>;
  resetState: () => void;
  setCalculatedRates: (rates: { localToHome: number | null, homeToLocal: number | null }) => void;
}

// ストアを作成
export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  // --- 初期状態 ---
  status: 'loading',
  banner: null,
  capturedImage: null,
  confirmationStep: null,
  localToHomeRate: null,
  homeToLocalRate: null,
  rates: null,
  homeCurrency: 'USD',
  localCurrency: '',
  detections: [],
  jobId: null,
  unsubscribe: null,
  userId: null,
  isSaveModalOpen: false,
  savedImageURL: null,
  deviceOrientation: 'portrait',
  thinkingLevel: 'medium',

  // --- 状態更新アクション ---
  setUserId: (userId) => set({ userId }),
  setThinkingLevel: (level) => set({ thinkingLevel: level }),
  setStatus: (status) => set({ status }),
  setBanner: (banner) => set({ banner }),
  setCapturedImage: (image) => set({ capturedImage: image, detections: [] }),
  setConfirmationStep: (step) => set({ confirmationStep: step }),
  setHomeCurrency: (currency) => set({ homeCurrency: currency }),
  setLocalCurrency: (currency) => set({ localCurrency: currency }),
  setDetections: (detections) => set({ detections }),
  setJobId: (jobId) => set({ jobId }),
  setSaveModalOpen: (isOpen) => set({ isSaveModalOpen: isOpen }),
  setSavedImageURL: (url) => set({ savedImageURL: url }),
  setDeviceOrientation: (orientation) => set({ deviceOrientation: orientation }),

  // --- 非同期アクション ---
  loadUserSettings: async () => {
    const { userId } = get();
    if (!userId) return false;

    const settingsRef = doc(db, "userSettings", userId);
    try {
      const docSnap = await getDoc(settingsRef);
      if (docSnap.exists()) {
        const settings = docSnap.data();
        const updatedAt = settings.updatedAt?.toDate();
        if (updatedAt && (Date.now() - updatedAt.getTime()) < USER_SETTINGS_TTL_MS) {
          // 有効期限内の設定があれば適用
          if (settings.homeCurrency) set({ homeCurrency: settings.homeCurrency });
          if (settings.language) useTranslationStore.getState().setLanguage(settings.language);
          return true;
        }
      }
    } catch (error) {
      console.error("Error loading user settings:", error);
    }
    return false;
  },

  saveUserSettings: async () => {
    const { userId, homeCurrency } = get();
    const { language } = useTranslationStore.getState();
    if (!userId) return;

    const settingsRef = doc(db, "userSettings", userId);
    try {
      await setDoc(settingsRef, {
        homeCurrency,
        language,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.error("Error saving user settings:", error);
    }
  },

  fetchRates: async () => {
    try {
      const data = await apiClient.getExchangeRates();
      if (data.rates && data.base_currency === 'USD') {
        set({ rates: data.rates, banner: null });
        localStorage.setItem('cachedRates', JSON.stringify(data.rates));
      } else {
        throw new Error('Fetched rates data is not in the expected format.');
      }
    } catch (error) {
      console.warn('Failed to fetch new rates, attempting to load from cache.', error);
      const cachedRatesJson = localStorage.getItem('cachedRates');
      try {
        if (!cachedRatesJson) {
          throw new Error('No cached rates available.');
        }
        const cachedRates = JSON.parse(cachedRatesJson);
        // 簡単なキャッシュの形式チェック（bid/ask形式でない古いキャッシュは破棄）
        const firstKey = Object.keys(cachedRates)[0];
        if (!firstKey || !cachedRates[firstKey].hasOwnProperty('bid')) {
          localStorage.removeItem('cachedRates');
          throw new Error('Cached rates data is outdated format.');
        }
        set({ rates: cachedRates });
      } catch (cacheError) {
        set({ status: 'error', banner: { message: 'rateFetchFailedNoCache', type: 'error' } });
      }
    }
  },

  performDetection: async (language) => {
    const { capturedImage, homeCurrency, localCurrency, localToHomeRate, deviceOrientation, thinkingLevel } = get();

    if (!capturedImage) return;

    set({ status: 'analyzing', confirmationStep: null, detections: [], jobId: null });

    try {
      // 1. ジョブの開始リクエストを送信
      const response = await apiClient.detectPrices({
        imageData: capturedImage,
        targetCurrency: homeCurrency,
        language,
        localCurrency,
        exchangeRate: localToHomeRate,
        deviceOrientation,
        thinkingLevel,
      });

      if (response.success && response.jobId) {
        // 2. jobIdをセットし、Firestoreの監視を開始
        set({ jobId: response.jobId });
        get().listenToJobUpdates(response.jobId);
      } else {
        throw new Error(response.error || 'Failed to start detection job.');
      }
    } catch (error) {
      console.error("Failed to perform detection:", error);
      get().showBanner('priceDetectionError', 'error');
      set({ status: 'running' });
    }
  },

  listenToJobUpdates: (jobId) => {
    // 既存の監視があれば解除
    get().unsubscribe?.();

    const unsub = onSnapshot(doc(db, "detectionJobs", jobId),
      (doc) => {
        if (!doc.exists()) return;

        const stopListening = () => {
          unsub();
          set({ unsubscribe: null });
        };

        switch (doc.get("status")) {
          case 'completed': {
            const detections: Detection[] = doc.get("detections") || [];
            set({ detections, status: 'processed' });
            if (detections.length > 0) {
              set({ confirmationStep: 'save' });
            } else {
              get().showBanner('priceNotDetected', 'warning');
            }
            stopListening();
            break;
          }
          case 'error':
            console.error("Detection job failed in backend:", doc.get("error"));
            get().showBanner('priceDetectionError', 'error');
            set({ status: 'running' });
            stopListening();
            break;
          case 'processing':
          case 'pending':
            // 処理中は特に何もしない（UIは'analyzing'のまま）
            break;
        }
      },
      (error) => {
        console.error("Error listening to job updates:", error);
        get().showBanner('priceDetectionError', 'error');
        set({ status: 'running' });
        unsub();
        set({ unsubscribe: null });
      }
    );

    set({ unsubscribe: unsub });
  },

  resetState: () => {
    get().unsubscribe?.();
    set({
      banner: null,
      capturedImage: null,
      detections: [],
      confirmationStep: null,
      status: 'running',
      jobId: null,
      unsubscribe: null,
      isSaveModalOpen: false,
      savedImageURL: null,
      deviceOrientation: 'portrait',
    });
  },

  showBanner: (message, type) => set({ banner: { message, type } }),

  hideBanner: () => {
    get().resetState();
  },

  setCalculatedRates: (rates) => set({ localToHomeRate: rates.localToHome, homeToLocalRate: rates.homeToLocal }),
}));
