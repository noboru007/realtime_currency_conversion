import html2canvas from 'html2canvas';

export const saveCanvasAsImage = (canvas: HTMLCanvasElement, filename: string) => {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
};

export const saveDivAsImage = async (element: HTMLElement, filename: string) => {
    try {
        const canvas = await html2canvas(element, {
            useCORS: true,
            backgroundColor: null,
        });
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (error) {
        console.error('Error capturing image:', error);
    }
};
