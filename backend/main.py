from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
import google.generativeai as genai
import requests
import os
from dotenv import load_dotenv

# 環境変数を読み込み
load_dotenv()

import json
import base64
from io import BytesIO
from PIL import Image

app = FastAPI(title="Currency Converter API", version="1.0.0")

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 本番環境では具体的なドメインを指定
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gemini API設定
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# レスポンススキーマ
response_schema = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "amount": {"type": "number", "description": "The numeric value of the price."},
            "boundingBox": {
                "type": "object",
                "properties": {
                    "x": {"type": "number", "description": "Left position as a percentage (0-100)"},
                    "y": {"type": "number", "description": "Top position as a percentage (0-100)"},
                    "width": {"type": "number", "description": "Width as a percentage (0-100)"},
                    "height": {"type": "number", "description": "Height as a percentage (0-100)"},
                },
                "required": ["x", "y", "width", "height"],
            },
        },
        "required": ["amount", "boundingBox"],
    },
}

class DetectionRequest(BaseModel):
    image_data: str  # base64エンコードされた画像データ
    target_currency: str = "USD"

class DetectionResponse(BaseModel):
    detections: List[Dict[str, Any]]
    success: bool
    error: str = None

class RateData(BaseModel):
    rates: Dict[str, float]
    timestamp: str

@app.get("/")
async def root():
    return {"message": "Currency Converter API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "api_key_configured": bool(GEMINI_API_KEY)}

@app.post("/detect-prices", response_model=DetectionResponse)
async def detect_prices(request: DetectionRequest):
    """画像から価格を検出する"""
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API key not configured")
    
    try:
        # 画像データをデコード
        image_data = base64.b64decode(request.image_data.split(',')[1] if ',' in request.image_data else request.image_data)
        image = Image.open(BytesIO(image_data))
        
        # Gemini Vision APIを使用
        model = genai.GenerativeModel('gemini-1.5-flash')
        
                prompt = f"""
                この画像内の価格と通貨記号を検出してください。価格は数値で表示されており、通貨記号（¥、$、€、£、₩など）が含まれている可能性があります。
                検出された価格の数値部分と通貨記号を抽出し、その位置情報も含めて返してください。
                ターゲット通貨: {request.target_currency}
                
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
        
        # JSONをパース
        try:
            detections = json.loads(result_text)
            if not isinstance(detections, list):
                detections = [detections]
        except json.JSONDecodeError:
            # JSONパースに失敗した場合、テキストから数値を抽出
            import re
            numbers = re.findall(r'\d+\.?\d*', result_text)
            detections = [{"amount": float(num), "boundingBox": {"x": 0, "y": 0, "width": 100, "height": 100}} for num in numbers[:5]]
        
        return DetectionResponse(detections=detections, success=True)
        
    except Exception as e:
        return DetectionResponse(detections=[], success=False, error=str(e))

@app.get("/exchange-rates", response_model=RateData)
async def get_exchange_rates():
    """為替レートを取得する"""
    try:
        # GMOコインのAPIから為替レートを取得
        response = requests.get("https://forex-api.coin.z.com/public/v1/ticker", timeout=10)
        response.raise_for_status()
        
        data = response.json()
        rates = {}
        
        # レスポンスから為替レートを抽出
        for item in data.get("data", []):
            symbol = item.get("symbol", "")
            price = item.get("ask", 0)
            if symbol and price:
                # シンボルから通貨ペアを分離
                if len(symbol) >= 6:
                    base_currency = symbol[:3]
                    quote_currency = symbol[3:6]
                    rates[f"{base_currency}/{quote_currency}"] = price
        
        return RateData(rates=rates, timestamp=data.get("timestamp", ""))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch exchange rates: {str(e)}")

@app.get("/convert")
async def convert_currency(amount: float, from_currency: str, to_currency: str):
    """通貨変換を行う"""
    try:
        rates_data = await get_exchange_rates()
        rates = rates_data.rates
        
        # 通貨ペアのキーを構築
        pair_key = f"{from_currency}/{to_currency}"
        reverse_pair_key = f"{to_currency}/{from_currency}"
        
        if pair_key in rates:
            converted_amount = amount * rates[pair_key]
        elif reverse_pair_key in rates:
            converted_amount = amount / rates[reverse_pair_key]
        else:
            raise HTTPException(status_code=400, detail=f"Exchange rate not found for {from_currency}/{to_currency}")
        
        return {
            "original_amount": amount,
            "from_currency": from_currency,
            "to_currency": to_currency,
            "converted_amount": round(converted_amount, 2),
            "exchange_rate": rates.get(pair_key, 1/rates.get(reverse_pair_key, 1))
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    load_dotenv()
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
