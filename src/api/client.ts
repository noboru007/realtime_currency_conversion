/// <reference types="vite/client" />

// API クライアント設定
// firebase.json の rewrites を使うため、API_BASE_URL は空文字にする
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export interface DetectPricesParams {
  imageData: string;
  targetCurrency: string;
  language: string;
  localCurrency: string;
  exchangeRate: number | null;
  deviceOrientation: 'portrait' | 'landscape';
  thinkingLevel: string;
}

export interface DetectionResponse {
  success: boolean;
  jobId?: string; // jobIdはオプション（成功時のみ存在）
  error?: string;
}

export interface Rate {
  bid: number;
  ask: number;
}

export interface RateData {
  rates: { [pair: string]: Rate };
  timestamp_unix: number;
  timestamp_jst: string;
  base_currency: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// API呼び出し関数
export const apiClient = {
  // 価格検出（バックグラウンドジョブの開始）
  async detectPrices(params: DetectPricesParams): Promise<DetectionResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/detectPrices`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          image_data: params.imageData,
          target_currency: params.targetCurrency,
          language: params.language,
          local_currency: params.localCurrency,
          exchange_rate: params.exchangeRate || 1.0,
          device_orientation: params.deviceOrientation,
          thinking_level: params.thinkingLevel,
        }),
      });

      if (!response.ok) {
        let errorBody = { message: `API request failed with status ${response.status}` };
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          try {
            errorBody = await response.json();
          } catch (e) {
            console.error('Failed to parse JSON error response:', e);
          }
        }
        const error: any = new Error(errorBody.message || 'API request failed');
        error.response = { data: errorBody, status: response.status };
        throw error;
      }
      return response.json();

    } catch (error: any) {
      // ネットワークエラーなど、fetch自体が失敗した場合
      console.error('API request failed:', error);
      const newError: any = new Error(error.message || 'Network error');
      newError.response = error.response || { data: { message: error.message }, status: 500 };
      throw newError;
    }
  },

  // 為替レート取得
  async getExchangeRates(): Promise<RateData> {
    const response = await fetch(`${API_BASE_URL}/getExchangeRates`);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response.json();
  },

  // 緯度・経度から現地通貨コード取得
  async getCurrencyFromLocation(lat: number, lon: number): Promise<{ currency_code: string }> {
    const response = await fetch(`${API_BASE_URL}/getCurrencyFromLocation`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ lat, lon }),
    });
    if (!response.ok) {
      throw new Error('API request failed');
    }
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to get currency from location');
    }
    return data;
  },

};
