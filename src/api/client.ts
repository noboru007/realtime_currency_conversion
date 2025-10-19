/// <reference types="vite/client" />

// API クライアント設定
// firebase.json の rewrites を使うため、API_BASE_URL は空文字にする
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export interface DetectionRequest {
  image_data: string;
  target_currency: string;
}

export interface DetectionResponse {
  detections: Array<{
    amount: number;
    boundingBox: { x: number; y: number; width: number; height: number; };
  }>;
  success: boolean;
  image: string; // Base64 encoded image string
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
    exchangeRate: number | string = 1,
    language: string = 'English'
  ): Promise<DetectionResponse> {
    const response = await fetch(`${API_BASE_URL}/detectPrices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_data: imageData,
        target_currency: targetCurrency,
        exchange_rate: String(exchangeRate),
        language: language,
      }),
    });

    if (!response.ok) {
      // バックエンドからのエラーレスポンス(JSON)を取得
      const errorBody = await response.json();

      // useCurrencyStoreがエラーを正しく解釈できるよう、
      // Axiosのエラーオブジェクトの構造を模倣してエラーをスローする
      const error: any = new Error(errorBody.message || 'API request failed');
      error.response = {
        data: errorBody,
        status: response.status
      };
      
      throw error;
    }
    return response.json();
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

};