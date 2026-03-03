"""通貨変換・フォーマットのユーティリティ"""

# 通貨記号マッピング
CURRENCY_SYMBOL_MAP = {
    'JPY': '¥', 'USD': '$', 'EUR': '€', 'GBP': '£',
    'KRW': '₩', 'VND': '₫', 'IDR': 'Rp', 'THB': '฿',
    'MYR': 'RM', 'PHP': '₱', 'SGD': 'S$', 'HKD': 'HK$',
    'NZD': 'NZ$', 'CNY': '¥', 'AUD': 'A$', 'CAD': 'C$',
}

# 小数点なしで表示する通貨
ZERO_DECIMAL_CURRENCIES = {'JPY', 'KRW', 'VND', 'IDR'}


def convert_and_format_currency(amount: float, currency_code: str, exchange_rate: float) -> str:
    """金額を変換し、通貨記号付きの文字列にフォーマットする

    Args:
        amount: 元の金額
        currency_code: ターゲット通貨コード
        exchange_rate: 為替レート

    Returns:
        フォーマット済みの通貨文字列（例: "¥1,500"、"$12.99"）
    """
    converted = amount * exchange_rate

    if currency_code in ZERO_DECIMAL_CURRENCIES:
        formatted = f"{int(round(converted, 0)):,}"
    else:
        formatted = f"{converted:,.2f}"

    symbol = CURRENCY_SYMBOL_MAP.get(currency_code)
    if symbol:
        return f"{symbol}{formatted}"
    return f"{formatted} {currency_code}"
