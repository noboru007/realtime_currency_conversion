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
    return {
      bid: (firstLegInverseRate.bid + firstLegInverseRate.ask) / 2 * secondLegData.bid, // (1/ask + bid) / 2 * bid => spreadを考慮したbid.  1st, 2nd 両方に1%乗せると最終レートの見栄えが悪くなる。
      ask: (firstLegInverseRate.ask + firstLegInverseRate.bid) / 2 * secondLegData.ask, // (1/bid + ask) / 2 * ask => spreadを考慮したask
    };
  }
  
  return null; // どの経路でもレートが見つからない場合
};


/**
 * 金額をロケールに合わせた通貨形式の文字列にフォーマットします。
 * (この関数は変更ありません)
 */
export const formatCurrency = (amount: number, currency: string): string => {
  try {
    const noDecimalCurrencies = ['JPY', 'IDR', 'KRW', 'VND'];
    const options: Intl.NumberFormatOptions = {
            style: 'currency',
            currency: currency,
            currencyDisplay: 'symbol'
    };
    // noDecimalCurrenciesに含まれる通貨の場合、小数点以下の桁数を0にする
    // ブラウザ自体に組み込まれている国際化ライブラリ（ICU）のデータに基づいて判定すると何故かIDRが小数点以下2桁まで表示されるため）
    if (noDecimalCurrencies.includes(currency)) {
        options.minimumFractionDigits = 0;
        options.maximumFractionDigits = 0;
    }

    return new Intl.NumberFormat(undefined, options).format(amount);
    } catch (e) {
        return `${amount.toFixed(2)} ${currency}`;
    }
  };

/**
 * 通貨記号から通貨コードに変換します。
 * @param symbol The currency symbol (e.g., '¥', '€').
 * @returns The corresponding currency code (e.g., 'JPY', 'EUR').
 */
// export const  = (symbol: string): string => {
//   const map: { [key: string]: string } = {
//     // アジア・オセアニア
//     // '¥': 'JPY',
//     '円': 'JPY',
//     // '元': 'CNY',
//     '₩': 'KRW',
//     '₹': 'INR',
//     '₱': 'PHP',
//     '฿': 'THB',
//     '₫': 'VND',
//     'S$': 'SGD',
//     'RM': 'MYR',
//     'Rp': 'IDR',
//     '৳': 'BDT',
//     'LKR': 'LKR',
//     'रू': 'NPR',
//     '₨': 'PKR',
//     '៛': 'KHR',
//     '₭': 'LAK',
//     '₮': 'MNT',

//     // ヨーロッパ
//     '€': 'EUR',
//     '£': 'GBP',
//     'CHF': 'CHF',
//     '₽': 'RUB',
//     '₺': 'TRY',
//     // 'kr': 'SEK', // SEK, NOK, DKK
//     'zł': 'PLN',
//     '₴': 'UAH',
//     'Kč': 'CZK',
//     'Ft': 'HUF',
//     'L': 'RON',
//     'лв': 'BGN',

//     // 北米・南米
//     'C$': 'CAD',
//     'R$': 'BRL',
//     'Mex$': 'MXN',
    
//     // 中東・アフリカ
//     '₪': 'ILS',
//     // '﷼': 'SAR', // SAR, IRR, QAR, OMR, YER
//     'د.إ': 'AED',
//     'R': 'ZAR',
//     '₦': 'NGN',
//     'KSh': 'KES',
//     'GH₵': 'GHS',
//   };
//   return map[symbol] || symbol;
// };

