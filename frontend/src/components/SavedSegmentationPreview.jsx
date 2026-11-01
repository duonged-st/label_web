import { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';

export default function SavedSegmentationPreview({ annotation, imageUrl, dirty }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!annotation) return;
    let cancelled = false;
    const urls = [];
    const instance = new Worker(new URL('../workers/segmentationExport.js', import.meta.url), { type: 'module' });
    instance.onmessage = ({ data }) => {
      if (cancelled) return;
      if (data.error) { setError(data.error); instance.terminate(); return; }
      const maskUrl = URL.createObjectURL(data.maskBlob);
      const overlayUrl = URL.createObjectURL(data.overlayBlob);
      urls.push(maskUrl, overlayUrl);
      setPreview({ maskUrl, overlayUrl, empty: data.empty });
      instance.terminate();
    };
    instance.onerror = () => {
      if (!cancelled) setError('Không tạo được ảnh xem trước. Annotation vẫn đã lưu; hãy thử lại.');
      instance.terminate();
    };
    instance.postMessage({ mode: 'saved-preview', regions: annotation.regions, width: annotation.width, height: annotation.height, classes: annotation.classes });
    return () => {
      cancelled = true;
      instance.terminate();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [annotation, imageUrl, attempt]);

  return <section aria-label="Xem trước sau khi lưu" data-testid="saved-segmentation-preview" data-image-id={annotation?.imageId || ''} data-revision={annotation?.revision || 0} className="border-t border-gray-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
      <div>
        <h2 className="font-semibold text-gray-800">Xem trước sau khi lưu</h2>
        <p className="mt-1 text-xs text-gray-500">{annotation ? `${annotation.filename} · Phiên bản ${annotation.revision} · ${annotation.width} × ${annotation.height} px` : 'Nhấn Lưu nhãn để xem ảnh gốc, ảnh chồng mask và mask riêng tại đây.'}</p>
      </div>
      {annotation && <span className="rounded bg-green-50 px-2 py-1 text-xs text-green-700 border border-green-200">Bản đã lưu trên máy chủ</span>}
    </div>
    {annotation && dirty && <p data-testid="saved-preview-draft-notice" className="mb-3 rounded bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">Bạn có thay đổi chưa lưu. Ba ảnh dưới đây vẫn là bản đã lưu gần nhất; nhấn Lưu để cập nhật.</p>}
    {error && <div className="mb-3 flex items-center justify-between gap-2 rounded bg-red-50 border border-red-200 p-2 text-xs text-red-700"><span>{error}</span><button onClick={() => { setPreview(null); setError(''); setAttempt((value) => value + 1); }} className="inline-flex items-center gap-1 underline shrink-0"><RotateCcw size={13} />Thử lại preview</button></div>}
    {annotation && <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <figure className="min-w-0 overflow-hidden rounded border border-gray-200">
        <figcaption className="border-b border-gray-200 px-3 py-2 text-sm font-medium text-gray-700">1. Ảnh gốc chưa mask</figcaption>
        <div className="relative h-56 bg-gray-900"><img data-testid="saved-original-preview" src={imageUrl} alt="Ảnh gốc chưa mask" width={annotation.width} height={annotation.height} className="h-full w-full object-contain" /></div>
      </figure>
      <figure className="min-w-0 overflow-hidden rounded border border-gray-200">
        <figcaption className="border-b border-gray-200 px-3 py-2 text-sm font-medium text-gray-700">2. Ảnh có mask</figcaption>
        <div data-testid="saved-overlay-preview" className="relative h-56 bg-gray-900">
          <img data-testid="saved-overlay-source" src={imageUrl} alt="Ảnh gốc trong bản chồng mask" width={annotation.width} height={annotation.height} className="absolute inset-0 h-full w-full object-contain" />
          {preview && <img data-testid="saved-overlay-mask" src={preview.overlayUrl} alt="Lớp mask màu chồng lên ảnh gốc" width={annotation.width} height={annotation.height} className="absolute inset-0 h-full w-full object-contain" style={{ opacity: 0.45 }} />}
          {!preview && !error && <div className="absolute inset-0 flex items-center justify-center gap-2 bg-gray-900/60 text-white text-xs"><Loader2 className="animate-spin" size={16} />Đang tạo preview...</div>}
        </div>
      </figure>
      <figure className="min-w-0 overflow-hidden rounded border border-gray-200">
        <figcaption className="border-b border-gray-200 px-3 py-2 text-sm font-medium text-gray-700">3. Chỉ hiện mask</figcaption>
        <div className="relative h-56 bg-black">
          {preview && <img data-testid="saved-mask-preview" src={preview.maskUrl} alt="Chỉ hiện mask màu trên nền đen" width={annotation.width} height={annotation.height} className="h-full w-full object-contain" />}
          {!preview && !error && <div className="absolute inset-0 flex items-center justify-center gap-2 text-white text-xs"><Loader2 className="animate-spin" size={16} />Đang tạo preview...</div>}
        </div>
      </figure>
    </div>}
    {annotation && preview?.empty && <p className="mt-3 text-xs text-gray-500">Bản đã lưu chưa có pixel mask. Ảnh có mask sẽ giống ảnh gốc, còn ô mask riêng sẽ đen. ROI cần được chuyển thành mask để xuất hiện ở đây.</p>}
    {annotation && <p className="mt-3 text-xs text-gray-500">Màu mask theo nhãn của dataset. ROI chưa chuyển thành mask không nằm trong preview. Ba ảnh được căn theo cùng kích thước ảnh gốc.</p>}
  </section>;
}
