import os
import json
import requests
import traceback
from datetime import datetime, timedelta, timezone

from firebase_functions import https_fn, options
from firebase_admin import initialize_app, storage
import time
import base64
import io
import json
import random
import re
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from google.generativeai.types import HarmCategory, HarmBlockThreshold
import google.generativeai as genai

# Firebase Storageなど他のサービスと連携するためにSDKを初期化します
initialize_app()

FONT_MAP = {
    "ja": "NotoSansJP-Regular.ttf",
    "ko": "NotoSansKR-Regular.ttf",
    "hi": "NotoSansDevanagari-Regular.ttf",
    "zh-CN": "NotoSansSC-Regular.ttf",
    "zh-TW": "NotoSansTC-Regular.ttf",
    "th": "NotoSansThai-Regular.ttf",
}

@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins=["*"],
        cors_methods=["get", "post", "options"]
    ),
    secrets=["GEMINI_API_KEY"],
    memory=options.MemoryOption.GB_1,
    timeout_sec=60
)
def detectPrices(req: https_fn.Request) -> https_fn.Response:
    """価格を検出し、マスクを描画して画像を返すFirebase Function"""
    try:
        api_key = os.getenv("GEMINI_API_KEY") # APIキーを取得
        if not api_key:
            return https_fn.Response(
                json.dumps({"success": False, "error": "Gemini API key not configured"}),
                status=500, headers={"Content-Type": "application/json"}
            )

        request_json = req.get_json(silent=True) # リクエストボディを取得
        if not request_json or 'image_data' not in request_json:
            return https_fn.Response(
                json.dumps({"success": False, "error": "Invalid request body"}),
                status=400, headers={"Content-Type": "application/json"}
            )

        image_data_base64 = request_json['image_data'] # 画像データを取得
        image_content_base64 = image_data_base64.split(',')[1] if ',' in image_data_base64 else image_data_base64 # 画像データをBase64エンコード

        # Base64デコードしてリサイズ
        image_bytes = base64.b64decode(image_content_base64)
        img = Image.open(io.BytesIO(image_bytes))
        
        # アスペクト比を保ちつつ、最大辺が1024pxになるようにリサイズ
        img.thumbnail([1024, 1024], Image.Resampling.LANCZOS)

        processed_width, processed_height = img.size
        print(f"--- Image size sent to Gemini: {processed_width}x{processed_height} ---")

        safety_settings = {
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        }
        target_currency = request_json.get('target_currency', 'USD')
        exchange_rate = float(request_json.get('exchange_rate', 1.0))
        language = request_json.get('language', 'English')
        print(f"--- Received language parameter: {language} ---")

        # bounding_box_system_instructions = """
        # Return bounding boxes as a JSON array of items and prices. Limit to 80 objects.
        # """
        prompt = f"""
        Detect all items and their corresponding prices in this image.
        Your response MUST be a valid JSON array of objects. Do not wrap it in markdown.
        Each object in the array represents a detected pair and MUST contain the following four keys: "price_text", "price_box", "item_text", and "item_box".

        - "price_text": Convert the detected price to {target_currency} using an exchange rate of {exchange_rate}. Round to 2 decimal places, except for JPY, KRW, VND, and IDR which should be integers. The result should be a string (e.g., "123.45 JPY").
        - "price_box": A list of 4 numbers for the price's bounding box [y_min, x_min, y_max, x_max], normalized to 1000.
        - "item_text": Translate the item's name to {language}. If no corresponding item is found for a price, this MUST be an empty string "".
        - "item_box": A list of 4 numbers for the item's bounding box. If no item is found, this MUST be an empty list [].

        IMPORTANT:
        - ONLY include an object in the array if a "price_text" and "price_box" are clearly identified.
        - If an item has a price, it MUST be included. If a price is visible but has no clear item, it MUST also be included (with empty "item_text" and "item_box").
        - Do NOT include items that do not have a price.

        Example of a valid object:
        {{
            "price_text": "123.45 JPY",
            "price_box": [100, 200, 150, 300],
            "item_text": "Item Name",
            "item_box": [150, 50, 170, 250]
        }}
        """
        # Detect all items and prices in the image.
        # Your response MUST be a valid JSON array of objects. Do not wrap it in markdown.
        # Each object in the array represents one detected item or price and MUST contain these three keys: "box_2d", "label", "text_content".

        # 1.  "box_2d": A list of 4 numbers representing the bounding box coordinates [y_min, x_min, y_max, x_max], normalized to 1000.
        # 2.  "label": A string, either "item" or "price".
        # 3.  "text_content":
        #     - If "label" is "item", translate the item's name to {language}. If the name cannot be determined, use an empty string "".
        #     - If "label" is "price", convert the price to {target_currency} using an exchange rate of {exchange_rate}. Round to 2 decimal places, except for JPY, KRW, VND, and IDR which should be rounded to the nearest integer. The result should be a string (e.g., "123.45 JPY").

        # Example of a single valid object:
        # {{
        #     "box_2d": [100, 200, 150, 300],
        #     "label": "Translated Item Name or converted price in {target_currency}",
        #     "text_content": "Translated Item Name or converted price"
        # }}

        # IMPORTANT: If "text_content" is empty, you MUST still include the key with an empty string value, like "text_content": "". Never omit the "text_content" key.
        # """
        # prompt = f"""Return bounding boxes as a JSON array of items and prices. Limit to 80 objects.
        # Where price is detected, convert the price to {target_currency} using {exchange_rate}, rounded to the 2nd decimal place exepnt for JPY, KRW, VND, IDR to be rounded tothe nearest integer.
        # Where item is detected, convert the item name to {language}.
        # Detect the 2d bounding boxes of the items and prices. Label with value in text_content.
        # Use the derived item name and converted price information as either th label or text_content.
        # """
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-2.5-flash')
        
        start_time = time.time()
        response = model.generate_content(
            contents=[prompt, img],
            generation_config = genai.GenerationConfig(
                # system_instruction=bounding_box_system_instructions,
                temperature=0.5
            ),
            safety_settings=safety_settings
        )
        end_time = time.time()
        print(f"--- Gemini API call took: {end_time - start_time:.2f} seconds ---")

        # print(prompt)
        print(f"--- Gemini Raw Response ---:\n{response.text}")

        #######
        # AIから返されたオブジェクトの位置情報を基に、Boxと商品・値段情報を描画
        #######
        # --- Bounding Box Drawing Logic ---
        try:
            bounding_boxes_text = response.text.strip('```json\n').strip('```').strip()
            if bounding_boxes_text:
                detected_pairs = json.loads(bounding_boxes_text)
                
                # Use a copy of the image for drawing
                draw_img = img.copy()
                draw = ImageDraw.Draw(draw_img)
                # width, heightはここで改めて取得するのではなく、上で取得した値を使う
                width, height = processed_width, processed_height

                # --- Font Loading Logic ---
                font_file_name = FONT_MAP.get(language) # Get font if language is supported
                font = None

                if font_file_name:
                    font_path = f"/tmp/{font_file_name}"
                    try:
                        if not os.path.exists(font_path):
                            bucket = storage.bucket()
                            blob = bucket.blob(f"fonts/{font_file_name}")
                            blob.download_to_filename(font_path)
                            print(f"--- Downloaded font: {font_file_name} ---")
                        font = ImageFont.truetype(font_path, size=16)
                    except Exception as e:
                        print(f"--- WARNING: Failed to load font '{font_file_name}'. Error: {e}. Using default. ---")
                        font = ImageFont.load_default()
                else:
                    # If language not in map, use default font
                    print(f"--- INFO: Language '{language}' not in FONT_MAP. Using default font. ---")
                    font = ImageFont.load_default()

                # --- Font Size Constants ---
                MIN_FONT_SIZE = 8
                MAX_FONT_SIZE = 48

                colors = [
                    "#FF5733", "#33FF57", "#3357FF", "#FF33A1", "#A133FF", "#33FFA1",
                    "#FFC300", "#C70039", "#900C3F", "#581845", "#00BFFF", "#FF69B4",
                    "#7CFC00", "#FFD700", "#ADFF2F", "#00FFFF", "#4682B4", "#DDA0DD",
                    "#20B2AA", "#DB7093", "#F4A460", "#8A2BE2", "#32CD32", "#FF4500"
                ]
                detections_for_response = []

                for i, pair in enumerate(detected_pairs):
                    color = colors[i % len(colors)]
                    
                    price_text = pair.get("price_text")
                    price_box = pair.get("price_box")
                    item_text = pair.get("item_text")
                    item_box = pair.get("item_box")

                    # 必須項目である価格情報がなければスキップ
                    if not price_text or not price_box or len(price_box) != 4:
                        continue

                    # まず、Geminiからの生の座標を変数に代入
                    py0_norm, px0_norm, py1_norm, px1_norm = price_box

                    # --- 価格の描画 ---
                    # 1000に正規化された座標を、実際の画像サイズに合わせてスケール変換
                    is_landscape_image = width > height

                    # 縦長の画像なのに、返ってきたBoxが横に長い場合、座標系が90度回転していると判断
                    box_width_norm = abs(px1_norm - px0_norm)
                    box_height_norm = abs(py1_norm - py0_norm)

                    if not is_landscape_image and box_width_norm > box_height_norm:
                        # 座標を反時計回りに90度回転させる (x, y) -> (y, 1000-x)
                        corrected_py0 = px0_norm
                        corrected_px0 = 1000 - py1_norm
                        corrected_py1 = px1_norm
                        corrected_px1 = 1000 - py0_norm
                        
                        py0_norm, px0_norm, py1_norm, px1_norm = corrected_py0, corrected_px0, corrected_py1, corrected_px1
                        
                        # item_boxも同様に回転させる
                        if item_box and len(item_box) == 4:
                            iy0_norm, ix0_norm, iy1_norm, ix1_norm = item_box
                            corrected_iy0 = ix0_norm
                            corrected_ix0 = 1000 - iy1_norm
                            corrected_iy1 = ix1_norm
                            corrected_ix1 = 1000 - iy0_norm
                            item_box = [corrected_iy0, corrected_ix0, corrected_iy1, corrected_ix1]

                    py0 = int(py0_norm / 1000 * height)
                    px0 = int(px0_norm / 1000 * width)
                    py1 = int(py1_norm / 1000 * height)
                    px1 = int(px1_norm / 1000 * width)

                    if py0 > py1: py0, py1 = py1, py0
                    if px0 > px1: px0, px1 = px1, px0
                    
                    draw.rectangle(((px0, py0), (px1, py1)), outline=color, width=1)
                    
                    # 動的フォントサイズ計算
                    p_box_height = py1 - py0
                    p_font_size = max(MIN_FONT_SIZE, min(int(p_box_height * 0.9), MAX_FONT_SIZE))
                    try:
                        p_dynamic_font = ImageFont.truetype(font.path, size=p_font_size)
                    except (IOError, AttributeError):
                        p_dynamic_font = ImageFont.load_default(size=p_font_size)
                    
                    draw.text((px0 + 5, py0 + 5), price_text, fill=color, font=p_dynamic_font)

                    # --- 商品名の描画 (存在する場合のみ) ---
                    if item_text and item_box and len(item_box) == 4:
                        iy0_norm, ix0_norm, iy1_norm, ix1_norm = item_box
                        # iy0, ix0, iy1, ix1 = [int(v / 1000 * dim) for v, dim in zip(item_box, [height, width, height, width])]
                        iy0 = int(iy0_norm / 1000 * height)
                        ix0 = int(ix0_norm / 1000 * width)
                        iy1 = int(iy1_norm / 1000 * height)
                        ix1 = int(ix1_norm / 1000 * width)

                        if iy0 > iy1: iy0, iy1 = iy1, iy0
                        if ix0 > ix1: ix0, ix1 = ix1, ix0

                        draw.rectangle(((ix0, iy0), (ix1, iy1)), outline=color, width=1)

                        # 動的フォントサイズ計算
                        i_box_height = iy1 - iy0
                        i_font_size = max(MIN_FONT_SIZE, min(int(i_box_height * 0.9), MAX_FONT_SIZE))
                        try:
                            i_dynamic_font = ImageFont.truetype(font.path, size=i_font_size)
                        except (IOError, AttributeError):
                            i_dynamic_font = ImageFont.load_default(size=i_font_size)

                        draw.text((ix0 + 5, iy0 + 5), item_text, fill=color, font=i_dynamic_font)

                    # --- フロントエンドに返すdetections配列の作成 ---　（未使用）
                    try:
                        match = re.search(r'([\d,.]*\d)', price_text)
                        if match:
                            price_str = match.group(0).replace(',', '')
                            if price_str.count('.') <= 1:
                                amount = float(price_str)
                                detections_for_response.append({
                                    'amount': amount,
                                    'boundingBox': {'x': px0, 'y': py0, 'width': px1 - px0, 'height': py1 - py0}
                                })
                    except (ValueError, AttributeError) as e:
                        print(f"--- INFO: Could not parse price from text: '{price_text}'. Error: {e} ---")
                        pass
                
                # Replace original image with the one with drawings
                img = draw_img

        except (json.JSONDecodeError, KeyError) as e:
            print(f"--- ERROR: Failed to parse or process bounding boxes. Error: {e} ---")
            print(f"--- FAILING RESPONSE TEXT ---:\n{bounding_boxes_text}\n--------------------")
            # If parsing fails, we'll just return the original image without boxes.
            detections_for_response = []


        # --- Image Encoding and Response ---
        buffered = io.BytesIO()
        img.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()

        # 最終的なレスポンスデータを定義
        response_data = {
            "success": True,
            "image": "data:image/png;base64," + img_str,
            "detections": detections_for_response
        }
        # デバッグ情報を追加
        response_data["debug_info"] = {
            "processed_image_width": img.width,
            "processed_image_height": img.height,
            "gemini_raw_response": response.text.strip()
        }

        return https_fn.Response(
            json.dumps(response_data),
            status=200,
            headers={"Content-Type": "application/json"}
        )

    except Exception as e:
        print(f"--- ERROR: An exception occurred: {type(e).__name__} ---")
        print(traceback.format_exc())
        return https_fn.Response(
            json.dumps({"success": False, "error": f"An unexpected error occurred: {str(e)}"}),
            status=500,
            headers={"Content-Type": "application/json"}
        )


