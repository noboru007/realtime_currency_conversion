import { useCallback } from 'react';
import html2canvas from 'html2canvas';
import { useCurrencyStore } from '../store/useCurrencyStore';

/**
 * タイムスタンプベースのファイル名を生成する
 */
const generateTimestampFilename = (): string => {
    const now = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    const timestamp = [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        '_',
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
        '_',
        pad(now.getMilliseconds(), 3),
    ].join('');
    return `OrionX_${timestamp}.png`;
};

/**
 * AR画像の保存ロジックを管理するカスタムフック
 */
export const useSaveImage = () => {
    const { showBanner, setSavedImageURL, setSaveModalOpen } = useCurrencyStore();

    const saveARImage = useCallback(async () => {
        const cameraContainer = document.querySelector('.camera-container') as HTMLElement;
        if (!cameraContainer) return;

        try {
            const canvas = await html2canvas(cameraContainer, {
                useCORS: true,
                backgroundColor: null,
            });
            const imageURL = canvas.toDataURL('image/png');

            // 画像をダウンロード
            const link = document.createElement('a');
            link.download = generateTimestampFilename();
            link.href = imageURL;
            link.click();

            // 確認モーダルを表示
            setSavedImageURL(imageURL);
            setSaveModalOpen(true);
        } catch (error) {
            console.error('Error capturing and saving image:', error);
            showBanner('imageSaveFailed', 'error');
        }
    }, [showBanner, setSavedImageURL, setSaveModalOpen]);

    return { saveARImage };
};
