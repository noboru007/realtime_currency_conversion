import base64
import io
import json
import os
import re
import traceback
import uuid
from datetime import datetime, timedelta, timezone
import requests

import firebase_admin
from firebase_admin import firestore, initialize_app, storage
from firebase_functions import firestore_fn, https_fn, options
import google.generativeai as genai
from PIL import Image

# 定数
# FONT_MAPはクライアントサイドでの描画に移行したため不要

def convert_and_format_currency(amount, currency_code, exchange_rate):
    """通貨記号を付けて数値をフォーマットする"""
    if currency_code in ['JPY', 'KRW', 'VND', 'IDR']:
        # 小数点以下を四捨五入して整数にする通貨
        formatted_amount = f"{int(round(amount * exchange_rate, 0)):,}"
    else:
        # 小数点以下2桁で表示する通貨
        formatted_amount = f"{amount * exchange_rate:,.2f}"

    # 通貨記号を前に付けるか後ろに付けるかの簡易的なマッピング
    symbol_map = {
        'JPY': f'¥{formatted_amount}',
        'USD': f'${formatted_amount}',
        'EUR': f'€{formatted_amount}',
        'GBP': f'£{formatted_amount}',
        'KRW': f'₩{formatted_amount}',
        'VND': f'₫{formatted_amount}',
        'IDR': f'Rp{formatted_amount}',
        'THB': f'฿{formatted_amount}',
        'MYR': f'RM{formatted_amount}',
        'PHP': f'₱{formatted_amount}',
        'SGD': f'S${formatted_amount}',
        'HKD': f'HK${formatted_amount}',
        'NZD': f'NZ${formatted_amount}',
        'CNY': f'¥{formatted_amount}',
        'AUD': f'A${formatted_amount}',
        'CAD': f'C${formatted_amount}',
    }
    # マップにない場合は、コードを後ろにつける
    return symbol_map.get(currency_code, f'{formatted_amount} {currency_code}')

# Firebase SDKの初期化
if not firebase_admin._apps:
    initialize_app()

def get_default_font(size):
    """要求されたサイズのデフォルトフォントを返す"""
    return ImageFont.load_default()

@https_fn.on_request(
    cors=options.CorsOptions(cors_origins=["*"], cors_methods=["get", "options"]),
    secrets=["OPEN_EXCHANGE_RATE_APP_ID"],
    region="asia-northeast1" # リージョンを明示的に指定
)
def getExchangeRates(req: https_fn.Request) -> https_fn.Response:
    """
    Firebase Storageを24時間キャッシュとして利用し、為替レートを取得します。
    APIから取得した中間レートを元にBid/Askレートを生成します。
    """
    try:
        jst = timezone(timedelta(hours=9))
        is_local = os.getenv("FUNCTIONS_EMULATOR") is None and os.getenv("K_SERVICE") is None
        
        if not is_local:
            bucket = storage.bucket() 
            blob = bucket.blob("rates.json")
        now = datetime.now(jst)
        if blob.exists():
            blob.reload()
            updated_time = blob.updated
            if updated_time and (now - updated_time) < timedelta(hours=24):
                cached_data = json.loads(blob.download_as_string())
                return https_fn.Response(json.dumps(cached_data), status=200, headers={"Content-Type": "application/json", "X-Cache-Status": "HIT"})

        app_id = os.getenv("OPEN_EXCHANGE_RATE_APP_ID")
        if not app_id:
            raise ValueError("OPEN_EXCHANGE_RATE_APP_ID secret not configured.")

        api_url = f"https://openexchangerates.org/api/latest.json?app_id={app_id}"
        api_response = requests.get(api_url, timeout=15)
        api_response.raise_for_status()
        api_data = api_response.json()

        processed_rates = {}
        api_timestamp = api_data.get("timestamp")
        dt_object_jst = datetime.fromtimestamp(api_timestamp, jst)
        formatted_timestamp = dt_object_jst.strftime('%Y%m%d %H:%M:%S')
        base_currency = api_data.get("base", "USD")
        
        for currency, rate in api_data.get("rates", {}).items():
            pair_name = f"{base_currency}/{currency}"
            bid = rate * 0.99
            ask = rate * 1.01
            processed_rates[pair_name] = {"bid": bid, "ask": ask}

        final_data = {
            "rates": processed_rates, "timestamp_unix": api_timestamp,
            "timestamp_jst": formatted_timestamp, "base_currency": base_currency
        }
        
        bucket = storage.bucket()
        blob = bucket.blob("rates.json") # blobを再定義
        blob.upload_from_string(json.dumps(final_data), content_type="application/json")
        
        return https_fn.Response(json.dumps(final_data), status=200, headers={"Content-Type": "application/json", "X-Cache-Status": "MISS"})
    except Exception as e:
        print(traceback.format_exc())
        return https_fn.Response(json.dumps({"success": False, "error": f"Failed to fetch exchange rates: {str(e)}"}), status=500, headers={"Content-Type": "application/json"})

