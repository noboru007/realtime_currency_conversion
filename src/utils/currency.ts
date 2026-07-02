import { RateData } from '../api/client';

/**
 * 2つの通貨間の為替レート（Bid/Ask）を取得します。
 * @param quoted 値段が付いている通貨 (例: 1USD=100の時の'USD', 100JPY=1USDの時の'JPY')
 * @param quoting quoted通貨に値段を付ける通貨 (例: 1USD=100の時の'JPY', 100JPY=1USDの時の'USD')
 * @param rates レート情報オブジェクト (USDが基準)
 * @returns { bid: number, ask: number } 形式のレートオブジェクト。見つからない場合はnull。
 */
export const getExchangeRate = (quoted: string, quoting: string, rates: RateData['rates'] | null): { bid: number, ask: number } | null => {
  if (!rates) return null;
  if (quoted === quoting) return { bid: 1, ask: 1 };

  const base = 'USD';

  // Case 1: 'quoted'が基準通貨 (例: USD -> JPY)
  if (quoted === base) {
    const directPair = `${quoted}/${quoting}`; // "USD/JPY"
    if (rates[directPair]) {
      return rates[directPair];
    }
  }

  // Case 2: 'quoting'が基準通貨 (例: JPY -> USD)
  if (quoting === base) {
    const inversePair = `${quoting}/${quoted}`; // JPY/USDレートは無いので、USD/JPYレートを反転させて生成する
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
  const firstLegPair = `${base}/${quoted}`; // "USD/JPY"
  const firstLegData = rates[firstLegPair];

  // USD -> EUR のレートを取得
  const secondLegPair = `${base}/${quoting}`; // "USD/EUR"
  const secondLegData = rates[secondLegPair];

  if (firstLegData && secondLegData) {
    // JPY -> USD の Bid/Ask を計算
    const firstLegInverseRate = {
      bid: 1 / firstLegData.ask,
      ask: 1 / firstLegData.bid,
    };

    // (JPY -> USD) * (USD -> EUR) = JPY -> EUR
    // 1st, 2nd 両レッグにスプレッドを乗せると最終レートの見栄えが悪くなるため、1stレッグはmid値を使う
    return {
      bid: (firstLegInverseRate.bid + firstLegInverseRate.ask) / 2 * secondLegData.bid,
      ask: (firstLegInverseRate.ask + firstLegInverseRate.bid) / 2 * secondLegData.ask,
    };
  }

  return null; // どの経路でもレートが見つからない場合
};
