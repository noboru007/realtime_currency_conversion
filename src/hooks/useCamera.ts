import { useRef, useCallback } from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { captureVideoFrame } from '../utils/canvas';

/**
 * カメラの起動・キャプチャロジックを管理するカスタムフック
 */
export const useCamera = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const { setStatus, showBanner, setCapturedImage, setConfirmationStep } = useCurrencyStore();

    const startCamera = useCallback(async () => {
        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error('Camera not supported.');
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    aspectRatio: { ideal: 9 / 16 }
                }
            });

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (error) {
            showBanner('cameraAccessFailed', 'error');
            setStatus('error');
        }
    }, [setStatus, showBanner]);

    const handleCapture = useCallback(() => {
        if (!videoRef.current) return;

        const imageData = captureVideoFrame(videoRef.current);
        if (!imageData) return;

        setCapturedImage(imageData);
        setConfirmationStep('analyze');
    }, [setCapturedImage, setConfirmationStep]);

    return { videoRef, startCamera, handleCapture };
};
