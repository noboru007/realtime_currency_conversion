// API クライアント設定
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export interface DetectionRequest {
  image_data: string;
  target_currency: string;
}

export interface DetectionResponse {
  detections: Array<{
    amount: number;
    boundingBox: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
  success: boolean;
  error?: string;
}

export interface RateData {
  rates: { [currency: string]: number };
  timestamp: string;
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
  async detectPrices(imageData: string, targetCurrency: string = 'USD'): Promise<DetectionResponse> {
    const response = await fetch(`${API_BASE_URL}/detect-prices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_data: imageData,
        target_currency: targetCurrency,
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response.json();
  },

  // 為替レート取得
  async getExchangeRates(): Promise<RateData> {
    const response = await fetch(`${API_BASE_URL}/exchange-rates`);

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
};
