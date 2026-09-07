import React, { useRef, useEffect, useCallback } from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';

/**
 * 生成された翻訳画像をフルスクリーンで表示するビューアコンポーネント
 * DOM直接操作によるスムーズなピンチズーム・パンを提供
 */
export const ImageTranslationViewer: React.FC = () => {
    const { translatedImageUrl, closeTranslationViewer } = useCurrencyStore();
    const { t } = useTranslationStore();

    // トランスフォーム値をrefで保持（React再レンダリングを回避）
    const scaleRef = useRef(1);
    const posRef = useRef({ x: 0, y: 0 });
    const imgRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // タッチ追跡用ref
    const lastTouchDistance = useRef<number | null>(null);
    const lastTouchCenter = useRef<{ x: number; y: number } | null>(null);
    const lastPanPos = useRef<{ x: number; y: number } | null>(null);
    const touchCount = useRef(0);

    // 画像データ
    const [imageDataUrl, setImageDataUrl] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);

    // 画像をfetchしてbase64に変換
    useEffect(() => {
        if (!translatedImageUrl) return;

        if (translatedImageUrl.startsWith('data:')) {
            setImageDataUrl(translatedImageUrl);
            setIsLoading(false);
            return;
        }

        const fetchImage = async () => {
            try {
                setIsLoading(true);
                const response = await fetch(translatedImageUrl);
                const blob = await response.blob();
                const reader = new FileReader();
                reader.onload = () => {
                    setImageDataUrl(reader.result as string);
                    setIsLoading(false);
                };
                reader.readAsDataURL(blob);
            } catch (error) {
                console.error('Failed to fetch translated image:', error);
                setIsLoading(false);
            }
        };

        fetchImage();
    }, [translatedImageUrl]);

    // トランスフォームをDOM直接更新（setState不使用でリレンダリング回避）
    const applyTransform = useCallback(() => {
        if (!imgRef.current) return;
        const s = scaleRef.current;
        const { x, y } = posRef.current;
        imgRef.current.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    }, []);

    const resetTransform = useCallback(() => {
        scaleRef.current = 1;
        posRef.current = { x: 0, y: 0 };
        applyTransform();
    }, [applyTransform]);

    // タッチヘルパー
    const getDistance = (t1: Touch, t2: Touch) => {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    const getCenter = (t1: Touch, t2: Touch) => ({
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
    });

    // ネイティブタッチイベント（passive: false でブラウザジェスチャーを完全に阻止）
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onTouchStart = (e: TouchEvent) => {
            touchCount.current = e.touches.length;
            if (e.touches.length === 2) {
                e.preventDefault();
                lastTouchDistance.current = getDistance(e.touches[0], e.touches[1]);
                lastTouchCenter.current = getCenter(e.touches[0], e.touches[1]);
                lastPanPos.current = null;
            } else if (e.touches.length === 1 && scaleRef.current > 1.05) {
                e.preventDefault();
                lastPanPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        };

        const onTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 2 && lastTouchDistance.current !== null) {
                e.preventDefault();
                const newDist = getDistance(e.touches[0], e.touches[1]);
                if (newDist > 0 && lastTouchDistance.current > 0) {
                    const factor = newDist / lastTouchDistance.current;
                    scaleRef.current = Math.max(0.5, Math.min(5, scaleRef.current * factor));
                }
                lastTouchDistance.current = newDist;

                const newCenter = getCenter(e.touches[0], e.touches[1]);
                if (lastTouchCenter.current) {
                    posRef.current = {
                        x: posRef.current.x + newCenter.x - lastTouchCenter.current.x,
                        y: posRef.current.y + newCenter.y - lastTouchCenter.current.y,
                    };
                }
                lastTouchCenter.current = newCenter;
                applyTransform();
            } else if (e.touches.length === 1 && lastPanPos.current && scaleRef.current > 1.05) {
                e.preventDefault();
                const dx = e.touches[0].clientX - lastPanPos.current.x;
                const dy = e.touches[0].clientY - lastPanPos.current.y;
                posRef.current = {
                    x: posRef.current.x + dx,
                    y: posRef.current.y + dy,
                };
                lastPanPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                applyTransform();
            }
        };

        const onTouchEnd = (e: TouchEvent) => {
            touchCount.current = e.touches.length;
            lastTouchDistance.current = null;
            lastTouchCenter.current = null;
            lastPanPos.current = null;
            if (scaleRef.current <= 1) {
                resetTransform();
            }
        };

        container.addEventListener('touchstart', onTouchStart, { passive: false });
        container.addEventListener('touchmove', onTouchMove, { passive: false });
        container.addEventListener('touchend', onTouchEnd, { passive: true });

        return () => {
            container.removeEventListener('touchstart', onTouchStart);
            container.removeEventListener('touchmove', onTouchMove);
            container.removeEventListener('touchend', onTouchEnd);
        };
    }, [applyTransform, resetTransform]);

    // マウスホイールズーム
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        scaleRef.current = Math.max(0.5, Math.min(5, scaleRef.current * factor));
        applyTransform();
    }, [applyTransform]);

    // ダブルタップでリセット
    const lastTap = useRef(0);
    const handleTap = useCallback(() => {
        if (touchCount.current > 0) return;
        const now = Date.now();
        if (now - lastTap.current < 300) {
            resetTransform();
        }
        lastTap.current = now;
    }, [resetTransform]);

    // 保存
    const handleSave = useCallback(() => {
        if (!imageDataUrl) return;
        const link = document.createElement('a');
        link.href = imageDataUrl;
        link.download = `translated_image_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [imageDataUrl]);

    if (!translatedImageUrl) return null;

    return (
        <div className="image-translation-viewer">
            <div className="itv-header">
                <button
                    className="itv-close-btn"
                    onClick={closeTranslationViewer}
                    aria-label={t('closeButton')}
                >
                    ✕
                </button>
                <button
                    className="itv-save-btn"
                    onClick={handleSave}
                    disabled={!imageDataUrl}
                    aria-label={t('saveImage')}
                >
                    💾 {t('saveImage')}
                </button>
            </div>

            <div
                className="itv-image-container"
                ref={containerRef}
                onWheel={handleWheel}
                onClick={handleTap}
            >
                {isLoading ? (
                    <div className="itv-loading">
                        <div className="itv-spinner" />
                        <p>{t('generating')}</p>
                    </div>
                ) : imageDataUrl ? (
                    <img
                        ref={imgRef}
                        src={imageDataUrl}
                        alt="Translated image"
                        className="itv-image"
                        draggable={false}
                    />
                ) : (
                    <p className="itv-error">{t('generationFailed')}</p>
                )}
            </div>
        </div>
    );
};
