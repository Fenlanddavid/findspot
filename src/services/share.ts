import html2canvas from 'html2canvas';

/**
 * Captures an element as an image and shares it using the Web Share API if available.
 * Fallbacks to downloading the image if sharing is not supported.
 */
export async function shareElementAsImage(element: HTMLElement, filename: string, title: string, text: string) {
  try {
    // We need to make sure the element is rendered and visible for html2canvas to work well.
    // Sometimes we need a small delay or to ensure it's in the DOM.
    
    // Config for high quality
    const canvas = await html2canvas(element, {
      scale: 1, // 1080x1080 is already large
      useCORS: true,
      logging: false,
      backgroundColor: '#0f172a',
      width: 1080,
      height: 1080,
    });

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 0.9));
    if (!blob) throw new Error('Failed to create image blob');

    const file = new File([blob], `${filename}.png`, { type: 'image/png' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title,
        text,
      });
    } else {
      // Fallback: Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.error('Sharing failed:', error);
    throw error;
  }
}
