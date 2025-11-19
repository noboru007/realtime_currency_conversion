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
      const dpr = window.devicePixelRatio || 1;
      
      // Set canvas dimensions to match the displayed image size, scaled by DPR
      canvas.width = image.clientWidth * dpr;
      canvas.height = image.clientHeight * dpr;
      
      // Set display size (css)
      canvas.style.width = `${image.clientWidth}px`;
      canvas.style.height = `${image.clientHeight}px`;

      // Scale all drawing operations by dpr
      ctx.scale(dpr, dpr);
      
      // Clear previous drawings
      ctx.clearRect(0, 0, image.clientWidth, image.clientHeight);

      const { deviceOrientation } = useCurrencyStore.getState();
      const needsRotation = deviceOrientation === 'landscape';
      
      // Note: Coordinate transformations below operate in the logical pixel space (CSS pixels)
      // because we already applied ctx.scale(dpr, dpr).
      
      if (needsRotation) {
        ctx.save();
        ctx.translate(image.clientWidth / 2, image.clientHeight / 2);
        ctx.rotate(Math.PI / 2); // 90 degrees clockwise
        ctx.translate(-image.clientHeight / 2, -image.clientWidth / 2);
      }

      if (detections && detections.length > 0) {
        // Adjust scale factors based on rotation
        // logical dimensions are used for calculation
        const scaleX = needsRotation ? image.clientHeight : image.clientWidth;
        const scaleY = needsRotation ? image.clientWidth : image.clientHeight;

        // 1. Draw Items first (Background layer)
        detections.forEach(({ itemText, itemBox }) => {
          if (itemText && itemBox && itemBox.length === 4) {
            drawDetection(ctx, itemText, itemBox, scaleX, scaleY, false);
          }
        });

        // 2. Draw Prices second (Foreground layer)
        detections.forEach(({ priceText, priceBox }) => {
          if (priceText && priceBox && priceBox.length === 4) {
            drawDetection(ctx, priceText, priceBox, scaleX, scaleY, true);
          }
        });
      }

      if (needsRotation) {
        ctx.restore();
      }
    };

    const drawDetection = (
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

        // 1. Calculate Max Allowed Dimensions
        const maxLabelWidth = Math.max(width, 40);
        // const maxLabelHeight = Math.max(height, 20); // Not strictly used below, but good reference

        // 2. Initial Font Size Calculation (Bounded)
        let fontSize = Math.min(height * 0.6, 24); 
        fontSize = Math.max(fontSize, 14); // Slightly larger min size for readability

        ctx.font = `bold ${fontSize}px "Noto Sans JP", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 3. Measure and Scale Down if Text is Too Wide
        let textMetrics = ctx.measureText(text);
        let textWidth = textMetrics.width;
        const paddingX = 12; // Increased horizontal padding
        const paddingY = 8;  // Vertical padding
        
        const availableWidth = isVertical ? height : width;
        
        // If text is wider than the box, scale down
        if (textWidth > availableWidth - paddingX * 2) {
            const scaleFactor = (availableWidth - paddingX * 2) / textWidth;
            fontSize = Math.floor(fontSize * scaleFactor);
            fontSize = Math.max(fontSize, 11); // Minimum legible size
            ctx.font = `bold ${fontSize}px "Noto Sans JP", sans-serif`;
            
            textMetrics = ctx.measureText(text);
            textWidth = textMetrics.width;
        }

        const textHeight = fontSize * 1.4; // Add vertical padding relative to font size

        // Center of the bounding box
        const centerX = left + width / 2;
        const centerY = top + height / 2;

        // Text Outline Settings (White Text with Black Outline)
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        
        // Change text color based on type: Price = Light Yellow, Item = White
        ctx.fillStyle = isPrice ? '#FFEB3B' : 'white'; // Material Design Yellow 500 is a bit strong, maybe 200 or 300
        // Let's use a standard bright yellow for high visibility against the black stroke
        // #FFFF00 (Pure Yellow) might be too harsh. #FFF176 (Yellow 300) is nice.
        // User asked for "Pale Yellow" -> #FFFFCC or #FFF9C4
        // But for AR text, slightly more saturated is better for readability. 
        // Let's try #FFEE58 (Yellow 400) or just keeps it simple #FFFF99
        
        ctx.fillStyle = isPrice ? '#FFFF66' : 'white'; // Slightly saturated pale yellow

        ctx.shadowColor = 'transparent'; // No shadow for this style

        if (isVertical) {
            ctx.translate(centerX, centerY);
            ctx.rotate(Math.PI / 2);
            
            // Draw Stroke (Outline)
            ctx.strokeText(text, 0, 0);
            // Draw Fill (Text)
            ctx.fillText(text, 0, 0);

        } else {
            // Draw Stroke (Outline)
            ctx.strokeText(text, centerX, centerY);
            // Draw Fill (Text)
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