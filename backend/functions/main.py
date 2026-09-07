"""Firebase Cloud Functions エントリーポイント

Cloud Functionの定義のみを含む。ビジネスロジックはservicesパッケージに分離。
"""

import base64
import json
import os
import traceback
import uuid

import firebase_admin
from firebase_admin import firestore, initialize_app, storage
from firebase_functions import firestore_fn, https_fn, options

from services.exchange_rates import fetch_and_cache_rates
from services.geocoding import get_currency_from_coordinates

# Firebase SDKの初期化
if not firebase_admin._apps:
    initialize_app()


# ---------------------------------------------------------------------------
# 1. 為替レート取得
# ---------------------------------------------------------------------------
@https_fn.on_request(
    cors=options.CorsOptions(cors_origins=["*"], cors_methods=["get", "options"]),
    secrets=["OPEN_EXCHANGE_RATE_APP_ID"],
    region="asia-northeast1",
)
def getExchangeRates(req: https_fn.Request) -> https_fn.Response:
    """Firebase Storageを24時間キャッシュとして利用し、為替レートを取得する"""
    try:
        result = fetch_and_cache_rates()
        return https_fn.Response(
            json.dumps(result["data"]),
            status=200,
            headers={
                "Content-Type": "application/json",
                "X-Cache-Status": result["cache_status"],
            },
        )
    except Exception as e:
        print(traceback.format_exc())
        return https_fn.Response(
            json.dumps({"success": False, "error": f"Failed to fetch exchange rates: {str(e)}"}),
            status=500,
            headers={"Content-Type": "application/json"},
        )


# ---------------------------------------------------------------------------
# 2. 位置情報から通貨コード取得
# ---------------------------------------------------------------------------
@https_fn.on_request(
    cors=options.CorsOptions(cors_origins=["*"], cors_methods=["post", "options"]),
    secrets=["OPENCAGE_API_KEY"],
    region="asia-northeast1",
)
def getCurrencyFromLocation(req: https_fn.Request) -> https_fn.Response:
    """緯度・経度から国を特定し、その国の通貨コードを返す"""
    try:
        request_json = req.get_json(silent=True)
        if not request_json or 'lat' not in request_json or 'lon' not in request_json:
            return https_fn.Response(
                json.dumps({"success": False, "error": "Invalid request"}),
                status=400,
                headers={"Content-Type": "application/json"},
            )

        result = get_currency_from_coordinates(request_json['lat'], request_json['lon'])
        return https_fn.Response(
            json.dumps(result),
            status=200,
            headers={"Content-Type": "application/json"},
        )

    except Exception as e:
        # OpenCage APIのクォータ超過は200で返す（USDフォールバック）
        if hasattr(e, '__cause__') or 'HTTPError' in type(e).__name__:
            import requests as req_lib
            if isinstance(e, req_lib.exceptions.HTTPError) and e.response.status_code == 402:
                print("WARN: OpenCage API Quota exceeded (402). Returning USD as default.")
                return https_fn.Response(
                    json.dumps({
                        "success": True,
                        "country_code": "",
                        "currency_code": "USD",
                        "cache": "fallback",
                    }),
                    status=200,
                    headers={"Content-Type": "application/json"},
                )

        print(traceback.format_exc())
        return https_fn.Response(
            json.dumps({"success": False, "error": f"An unexpected error occurred: {str(e)}"}),
            status=500,
            headers={"Content-Type": "application/json"},
        )


# ---------------------------------------------------------------------------
# 3. 価格検出（HTTPトリガー：ジョブ受付）
# ---------------------------------------------------------------------------
@https_fn.on_request(
    cors=options.CorsOptions(cors_origins=["*"], cors_methods=["get", "post", "options"]),
    secrets=["GEMINI_API_KEY"],
    region="asia-northeast1",
    memory=options.MemoryOption.GB_1,
    timeout_sec=60,
)
def detectPrices(req: https_fn.Request) -> https_fn.Response:
    """画像を受け付け、バックグラウンド処理ジョブを開始する"""
    db = firestore.client()
    try:
        request_json = req.get_json(silent=True)
        if not request_json or 'image_data' not in request_json:
            return https_fn.Response(
                json.dumps({"success": False, "error": "Invalid request"}),
                status=400,
                headers={"Content-Type": "application/json"},
            )

        job_id = str(uuid.uuid4())
        image_data_base64 = request_json['image_data']
        image_content_base64 = (
            image_data_base64.split(',')[1]
            if ',' in image_data_base64
            else image_data_base64
        )
        image_bytes = base64.b64decode(image_content_base64)

        # 画像をCloud Storageにアップロード
        bucket = storage.bucket()
        blob = bucket.blob(f"uploads/{job_id}.png")
        blob.upload_from_string(image_bytes, content_type="image/png")

        # Firestoreにジョブドキュメントを作成（processImageトリガーが発火）
        job_ref = db.collection('detectionJobs').document(job_id)
        job_ref.set({
            'status': 'pending',
            'createdAt': firestore.SERVER_TIMESTAMP,
            'originalImageUri': blob.public_url,
            'targetCurrency': request_json.get('target_currency', 'USD'),
            'language': request_json.get('language', 'English'),
            'localCurrency': request_json.get('local_currency', ''),
            'exchangeRate': request_json.get('exchange_rate') or 1.0,
            'deviceOrientation': request_json.get('device_orientation', 'portrait'),
            'thinkingLevel': request_json.get('thinking_level', 'medium'),
            'overlayModel': request_json.get('overlay_model', 'gemini-3-flash-preview'),
        })

        return https_fn.Response(
            json.dumps({"success": True, "jobId": job_id}),
            status=202,
            headers={"Content-Type": "application/json"},
        )

    except Exception as e:
        print(traceback.format_exc())
        return https_fn.Response(
            json.dumps({"success": False, "error": f"An unexpected error occurred: {str(e)}"}),
            status=500,
            headers={"Content-Type": "application/json"},
        )


