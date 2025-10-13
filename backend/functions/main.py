import os
import json
import requests
import traceback
from datetime import datetime, timedelta, timezone

from firebase_functions import https_fn, options
from firebase_admin import initialize_app, storage

# Firebase Storageなど他のサービスと連携するためにSDKを初期化します
initialize_app()


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
    """価格を検出するFirebase Function (この関数は変更ありません)"""
    # (既存の detectPrices のコードはそのまま)
    try:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return https_fn.Response(
                json.dumps({"success": False, "error": "Gemini API key not configured"}),
                status=500, headers={"Content-Type": "application/json"}
            )

        request_json = req.get_json(silent=True)
        if not request_json or 'image_data' not in request_json:
            return https_fn.Response(
                json.dumps({"success": False, "error": "Invalid request body"}),
                status=400, headers={"Content-Type": "application/json"}
            )

        image_data_base64 = request_json['image_data']
        image_content_base64 = image_data_base64.split(',')[1] if ',' in image_data_base64 else image_data_base64
        target_currency = request_json.get('target_currency', 'USD')

        prompt = f"""
        この画像内の価格と通貨記号を検出してください。価格は数値で表示されており、通貨記号（¥、$、€、£、₩、円、元など）が含まれている可能性があります。
        検出された価格の数値部分と通貨記号を抽出し、その位置情報も含めて返してください。
        ターゲット通貨: {target_currency}

        以下の形式でJSONを返してください:
        [
            {{
                "amount": 数値,
                "currency": "通貨記号（例：¥、$、€、₩、円、元）",
                "boundingBox": {{
                    "x": 左端の位置（0-100のパーセンテージ）,
                    "y": 上端の位置（0-100のパーセンテージ）,
                    "width": 幅（0-100のパーセンテージ）,
                    "height": 高さ（0-100のパーセンテージ）
                }}
            }}
        ]
        """

        request_body = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": "image/jpeg",
                                "data": image_content_base64
                            }
                        }
                    ]
                }
            ]
        }

        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
        headers = {"Content-Type": "application/json"}
        
        try:
            gemini_response = requests.post(url, headers=headers, json=request_body, timeout=55)
            gemini_response.raise_for_status()
        except requests.exceptions.Timeout:
            print("--- WARNING: Gemini API request timed out. ---")
            return https_fn.Response(
                json.dumps({"success": True, "detections": [], "warning": "API_TIMEOUT"}),
                status=200,
                headers={"Content-Type": "application/json"}
            )

        response_data = gemini_response.json()
        result_text = ""
        if 'candidates' in response_data and len(response_data['candidates']) > 0:
            content = response_data['candidates'][0].get('content', {})
            if 'parts' in content and len(content['parts']) > 0:
                result_text = content['parts'][0].get('text', '')

        if not result_text:
            detections = []
        else:
            try:
                import re
                json_match = re.search(r'```json\s*([\s\S]*?)\s*```', result_text)
                if json_match:
                    json_str = json_match.group(1)
                else:
                    json_str = result_text

                detections = json.loads(json_str)
                if not isinstance(detections, list):
                    detections = [detections]
            except json.JSONDecodeError:
                numbers = re.findall(r'\d+\.?\d*', result_text)
                detections = [{"amount": float(num), "currency": "?", "boundingBox": {"x": 0, "y": 0, "width": 100, "height": 100}} for num in numbers[:5]]

        return https_fn.Response(
            json.dumps({"detections": detections, "success": True}),
            status=200,
            headers={"Content-Type": "application/json"}
        )

    except Exception as e:
        import traceback
        print(f"--- ERROR: An exception occurred: {type(e).__name__} ---")
        print(traceback.format_exc())
        print("---------------------------------------------------------")
        if isinstance(e, requests.exceptions.HTTPError):
            print(f"--- ERROR RESPONSE FROM SERVER ---")
            print(f"Status Code: {e.response.status_code}")
            print(e.response.text)
            print(f"--------------------------------")
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