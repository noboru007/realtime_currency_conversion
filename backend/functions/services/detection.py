"""画像検出（Gemini API）のビジネスロジック"""

import io
import json
import time

from google import genai
from PIL import Image

from .currency import convert_and_format_currency

# Gemini APIのレスポンス用JSONスキーマ
DETECTION_RESPONSE_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "price_text": {
                "type": "number",
                "description": "The detected price as a numeric value",
            },
            "price_box": {
                "type": "array",
                "items": {"type": "integer"},
                "description": "Bounding box [y_min, x_min, y_max, x_max], normalized to 1000",
            },
            "item_text": {
                "type": "string",
                "description": "Translated item name, empty string if not found",
            },
            "item_box": {
                "type": "array",
                "items": {"type": "integer"},
                "description": "Bounding box for item, empty array if not found",
            },
        },
        "required": ["price_text", "price_box", "item_text", "item_box"],
        "propertyOrdering": ["price_text", "price_box", "item_text", "item_box"],
    },
}


def build_detection_prompt(language: str) -> str:
    """Gemini API用の検出プロンプトを生成する"""
    return f"""Detect all items and their corresponding prices in this image.

- "price_text": The detected price as a numeric value only.
- "price_box": Bounding box [y_min, x_min, y_max, x_max], normalized to 1000.
- "item_text": Translate the item's name to {language}. If no item found, use empty string.
- "item_box": Bounding box for the item. If no item found, use empty list.

IMPORTANT:
- ONLY include items where a price is clearly visible.
- If a price has no clear item, include it with empty item_text and item_box."""


def detect_prices_from_image(
    image_bytes: bytes,
    api_key: str,
    target_currency: str,
    language: str,
    exchange_rate: float,
    device_orientation: str,
    job_id: str,
) -> list[dict]:
    """画像から価格を検出し、変換済みの検出結果リストを返す

    Args:
        image_bytes: 画像のバイトデータ
        api_key: Gemini APIキー
        target_currency: ターゲット通貨コード
        language: 翻訳先言語
        exchange_rate: 為替レート
        device_orientation: デバイスの向き（portrait/landscape）
        job_id: ジョブID（ログ用）

    Returns:
        クライアント描画用の検出結果リスト
    """
    img = Image.open(io.BytesIO(image_bytes))

    if device_orientation == 'landscape':
        print(f"[Job {job_id}] Rotating landscape image clockwise.")
        img = img.rotate(-90, expand=True)

    client = genai.Client(api_key=api_key)
    prompt = build_detection_prompt(language)
    print(f"[Job {job_id}] Sending request to Gemini API...")

    start_time = time.time()
    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[prompt, img],
        config={
            "temperature": 0.5,
            "response_mime_type": "application/json",
            "response_json_schema": DETECTION_RESPONSE_SCHEMA,
        },
    )
    elapsed = time.time() - start_time
    print(f"[Job {job_id}] Gemini response received ({elapsed:.2f}s)")

    return _parse_detections(response.text, target_currency, exchange_rate, job_id)


def _parse_detections(
    response_text: str | None,
    target_currency: str,
    exchange_rate: float,
    job_id: str,
) -> list[dict]:
    """Geminiのレスポンスをパースし、クライアント描画用データに変換する"""
    try:
        detected_pairs = json.loads(response_text) if response_text else []
        print(f"[Job {job_id}] Parsed {len(detected_pairs)} detections.")
    except (json.JSONDecodeError, ValueError) as e:
        print(f"[Job {job_id}] JSON parsing failed: {e}")
        return []

    client_detections = []
    for pair in detected_pairs:
        price_text_raw = pair.get("price_text")
        price_box = pair.get("price_box")
        item_text = pair.get("item_text", "")
        item_box = pair.get("item_box")

        converted_price_text = ""
        if price_text_raw and price_box:
            try:
                converted_price_text = convert_and_format_currency(
                    float(price_text_raw), target_currency, exchange_rate
                )
            except (ValueError, TypeError):
                converted_price_text = str(price_text_raw)

        client_detections.append({
            "itemText": item_text,
            "itemBox": item_box,
            "priceText": converted_price_text,
            "priceBox": price_box,
        })

    return client_detections
