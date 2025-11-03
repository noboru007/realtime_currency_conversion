import React, { useRef, useLayoutEffect } from 'react';
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
}

export const CameraView: React.FC<CameraViewProps> = ({ videoRef }) => {
  const { detections, capturedImage } = useCurrencyStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const ctx = canvas?.getContext('2d');

    if (!canvas || !ctx || !image) return;

    const handleImageLoad = () => {
      // Set canvas dimensions to match the displayed image size
      canvas.width = image.clientWidth;
      canvas.height = image.clientHeight;
      
      // Clear previous drawings
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (detections && detections.length > 0) {
        const scaleX = canvas.width;
        const scaleY = canvas.height;

        detections.forEach(({ itemText, itemBox, priceText, priceBox }) => {
          // Draw for Price
          if (priceText && priceBox && priceBox.length === 4) {
            drawDetection(ctx, priceText, priceBox, scaleX, scaleY);
          }
          // Draw for Item
          if (itemText && itemBox && itemBox.length === 4) {
            drawDetection(ctx, itemText, itemBox, scaleX, scaleY);
          }
        });
      }
    };

    const drawDetection = (
        ctx: CanvasRenderingContext2D,
        text: string,
        box: number[],
        scaleX: number,
        scaleY: number
    ) => {
        const [yMin, xMin, yMax, xMax] = box;
        const left = xMin / 1000 * scaleX;
        const top = yMin / 1000 * scaleY;
        const width = (xMax - xMin) / 1000 * scaleX;
        const height = (yMax - yMin) / 1000 * scaleY;
        
        const isVertical = height > width;

        ctx.save();

        // --- Draw Bounding Box (optional, for debugging) ---
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
        ctx.lineWidth = 2;
        ctx.strokeRect(left, top, width, height);

        // --- Draw Text ---
        const fontSize = Math.min(width, height) * 0.5; // Adjust font size based on box size
        ctx.font = `${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Add a semi-transparent background for better readability
        const textMetrics = ctx.measureText(text);
        const textWidth = textMetrics.width;
        const textHeight = fontSize; // Approximate height
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        
        // Center of the bounding box
        const centerX = left + width / 2;
        const centerY = top + height / 2;

        if (isVertical) {
            // Vertical text logic
            ctx.translate(centerX, centerY);
            ctx.rotate(Math.PI / 2); // Rotate 90 degrees
            ctx.fillRect(-textWidth / 2 - 2, -textHeight / 2 - 2, textWidth + 4, textHeight + 4);
            ctx.fillStyle = 'white';
            ctx.fillText(text, 0, 0);

        } else {
            // Horizontal text logic
            ctx.fillRect(centerX - textWidth / 2 - 2, centerY - textHeight / 2 - 2, textWidth + 4, textHeight + 4);
            ctx.fillStyle = 'white';
            ctx.fillText(text, centerX, centerY);
        }

        ctx.restore();
    };


    if (image) {
        if (image.complete) {
            handleImageLoad();
        } else {
            image.onload = handleImageLoad;
        }
    }
    // Also handle window resize to adjust canvas overlay
    window.addEventListener('resize', handleImageLoad);
    return () => {
        window.removeEventListener('resize', handleImageLoad);
        if (image) {
            image.onload = null;
        }
    };

  }, [detections, capturedImage]);


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