@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins=["*"],
        cors_methods=["get", "options"]
    ),
    secrets=["OPEN_EXCHANGE_RATE_APP_ID"] # 新しいシークレットを指定
)
def getExchangeRates(req: https_fn.Request) -> https_fn.Response:
    """
    Firebase Storageを24時間キャッシュとして利用し、為替レートを取得します。
    APIから取得した中間レートを元にBid/Askレートを生成します。
    """
    try:
        # プロジェクトのデフォルトバケットを取得
        bucket = storage.bucket() 
        blob = bucket.blob("rates.json") # キャッシュファイル名

        jst = timezone(timedelta(hours=9))
        now = datetime.now(jst)

        # 最初にキャッシュを確認
        if blob.exists():
            blob.reload()  # 最新のメタデータを取得
            updated_time = blob.updated
            if updated_time and (now - updated_time) < timedelta(hours=24):
                # キャッシュが有効期間内なら、Storageからデータを返す
                cached_data = json.loads(blob.download_as_string())
                return https_fn.Response(
                    json.dumps(cached_data),
                    status=200,
                    headers={"Content-Type": "application/json", "X-Cache-Status": "HIT"}
                )

        # キャッシュが無効、または存在しない場合はAPIから取得
        app_id = os.getenv("OPEN_EXCHANGE_RATE_APP_ID")
        if not app_id:
            raise ValueError("OPEN_EXCHANGE_RATE_APP_ID secret not configured.")

        api_url = f"https://openexchangerates.org/api/latest.json?app_id={app_id}"
        api_response = requests.get(api_url, timeout=15)
        api_response.raise_for_status()
        api_data = api_response.json()

        # データを要件に合わせて加工
        processed_rates = {}
        api_timestamp = api_data.get("timestamp")
        
        # Unixタイムスタンプを日本時間の文字列に変換
        dt_object_jst = datetime.fromtimestamp(api_timestamp, jst)
        formatted_timestamp = dt_object_jst.strftime('%Y%m%d %H:%M:%S')

        base_currency = api_data.get("base", "USD")
        
        for currency, rate in api_data.get("rates", {}).items():
            pair_name = f"{base_currency}/{currency}"
            # 取得したレートの1%をスプレッドとしてBid/Askレートを生成
            bid = rate * 0.99
            ask = rate * 1.01
            processed_rates[pair_name] = {
                "bid": bid,
                "ask": ask,
            }

        # 保存・返却する最終的なデータ構造
        final_data = {
            "rates": processed_rates,
            "timestamp_unix": api_timestamp,
            "timestamp_jst": formatted_timestamp,
            "base_currency": base_currency
        }
        
        # 新しいデータをJSON形式でStorageにアップロード（キャッシュを更新）
        blob.upload_from_string(
            json.dumps(final_data),
            content_type="application/json"
        )
        
        return https_fn.Response(
            json.dumps(final_data),
            status=200,
            headers={"Content-Type": "application/json", "X-Cache-Status": "MISS"}
        )

    except Exception as e:
        print(traceback.format_exc())
        return https_fn.Response(
            json.dumps({"success": False, "error": f"Failed to fetch exchange rates: {str(e)}"}),
            status=500,
            headers={"Content-Type": "application/json"}
        )

