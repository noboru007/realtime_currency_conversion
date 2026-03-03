import { useRef, useCallback } from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';

/**
 * カメラの起動・キャプチャロジックを管理するカスタムフック
 */
export const useCamera = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const { setStatus, showBanner, setCapturedImage, setConfirmationStep } = useCurrencyStore();
    const { t } = useTranslationStore();

    const startCamera = useCallback(async () => {
        try {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                const constraints = {
                    video: {
                        facingMode: 'environment',
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                        aspectRatio: { ideal: 9 / 16 }
                    }
                };
                const stream = await navigator.mediaDevices.getUserMedia(constraints);

                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            } else {
                throw new Error('Camera not supported.');
            }
        } catch (error) {
            showBanner(t('cameraAccessFailed'), 'error');
            setStatus('error');
        }
    }, [setStatus, showBanner, t]);

    const handleCapture = useCallback(() => {
        if (!videoRef.current) return;

        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (!context) return;

        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;
        const videoAspectRatio = videoWidth / videoHeight;

        const containerWidth = video.clientWidth;
        const containerHeight = video.clientHeight;
        const containerAspectRatio = containerWidth / containerHeight;

        let sx = 0;
        let sy = 0;
        let sWidth = videoWidth;
        let sHeight = videoHeight;

        if (videoAspectRatio > containerAspectRatio) {
            sWidth = videoHeight * containerAspectRatio;
            sx = (videoWidth - sWidth) / 2;
        } else {
            sHeight = videoWidth / containerAspectRatio;
            sy = (videoHeight - sHeight) / 2;
        }

        // 画像リサイズ（最大1920x1920）
        const MAX_DIMENSION = 1920;
        let targetWidth = sWidth;
        let targetHeight = sHeight;

        if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
            if (targetWidth / targetHeight > 1) {
                targetWidth = MAX_DIMENSION;
                targetHeight = Math.round(targetWidth / (sWidth / sHeight));
            } else {
                targetHeight = MAX_DIMENSION;
                targetWidth = Math.round(targetHeight * (sWidth / sHeight));
            }
        }

        canvas.width = targetWidth;
        canvas.height = targetHeight;
        context.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, targetWidth, targetHeight);

        const imageData = canvas.toDataURL('image/png');
        setCapturedImage(imageData);
        setConfirmationStep('analyze');
    }, [setCapturedImage, setConfirmationStep]);

    return { videoRef, startCamera, handleCapture };
};
