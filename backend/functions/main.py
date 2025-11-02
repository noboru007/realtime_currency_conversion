import base64
import collections
import hashlib
import io
import json
import os
import re
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
import binascii

import firebase_admin
from firebase_admin import firestore, initialize_app, storage
from firebase_functions import firestore_fn, https_fn, options
import google.auth
from google.cloud import iam_credentials_v1
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
from PIL import Image, ImageDraw, ImageFont
import six
import requests

# 定数
FONT_MAP = {
    "Japanese": "NotoSansJP-Regular.ttf",
    "Korean": "NotoSansKR-Regular.ttf",
    "Hindi": "NotoSansDevanagari-Regular.ttf",
    "Simplified Chinese": "NotoSansSC-Regular.ttf",
    "Traditional Chinese": "NotoSansTC-Regular.ttf",
    "Thai": "NotoSansThai-Regular.ttf",
    # FONT_MAPに言語コードのキーは不要。promptNameで統一する。
}

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
		
		detections_for_response = []
		draw_img = img.copy() # デフォルトは元の画像
		
		try:
			bounding_boxes_text = response.text.strip()
			match = re.search(r'```json\s*([\s\S]*?)\s*```', bounding_boxes_text, re.DOTALL)
			json_str = match.group(1) if match else bounding_boxes_text
			detected_pairs = json.loads(json_str) if json_str else []
			print(f"--- [Job {job_id}] 4. JSON parsed. Found {len(detected_pairs)} pairs. ---")
			
			if detected_pairs:
				draw = ImageDraw.Draw(draw_img)
				width, height = img.size
				
				font_file_name = FONT_MAP.get(language) # ★ 言語名で直接フォントを引く
				font_path = None
				is_truetype = False
				if font_file_name:
					font_path = f"/tmp/{font_file_name}"
					try:
						if not os.path.exists(font_path):
							bucket = storage.bucket()
							blob = bucket.blob(f"fonts/{font_file_name}")
							blob.download_to_filename(font_path)
						font = ImageFont.truetype(font_path, size=16) 
						is_truetype = True
					except Exception as e:
						print(f"--- WARNING: Job {job_id}: Failed to load TTF font '{font_file_name}': {e}. Using default. ---")
				
				MIN_FONT_SIZE, MAX_FONT_SIZE = 8, 48
				colors = [
					"#FF8866",  # コーラルオレンジ
					"#FFD966",  # 明るいイエロー
					"#66FF88",  # ライムグリーン
					"#66FFDD",  # アクア/シアン
					"#66B3FF",  # スカイブルー
					"#8888FF",  # 明るいインディゴ
					"#DD66FF",  # ラベンダー
					"#FF66E8",  # ピンク
					"#FF6699",  # ホットピンク
					"#FF9966",  # ピーチ
					"#BBFF66",  # イエローグリーン
					"#66FFBB"   # ミントグリーン
				]

				for i, pair in enumerate(detected_pairs):
					color = colors[i % len(colors)]
					
					# --- Price Drawing ---
					price_text = pair.get("price_text", "")
					price_box = pair.get("price_box")
					if price_text and price_box and len(price_box) == 4:
						py0_norm, px0_norm, py1_norm, px1_norm = [float(c) for c in price_box]
						py0, px0 = int(py0_norm / 1000 * height), int(px0_norm / 1000 * width)
						py1, px1 = int(py1_norm / 1000 * height), int(px1_norm / 1000 * width)
						if py0 > py1: py0, py1 = py1, py0
						if px0 > px1: px0, px1 = px1, px0
						draw.rectangle(((px0, py0), (px1, py1)), outline=color, width=1)
						
						p_font_size = max(MIN_FONT_SIZE, min(int((py1 - py0) * 0.8), MAX_FONT_SIZE))
						final_font_p = ImageFont.truetype(font_path, size=p_font_size) if is_truetype and font_path else get_default_font(p_font_size)
						
						# AIから渡された金額をターゲット通貨に変換
						converted_price_text = convert_and_format_currency(float(price_text), target_currency, exchange_rate)
						draw.text((px0 + 5, py0 + 5), str(converted_price_text), fill=color, font=final_font_p, stroke_width=1, stroke_fill="black")

						match = re.search(r'([\d,.]*\d)', str(price_text)) # フロントには数値のみを返す。カンマは削除。今はフロントでは一つでも値段情報が返ってきたか否かの判定にしか使っていないが、英語文字の縦書きとかPillowで出来ないならフロントでやった方が良いかも。
						if match:
							price_str = match.group(0).replace(',', '')
							if price_str.count('.') <= 1:
								detections_for_response.append({
									'amount': float(price_str),
									'boundingBox': {'x': px0, 'y': py0, 'width': px1 - px0, 'height': py1 - py0}
								})

					# --- Item Drawing ---
					item_text = pair.get("item_text", "")
					item_box = pair.get("item_box")
					if item_text and item_box and len(item_box) == 4:
						if len(item_text) > 60:
							item_text = item_text[:57] + "..."
						
						iy0_norm, ix0_norm, iy1_norm, ix1_norm = [float(c) for c in item_box]
						iy0, ix0 = int(iy0_norm / 1000 * height), int(ix0_norm / 1000 * width)
						iy1, ix1 = int(iy1_norm / 1000 * height), int(ix1_norm / 1000 * width)
						if iy0 > iy1: iy0, iy1 = iy1, iy0
						if ix0 > ix1: ix0, ix1 = ix1, ix1
						draw.rectangle(((ix0, iy0), (ix1, iy1)), outline=color, width=2)

						# --- Find the best font size for Item ---
						max_font_size = 50
						min_font_size = 8
						final_font_i = None
						# Iterate from max_font_size down to min_font_size to find the best fit
						for font_size_i in range(max_font_size, min_font_size - 1, -1):
							try:
								# Try to load the font
								font_i = ImageFont.truetype(font_path, font_size_i) if is_truetype and font_path else get_default_font(font_size_i)
								text_bbox_i = draw.textbbox((0, 0), item_text, font=font_i)
								text_width_i = text_bbox_i[2] - text_bbox_i[0]
								text_height_i = text_bbox_i[3] - text_bbox_i[1]
								if text_width_i <= ix1 - ix0 and text_height_i <= iy1 - iy0:
									final_font_i = font_i
									break
							except Exception as e:
								print(f"--- WARNING: Job {job_id}: Failed to load font for item text: {e}. Trying smaller size. ---")
								continue
						else:
							# Fallback to a small font size if no suitable size is found
							final_font_i = ImageFont.truetype(font_path, 10) if is_truetype and font_path else get_default_font(10)
						
						draw.text((ix0 + 1, iy0 + 1), item_text, fill=color, font=final_font_i, stroke_width=1, stroke_fill="black")
			
				print(f"--- [Job {job_id}] 5. AR drawing finished. ---")
			else:
				print(f"--- [Job {job_id}] 5. No pairs found. ---")
						
		except (AttributeError, json.JSONDecodeError, ValueError) as e:
			print(f"Job {job_id}: JSON parsing or drawing failed. Using original image. Error: {e}")

		buffered = io.BytesIO()
		draw_img.save(buffered, format="PNG")
		result_blob = bucket.blob(f"results/{job_id}.png")
		result_blob.upload_from_string(buffered.getvalue(), content_type="image/png")

		try:
			signed_url = generate_signed_url_v4_manual(bucket_name=bucket.name, object_name=result_blob.name)
			print(f"--- [Job {job_id}] 6. Signed URL generated manually successfully. ---")
		
		except Exception as sign_error:
			print(f"--- [Job {job_id}] ERROR: Failed to generate signed URL manually: {sign_error}")
			print(traceback.format_exc())
			raise

		print(f"--- [Job {job_id}] DEBUG: Final detections for Firestore: {detections_for_response} ---")
		update_data = {
			'status': 'completed',
			'completedAt': firestore.SERVER_TIMESTAMP,
			'processedImageUri': signed_url,
			'detections': detections_for_response
		}
		print(f"--- [Job {job_id}] 7a. Preparing to update Firestore with final data. ---")
		job_ref.update(update_data)
		print(f"--- [Job {job_id}] 7b. Firestore update completed. ---")

	except Exception as e:
		print(f"Job {job_id}: An unexpected error occurred in the main try block.")
		print(traceback.format_exc())
		job_ref.update({
			'status': 'error', 'error': str(e),
			'completedAt': firestore.SERVER_TIMESTAMP
		})
	return

