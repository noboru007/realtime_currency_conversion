import React from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { convertCurrency, formatCurrency, getCurrencyFromSymbol } from '../utils/currency'; // パスを修正

interface CameraViewProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

export const CameraView: React.FC<CameraViewProps> = ({ videoRef, canvasRef }) => {
  const { rates, homeCurrency, localCurrency, detections } = useCurrencyStore();

  return (
    <div className="middle-section">
      <video ref={videoRef} autoPlay playsInline className="video-feed" />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <div className="overlay-container">
        {detections.map((detection, index) => {
          const detectedCurrency = detection.currency ? getCurrencyFromSymbol(detection.currency) : localCurrency;
          if (!detectedCurrency) return null;
          
          const convertedAmount = convertCurrency(detection.amount, detectedCurrency, homeCurrency, rates);
          
          return (
            <div 
              key={index} 
              className="detection-box" 
              style={{ 
                left: `${detection.boundingBox.x}%`, 
                top: `${detection.boundingBox.y}%`, 
                width: `${detection.boundingBox.width}%`, 
                height: `${detection.boundingBox.height}%` 
              }}
            >
              <div className="converted-amount">{formatCurrency(convertedAmount, homeCurrency)}</div>
              <div className="original-price">{formatCurrency(detection.amount, detectedCurrency)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};