interface CurrencyInfo {
  name: string; // 国名
  currency: string; // ISO 4217 通貨コード
}
/**
 * ブラウザのロケールから通貨コードに変換します。
*/
export const localeCurrencyMetadata: { [key: string]: CurrencyInfo } = {
  'ar-AE': { name: 'United Arab Emirates', currency: 'AED' },
  'fa-AF': { name: 'Afghanistan', currency: 'AFN' },
  'sq-AL': { name: 'Albania', currency: 'ALL' },
  'hy-AM': { name: 'Armenia', currency: 'AMD' },
  'pt-AO': { name: 'Angola', currency: 'AOA' },
  'es-AR': { name: 'Argentina', currency: 'ARS' },
  'en-AS': { name: 'American Samoa', currency: 'USD' },
  'de-AT': { name: 'Austria', currency: 'EUR' },
  'en-AU': { name: 'Australia', currency: 'AUD' },
  'nl-AW': { name: 'Aruba', currency: 'AWG' },
  'az-AZ': { name: 'Azerbaijan', currency: 'AZN' },
  'bs-BA': { name: 'Bosnia and Herzegovina', currency: 'BAM' },
  'en-BB': { name: 'Barbados', currency: 'BBD' },
  'bn-BD': { name: 'Bangladesh', currency: 'BDT' },
  'fr-BE': { name: 'Belgium', currency: 'EUR' },
  'nl-BE': { name: 'Belgium', currency: 'EUR' },
  'bg-BG': { name: 'Bulgaria', currency: 'BGN' },
  'ar-BH': { name: 'Bahrain', currency: 'BHD' },
  'fr-BI': { name: 'Burundi', currency: 'BIF' },
  'en-BM': { name: 'Bermuda', currency: 'BMD' },
  'ms-BN': { name: 'Brunei Darussalam', currency: 'BND' },
  'es-BO': { name: 'Bolivia', currency: 'BOB' },
  'pt-BR': { name: 'Brazil', currency: 'BRL' },
  'en-BS': { name: 'Bahamas', currency: 'BSD' },
  'dz-BT': { name: 'Bhutan', currency: 'BTN' },
  'en-BW': { name: 'Botswana', currency: 'BWP' },
  'be-BY': { name: 'Belarus', currency: 'BYN' },
  'en-BZ': { name: 'Belize', currency: 'BZD' },
  'en-CA': { name: 'Canada', currency: 'CAD' },
  'fr-CA': { name: 'Canada', currency: 'CAD' },
  'fr-CD': { name: 'Congo, Democratic Republic of the', currency: 'CDF' },
  'de-CH': { name: 'Switzerland', currency: 'CHF' },
  'fr-CH': { name: 'Switzerland', currency: 'CHF' },
  'it-CH': { name: 'Switzerland', currency: 'CHF' },
  'es-CL': { name: 'Chile', currency: 'CLP' },
  'zh-CN': { name: 'China', currency: 'CNY' },
  'es-CO': { name: 'Colombia', currency: 'COP' },
  'es-CR': { name: 'Costa Rica', currency: 'CRC' },
  'es-CU': { name: 'Cuba', currency: 'CUP' },
  'pt-CV': { name: 'Cabo Verde', currency: 'CVE' },
  'nl-CW': { name: 'Curaçao', currency: 'ANG' },
  'el-CY': { name: 'Cyprus', currency: 'EUR' },
  'cs-CZ': { name: 'Czechia', currency: 'CZK' },
  'de-DE': { name: 'Germany', currency: 'EUR' },
  'fr-DJ': { name: 'Djibouti', currency: 'DJF' },
  'da-DK': { name: 'Denmark', currency: 'DKK' },
  'es-DO': { name: 'Dominican Republic', currency: 'DOP' },
  'ar-DZ': { name: 'Algeria', currency: 'DZD' },
  'es-EC': { name: 'Ecuador', currency: 'USD' },
  'et-EE': { name: 'Estonia', currency: 'EUR' },
  'ar-EG': { name: 'Egypt', currency: 'EGP' },
  'ti-ER': { name: 'Eritrea', currency: 'ERN' },
  'es-ES': { name: 'Spain', currency: 'EUR' },
  'am-ET': { name: 'Ethiopia', currency: 'ETB' },
  'fi-FI': { name: 'Finland', currency: 'EUR' },
  'en-FJ': { name: 'Fiji', currency: 'FJD' },
  'en-FK': { name: 'Falkland Islands', currency: 'FKP' },
  'en-FM': { name: 'Micronesia', currency: 'USD' },
  'fr-FR': { name: 'France', currency: 'EUR' },
  'en-GB': { name: 'United Kingdom', currency: 'GBP' },
  'ka-GE': { name: 'Georgia', currency: 'GEL' },
  'en-GG': { name: 'Guernsey', currency: 'GGP' },
  'en-GH': { name: 'Ghana', currency: 'GHS' },
  'en-GI': { name: 'Gibraltar', currency: 'GIP' },
  'en-GM': { name: 'Gambia', currency: 'GMD' },
  'fr-GN': { name: 'Guinea', currency: 'GNF' },
  'el-GR': { name: 'Greece', currency: 'EUR' },
  'es-GT': { name: 'Guatemala', currency: 'GTQ' },
  'en-GU': { name: 'Guam', currency: 'USD' },
  'en-GY': { name: 'Guyana', currency: 'GYD' },
  'zh-HK': { name: 'Hong Kong', currency: 'HKD' },
  'es-HN': { name: 'Honduras', currency: 'HNL' },
  'hr-HR': { name: 'Croatia', currency: 'EUR' }, // 2023年1月よりEURに移行
  'ht-HT': { name: 'Haiti', currency: 'HTG' },
  'hu-HU': { name: 'Hungary', currency: 'HUF' },
  'id-ID': { name: 'Indonesia', currency: 'IDR' },
  'en-IE': { name: 'Ireland', currency: 'EUR' },
  'he-IL': { name: 'Israel', currency: 'ILS' },
  'en-IM': { name: 'Isle of Man', currency: 'IMP' },
  'hi-IN': { name: 'India', currency: 'INR' },
  'ar-IQ': { name: 'Iraq', currency: 'IQD' },
  'fa-IR': { name: 'Iran', currency: 'IRR' },
  'is-IS': { name: 'Iceland', currency: 'ISK' },
  'it-IT': { name: 'Italy', currency: 'EUR' },
  'en-JE': { name: 'Jersey', currency: 'JEP' },
  'en-JM': { name: 'Jamaica', currency: 'JMD' },
  'ar-JO': { name: 'Jordan', currency: 'JOD' },
  'ja-JP': { name: 'Japan', currency: 'JPY' },
  'sw-KE': { name: 'Kenya', currency: 'KES' },
  'ky-KG': { name: 'Kyrgyzstan', currency: 'KGS' },
  'km-KH': { name: 'Cambodia', currency: 'KHR' },
  'fr-KM': { name: 'Comoros', currency: 'KMF' },
  'ko-KP': { name: 'North Korea', currency: 'KPW' },
  'ko-KR': { name: 'South Korea', currency: 'KRW' },
  'ar-KW': { name: 'Kuwait', currency: 'KWD' },
  'en-KY': { name: 'Cayman Islands', currency: 'KYD' },
  'kk-KZ': { name: 'Kazakhstan', currency: 'KZT' },
  'lo-LA': { name: 'Laos', currency: 'LAK' },
  'ar-LB': { name: 'Lebanon', currency: 'LBP' },
  'de-LI': { name: 'Liechtenstein', currency: 'CHF' },
  'si-LK': { name: 'Sri Lanka', currency: 'LKR' },
  'en-LR': { name: 'Liberia', currency: 'LRD' },
  'st-LS': { name: 'Lesotho', currency: 'LSL' },
  'lt-LT': { name: 'Lithuania', currency: 'EUR' },
  'fr-LU': { name: 'Luxembourg', currency: 'EUR' },
  'lv-LV': { name: 'Latvia', currency: 'EUR' },
  'ar-LY': { name: 'Libya', currency: 'LYD' },
  'ar-MA': { name: 'Morocco', currency: 'MAD' },
  'ro-MD': { name: 'Moldova', currency: 'MDL' },
  'fr-MC': { name: 'Monaco', currency: 'EUR' },
  'mg-MG': { name: 'Madagascar', currency: 'MGA' },
  'en-MH': { name: 'Marshall Islands', currency: 'USD' },
  'mk-MK': { name: 'North Macedonia', currency: 'MKD' },
  'my-MM': { name: 'Myanmar', currency: 'MMK' },
  'mn-MN': { name: 'Mongolia', currency: 'MNT' },
  'zh-MO': { name: 'Macao', currency: 'MOP' },
  'en-MP': { name: 'Northern Mariana Islands', currency: 'USD' },
  'ar-MR': { name: 'Mauritania', currency: 'MRU' },
  'en-MT': { name: 'Malta', currency: 'EUR' },
  'en-MU': { name: 'Mauritius', currency: 'MUR' },
  'dv-MV': { name: 'Maldives', currency: 'MVR' },
  'en-MW': { name: 'Malawi', currency: 'MWK' },
  'es-MX': { name: 'Mexico', currency: 'MXN' },
  'ms-MY': { name: 'Malaysia', currency: 'MYR' },
  'pt-MZ': { name: 'Mozambique', currency: 'MZN' },
  'en-NA': { name: 'Namibia', currency: 'NAD' },
  'en-NG': { name: 'Nigeria', currency: 'NGN' },
  'es-NI': { name: 'Nicaragua', currency: 'NIO' },
  'nl-NL': { name: 'Netherlands', currency: 'EUR' },
  'no-NO': { name: 'Norway', currency: 'NOK' },
  'ne-NP': { name: 'Nepal', currency: 'NPR' },
  'en-NZ': { name: 'New Zealand', currency: 'NZD' },
  'ar-OM': { name: 'Oman', currency: 'OMR' },
  'es-PA': { name: 'Panama', currency: 'PAB' }, // USDも法定通貨
  'es-PE': { name: 'Peru', currency: 'PEN' },
  'en-PG': { name: 'Papua New Guinea', currency: 'PGK' },
  'fil-PH': { name: 'Philippines', currency: 'PHP' },
  'ur-PK': { name: 'Pakistan', currency: 'PKR' },
  'pl-PL': { name: 'Poland', currency: 'PLN' },
  'es-PR': { name: 'Puerto Rico', currency: 'USD' },
  'pt-PT': { name: 'Portugal', currency: 'EUR' },
  'en-PW': { name: 'Palau', currency: 'USD' },
  'es-PY': { name: 'Paraguay', currency: 'PYG' },
  'ar-QA': { name: 'Qatar', currency: 'QAR' },
  'ro-RO': { name: 'Romania', currency: 'RON' },
  'sr-RS': { name: 'Serbia', currency: 'RSD' },
  'ru-RU': { name: 'Russia', currency: 'RUB' },
  'rw-RW': { name: 'Rwanda', currency: 'RWF' },
  'ar-SA': { name: 'Saudi Arabia', currency: 'SAR' },
  'en-SB': { name: 'Solomon Islands', currency: 'SBD' },
  'fr-SC': { name: 'Seychelles', currency: 'SCR' },
  'ar-SD': { name: 'Sudan', currency: 'SDG' },
  'sv-SE': { name: 'Sweden', currency: 'SEK' },
  'en-SG': { name: 'Singapore', currency: 'SGD' },
  'en-SH': { name: 'Saint Helena', currency: 'SHP' },
  'sl-SI': { name: 'Slovenia', currency: 'EUR' },
  'sk-SK': { name: 'Slovakia', currency: 'EUR' },
  'en-SL': { name: 'Sierra Leone', currency: 'SLE' },
  'so-SO': { name: 'Somalia', currency: 'SOS' },
  'nl-SR': { name: 'Suriname', currency: 'SRD' },
  'en-SS': { name: 'South Sudan', currency: 'SSP' },
  'pt-ST': { name: 'Sao Tome and Principe', currency: 'STN' },
  'es-SV': { name: 'El Salvador', currency: 'USD' },
  'ar-SY': { name: 'Syria', currency: 'SYP' },
  'en-SZ': { name: 'Eswatini', currency: 'SZL' },
  'en-TC': { name: 'Turks and Caicos Islands', currency: 'USD' },
  'th-TH': { name: 'Thailand', currency: 'THB' },
  'tg-TJ': { name: 'Tajikistan', currency: 'TJS' },
  'tk-TM': { name: 'Turkmenistan', currency: 'TMT' },
  'ar-TN': { name: 'Tunisia', currency: 'TND' },
  'to-TO': { name: 'Tonga', currency: 'TOP' },
  'tr-TR': { name: 'Turkey', currency: 'TRY' },
  'en-TT': { name: 'Trinidad and Tobago', currency: 'TTD' },
  'zh-TW': { name: 'Taiwan', currency: 'TWD' },
  'sw-TZ': { name: 'Tanzania', currency: 'TZS' },
  'uk-UA': { name: 'Ukraine', currency: 'UAH' },
  'en-UG': { name: 'Uganda', currency: 'UGX' },
  'en-US': { name: 'United States', currency: 'USD' },
  'es-UY': { name: 'Uruguay', currency: 'UYU' },
  'uz-UZ': { name: 'Uzbekistan', currency: 'UZS' },
  'es-VE': { name: 'Venezuela', currency: 'VES' },
  'vi-VN': { name: 'Viet Nam', currency: 'VND' },
  'fr-VU': { name: 'Vanuatu', currency: 'VUV' },
  'sm-WS': { name: 'Samoa', currency: 'WST' },
  'ar-YE': { name: 'Yemen', currency: 'YER' },
  'en-ZA': { name: 'South Africa', currency: 'ZAR' },
  'en-ZM': { name: 'Zambia', currency: 'ZMW' },
  'en-ZW': { name: 'Zimbabwe', currency: 'ZWL' }, // USDなども流通
};