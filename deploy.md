# Firebase デプロイ手順

## 前提条件
1. Node.js がインストールされている
2. Python 3.11 がインストールされている
3. Firebase CLI がインストールされている
4. Firebase プロジェクトが作成されている

## 手順

### 1. Firebase CLI のインストール（まだの場合）
```bash
npm install -g firebase-tools
```

### 2. Firebase にログイン
```bash
firebase login
```

### 3. プロジェクトの初期化
```bash
firebase init
```
- Hosting: Configure files for Firebase Hosting を選択
- Functions: Configure a Cloud Functions directory を選択
- 既存のプロジェクトを選択するか、新しいプロジェクトを作成

### 4. プロジェクトIDの設定
`.firebaserc` ファイルの `your-project-id` を実際のプロジェクトIDに変更

### 5. 環境変数の設定
Firebase Functions に環境変数を設定：
```bash
firebase functions:config:set gemini.api_key="YOUR_GEMINI_API_KEY"
```

### 6. フロントエンドのビルド
```bash
npm run build
```

### 7. デプロイ
```bash
firebase deploy
```

## 環境変数の設定

### 開発環境
`.env.local` ファイルを作成：
```
VITE_API_BASE_URL=http://localhost:8000
```

### 本番環境
Firebase Functions の環境変数を設定：
```bash
firebase functions:config:set gemini.api_key="YOUR_GEMINI_API_KEY"
```

## ローカル開発

### バックエンド（Python）の実行
```bash
cd backend
pip install -r requirements.txt
python main.py
```

### フロントエンドの実行
```bash
npm run dev
```

## API エンドポイント

デプロイ後、以下のエンドポイントが利用可能になります：

- `https://your-project-id.web.app` - フロントエンド
- `https://your-project-id-default-rtdb.firebaseio.com/detect-prices` - 価格検出API
- `https://your-project-id-default-rtdb.firebaseio.com/exchange-rates` - 為替レート取得API
- `https://your-project-id-default-rtdb.firebaseio.com/convert` - 通貨変換API
