// Zustand store for currency conversion state management
import { create } from 'zustand';
import { apiClient, RateData } from '../api/client';
import { useTranslationStore } from './useTranslationStore';
import { db } from '../firebase'; // Firebaseの初期化をインポート
import { doc, onSnapshot, Unsubscribe, getDoc, setDoc, serverTimestamp } from "firebase/firestore"; // Firestore関連の関数をインポート

// バナーの型定義
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
  overlayModel: string;
  overlayThinkingLevel: string;
  imageModel: 'nanobanana2' | 'nanobanana-pro';
  imageThinkingLevel: string;
  imageSize: '1K' | '2K' | '4K';
  translatedImageUrl: string | null;
  translationJobId: string | null;
  translationUnsubscribe: Unsubscribe | null;

  // 状態を更新するためのアクション
  setUserId: (userId: string) => void;
  setOverlayModel: (model: string) => void;
  setOverlayThinkingLevel: (level: string) => void;
  setImageThinkingLevel: (level: string) => void;
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
  setImageSize: (size: '1K' | '2K' | '4K') => void;
  setImageModel: (model: 'nanobanana2' | 'nanobanana-pro') => void;
  listenToJobUpdates: (jobId: string) => void;
  showBanner: (message: string, type: Banner['type']) => void;
  hideBanner: () => void;

  // データ取得などの非同期アクション
  fetchRates: () => Promise<void>;
  loadUserSettings: () => Promise<boolean>;
  saveUserSettings: () => Promise<void>;
  performDetection: (language: string) => Promise<void>;
  performTranslation: (language: string) => Promise<void>;
  resetState: () => void;
  setCalculatedRates: (rates: { localToHome: number | null, homeToLocal: number | null }) => void;
  setTranslatedImageUrl: (url: string | null) => void;
  closeTranslationViewer: () => void;
  listenToTranslationUpdates: (jobId: string) => void;
}