@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins=["*"],
        cors_methods=["post", "options"]
    ),
    secrets=["OPENCAGE_API_KEY"]
)
def getCurrencyFromLocation(req: https_fn.Request) -> https_fn.Response:
    """
    緯度・経度から国を特定し、その国の通貨コードを返します。
    """
    try:
        request_json = req.get_json(silent=True)
        if not request_json or 'lat' not in request_json or 'lon' not in request_json:
            return https_fn.Response(json.dumps({"success": False, "error": "Invalid request"}), status=400)

        lat = request_json['lat']
        lon = request_json['lon']

        api_key = os.getenv("OPENCAGE_API_KEY")
        if not api_key:
            raise ValueError("OPENCAGE_API_KEY secret not configured.")

        # URLから '&no_annotations=1' を削除
        api_url = f"https://api.opencagedata.com/geocode/v1/json?q={lat}+{lon}&key={api_key}"
        api_response = requests.get(api_url, timeout=15)
        api_response.raise_for_status()
        api_data = api_response.json()

        if not api_data.get("results"):
            raise ValueError("Could not determine location from coordinates.")

        # --- ▼▼▼ データ抽出ロジックをより安全な形に修正 ▼▼▼ ---
        first_result = api_data["results"][0]
        country_code = first_result.get("components", {}).get("country_code", "").upper()
        
        currency_info = first_result.get("annotations", {}).get("currency", {})
        currency_code = currency_info.get("iso_code", "")

        if not country_code or not currency_code:
            # もし見つからなくてもエラーにせず、ログに残して空の成功レスポンスを返す
            print(f"Warning: Could not extract country/currency. Country: {country_code}, Currency: {currency_code}")
            # フロント側でcurrency_codeが空かどうかをチェックする
            return https_fn.Response(json.dumps({"success": True, "country_code": "", "currency_code": ""}), status=200)
            
        return https_fn.Response(
            json.dumps({
                "success": True,
                "country_code": country_code,
                "currency_code": currency_code
            }),
            status=200,
            headers={"Content-Type": "application/json"}
        )

    except Exception as e:
        print(traceback.format_exc())
        return https_fn.Response(
            json.dumps({"success": False, "error": f"An unexpected error occurred: {str(e)}"}),
            status=500,
            headers={"Content-Type": "application/json"}
        )