@https_fn.on_request(
    cors=options.CorsOptions(cors_origins=["*"], cors_methods=["post", "options"]),
    secrets=["OPENCAGE_API_KEY"],
    region="asia-northeast1"
)
def getCurrencyFromLocation(req: https_fn.Request) -> https_fn.Response:
    """
    緯度・経度から国を特定し、その国の通貨コードを返します。
    結果はFirestoreに7日間キャッシュされます。
    """
    db = firestore.client()
    try:
        request_json = req.get_json(silent=True)
        if not request_json or 'lat' not in request_json or 'lon' not in request_json:
            return https_fn.Response(json.dumps({"success": False, "error": "Invalid request"}), status=400)

        lat = request_json['lat']
        lon = request_json['lon']

        cache_key = f"lat_{round(lat, 2)}_lon_{round(lon, 2)}"
        cache_ref = db.collection('locationCache').document(cache_key)
        
        try:
            cache_doc = cache_ref.get()
            if cache_doc.exists:
                cache_data = cache_doc.to_dict()
                cached_at = cache_data.get('timestamp')
                if cached_at and (datetime.now(timezone.utc) - cached_at.replace(tzinfo=timezone.utc)) < timedelta(days=7):
                    print(f"Cache HIT for {cache_key}")
                    return https_fn.Response(json.dumps({
                        "success": True, 
                        "country_code": cache_data.get("country_code", ""), 
                        "currency_code": cache_data.get("currency_code", ""),
                        "cache": "hit"
                    }), status=200, headers={"Content-Type": "application/json"})
        except Exception as e:
            print(f"Cache read failed for key {cache_key}: {e}")

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

        cache_ref.set({
            "currency_code": currency_code,
            "country_code": country_code,
            "timestamp": firestore.SERVER_TIMESTAMP,
        })
        
        return https_fn.Response(json.dumps({
            "success": True, 
            "country_code": country_code, 
            "currency_code": currency_code,
            "cache": "miss"
        }), status=200, headers={"Content-Type": "application/json"})

    except requests.exceptions.HTTPError as http_err:
        if http_err.response.status_code == 402:
            print("WARN: OpenCage API Quota exceeded (402). Returning USD as default.")
            return https_fn.Response(json.dumps({
                "success": True, 
                "country_code": "", 
                "currency_code": "USD",
                "cache": "fallback"
            }), status=200, headers={"Content-Type": "application/json"})
        else:
            print(traceback.format_exc())
            return https_fn.Response(json.dumps({"success": False, "error": f"API request failed: {str(http_err)}"}), status=500, headers={"Content-Type": "application/json"})

    except Exception as e:
        print(traceback.format_exc())
        return https_fn.Response(json.dumps({"success": False, "error": f"An unexpected error occurred: {str(e)}"}), status=500, headers={"Content-Type": "application/json"})
    
