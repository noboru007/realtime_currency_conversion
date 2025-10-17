import React, { useRef, useState, useLayoutEffect } from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useUIStore } from '../store/useUIStore';
import { formatCurrency } from '../utils/currency';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DynamicTextOverlayProps {
  text: string | string[];
  boundingBox: BoundingBox;
  className?: string;
}

const DynamicTextOverlay: React.FC<DynamicTextOverlayProps> = ({ text, boundingBox, className }) => {
  const textRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(16);
  const { orientationAngle } = useUIStore();

  useLayoutEffect(() => {
    if (textRef.current && text) {
      const boxWidth = textRef.current.offsetWidth;
      const boxHeight = textRef.current.offsetHeight;

      const lines = Array.isArray(text) ? text : [text];
      const longestLine = lines.reduce((a, b) => a.length > b.length ? a : b, '');

      // ▼▼▼ 変更点: フォントサイズ計算をより大胆に調整 ▼▼▼
      // 幅に基づく計算係数を 1.8 -> 2.2 に変更
      // const fontSizeForWidth = (boxWidth / (longestLine.length || 1)) * 1.8;
      const fontSizeForWidth = boxWidth
      // 高さに基づく計算係数を 0.9 -> 1.0 に変更（領域の高さいっぱいに使う）
      // const fontSizeForHeight = (boxHeight / lines.length) * 1.0;
      const fontSizeForHeight = boxHeight
      // フォントサイズの最大値を 90 -> 120 に変更
      const newFontSize = Math.min(fontSizeForWidth, fontSizeForHeight, 70);
      // ▲▲▲ ここまで変更 ▲▲▲

      setFontSize(newFontSize);
    }
  }, [text, boundingBox, orientationAngle]);

  // boxが縦長なら縦書き
  console.log('boundingBox', boundingBox);
  let rotate = 0;
  if (boundingBox.height > boundingBox.width) {
    rotate = 90;
  } else {
    rotate = 0;
  }
  // テキストのスタイルを設定
  const textStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${boundingBox.x}%`,
    top: `${boundingBox.y}%`,
    width: `${boundingBox.width}%`,
    height: `${boundingBox.height}%`,
    // transform: `rotate(${orientationAngle}deg)`,
    transform: `rotate(${rotate}deg)`,
    transformOrigin: 'center center',
    fontSize: `${fontSize}px`,
    lineHeight: 1.2,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '1px 1px',
    textAlign: 'center',
  };

  return (
    <div ref={textRef} className={className} style={textStyle}>
      {Array.isArray(text) ? (
        text.map((line, i) => <span key={i}>{line}</span>)
      ) : (
        <span>{text}</span>
      )}
    </div>
  );
};

interface CameraViewProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

export const CameraView: React.FC<CameraViewProps> = ({ videoRef, canvasRef }) => {
  const { detections, homeCurrency, capturedImage } = useCurrencyStore();

  return (
    <div className="middle-section">
      <div className="camera-container">
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          className="camera-feed"
          style={{ display: capturedImage ? 'none' : 'block' }}
        />
        {capturedImage && (
          <img src={capturedImage} alt="Captured frame" className="captured-image" />
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {detections.map((detection, index) => {
          if (!detection.item || !detection.itemBoundingBox) {
            const convertedDisplay = detection.amount !== 0
              ? formatCurrency(detection.amount, homeCurrency)
              : `${homeCurrency} --.--`;

            // AR表示を検出領域に直接重ねる
            const displayAmountBox = detection.amountBoundingBox;

            return (
              <DynamicTextOverlay
                key={`amount-only-${index}`}
                text={convertedDisplay}
                boundingBox={displayAmountBox}
                className="converted-amount"
              />
            );
          }

          console.log('detection', detection);

          const itemBox = detection.itemBoundingBox;
          const amountBox = detection.amountBoundingBox;

          const itemCenterX = itemBox.x + itemBox.width / 2;
          const amountCenterX = amountBox.x + amountBox.width / 2;

          let displayBox: BoundingBox;
          let displayText: string[];
          const formattedPrice = formatCurrency(detection.amount, homeCurrency);

          // 項目と価格が左右に並んでいるか（x距離がy距離より十分大きいか）でレイアウトを判断
          const isSideBySide = Math.abs(itemCenterX - amountCenterX) > (itemBox.width + amountBox.width) * 0.4;

          if (isSideBySide) {
            // 左右レイアウトの場合：商品名領域を基準に、価格をカッコ付きで表示
            displayBox = itemBox;
            displayText = [detection.item, `(${formattedPrice})`];
          } else {
            // 上下レイアウトの場合：二つを囲む領域を計算し、そこに重ねて表示
            const combinedX = Math.min(itemBox.x, amountBox.x);
            const combinedY = Math.min(itemBox.y, amountBox.y);
            const combinedWidth = Math.max(itemBox.x + itemBox.width, amountBox.x + amountBox.width) - combinedX;
            const combinedHeight = Math.max(itemBox.y + itemBox.height, amountBox.y + amountBox.height) - combinedY;
            displayBox = { x: combinedX, y: combinedY, width: combinedWidth, height: combinedHeight };
            displayText = [detection.item, formattedPrice];
          }

          return (
            <DynamicTextOverlay
              key={`detection-${index}`}
              text={displayText}
              boundingBox={displayBox}
              className="item-name"
            />
          );
        })}
      </div>
    </div>
  );
};