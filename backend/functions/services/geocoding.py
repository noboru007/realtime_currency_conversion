"""ジオコーディング（位置情報→通貨コード）のビジネスロジック"""

import os
from datetime import datetime, timedelta, timezone

import requests
from firebase_admin import firestore


def get_currency_from_coordinates(lat: float, lon: float) -> dict:
    """緯度・経度から国を特定し、通貨コードを返す

    結果はFirestoreに7日間キャッシュされる。

    Args:
        lat: 緯度
        lon: 経度

    Returns:
        dict: success, country_code, currency_code, cache を含む辞書

    Raises:
        ValueError: APIキーが未設定または位置が特定できない場合
        requests.exceptions.HTTPError: API呼び出しに失敗した場合
    """
    db = firestore.client()

    # キャッシュチェック（座標を小数第2位で丸めてキーにする）
    cache_key = f"lat_{round(lat, 2)}_lon_{round(lon, 2)}"
    cache_ref = db.collection('locationCache').document(cache_key)

    try:
        cache_doc = cache_ref.get()
        if cache_doc.exists:
            cache_data = cache_doc.to_dict()
            cached_at = cache_data.get('timestamp')
            if cached_at and (datetime.now(timezone.utc) - cached_at.replace(tzinfo=timezone.utc)) < timedelta(days=7):
                print(f"Cache HIT for {cache_key}")
                return {
                    "success": True,
                    "country_code": cache_data.get("country_code", ""),
                    "currency_code": cache_data.get("currency_code", ""),
                    "cache": "hit",
                }
    except Exception as e:
        print(f"Cache read failed for key {cache_key}: {e}")

    # OpenCage APIを呼び出し
    print(f"Cache MISS for {cache_key}. Calling API.")
    api_key = os.getenv("OPENCAGE_API_KEY")
    if not api_key:
        raise ValueError("OPENCAGE_API_KEY secret not configured.")

    api_url = f"https://api.opencagedata.com/geocode/v1/json?q={lat}+{lon}&key={api_key}"
    api_response = requests.get(api_url, timeout=15)
    api_response.raise_for_status()
    api_data = api_response.json()

    if not api_data.get("results"):
        raise ValueError("Could not determine location from coordinates.")

    first_result = api_data["results"][0]
    country_code = first_result.get("components", {}).get("country_code", "").upper()
    currency_info = first_result.get("annotations", {}).get("currency", {})
    currency_code = currency_info.get("iso_code", "")

    # キャッシュに保存
    cache_ref.set({
        "currency_code": currency_code,
        "country_code": country_code,
        "timestamp": firestore.SERVER_TIMESTAMP,
    })

    return {
        "success": True,
        "country_code": country_code,
        "currency_code": currency_code,
        "cache": "miss",
    }