@https_fn.on_request(
    cors=options.CorsOptions(cors_origins=["*"], cors_methods=["get", "post", "options"]),
    secrets=["GEMINI_API_KEY"],
    region="asia-northeast1", # リージョンを明示的に指定
    memory=options.MemoryOption.GB_1, # 受付だけなのでメモリは少なくても良い
    timeout_sec=60 
)
def detectPrices(req: https_fn.Request) -> https_fn.Response:
    """画像を受け付け、バックグラウンド処理ジョブを開始する"""
    db = firestore.client()
    try:
        request_json = req.get_json(silent=True)
        if not request_json or 'image_data' not in request_json:
            return https_fn.Response(json.dumps({"success": False, "error": "Invalid request"}), status=400)

        job_id = str(uuid.uuid4())
        image_data_base64 = request_json['image_data']
        target_currency = request_json.get('target_currency', 'USD')
        language = request_json.get('language', 'English')
        local_currency = request_json.get('local_currency', '')
        exchange_rate = request_json.get('exchange_rate') or 1.0

        image_content_base64 = image_data_base64.split(',')[1] if ',' in image_data_base64 else image_data_base64
        image_bytes = base64.b64decode(image_content_base64)
        
        bucket = storage.bucket()
        blob = bucket.blob(f"uploads/{job_id}.png")
        blob.upload_from_string(image_bytes, content_type="image/png")

        job_ref = db.collection('detectionJobs').document(job_id)
        job_ref.set({
            'status': 'pending', 'createdAt': firestore.SERVER_TIMESTAMP,
            'originalImageUri': blob.public_url, 'targetCurrency': target_currency,
            'language': language,
            'localCurrency': local_currency,
            'exchangeRate': exchange_rate,
        })
            
        return https_fn.Response(
            json.dumps({"success": True, "jobId": job_id}),
            status=202, # 202 Accepted: リクエストは受け付けられたが、処理は完了していない
            headers={"Content-Type": "application/json"}
        )

    except Exception as e:
        print(traceback.format_exc())
        return https_fn.Response(
            json.dumps({"success": False, "error": f"An unexpected error occurred: {str(e)}"}),
            status=500,
            headers={"Content-Type": "application/json"}
        )