# ---------------------------------------------------------------------------
# 4. 画像処理（Firestoreトリガー：バックグラウンド処理）
# ---------------------------------------------------------------------------
@firestore_fn.on_document_created(
    document="detectionJobs/{jobId}",
    secrets=["GEMINI_API_KEY"],
    region="asia-northeast1",
    memory=options.MemoryOption.GB_2,
    timeout_sec=540,
)
def processImage(event: firestore_fn.Event[firestore_fn.Change]) -> None:
    """Firestoreにジョブが作成されたのをトリガーに、画像処理を実行する"""
    job_id = event.params.get("jobId")
    if not job_id:
        print("Error: job_id not found in event parameters.")
        return

    db = firestore.client()
    job_ref = db.collection('detectionJobs').document(job_id)

    try:
        job_data = event.data.to_dict()
        if job_data is None:
            raise ValueError("event.data is None, cannot proceed.")

        print(f"[Job {job_id}] Processing started.")
        job_ref.update({'status': 'processing'})

        # Cloud Storageから画像を取得
        bucket = storage.bucket()
        blob = bucket.blob(f"uploads/{job_id}.png")
        image_bytes = blob.download_as_bytes()

        # Gemini APIで検出処理
        from services.detection import detect_prices_from_image
        api_key = os.getenv("GEMINI_API_KEY")
        client_detections = detect_prices_from_image(
            image_bytes=image_bytes,
            api_key=api_key,
            target_currency=job_data.get('targetCurrency', 'USD'),
            language=job_data.get('language', 'English'),
            exchange_rate=job_data.get('exchangeRate') or 1.0,
            device_orientation=job_data.get('deviceOrientation', 'portrait'),
            job_id=job_id,
            thinking_level=job_data.get('thinkingLevel', 'medium'),
            overlay_model=job_data.get('overlayModel', 'gemini-3-flash-preview'),
        )

        # 結果をFirestoreに書き込み
        job_ref.update({
            'status': 'completed',
            'completedAt': firestore.SERVER_TIMESTAMP,
            'detections': client_detections,
        })
        print(f"[Job {job_id}] Completed with {len(client_detections)} detections.")

        # アップロード画像を削除
        try:
            blob_to_delete = bucket.blob(f"uploads/{job_id}.png")
            if blob_to_delete.exists():
                blob_to_delete.delete()
                print(f"[Job {job_id}] Uploaded file deleted.")
        except Exception as e:
            print(f"[Job {job_id}] WARNING: Failed to delete uploaded file: {e}")

    except Exception as e:
        print(f"[Job {job_id}] Error: {str(e)}")
        print(traceback.format_exc())
        job_ref.update({
            'status': 'error',
            'error': str(e),
            'completedAt': firestore.SERVER_TIMESTAMP,
        })


