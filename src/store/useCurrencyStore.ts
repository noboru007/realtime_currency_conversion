import React from 'react'; // Reactをインポート
import { create } from 'zustand';
import { apiClient, RateData } from '../api/client';
import { useTranslationStore } from './useTranslationStore'; // ★ この行を追加
import { db } from '../firebase'; // Firebaseの初期化をインポート
import { doc, onSnapshot, Unsubscribe, getDoc, setDoc, serverTimestamp } from "firebase/firestore"; // Firestore関連の関数をインポート

// バナーの型定義
interface Banner {
  message: string;
  type: 'error' | 'warning' | 'info';
}

// 検出結果の型定義
export interface Detection {
  amount: number;
  boundingBox: { x: number; y: number; width: number; height: number; };
}

// ストアの状態とアクションの型を定義
interface CurrencyState {
  status: 'loading' | 'running' | 'analyzing' | 'processed' | 'error';
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
  jobId: string | null;
  unsubscribe: Unsubscribe | null; // Firestoreの監視を解除する関数
  userId: string | null; // ★ 追加
  
  // 状態を更新するためのアクション
  setUserId: (userId: string) => void; // ★ 追加
  setStatus: (status: CurrencyState['status']) => void;
  setBanner: (banner: Banner | null) => void;
  setCapturedImage: (image: string | null) => void;
  setProcessedImage: (image: string | null) => void; // Add this line
  setConfirmationStep: (step: CurrencyState['confirmationStep']) => void;
  setHomeCurrency: (currency: string) => void;
  setLocalCurrency: (currency: string) => void;
  setLanguageForPrompt: (language: string) => void;
  setDetections: (detections: Detection[]) => void;
  setJobId: (jobId: string | null) => void;
  listenToJobUpdates: (jobId: string) => void;
  showBanner: (message: string, type: Banner['type']) => void;
  hideBanner: () => void;
  
  // データ取得などの非同期アクション
  fetchRates: () => Promise<void>;
  loadUserSettings: () => Promise<boolean>; // ★ 追加
  saveUserSettings: () => Promise<void>; // ★ 追加
  performDetection: () => Promise<void>;
  resetState: () => void;
  setCalculatedRates: (rates: { localToHome: number | null, homeToLocal: number | null }) => void; // ← この行を追加
}

let bannerTimeout: NodeJS.Timeout | null = null;

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
  jobId: null,
  unsubscribe: null,
  userId: null, // ★ 追加

  // --- 状態更新アクション ---
  setUserId: (userId) => set({ userId }), // ★ 追加
  setStatus: (status) => set({ status }),
  setBanner: (banner) => set({ banner }),
  setCapturedImage: (image) => set({ capturedImage: image, detections: [], processedImage: null }), // Reset processedImage
  setProcessedImage: (image) => set({ processedImage: image }), // Add this line
  setConfirmationStep: (step) => set({ confirmationStep: step }),
  setHomeCurrency: (currency) => set({ homeCurrency: currency }),
  setLocalCurrency: (currency) => set({ localCurrency: currency }),
  setLanguageForPrompt: (language) => set({ languageForPrompt: language }),
  setDetections: (detections) => set({ detections }),
  setJobId: (jobId) => set({ jobId }),
  
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
        if (updatedAt && (new Date().getTime() - updatedAt.getTime()) < 7 * 24 * 60 * 60 * 1000) {
          // 7日以内の設定があれば適用
          if (settings.homeCurrency) set({ homeCurrency: settings.homeCurrency });
          if (settings.language) useTranslationStore.getState().setLanguage(settings.language);
          // console.log("Loaded user settings from Firestore:", settings);
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
      console.log("Saved user settings to Firestore.");
    } catch (error) {
      console.error("Error saving user settings:", error);
    }
  },

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
              // 以下の行を削除またはコメントアウト
              // set({ banner: { message: 'rateFetchFailedCacheUsed', type: 'warning' } });
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
    const { capturedImage, homeCurrency, languageForPrompt, localCurrency, localToHomeRate, resetState } = get();

    if (!capturedImage) return;
      
    set({ status: 'analyzing', confirmationStep: null, detections: [], jobId: null });

    try {
      // 1. ジョブの開始リクエストを送信
      const response = await apiClient.detectPrices(
        capturedImage,
        homeCurrency,
        languageForPrompt,
        localCurrency,
        localToHomeRate
      );

      if (response.success && response.jobId) {
        // 2. jobIdをセットし、Firestoreの監視を開始
        set({ jobId: response.jobId });
        get().listenToJobUpdates(response.jobId);
      } else {
        throw new Error(response.error || 'Failed to start detection job.');
      }
    } catch (error:any) {
      console.error("Failed to perform detection:", error);
      get().showBanner('priceDetectionError', 'error'); // ★ t()を削除し、翻訳キーを直接渡す
      set({ status: 'running' });
    }
  },

  listenToJobUpdates: (jobId) => {
    // 既存の監視があれば解除
    const { unsubscribe } = get();
    if (unsubscribe) {
      unsubscribe();
    }

    const unsub = onSnapshot(doc(db, "detectionJobs", jobId), 
      (doc) => {
        if (doc.exists()) {
          const jobData = doc.data();
          switch (jobData.status) {
            case 'completed':
              const detections = jobData.detections || [];
              set({ 
                detections: detections, 
                processedImage: jobData.processedImageUri,
                status: 'processed',
              });
              if (detections.length > 0) {
                set({ confirmationStep: 'save' });
              } else {
                get().showBanner('priceNotDetected', 'warning');
              }
              unsub();
              set({ unsubscribe: null });
              break;
            case 'error':
              console.error("Detection job failed in backend:", jobData.error);
              get().showBanner('priceDetectionError', 'error'); // ★ t()を削除し、翻訳キーを直接渡す
              set({ status: 'running' });
              unsub();
              set({ unsubscribe: null });
              break;
            case 'processing':
            case 'pending':
              // 処理中は特に何もしない（UIは'analyzing'のまま）
              break;
          }
        }
      },
      (error) => {
        console.error("Error listening to job updates:", error);
        get().showBanner('priceDetectionError', 'error'); // ★ t()を削除し、翻訳キーを直接渡す
        set({ status: 'running' });
        unsub();
        set({ unsubscribe: null });
      }
    );

    set({ unsubscribe: unsub });
  },

  resetState: () => {
    // console.log("--- RESET STATE CALLED ---", new Error().stack); // 呼び出し元を特定するためのログ
    const { unsubscribe } = get();
    if (unsubscribe) {
      unsubscribe(); // Firestoreの監視を解除
    }
    set({
      banner: null, // resetState時に直接バナーも消す
      capturedImage: null,
      processedImage: null,
      detections: [],
      confirmationStep: null,
      status: 'running',
      jobId: null,
      unsubscribe: null,
    });
  },

  showBanner: (message, type) => {
    if (bannerTimeout) {
      clearTimeout(bannerTimeout);
      bannerTimeout = null;
    }
    set({ banner: { message, type } });
  },

  hideBanner: () => {
    // バナーを閉じたら、関連する状態をリセットして初期状態に戻す
    get().resetState();
  },

  setCalculatedRates: (rates) => set({ localToHomeRate: rates.localToHome, homeToLocalRate: rates.homeToLocal }), // ← この行を追加
}));