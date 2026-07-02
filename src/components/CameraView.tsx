import React, { useRef, useLayoutEffect, useState } from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';

interface CameraViewProps {
  videoRef: React.RefObject<HTMLVideoElement>;
}

const LABEL_FONT_FAMILY = '"Noto Sans JP", sans-serif';
const PRICE_TEXT_COLOR = '#FFFF66'; // やや彩度のある淡い黄色（黒縁取りと合わせて視認性を確保）
const ITEM_TEXT_COLOR = 'white';

/**
 * 検出結果のラベルをバウンディングボックスの中央に描画する。
 * 座標はctx.scale(dpr, dpr)適用済みの論理ピクセル空間で扱う。
 */
const drawDetectionLabel = (
  ctx: CanvasRenderingContext2D,
  text: string,
  box: number[],
  scaleX: number,
  scaleY: number,
  isPrice: boolean
) => {
  const [yMin, xMin, yMax, xMax] = box;

  const left = xMin / 1000 * scaleX;
  const top = yMin / 1000 * scaleY;
  const width = (xMax - xMin) / 1000 * scaleX;
  const height = (yMax - yMin) / 1000 * scaleY;

  const isVertical = height > width;

  ctx.save();

  // フォントサイズはボックスの高さに応じて決定（読みやすさのため下限14px・上限24px）
  let fontSize = Math.min(height * 0.6, 24);
  fontSize = Math.max(fontSize, 14);

  ctx.font = `bold ${fontSize}px ${LABEL_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // テキストがボックス幅に収まらない場合は縮小（下限11px）
  const paddingX = 12;
  const availableWidth = isVertical ? height : width;
  const textWidth = ctx.measureText(text).width;

  if (textWidth > availableWidth - paddingX * 2) {
    const scaleFactor = (availableWidth - paddingX * 2) / textWidth;
    fontSize = Math.max(Math.floor(fontSize * scaleFactor), 11);
    ctx.font = `bold ${fontSize}px ${LABEL_FONT_FAMILY}`;
  }

  // バウンディングボックスの中心
  const centerX = left + width / 2;
  const centerY = top + height / 2;

  // 黒縁取り＋塗りつぶしのスタイル設定
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.fillStyle = isPrice ? PRICE_TEXT_COLOR : ITEM_TEXT_COLOR;

  if (isVertical) {
    ctx.translate(centerX, centerY);
    ctx.rotate(Math.PI / 2);
    ctx.strokeText(text, 0, 0);
    ctx.fillText(text, 0, 0);
  } else {
    ctx.strokeText(text, centerX, centerY);
    ctx.fillText(text, centerX, centerY);
  }

  ctx.restore();
};

export const CameraView: React.FC<CameraViewProps> = ({ videoRef }) => {
  const { detections, capturedImage } = useCurrencyStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [showOverlay, setShowOverlay] = useState(true);

  // キャプチャ画像タップでオーバーレイの表示/非表示を切り替え
  const toggleOverlay = () => {
    if (capturedImage) {
      setShowOverlay((prev) => !prev);
    }
  };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const ctx = canvas?.getContext('2d');

    if (!canvas || !ctx || !image) return;

    const drawOverlay = () => {
      const dpr = window.devicePixelRatio || 1;

      // 表示中の画像サイズに合わせてキャンバスを設定（DPRでスケール）
      canvas.width = image.clientWidth * dpr;
      canvas.height = image.clientHeight * dpr;
      canvas.style.width = `${image.clientWidth}px`;
      canvas.style.height = `${image.clientHeight}px`;

      // 以降の描画は論理ピクセル（CSSピクセル）空間で行う
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, image.clientWidth, image.clientHeight);

      // オーバーレイ非表示の場合はクリアのみで終了
      if (!showOverlay || detections.length === 0) return;

      const { deviceOrientation } = useCurrencyStore.getState();
      const needsRotation = deviceOrientation === 'landscape';

      if (needsRotation) {
        ctx.save();
        ctx.translate(image.clientWidth / 2, image.clientHeight / 2);
        ctx.rotate(Math.PI / 2); // 時計回りに90度
        ctx.translate(-image.clientHeight / 2, -image.clientWidth / 2);
      }

      // 回転時は幅と高さを入れ替えてスケールを計算
      const scaleX = needsRotation ? image.clientHeight : image.clientWidth;
      const scaleY = needsRotation ? image.clientWidth : image.clientHeight;

      // 1. 商品名を先に描画（背面レイヤー）
      detections.forEach(({ itemText, itemBox }) => {
        if (itemText && itemBox && itemBox.length === 4) {
          drawDetectionLabel(ctx, itemText, itemBox, scaleX, scaleY, false);
        }
      });

      // 2. 価格を後に描画（前面レイヤー）
      detections.forEach(({ priceText, priceBox }) => {
        if (priceText && priceBox && priceBox.length === 4) {
          drawDetectionLabel(ctx, priceText, priceBox, scaleX, scaleY, true);
        }
      });

      if (needsRotation) {
        ctx.restore();
      }
    };

    if (image.complete) {
      drawOverlay();
    } else {
      image.onload = drawOverlay;
    }
    // ウィンドウリサイズ時もオーバーレイを再描画
    window.addEventListener('resize', drawOverlay);
    return () => {
      window.removeEventListener('resize', drawOverlay);
      image.onload = null;
    };
  }, [detections, capturedImage, showOverlay]);

  return (
    <div className="middle-section">
      <div
        className="camera-container"
        onClick={toggleOverlay}
        style={{ cursor: capturedImage ? 'pointer' : 'default' }}
      >
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          className="camera-feed"
          style={{ display: capturedImage ? 'none' : 'block' }}
        />
        {capturedImage && (
          <>
            <img
              ref={imageRef}
              src={capturedImage}
              alt="Captured frame"
              className="captured-image"
            />
            <canvas
              ref={canvasRef}
              className="overlay-canvas"
            />
          </>
        )}
      </div>
    </div>
  );
};
