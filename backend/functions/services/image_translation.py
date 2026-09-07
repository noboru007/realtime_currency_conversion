"""Nano Banana 2による画像翻訳・通貨変換サービス

gemini-3.1-flash-image-preview を使用して、画像内の文字を翻訳し、
金額を通貨変換した新しい画像を生成する。
"""

import io
import time


def build_translation_prompt(
    language: str,
    local_currency: str,
    home_currency: str,
    exchange_rate: float,
) -> str:
    """画像翻訳用のプロンプトを構築する"""
    return f"""Generate the same image, but with translation to {language}.
Also convert ALL prices from {local_currency} to {home_currency} at the exchange rate of 1{local_currency}={exchange_rate}{home_currency}.
IMPORTANT: You MUST convert every price. For example, if a price is 1990 {local_currency}, display it as {int(1990 * exchange_rate)} {home_currency}.
ALL Chinese characters (whether Traditional or Simplified) MUST be converted into proper {language} characters. 
Keep the original layout, font style, and design as close as possible to the original image.
Only translate text and convert prices — do not add, remove, or reposition any elements."""


def translate_image(
    image_bytes: bytes,
    api_key: str,
    language: str,
    local_currency: str,
    home_currency: str,
    exchange_rate: float,
    job_id: str,
    image_size: str = "1K",
    thinking_level: str = "medium",
    image_model: str = "nanobanana2",
) -> bytes | None:
    """Nano Banana 2で画像を翻訳し、生成画像のバイトデータを返す

    Args:
        image_bytes: 元画像のバイトデータ
        api_key: Gemini APIキー
        language: 翻訳先言語（例: "Japanese"）
        local_currency: 元通貨コード（例: "ISK"）
        home_currency: 変換先通貨コード（例: "JPY"）
        exchange_rate: 為替レート（1元通貨あたりの変換先通貨の値）
        job_id: ジョブID（ログ用）
        image_size: 出力画像サイズ（"1K", "2K", "4K"）

    Returns:
        生成画像のバイトデータ。画像が生成されなかった場合はNone。
    """
    from google import genai
    from google.genai import types
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes))

    client = genai.Client(api_key=api_key)
    prompt = build_translation_prompt(language, local_currency, home_currency, exchange_rate)
    print(f"[Job {job_id}] Sending image translation request to Nano Banana 2...")
    print(f"[Job {job_id}] Prompt: {prompt}")
    print(f"[Job {job_id}] Image size: {image_size}")

    # モデル名のマッピング
    MODEL_MAP = {
        'nanobanana2': 'gemini-3.1-flash-image-preview',
        'nanobanana-pro': '-image-preview',
    }
    model_name = MODEL_MAP.get(image_model, 'gemini-3.1-flash-image-preview')
    print(f"[Job {job_id}] Model: {model_name} ({image_model})")

    # Thinking Level の設定（モデル別）
    # - nanobanana2: minimal or high のみサポート
    # - nanobanana-pro: thinking_config 指定不可
    thinking_config = None
    if image_model == 'nanobanana2':
        # low/medium は high にフォールバック
        effective_level = thinking_level if thinking_level in ('minimal', 'high') else 'high'
        thinking_config = types.ThinkingConfig(thinking_level=effective_level)
        print(f"[Job {job_id}] Thinking: {effective_level} (requested: {thinking_level})")
    else:
        print(f"[Job {job_id}] Thinking: N/A ({image_model} does not support thinking_config)")

    start_time = time.time()
    config_params = {
        "response_modalities": ["Image", "Text"],
        "image_config": types.ImageConfig(image_size=image_size),
    }
    if thinking_config:
        config_params["thinking_config"] = thinking_config

    response = client.models.generate_content(
        model=model_name,
        contents=[prompt, img],
        config=types.GenerateContentConfig(**config_params),
    )
    elapsed = time.time() - start_time
    print(f"[Job {job_id}] Nano Banana 2 response received ({elapsed:.2f}s)")

    # レスポンスから画像パートを抽出
    for part in response.parts:
        if part.text is not None:
            print(f"[Job {job_id}] Text response: {part.text[:200]}")
        elif part.inline_data is not None:
            # inline_data.data から直接バイトデータを取得
            image_data = part.inline_data.data
            mime_type = part.inline_data.mime_type
            print(f"[Job {job_id}] Generated image: {len(image_data)} bytes, mime: {mime_type}")

            # PNG以外の形式の場合はPILで変換
            if mime_type and 'png' not in mime_type.lower():
                img = Image.open(io.BytesIO(image_data))
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                image_data = buf.getvalue()
                print(f"[Job {job_id}] Converted to PNG: {len(image_data)} bytes")

            return image_data

    print(f"[Job {job_id}] WARNING: No image was generated in the response.")
    return None
