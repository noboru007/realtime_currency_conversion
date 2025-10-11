from firebase_functions import https_fn, options
# from firebase_admin import initialize_app
import os
import json
import requests
import traceback

# initialize_app() # v2では不要なためコメントアウト

@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins=["*"],
        cors_methods=["get", "post", "options"]
    ),
    secrets=["GEMINI_API_KEY"],
    memory=options.MemoryOption.GB_1,
    timeout_sec=120  # 関数のタイムアウトも念のため延長
)
def detectPrices(req: https_fn.Request) -> https_fn.Response:
    """価格を検出するFirebase Function"""

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
        この画像内の価格と通貨記号を検出してください。価格は数値で表示されており、通貨記号（¥、$、€、£、₩など）が含まれている可能性があります。
        検出された価格の数値部分と通貨記号を抽出し、その位置情報も含めて返してください。
        ターゲット通貨: {target_currency}

        以下の形式でJSONを返してください:
        [
            {{
                "amount": 数値,
                "currency": "通貨記号（例：¥、$、€）",
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

        # ▼▼▼ モデル名を gemini-pro-vision に変更 ▼▼▼
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
        headers = {"Content-Type": "application/json"}
        
        gemini_response = requests.post(url, headers=headers, json=request_body, timeout=55)
        gemini_response.raise_for_status()

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
    )
)
def getExchangeRates(req: https_fn.Request) -> https_fn.Response:
    """為替レートを取得するFirebase Function"""

    try:
        response = requests.get("https://forex-api.coin.z.com/public/v1/ticker", timeout=10)
        response.raise_for_status()

        data = response.json()
        rates = {}

        for item in data.get("data", []):
            symbol = item.get("symbol", "")
            price = item.get("ask", 0)
            if symbol and price and "_" in symbol:
                base_currency, quote_currency = symbol.split("_")
                rates[f"{base_currency}/{quote_currency}"] = float(price)

        return https_fn.Response(
            json.dumps({"rates": rates, "timestamp": data.get("timestamp", "")}),
            status=200,
            headers={"Content-Type": "application/json"}
        )

    except Exception as e:
        return https_fn.Response(
            json.dumps({"success": False, "error": f"Failed to fetch exchange rates: {str(e)}"}),
            status=500,
            headers={"Content-Type": "application/json"}
        )