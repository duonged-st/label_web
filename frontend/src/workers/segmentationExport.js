import { encodeMaskPng, encodeMaskPreviewPng, encodeMaskOverlayPng, rasterizeMask } from '../utils/segmentation';

self.onmessage = async ({ data }) => {
  try {
    const pixels = rasterizeMask(data.regions, data.width, data.height);
    const empty = !pixels.some((value) => value !== 0);
    if (data.mode === 'saved-preview') {
      const maskBlob = await encodeMaskPreviewPng(pixels, data.width, data.height, data.classes || []);
      const overlayBlob = await encodeMaskOverlayPng(pixels, data.width, data.height, data.classes || []);
      self.postMessage({ maskBlob, overlayBlob, empty });
      return;
    }
    if (empty && data.mode === 'preview') throw new Error('Chưa có pixel mask để xem. Hãy tô bằng Brush/Polygon, hoặc chọn Ellipse/Box rồi nhấn Tạo mask từ ROI.');
    const blob = data.mode === 'preview'
      ? await encodeMaskPreviewPng(pixels, data.width, data.height, data.classes || [])
      : await encodeMaskPng(pixels, data.width, data.height);
    self.postMessage({ blob, empty });
  } catch (error) { self.postMessage({ error: error.message }); }
};
