"""為替レート取得のビジネスロジック"""

import json
import os
from datetime import datetime, timedelta, timezone

import requests
from firebase_admin import storage


def fetch_and_cache_rates() -> dict:
    """Firebase Storageを24時間キャッシュとして利用し、為替レートを取得する

    Returns:
        為替レートデータ（rates, timestamp_unix, timestamp_jst, base_currency）

    Raises:
        ValueError: APIキーが未設定の場合
        Exception: API呼び出しに失敗した場合
    """
    jst = timezone(timedelta(hours=9))
    bucket = storage.bucket()
    blob = bucket.blob("rates.json")
    now = datetime.now(jst)

    # キャッシュチェック（24時間以内なら返す）
    if blob.exists():
        blob.reload()
        updated_time = blob.updated
        if updated_time and (now - updated_time) < timedelta(hours=24):
            cached_data = json.loads(blob.download_as_string())
            return {"data": cached_data, "cache_status": "HIT"}

    # APIからレートを取得
    app_id = os.getenv("OPEN_EXCHANGE_RATE_APP_ID")
    if not app_id:
        raise ValueError("OPEN_EXCHANGE_RATE_APP_ID secret not configured.")

    api_url = f"https://openexchangerates.org/api/latest.json?app_id={app_id}"
    api_response = requests.get(api_url, timeout=15)
    api_response.raise_for_status()
    api_data = api_response.json()

    # Bid/Askレートを生成（±1%スプレッド）
    processed_rates = {}
    api_timestamp = api_data.get("timestamp")
    dt_object_jst = datetime.fromtimestamp(api_timestamp, jst)
    formatted_timestamp = dt_object_jst.strftime('%Y%m%d %H:%M:%S')
    base_currency = api_data.get("base", "USD")

    for currency, rate in api_data.get("rates", {}).items():
        pair_name = f"{base_currency}/{currency}"
        processed_rates[pair_name] = {
            "bid": rate * 0.99,
            "ask": rate * 1.01,
        }

    final_data = {
        "rates": processed_rates,
        "timestamp_unix": api_timestamp,
        "timestamp_jst": formatted_timestamp,
        "base_currency": base_currency,
    }

    # キャッシュを更新
    blob.upload_from_string(json.dumps(final_data), content_type="application/json")

    return {"data": final_data, "cache_status": "MISS"}
