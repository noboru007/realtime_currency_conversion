import { RateData } from '../api/client';

/**
 * 2つの通貨間の為替レートを取得します。
 * @param from 基軸通貨
 * @param to 対象通貨
 * @param rates レート情報オブジェクト
 * @returns 為替レート。見つからない場合はnull。
 */
export const getExchangeRate = (from: string, to: string, rates: RateData['rates'] | null): number | null => {
  if (!rates) return null;
  if (from === to) return 1;

  const directRate = rates[`${from}/${to}`];
  if (directRate) return directRate;

  const inverseRate = rates[`${to}/${from}`];
  if (inverseRate) return 1 / inverseRate;

  const fromToUsdRate = rates[`${from}/USD`] ?? (1 / (rates[`USD/${from}`] || 0));
  const usdToToRate = rates[`USD/${to}`] ?? (1 / (rates[`${to}/USD`] || 0));

  if (fromToUsdRate && usdToToRate) {
    return fromToUsdRate * usdToToRate;
  }
  
  return null;
};

/**
 * 金額を指定された通貨に変換します。
 * @param amount 変換元の金額
 * @param fromCurrency 変換元の通貨
 * @param toCurrency 変換先の通貨
 * @param rates レート情報オブジェクト
 * @returns 変換後の金額
 */
export const convertCurrency = (amount: number, fromCurrency: string, toCurrency: string, rates: RateData['rates'] | null): number => {
  const rate = getExchangeRate(fromCurrency, toCurrency, rates);
  if (rate === null) return 0;

  const converted = amount * rate;
  if (['JPY', 'KRW', 'VND'].includes(toCurrency)) {
    return Math.round(converted);
  }
  return parseFloat(converted.toFixed(2));
};

/**
 * 金額をロケールに合わせた通貨形式の文字列にフォーマットします。
 * @param amount 金額
 * @param currency 通貨コード (例: 'USD', 'JPY')
 * @returns フォーマットされた文字列
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
 * @param symbol 通貨記号 (例: '¥', '$')
 * @returns 通貨コード (例: 'JPY', 'USD')
 */
export const getCurrencyFromSymbol = (symbol: string): string => {
  const map: { [key: string]: string } = {
    '¥': 'JPY',
    '$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '₩': 'KRW'
  };
  return map[symbol] || symbol;
};