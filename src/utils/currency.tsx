import { RateData } from '../api/client';

/**
 * 2つの通貨間の為替レート（Bid/Ask）を取得します。
 * @param from 売る通貨 (例: 'JPY', 'GBP')
 * @param to 買う通貨 (例: 'USD')
 * @param rates レート情報オブジェクト (USDが基準)
 * @returns { bid: number, ask: number } 形式のレートオブジェクト。見つからない場合はnull。
 */
export const getExchangeRate = (from: string, to: string, rates: RateData['rates'] | null): { bid: number, ask: number } | null => {
  if (!rates) return null;
  if (from === to) return { bid: 1, ask: 1 };

  const base = 'USD';

  // Case 1: 'from'が基準通貨 (例: USD -> JPY)
  if (from === base) {
    const directPair = `${from}/${to}`; // "USD/JPY"
    if (rates[directPair]) {
      return rates[directPair];
    }
  }

  // Case 2: 'to'が基準通貨 (例: JPY -> USD)
  if (to === base) {
    const inversePair = `${to}/${from}`; // "USD/JPY"
    if (rates[inversePair]) {
      const inverseRate = rates[inversePair];
      // Bid/Askを反転: 1/ask が新しいbid, 1/bid が新しいask
      return {
        bid: 1 / inverseRate.ask,
        ask: 1 / inverseRate.bid,
      };
    }
  }

  // Case 3: 合成レート (例: JPY -> EUR)
  // JPY -> USD のレートを取得 (USD/JPYの逆数)
  const fromRatePair = `${base}/${from}`; // "USD/JPY"
  const fromRateData = rates[fromRatePair];

  // USD -> EUR のレートを取得
  const toRatePair = `${base}/${to}`; // "USD/EUR"
  const toRateData = rates[toRatePair];

  if (fromRateData && toRateData) {
    // JPY -> USD の Bid/Ask を計算
    const fromInverseRate = {
      bid: 1 / fromRateData.ask,
      ask: 1 / fromRateData.bid,
    };
    
    // (JPY -> USD) * (USD -> EUR) = JPY -> EUR
    return {
      bid: fromInverseRate.bid * toRateData.bid,
      ask: fromInverseRate.ask * toRateData.ask,
    };
  }
  
  return null; // どの経路でもレートが見つからない場合
};


/**
 * 金額を指定された通貨に変換します。
 * (この関数は変更ありません)
 */
export const convertCurrency = (amount: number, fromCurrency: string, toCurrency: string, rates: RateData['rates'] | null): number => {
  const rateInfo = getExchangeRate(fromCurrency, toCurrency, rates);
  if (rateInfo === null) return 0;

  const rate = rateInfo.bid;
  const converted = amount * rate;

  if (['JPY', 'KRW', 'VND'].includes(toCurrency)) {
    return Math.round(converted);
  }
  return parseFloat(converted.toFixed(2));
};

/**
 * 金額をロケールに合わせた通貨形式の文字列にフォーマットします。
 * (この関数は変更ありません)
 */
export const formatCurrency = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency,
      currencyDisplay: 'symbol'
    }).format(amount);
  } catch (e) {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

/**
 * 通貨記号から通貨コードに変換します。
 * (この関数は変更ありません)
 */
export const getCurrencyFromSymbol = (symbol: string): string => {
  const map: { [key: string]: string } = {
    '¥': 'JPY',
    '円': 'JPY', // ← この行を追加
    '元': 'CNY', // ← この行を追加
    'S$': 'SGD',
    '€': 'EUR',
    '£': 'GBP',
    'Rp': 'IDR',
    '₩': 'KRW'
  };
  return map[symbol] || symbol;
};