# ---------------------------------------------------------------------------
# 5. 画像翻訳（HTTPトリガー：ジョブ受付）
# ---------------------------------------------------------------------------
@https_fn.on_request(
    cors=options.CorsOptions(cors_origins=["*"], cors_methods=["get", "post", "options"]),
    secrets=["GEMINI_API_KEY"],
    region="asia-northeast1",
    memory=options.MemoryOption.GB_1,
    timeout_sec=60,
)
def translateImage(req: https_fn.Request) -> https_fn.Response:
    """画像を受け付け、Nano Banana 2による画像翻訳ジョブを開始する"""
    db_client = firestore.client()
    try:
        request_json = req.get_json(silent=True)
        if not request_json or 'image_data' not in request_json:
            return https_fn.Response(
                json.dumps({"success": False, "error": "Invalid request"}),
                status=400,
                headers={"Content-Type": "application/json"},
            )

        job_id = str(uuid.uuid4())
        image_data_base64 = request_json['image_data']
        image_content_base64 = (
            image_data_base64.split(',')[1]
            if ',' in image_data_base64
            else image_data_base64
        )
        image_bytes = base64.b64decode(image_content_base64)

        # 画像をCloud Storageにアップロード
        bucket = storage.bucket()
        blob = bucket.blob(f"uploads/{job_id}.png")
        blob.upload_from_string(image_bytes, content_type="image/png")

        # Firestoreにジョブドキュメントを作成（processImageTranslationトリガーが発火）
        job_ref = db_client.collection('translationJobs').document(job_id)
        job_ref.set({
            'status': 'pending',
            'createdAt': firestore.SERVER_TIMESTAMP,
            'originalImageUri': blob.public_url,
            'language': request_json.get('language', 'English'),
            'localCurrency': request_json.get('local_currency', ''),
            'homeCurrency': request_json.get('home_currency', 'USD'),
            'exchangeRate': request_json.get('exchange_rate') or 1.0,
            'imageSize': request_json.get('image_size', '1K'),
            'userId': request_json.get('user_id', ''),
            'thinkingLevel': request_json.get('thinking_level', 'medium'),
            'imageModel': request_json.get('image_model', 'nanobanana2'),
        })

        return https_fn.Response(
            json.dumps({"success": True, "jobId": job_id}),
            status=202,
            headers={"Content-Type": "application/json"},
        )

    except Exception as e:
        print(traceback.format_exc())
        return https_fn.Response(
            json.dumps({"success": False, "error": f"An unexpected error occurred: {str(e)}"}),
            status=500,
            headers={"Content-Type": "application/json"},
        )


# ---------------------------------------------------------------------------
# 6. 画像翻訳処理（Firestoreトリガー：バックグラウンド処理）
# ---------------------------------------------------------------------------
@firestore_fn.on_document_created(
    document="translationJobs/{jobId}",
    secrets=["GEMINI_API_KEY"],
    region="asia-northeast1",
    memory=options.MemoryOption.GB_2,
    timeout_sec=540,
)
def processImageTranslation(event: firestore_fn.Event[firestore_fn.Change]) -> None:
    """Firestoreにジョブが作成されたのをトリガーに、Nano Banana 2で画像翻訳を実行する"""
    job_id = event.params.get("jobId")
    if not job_id:
        print("Error: job_id not found in event parameters.")
        return

    db_client = firestore.client()
    job_ref = db_client.collection('translationJobs').document(job_id)

    try:
        job_data = event.data.to_dict()
        if job_data is None:
            raise ValueError("event.data is None, cannot proceed.")

        print(f"[Translation {job_id}] Processing started.")
        job_ref.update({'status': 'processing'})

        # Cloud Storageから元画像を取得
        bucket = storage.bucket()
        blob = bucket.blob(f"uploads/{job_id}.png")
        image_bytes = blob.download_as_bytes()

        # Nano Banana 2で画像翻訳
        from services.image_translation import translate_image
        api_key = os.getenv("GEMINI_API_KEY")
        generated_image_bytes = translate_image(
            image_bytes=image_bytes,
            api_key=api_key,
            language=job_data.get('language', 'English'),
            local_currency=job_data.get('localCurrency', ''),
            home_currency=job_data.get('homeCurrency', 'USD'),
            exchange_rate=job_data.get('exchangeRate') or 1.0,
            job_id=job_id,
            image_size=job_data.get('imageSize', '1K'),
            thinking_level=job_data.get('thinkingLevel', 'medium'),
            image_model=job_data.get('imageModel', 'nanobanana2'),
        )

        if generated_image_bytes is None:
            raise ValueError("Nano Banana 2 did not generate an image.")

        # 生成画像をCloud Storageに保存
        translated_blob = bucket.blob(f"translations/{job_id}.png")
        translated_blob.upload_from_string(generated_image_bytes, content_type="image/png")
        # 公開URLを取得（署名付きURLの代わりにpublic URLを使用）
        translated_blob.make_public()
        translated_image_url = translated_blob.public_url

        # 結果をFirestoreに書き込み
        job_ref.update({
            'status': 'completed',
            'completedAt': firestore.SERVER_TIMESTAMP,
            'translatedImageUrl': translated_image_url,
        })
        print(f"[Translation {job_id}] Completed. Image URL: {translated_image_url}")

        # アップロード元画像を削除
        try:
            upload_blob = bucket.blob(f"uploads/{job_id}.png")
            if upload_blob.exists():
                upload_blob.delete()
                print(f"[Translation {job_id}] Uploaded file deleted.")
        except Exception as e:
            print(f"[Translation {job_id}] WARNING: Failed to delete uploaded file: {e}")

    except Exception as e:
        print(f"[Translation {job_id}] Error: {str(e)}")
        print(traceback.format_exc())
        job_ref.update({
            'status': 'error',
            'error': str(e),
            'completedAt': firestore.SERVER_TIMESTAMP,
        })