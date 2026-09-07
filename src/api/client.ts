/// <reference types="vite/client" />

// API クライアント設定
// firebase.json の rewrites を使うため、API_BASE_URL は空文字にする
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export interface DetectionRequest {
  image_data: string;
  target_currency: string;
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

export interface ConversionRequest {
  amount: number;
  from_currency: string;
  to_currency: string;
}

export interface ConversionResponse {
  original_amount: number;
  from_currency: string;
  to_currency: string;
  converted_amount: number;
  exchange_rate: number;
}

// API呼び出し関数
export const apiClient = {
  // 価格検出
  async detectPrices(
    imageData: string,
    targetCurrency: string = 'USD',
    language: string = 'English',
    localCurrency: string = '',
    exchangeRate: number | null = 1.0,
    deviceOrientation: 'portrait' | 'landscape' = 'portrait',
    thinkingLevel: string = 'medium',
    overlayModel: string = 'gemini-3-flash-preview',
  ): Promise<DetectionResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/detectPrices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_data: imageData,
          target_currency: targetCurrency,
          language: language,
          local_currency: localCurrency,
          exchange_rate: exchangeRate || 1.0,
          device_orientation: deviceOrientation,
          thinking_level: thinkingLevel,
          overlay_model: overlayModel,
        }),
      });

      if (!response.ok) {
        let errorBody = { message: `API request failed with status ${response.status}` };
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          try {
            errorBody = await response.json();
          } catch (e) {
            console.error("Failed to parse JSON error response:", e);
          }
        }
        const error: any = new Error(errorBody.message || 'API request failed');
        error.response = { data: errorBody, status: response.status };
        throw error;
      }
      return response.json();

    } catch (error: any) {
      // ネットワークエラーなど、fetch自体が失敗した場合
      console.error("API request failed:", error);
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

  // 通貨変換
  async convertCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string
  ): Promise<ConversionResponse> {
    const params = new URLSearchParams({
      amount: amount.toString(),
      from_currency: fromCurrency,
      to_currency: toCurrency,
    });

    const response = await fetch(`${API_BASE_URL}/convert?${params}`);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response.json();
  },

  // ヘルスチェック
  async healthCheck(): Promise<{ status: string; api_key_configured: boolean }> {
    const response = await fetch(`${API_BASE_URL}/health`);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response.json();
  },

  // 緯度・経度から現地通貨コード取得
  async getCurrencyFromLocation(lat: number, lon: number): Promise<{ currency_code: string }> {
    const response = await fetch(`${API_BASE_URL}/getCurrencyFromLocation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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

  // 画像翻訳（Nano Banana 2）
  async translateImage(
    imageData: string,
    language: string,
    localCurrency: string,
    homeCurrency: string,
    exchangeRate: number,
    userId: string,
    imageSize: string = '1K',
    thinkingLevel: string = 'medium',
    imageModel: string = 'nanobanana2',
  ): Promise<DetectionResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/translateImage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_data: imageData,
          language: language,
          local_currency: localCurrency,
          home_currency: homeCurrency,
          exchange_rate: exchangeRate,
          user_id: userId,
          image_size: imageSize,
          thinking_level: thinkingLevel,
          image_model: imageModel,
        }),
      });

      if (!response.ok) {
        let errorBody = { message: `API request failed with status ${response.status}` };
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          try {
            errorBody = await response.json();
          } catch (e) {
            console.error("Failed to parse JSON error response:", e);
          }
        }
        const error: any = new Error(errorBody.message || 'API request failed');
        error.response = { data: errorBody, status: response.status };
        throw error;
      }
      return response.json();

    } catch (error: any) {
      console.error("Translation API request failed:", error);
      const newError: any = new Error(error.message || 'Network error');
      newError.response = error.response || { data: { message: error.message }, status: 500 };
      throw newError;
    }
  },

};