def generate_signed_url_v4_manual(bucket_name, object_name, expiration_seconds=900, http_method="GET"):
	"""
	Cloud Functions環境でサービスアカウント認証情報を使い、手動でV4署名付きURLを生成する。
	iamcredentials.googleapis.com API を「直接」呼び出す。
	"""
	# 1. デフォルトの認証情報を取得 (SAのEmailと権限を行使するため)
	default_credentials, project_id = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])

	# 2. [削除] 偽装(impersonation)は不要。
	# デフォルトSAがIAM APIを直接呼び出す権限(TokenCreator)を持っているため。

	# 3. 必須パラメータを設定
	datetime_now = datetime.now(timezone.utc)
	request_timestamp = datetime_now.strftime("%Y%m%dT%H%M%SZ")
	datestamp = datetime_now.strftime("%Y%m%d")
	
	# ★ 修正: signing_credentials ではなく default_credentials から email を取得
	service_account_email = "750787091585-compute@developer.gserviceaccount.com"
	credential_scope = f"{datestamp}/auto/storage/goog4_request"
	credential = f"{service_account_email}/{credential_scope}"
	
	host = f"storage.googleapis.com"
	escaped_object_name = quote(six.ensure_binary(object_name), safe=b"/~")
	canonical_uri = f'/{bucket_name}/{escaped_object_name}'

	headers = {"host": host}
	canonical_headers = ""
	ordered_headers = collections.OrderedDict(sorted(headers.items()))
	for k, v in ordered_headers.items():
		lower_k = str(k).lower()
		strip_v = str(v).strip()
		canonical_headers += f"{lower_k}:{strip_v}\n"
	
	signed_headers = ";".join(sorted([k.lower() for k in headers.keys()]))

	query_parameters = {
		'X-Goog-Algorithm': 'GOOG4-RSA-SHA256', 'X-Goog-Credential': credential,
		'X-Goog-Date': request_timestamp, 'X-Goog-Expires': str(expiration_seconds),
		'X-Goog-SignedHeaders': signed_headers
	}
	canonical_query_string = ""
	ordered_query_parameters = collections.OrderedDict(sorted(query_parameters.items()))
	for k, v in ordered_query_parameters.items():
		encoded_k = quote(str(k), safe="")
		encoded_v = quote(str(v), safe="")
		canonical_query_string += f"{encoded_k}={encoded_v}&"
	canonical_query_string = canonical_query_string[:-1]
	
	# 4c. Canonical Request の結合
	canonical_request = "\n".join([
		http_method,
		canonical_uri,
		canonical_query_string,
		canonical_headers,
		signed_headers,
		"UNSIGNED-PAYLOAD"
	])
	
	canonical_request_hash = hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()

	# 5. String-to-Sign を作成
	string_to_sign = "\n".join([
		'GOOG4-RSA-SHA256',
		request_timestamp,
		credential_scope,
		canonical_request_hash
	])

	iam_client = iam_credentials_v1.IAMCredentialsClient()

    # 6b. 署名リクエストを作成
	# サービスアカウントパスには上で定義した正しいメールアドレスが使われる
	service_account_path = f"projects/-/serviceAccounts/{service_account_email}"
	payload = string_to_sign.encode('utf-8')
	
	sign_blob_request = iam_credentials_v1.SignBlobRequest(
		name=service_account_path, # ここで正しいEmailが使われるはず
		payload=payload,
	)
	

	# 6c. signBlob API を実行
	sign_blob_response = iam_client.sign_blob(sign_blob_request)
	
	# 6d. 署名（バイナリ）を16進数文字列に変換
	signature = binascii.hexlify(sign_blob_response.signed_blob).decode('utf-8')

	scheme_and_host = f"https://{host}"
	signed_url = f"{scheme_and_host}{canonical_uri}?{canonical_query_string}&X-Goog-Signature={signature}"

	return signed_url