@firestore_fn.on_document_created(
    document="detectionJobs/{jobId}", 
    secrets=["GEMINI_API_KEY"], 
    region="asia-northeast1", # リージョンを明示的に指定
    memory=options.MemoryOption.GB_2, 
    timeout_sec=540
)
def processImage(event: firestore_fn.Event[firestore_fn.Change]) -> None:
	"""Firestoreにジョブが作成されたのをトリガーに、重い画像処理を実行する"""
	job_id = event.params.get("jobId")
	if not job_id:
		print("Error: job_id not found in event parameters.")
		return

	db = firestore.client()
	job_ref = db.collection('detectionJobs').document(job_id)

	try:
		print(f"--- [Job {job_id}] 0. processImage function started. ---")
		job_data = event.data.to_dict()
		if job_data is None:
			raise ValueError("event.data is None, cannot proceed.")
		print(f"--- [Job {job_id}] 1. processImage triggered for image: {job_data.get('originalImageUri')} ---")
		job_ref.update({'status': 'processing'})

		target_currency = job_data.get('targetCurrency', 'USD')
		language = job_data.get('language', 'English')
		local_currency = job_data.get('localCurrency', '')
		exchange_rate = job_data.get('exchangeRate') or 1.0
		
		rounding_instruction = "Round the result to 2 decimal places."
		if target_currency in ['JPY', 'KRW', 'VND', 'IDR']:
			rounding_instruction = "Round the result to the nearest integer (0 decimal places)."

		bucket = storage.bucket()
		blob = bucket.blob(f"uploads/{job_id}.png")
		image_bytes = blob.download_as_bytes()
		img = Image.open(io.BytesIO(image_bytes))

		api_key = os.getenv("GEMINI_API_KEY")
		genai.configure(api_key=api_key)
		
		prompt = f"""
		Detect all items and their corresponding prices in this image.
		Your response MUST be a valid JSON array of objects. Do not wrap it in markdown.
		Each object in the array represents a detected pair and MUST contain the following four keys: "price_text", "price_box", "item_text", and "item_box".

		- "price_text": Take the detected price. The result MUST be a numeric value only.
		- "price_box": A list of 4 numbers for the price's bounding box [y_min, x_min, y_max, x_max], normalized to 1000.
		- "item_text": Translate the item's name to {language}. If no corresponding item is found for a price, this MUST be an empty string "".
		- "item_box": A list of 4 numbers for the item's bounding box. If no item is found, this MUST be an empty list [].

		IMPORTANT:
		- ONLY include an object in the array if a "price_box" is clearly identified.
		- If an item has a price, it MUST be included. If a price is visible but has no clear item, it MUST also be included (with empty "item_text" and "item_box").
		- The "price_text" MUST be the converted value. Do not return the original detected price.
		"""
		print(f"--- [Job {job_id}] 2. Prompt generated. ---\n\n{prompt}")
		
		import time
		model = genai.GenerativeModel('gemini-2.5-flash')
		start_time = time.time()
		response = model.generate_content(
			contents=[prompt, img],
			generation_config=genai.GenerationConfig(temperature=0.5)
		)
		elapsed_time = time.time() - start_time
		print(f"--- [Job {job_id}] 3. Received response from Gemini. --- (elapsed: {elapsed_time:.2f}s\n{response.text})")
		
		client_detections = []
		try:
			bounding_boxes_text = response.text.strip()
			match = re.search(r'```json\s*([\s\S]*?)\s*```', bounding_boxes_text, re.DOTALL)
			json_str = match.group(1) if match else bounding_boxes_text
			detected_pairs = json.loads(json_str) if json_str else []
			print(f"--- [Job {job_id}] 4. JSON parsed. Found {len(detected_pairs)} pairs. ---")
			
			if detected_pairs:
				for pair in detected_pairs:
					price_text_raw = pair.get("price_text")
					price_box = pair.get("price_box")
					item_text = pair.get("item_text", "")
					item_box = pair.get("item_box")

					converted_price_text = ""
					if price_text_raw and price_box:
						try:
							# AIから渡された金額をターゲット通貨に変換
							converted_price_text = convert_and_format_currency(float(price_text_raw), target_currency, exchange_rate)
						except (ValueError, TypeError):
							# 数値変換できない場合は、元のテキストをそのまま使用
							converted_price_text = str(price_text_raw)

					# クライアント描画用のデータを整形
					client_detections.append({
						"itemText": item_text,
						"itemBox": item_box,
						"priceText": converted_price_text,
						"priceBox": price_box
					})
				print(f"--- [Job {job_id}] 5. Detection data processed for client. ---")
			else:
				print(f"--- [Job {job_id}] 5. No pairs found. ---")
						
		except (json.JSONDecodeError, ValueError) as e:
			print(f"Job {job_id}: JSON parsing or data processing failed. Error: {e}")
			# この場合でも、Firestoreのステータスはエラーではなく完了とし、detectionsは空配列のままにする
			client_detections = []

		print(f"--- [Job {job_id}] DEBUG: Final detections for Firestore: {client_detections} ---")
		update_data = {
			'status': 'completed',
			'completedAt': firestore.SERVER_TIMESTAMP,
			'detections': client_detections
		}
		print(f"--- [Job {job_id}] 7a. Preparing to update Firestore with final data. ---")
		job_ref.update(update_data)
		print(f"--- [Job {job_id}] 7b. Firestore update completed. ---")

		# --- Clean up the uploaded file ---
		try:
			blob_to_delete = bucket.blob(f"uploads/{job_id}.png")
			if blob_to_delete.exists():
				blob_to_delete.delete()
				print(f"--- [Job {job_id}] 8. Successfully deleted uploaded file: uploads/{job_id}.png ---")
		except Exception as e:
			print(f"--- [Job {job_id}] WARNING: Failed to delete uploaded file uploads/{job_id}.png. Error: {e} ---")

	except Exception as e:
		print(f"Job {job_id}: An unexpected error occurred in the main try block.")
		print(traceback.format_exc())
		job_ref.update({
			'status': 'error', 'error': str(e),
			'completedAt': firestore.SERVER_TIMESTAMP
		})
	return

# generate_signed_url_v4_manual はクライアントサイドでの描画に移行したため不要