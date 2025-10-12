import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { convertCurrency, formatCurrency, getCurrencyFromSymbol } from '../utils/currency';

interface CameraViewProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

export const CameraView: React.FC<CameraViewProps> = ({ videoRef, canvasRef }) => {
  const { detections, rates, homeCurrency, localCurrency } = useCurrencyStore();

  return (
    <div className="middle-section">
      <div className="camera-container">
        <video ref={videoRef} playsInline autoPlay muted className="camera-feed" />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {detections.map((detection, index) => {
          // 常にユーザーが選択した localCurrency を変換元とする
          const currencyToConvertFrom = localCurrency;
        
          // let currencyToConvertFrom = '';
          // const detectedSymbol = detection.currency || '';

          // // カメラで検知した通貨記号（円など）を現地通貨として使いたい場合はこっちのロジック。現時点ではユーザーが選択した現地通貨を無視してまで検知した通貨を優先させたいニーズが不明のためDisableしてコードをシンプル化。
          // if (detectedSymbol) {
          //   const mappedCode = getCurrencyFromSymbol(detectedSymbol);
            
          //   // 1. マッピングテーブルに存在する記号かチェック
          //   if (mappedCode !== detectedSymbol) {
          //     // 存在する (例: '円' -> 'JPY')
          //     currencyToConvertFrom = mappedCode;
          //   } else {
          //     // 2. 存在しない未知の記号の場合 -> ユーザー設定の現地通貨にフォールバック
          //     if (localCurrency) {
          //       currencyToConvertFrom = localCurrency;
          //       // その旨をログに出力
          //       console.log(`Unmapped currency symbol "${detectedSymbol}" detected. Falling back to user-selected local currency "${localCurrency}".`);
          //     }
          //   }
          // } else {
          //   // そもそもGeminiが通貨を検出しなかった場合 -> ユーザー設定の現地通貨にフォールバック
          //   if (localCurrency) {
          //     currencyToConvertFrom = localCurrency;
          //   }
          // }
          // // --- ▲▲▲ ここまで ▲▲▲ ---

          const convertedAmount = convertCurrency(detection.amount, currencyToConvertFrom, homeCurrency, rates);

          if (currencyToConvertFrom && currencyToConvertFrom === homeCurrency) {
            return null;
          }

          const convertedDisplay = convertedAmount !== 0 
            ? formatCurrency(convertedAmount, homeCurrency)
            : `${homeCurrency} --.--`;

          const originalDisplay = currencyToConvertFrom
            ? formatCurrency(detection.amount, currencyToConvertFrom)
            : detection.amount.toFixed(2);

          const overlayStyle: React.CSSProperties = {
            left: `${detection.boundingBox.x}%`,
            top: `${detection.boundingBox.y}%`,
            width: `${detection.boundingBox.width}%`,
            height: `${detection.boundingBox.height}%`,
          };
          
          return (
            <div 
              key={index} 
              className="detection-box"
              style={overlayStyle}
            >
              <div className="converted-amount">{convertedDisplay}</div>
              <div className="original-price">{originalDisplay}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};