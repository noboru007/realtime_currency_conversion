/**
 * 表示中のビデオフレームを、画面に見えている範囲（object-fit: cover相当）で
 * 切り抜いてPNGのdata URLとして返します。
 * @param video キャプチャ対象のvideo要素
 * @param maxDimension 出力画像の最大辺の長さ（これを超える場合は縮小）
 * @returns PNG形式のdata URL。コンテキスト取得に失敗した場合はnull。
 */
export const captureVideoFrame = (video: HTMLVideoElement, maxDimension = 1920): string | null => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const videoAspectRatio = videoWidth / videoHeight;
    const containerAspectRatio = video.clientWidth / video.clientHeight;

    // 表示コンテナに合わせて切り抜く範囲を計算
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

    // 最大辺がmaxDimensionに収まるよう縮小
    let targetWidth = sWidth;
    let targetHeight = sHeight;

    if (targetWidth > maxDimension || targetHeight > maxDimension) {
        if (targetWidth > targetHeight) {
            targetWidth = maxDimension;
            targetHeight = Math.round(targetWidth / (sWidth / sHeight));
        } else {
            targetHeight = maxDimension;
            targetWidth = Math.round(targetHeight * (sWidth / sHeight));
        }
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, targetWidth, targetHeight);

    return canvas.toDataURL('image/png');
};
