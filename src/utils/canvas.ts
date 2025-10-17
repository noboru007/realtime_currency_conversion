import html2canvas from 'html2canvas';

export const saveCanvasAsImage = (canvas: HTMLCanvasElement, filename: string) => {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
};

export const saveDivAsImage = (element: HTMLElement, filename: string) => {
    html2canvas(element, {
    useCORS: true, // Allow loading cross-origin images
    backgroundColor: null, // Use transparent background
}).then(canvas => {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
});
};
