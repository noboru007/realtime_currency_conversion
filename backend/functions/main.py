from firebase_functions import https_fn, options
from firebase_functions.options import set_global_options
from firebase_admin import initialize_app
import google.generativeai as genai
import requests
import json
import base64
import os
from io import BytesIO
from PIL import Image
from dotenv import load_dotenv

# 環境変数を読み込み
load_dotenv()

# Gemini API設定
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# For cost control, you can set the maximum number of containers that can be
# running at the same time. This helps mitigate the impact of unexpected
# traffic spikes by instead downgrading performance. This limit is a per-function
# limit. You can override the limit for each function using the max_instances
# parameter in the decorator, e.g. @https_fn.on_request(max_instances=5).
set_global_options(max_instances=10)

initialize_app()

@https_fn.on_request(
    secrets=["GEMINI_API_KEY"],
    cors=options.CorsOptions(
        cors_origins=["*"],  # またはあなたのウェブアプリのドメイン
        cors_methods=["get", "post", "options"]
    )
)
def detectPrices(req: https_fn.Request) -> https_fn.Response:
    """Firebase Function for price detection."""
    
    # Check API key only for non-OPTIONS requests
    if not GEMINI_API_KEY:
        return https_fn.Response(
            json.dumps({"success": False, "error": "Gemini API key not configured"}),
            status=500,
            headers={**cors_headers, "Content-Type": "application/json"}
        )

    try:
        request_json = req.get_json(silent=True)
        if not request_json or 'image_data' not in request_json:
            return https_fn.Response(
                json.dumps({"success": False, "error": "Invalid request body"}),
                status=400,
                headers=headers
            )

        image_data_base64 = request_json['image_data']
        target_currency = request_json.get('target_currency', 'USD')

        # 画像データをデコード
        image_data = base64.b64decode(image_data_base64.split(',')[1] if ',' in image_data_base64 else image_data_base64)
        image = Image.open(BytesIO(image_data))

        # Gemini Vision APIを使用
        model = genai.GenerativeModel('gemini-1.5-flash')

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

        response = model.generate_content([prompt, image])
        result_text = response.text

        try:
            detections = json.loads(result_text)
            if not isinstance(detections, list):
                detections = [detections]
        except json.JSONDecodeError:
            import re
            numbers = re.findall(r'\d+\.?\d*', result_text)
            detections = [{"amount": float(num), "currency": "¥", "boundingBox": {"x": 0, "y": 0, "width": 100, "height": 100}} for num in numbers[:5]]

        return https_fn.Response(
            json.dumps({"detections": detections, "success": True}),
            status=200,
            # headers=headers
        )

    except Exception as e:
        return https_fn.Response(
            json.dumps({"success": False, "error": str(e)}),
            status=500,
            headers=headers
        )

@https_fn.on_request(
    secrets=["GEMINI_API_KEY"],
    cors=options.CorsOptions(
        cors_origins=["*"],  # またはあなたのウェブアプリのドメイン
        cors_methods=["get", "post", "options"]
    )
)
def getExchangeRates(req: https_fn.Request) -> https_fn.Response:
    """為替レートを取得するFirebase Function."""

    try:
        response = requests.get("https://forex-api.coin.z.com/public/v1/ticker", timeout=10)
        response.raise_for_status()

        data = response.json()
        rates = {}

        for item in data.get("data", []):
            symbol = item.get("symbol", "")
            price = item.get("ask", 0)
            if symbol and price:
                # GMO Coin APIのシンボル形式: "USD_JPY"
                if "_" in symbol:
                    base_currency, quote_currency = symbol.split("_")
                    rates[f"{base_currency}/{quote_currency}"] = float(price)

        return https_fn.Response(
            json.dumps({"rates": rates, "timestamp": data.get("timestamp", "")}),
            status=200,
            # headers=headers
        )

    except Exception as e:
        return https_fn.Response(
            json.dumps({"success": False, "error": f"Failed to fetch exchange rates: {str(e)}"}),
            status=500,
            headers=headers
        )