let bannerTimeout: NodeJS.Timeout | null = null;

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
  overlayModel: 'gemini-3-flash-preview',
  overlayThinkingLevel: 'medium',
  imageModel: 'nanobanana2',
  imageThinkingLevel: 'high',
  imageSize: '1K',
  translatedImageUrl: null,
  translationJobId: null,
  translationUnsubscribe: null,

  // --- 状態更新アクション ---
  setUserId: (userId) => set({ userId }),
  setOverlayModel: (model) => set({ overlayModel: model }),
  setOverlayThinkingLevel: (level) => set({ overlayThinkingLevel: level }),
  setImageThinkingLevel: (level) => set({ imageThinkingLevel: level }),
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
  setImageSize: (size) => set({ imageSize: size }),
  setImageModel: (model) => set({ imageModel: model }),
  setTranslatedImageUrl: (url) => set({ translatedImageUrl: url }),

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
    // 1時間以内のキャッシュがあればAPI呼び出しスキップ
    const cachedRatesJson = localStorage.getItem('cachedRates');
    const cachedTimestamp = localStorage.getItem('cachedRatesTimestamp');
    if (cachedRatesJson && cachedTimestamp) {
      const ageMs = Date.now() - parseInt(cachedTimestamp, 10);
      if (ageMs < 60 * 60 * 1000) { // 1時間
        try {
          const cachedRates = JSON.parse(cachedRatesJson);
          const firstKey = Object.keys(cachedRates)[0];
          if (firstKey && cachedRates[firstKey].hasOwnProperty('bid')) {
            set({ rates: cachedRates });
            console.log(`[Rates] Cache HIT (${Math.round(ageMs / 60000)}min old)`);
            return;
          }
        } catch (e) {
          // キャッシュ破損 → 通常フローへ
        }
      }
    }

    try {
      const data = await apiClient.getExchangeRates();
      if (data.rates && data.base_currency === 'USD') {
        set({ rates: data.rates, banner: null });
        localStorage.setItem('cachedRates', JSON.stringify(data.rates));
        localStorage.setItem('cachedRatesTimestamp', Date.now().toString());
        console.log('[Rates] Cache MISS → fetched from API');
      } else {
        throw new Error('Fetched rates data is not in the expected format.');
      }
    } catch (error) {
      console.warn('Failed to fetch new rates, attempting to load from cache.', error);
      // API失敗時はタイムスタンプ関係なくキャッシュを使う
      if (cachedRatesJson) {
        try {
          const cachedRates = JSON.parse(cachedRatesJson);
          const firstKey = Object.keys(cachedRates)[0];
          if (firstKey && cachedRates[firstKey].hasOwnProperty('bid')) {
            set({ rates: cachedRates });
          } else {
            localStorage.removeItem('cachedRates');
            localStorage.removeItem('cachedRatesTimestamp');
            throw new Error('Cached rates data is outdated format.');
          }
        } catch (cacheError) {
          set({ status: 'error', banner: { message: 'rateFetchFailedNoCache', type: 'error' } });
        }
      } else {
        set({ status: 'error', banner: { message: 'rateFetchFailedNoCache', type: 'error' } });
      }
    }
  },

  performDetection: async (language) => {
    const { capturedImage, homeCurrency, localCurrency, localToHomeRate, deviceOrientation, overlayModel, overlayThinkingLevel, resetState } = get();

    if (!capturedImage) return;

    set({ status: 'analyzing', confirmationStep: null, detections: [], jobId: null });

    try {
      // 1. ジョブの開始リクエストを送信
      const response = await apiClient.detectPrices(
        capturedImage,
        homeCurrency,
        language,
        localCurrency,
        localToHomeRate,
        deviceOrientation,
        overlayThinkingLevel,
        overlayModel
      );

      if (response.success && response.jobId) {
        // 2. jobIdをセットし、Firestoreの監視を開始
        set({ jobId: response.jobId });
        get().listenToJobUpdates(response.jobId);
      } else {
        throw new Error(response.error || 'Failed to start detection job.');
      }
    } catch (error: any) {
      console.error("Failed to perform detection:", error);
      get().showBanner('priceDetectionError', 'error');
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
          const jobStatus = doc.get("status");
          switch (jobStatus) {
            case 'completed':
              // .get()を使ってフィールドを明示的に取得する
              const detections = doc.get("detections") || [];
              set({
                detections: detections,
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
              console.error("Detection job failed in backend:", doc.get("error"));
              get().showBanner('priceDetectionError', 'error');
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
        get().showBanner('priceDetectionError', 'error');
        set({ status: 'running' });
        unsub();
        set({ unsubscribe: null });
      }
    );

    set({ unsubscribe: unsub });
  },

  resetState: () => {
    const { unsubscribe } = get();
    if (unsubscribe) {
      unsubscribe();
    }
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
      translatedImageUrl: null,
      translationJobId: null,
    });
  },

  closeTranslationViewer: () => {
    const { translationUnsubscribe } = get();
    if (translationUnsubscribe) {
      translationUnsubscribe();
    }
    set({
      translatedImageUrl: null,
      translationJobId: null,
      translationUnsubscribe: null,
      capturedImage: null,
      confirmationStep: null,
      status: 'running',
    });
  },

  performTranslation: async (language) => {
    const { capturedImage, homeCurrency, localCurrency, localToHomeRate, imageSize, userId, imageThinkingLevel, imageModel, resetState } = get();

    if (!capturedImage) return;

    set({ status: 'analyzing', confirmationStep: null, translatedImageUrl: null, translationJobId: null });

    try {
      const response = await apiClient.translateImage(
        capturedImage,
        language,
        localCurrency,
        homeCurrency,
        localToHomeRate || 1.0,
        userId || '',
        imageSize,
        imageThinkingLevel,
        imageModel,
      );

      if (response.success && response.jobId) {
        set({ translationJobId: response.jobId });
        get().listenToTranslationUpdates(response.jobId);
      } else {
        throw new Error(response.error || 'Failed to start translation job.');
      }
    } catch (error: any) {
      console.error("Failed to perform translation:", error);
      get().showBanner('generationFailed', 'error');
      set({ status: 'running' });
    }
  },

  listenToTranslationUpdates: (jobId) => {
    const { translationUnsubscribe } = get();
    if (translationUnsubscribe) {
      translationUnsubscribe();
    }

    const unsub = onSnapshot(doc(db, "translationJobs", jobId),
      (docSnap) => {
        if (docSnap.exists()) {
          const jobStatus = docSnap.get("status");
          switch (jobStatus) {
            case 'completed':
              const translatedImageUrl = docSnap.get("translatedImageUrl");
              set({
                translatedImageUrl: translatedImageUrl,
                status: 'processed',
              });
              unsub();
              set({ translationUnsubscribe: null });
              break;
            case 'error':
              console.error("Translation job failed:", docSnap.get("error"));
              get().showBanner('generationFailed', 'error');
              set({ status: 'running' });
              unsub();
              set({ translationUnsubscribe: null });
              break;
            case 'processing':
            case 'pending':
              break;
          }
        }
      },
      (error) => {
        console.error("Error listening to translation job:", error);
        get().showBanner('generationFailed', 'error');
        set({ status: 'running' });
        unsub();
        set({ translationUnsubscribe: null });
      }
    );

    set({ translationUnsubscribe: unsub });
  },

  showBanner: (message, type) => {
    if (bannerTimeout) {
      clearTimeout(bannerTimeout);
      bannerTimeout = null;
    }
    set({ banner: { message, type } });
  },

  hideBanner: () => {
    get().resetState();
  },

  setCalculatedRates: (rates) => set({ localToHomeRate: rates.localToHome, homeToLocalRate: rates.homeToLocal }),
}));