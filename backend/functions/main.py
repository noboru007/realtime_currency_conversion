import functions_framework
from flask import jsonify, request
import google.generativeai as genai
import requests
import json
import base64
import os
from io import BytesIO
from PIL import Image

# Gemini API設定
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

@functions_framework.http
def detect_prices(request):
    """画像から価格を検出するFirebase Function"""
    # CORS設定
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)
    
    headers = {
        'Access-Control-Allow-Origin': '*'
    }
    
    try:
        if request.method != 'POST':
            return (jsonify({'error': 'Method not allowed'}), 405, headers)
        
        data = request.get_json()
        if not data or 'image_data' not in data:
            return (jsonify({'error': 'Missing image_data'}), 400, headers)
        
        image_data = data['image_data']
        target_currency = data.get('target_currency', 'USD')
        
        # 画像データをデコード
        image_bytes = base64.b64decode(image_data.split(',')[1] if ',' in image_data else image_data)
        image = Image.open(BytesIO(image_bytes))
        
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
        
        return (jsonify({
            'detections': detections,
            'success': True
        }), 200, headers)
        
    except Exception as e:
        return (jsonify({
            'detections': [],
            'success': False,
            'error': str(e)
        }), 500, headers)

@functions_framework.http
def exchange_rates(request):
    """為替レートを取得するFirebase Function"""
    # CORS設定
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)
    
    headers = {
        'Access-Control-Allow-Origin': '*'
    }
    
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
        
        return (jsonify({
            'rates': rates,
            'timestamp': data.get("timestamp", ""),
            'success': True
        }), 200, headers)
        
    except Exception as e:
        return (jsonify({
            'rates': {},
            'success': False,
            'error': str(e)
        }), 500, headers)

@functions_framework.http
def convert_currency(request):
    """通貨変換を行うFirebase Function"""
    # CORS設定
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)
    
    headers = {
        'Access-Control-Allow-Origin': '*'
    }
    
    try:
        amount = float(request.args.get('amount', 0))
        from_currency = request.args.get('from_currency', 'JPY')
        to_currency = request.args.get('to_currency', 'USD')
        
        # 為替レートを取得
        rates_response = requests.get("https://forex-api.coin.z.com/public/v1/ticker", timeout=10)
        rates_response.raise_for_status()
        rates_data = rates_response.json()
        
        rates = {}
        for item in rates_data.get("data", []):
            symbol = item.get("symbol", "")
            price = item.get("ask", 0)
            if symbol and price:
                if len(symbol) >= 6:
                    base_currency = symbol[:3]
                    quote_currency = symbol[3:6]
                    rates[f"{base_currency}/{quote_currency}"] = price
        
        # 通貨ペアのキーを構築
        pair_key = f"{from_currency}/{to_currency}"
        reverse_pair_key = f"{to_currency}/{from_currency}"
        
        if pair_key in rates:
            converted_amount = amount * rates[pair_key]
            exchange_rate = rates[pair_key]
        elif reverse_pair_key in rates:
            converted_amount = amount / rates[reverse_pair_key]
            exchange_rate = 1 / rates[reverse_pair_key]
        else:
            return (jsonify({
                'error': f'Exchange rate not found for {from_currency}/{to_currency}',
                'success': False
            }), 400, headers)
        
        return (jsonify({
            'original_amount': amount,
            'from_currency': from_currency,
            'to_currency': to_currency,
            'converted_amount': round(converted_amount, 2),
            'exchange_rate': exchange_rate,
            'success': True
        }), 200, headers)
        
    except Exception as e:
        return (jsonify({
            'error': str(e),
            'success': False
        }), 500, headers)