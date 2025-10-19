import React, { useRef, useState, useLayoutEffect } from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
// import { useUIStore } from '../store/useUIStore';
// import { formatCurrency } from '../utils/currency';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CameraViewProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

export const CameraView: React.FC<CameraViewProps> = ({ videoRef, canvasRef }) => {
  const { detections, homeCurrency, capturedImage, processedImage } = useCurrencyStore();

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
        {capturedImage && !processedImage && (
          <img src={capturedImage} alt="Captured frame" className="captured-image" />
        )}
        {processedImage && (
          <img src={processedImage} alt="Processed frame with masks" className="captured-image" />
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* The overlay logic is now handled by the backend. 
            The text information can be displayed elsewhere in the UI if needed. */}
      </div>
    </div>
  );
};