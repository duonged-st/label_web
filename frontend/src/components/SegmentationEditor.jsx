import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Save, Download, Eye, EyeOff, Trash2, ChevronLeft, ChevronRight, Loader2, ScanLine, RotateCcw } from 'lucide-react';
import SegmentationCanvas from './SegmentationCanvas';
import SavedSegmentationPreview from './SavedSegmentationPreview';
import { downloadBlob, isMask, roiToMask } from '../utils/segmentation';

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}`, ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || `Yêu cầu thất bại (${response.status}).`), { status: response.status });
  return data;
}
const imageUrl = (image) => (image?.path || '').replace(/^http:\/\/minio:9000/, '/minio-storage');
const draftKey = (projectId, imageId) => {
  let userId;
  try {
    const payload = localStorage.getItem('token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    userId = JSON.parse(atob(payload)).userId;
  } catch { userId = JSON.parse(localStorage.getItem('user') || '{}').username || 'unknown'; }
  return `labelweb:segmentation:v1:${userId}:${projectId}:${imageId}`;
};
const naturalSize = (url) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
  image.onerror = () => reject(new Error('Không tải được ảnh. Hãy kiểm tra tệp và kết nối MinIO. Trình duyệt cần ảnh 2D như PNG/JPEG/WebP; DICOM cần chuyển sang ảnh 2D trước.'));
  image.src = url;
});

const SegmentationEditor = forwardRef(function SegmentationEditor({ selectedProjectId, setSelectedProjectId }, ref) {
  const [projects, setProjects] = useState([]);
  const [images, setImages] = useState([]);
  const [summary, setSummary] = useState({});
  const [selectedImageId, setSelectedImageId] = useState('');
  const [classes, setClasses] = useState([]);
  const [activeClassId, setActiveClassId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [document, setDocument] = useState(null);
  const [savedAnnotation, setSavedAnnotation] = useState(null);
  const documentRef = useRef(null);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Chọn ảnh và nhãn để bắt đầu.');
  const [pendingDraft, setPendingDraft] = useState(null);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');
  const [opacity, setOpacity] = useState(42);
  const [brushSize, setBrushSize] = useState(24);
  const [masksVisible, setMasksVisible] = useState(true);
  const canvas = useRef(null);
  const worker = useRef(null);
  const requestServerChoice = useRef(false);
  const workspace = useRef(null);
  const previewAnchor = useRef(null);
  const busy = loading || listLoading || saving || exporting;
  const currentImage = images.find((image) => image._id === selectedImageId);
  const currentIndex = images.findIndex((image) => image._id === selectedImageId);
  const regions = document?.regions || [];
  const activeClasses = classes.filter((item) => item.active);
  const brushLimit = document ? Math.min(1000, Math.max(document.width, document.height) * 2) : 100;
  const selected = regions.find((region) => region.id === selectedId);

  const replaceDocument = (value) => { documentRef.current = value; setDocument(value); };
  const persistDraft = (value) => {
    try { localStorage.setItem(draftKey(value.projectId, value.imageId), JSON.stringify(value)); }
    catch { setError('Không lưu được bản nháp trong trình duyệt. Hãy nhấn Lưu trước khi đóng trang.'); }
  };
  const removeDraft = (value) => {
    try { localStorage.removeItem(draftKey(value.projectId, value.imageId)); } catch { /* Server save is already durable. */ }
  };
  const editRegions = (next) => {
    const current = documentRef.current;
    if (!current || busy || pendingDraft) return;
    setHistory((items) => [...items.slice(-49), current.regions]);
    setFuture([]);
    const value = { ...current, regions: next, dirty: true };
    replaceDocument(value);
    persistDraft(value);
    setStatus('Có thay đổi chưa lưu lên máy chủ.');
  };
  const undo = () => {
    if (!history.length || busy) return;
    const current = documentRef.current;
    setFuture((items) => [current.regions, ...items]);
    const next = { ...current, regions: history.at(-1), dirty: true };
    setHistory((items) => items.slice(0, -1));
    replaceDocument(next); persistDraft(next); setSelectedId(null);
  };
  const redo = () => {
    if (!future.length || busy) return;
    const current = documentRef.current;
    setHistory((items) => [...items.slice(-49), current.regions]);
    const next = { ...current, regions: future[0], dirty: true };
    setFuture((items) => items.slice(1));
    replaceDocument(next); persistDraft(next); setSelectedId(null);
  };
  const noDraftGesture = () => {
    if (canvas.current?.hasDraft()) { setError('Hãy đóng Polygon hoặc hủy nét đang vẽ (Esc) trước khi lưu, chuyển ảnh hoặc xuất dữ liệu.'); return false; }
    if (pendingDraft) { setError('Hãy chọn bản nháp hoặc bản máy chủ trước khi tiếp tục.'); return false; }
    return true;
  };
  const saveCurrent = async (force = false, showPreview = false) => {
    if (savingRef.current) return savingRef.current;
    const current = documentRef.current;
    if (!current) return true;
    if (!noDraftGesture()) return false;
    if (!force && !current.dirty) return true;
    setSaving(true); setError('');
    const operation = (async () => {
      try {
        const saved = await api(`/segmentation/images/${current.imageId}`, { method: 'PUT', body: JSON.stringify({ width: current.width, height: current.height, revision: current.revision, regions: current.regions }) });
        replaceDocument({ ...saved, dirty: false });
        setSavedAnnotation(saved);
        setClasses(saved.classes);
        removeDraft(current);
        setSummary((items) => ({ ...items, [String(current.imageId)]: { regionCount: saved.regions.length, revision: saved.revision } }));
        setStatus(`Đã lưu ${saved.regions.length} vùng lên máy chủ · phiên bản ${saved.revision}.`);
        if (showPreview) requestAnimationFrame(() => previewAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        return true;
      } catch (failure) { setError(failure.message); return false; }
      finally { setSaving(false); savingRef.current = null; }
    })();
    savingRef.current = operation;
    return operation;
  };
  useImperativeHandle(ref, () => ({ prepareLeave: async () => !busy && noDraftGesture() && await saveCurrent() }));

  useEffect(() => {
    const controller = new AbortController();
    api('/projects', { signal: controller.signal }).then((items) => {
      setProjects(items);
      if (items.length) setSelectedProjectId((id) => id || items[0]._id);
    }).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message); });
    return () => controller.abort();
  }, [setSelectedProjectId]);

  useEffect(() => {
    const controller = new AbortController();
    setImages([]); setSelectedImageId(''); replaceDocument(null); setSavedAnnotation(null); setPendingDraft(null); setSummary({});
    setHistory([]); setFuture([]); setSelectedId(null); setError('');
    if (!selectedProjectId) { setListLoading(false); return () => controller.abort(); }
    setListLoading(true);
    Promise.all([
      api(`/images?projectId=${selectedProjectId}&limit=all&personal=true`, { signal: controller.signal }),
      api(`/segmentation/projects/${selectedProjectId}`, { signal: controller.signal })
    ]).then(([data, metadata]) => {
      if (controller.signal.aborted) return;
      setImages(data.images || []);
      setSummary(Object.fromEntries(metadata.annotations.map((item) => [String(item.imageId), item])));
      setClasses(metadata.classes);
      setActiveClassId(metadata.classes.find((item) => item.active)?.id || null);
      setSelectedImageId(data.images?.[0]?._id || '');
    }).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [selectedProjectId]);

  useEffect(() => {
    const controller = new AbortController();
    replaceDocument(null); setSavedAnnotation(null); setPendingDraft(null); setSelectedId(null); setHistory([]); setFuture([]);
    workspace.current?.scrollTo({ top: 0 });
    if (!selectedImageId || !currentImage) { setLoading(false); return () => controller.abort(); }
    setLoading(true); setError('');
    Promise.all([
      api(`/segmentation/images/${selectedImageId}`, { signal: controller.signal }),
      naturalSize(imageUrl(currentImage))
    ]).then(([data, size]) => {
      if (controller.signal.aborted) return;
      if (size.width * size.height > 64 * 1024 * 1024) throw new Error('Ảnh vượt giới hạn 64 triệu pixel của trình gán nhãn.');
      if (data.width && (data.width !== size.width || data.height !== size.height)) throw new Error('Kích thước ảnh đã thay đổi so với annotation. Cần khôi phục ảnh gốc trước khi chỉnh sửa.');
      setSavedAnnotation(data.revision ? { ...data, ...size } : null);
      let value = { ...data, ...size, dirty: false };
      let draft;
      try { draft = JSON.parse(localStorage.getItem(draftKey(data.projectId, data.imageId)) || 'null'); } catch { /* An invalid browser draft does not replace server data. */ }
      if (draft?.dirty && String(draft.imageId) === String(data.imageId) && draft.width === size.width && draft.height === size.height && Array.isArray(draft.regions)) {
        if (draft.revision === data.revision && !requestServerChoice.current) {
          value = { ...value, regions: draft.regions, dirty: true };
          setStatus('Đã khôi phục bản nháp chưa lưu của ảnh này.');
        } else {
          setPendingDraft(draft);
          setStatus('Có bản nháp cũ và phiên bản mới hơn trên máy chủ.');
        }
      } else setStatus(data.revision ? `Đã nạp annotation phiên bản ${data.revision}.` : 'Ảnh chưa có annotation Segmentation.');
      replaceDocument(value);
      requestServerChoice.current = false;
      setBrushSize((sizeInPixels) => Math.min(sizeInPixels, Math.max(size.width, size.height) * 2));
      setClasses(data.classes);
      setActiveClassId((id) => data.classes.find((item) => item.id === id && item.active)?.id || data.classes.find((item) => item.active)?.id || null);
    }).catch((failure) => { if (failure.name !== 'AbortError' && !controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Image IDs and dataset are stable; updating saved status must not reload a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImageId, selectedProjectId, reload]);

  useEffect(() => {
    const beforeUnload = (event) => { if (documentRef.current?.dirty || canvas.current?.hasDraft()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); worker.current?.terminate(); };
  }, []);

  const selectImage = async (id) => {
    if (id === selectedImageId || busy || !noDraftGesture()) return;
    if (await saveCurrent()) setSelectedImageId(id);
  };
  const selectProject = async (id) => {
    if (busy || !noDraftGesture()) return;
    if (await saveCurrent()) setSelectedProjectId(id);
  };
  const selectRegion = (id) => {
    setSelectedId(id);
    const region = regions.find((item) => item.id === id);
    if (region && activeClasses.some((item) => item.id === region.classId)) setActiveClassId(region.classId);
  };
  const changeSelected = (patch) => editRegions(regions.map((region) => region.id === selectedId ? { ...region, ...patch } : region));
  const convertSelectedRoi = () => {
    if (!selected || isMask(selected) || busy || pendingDraft || !noDraftGesture()) return;
    const mask = { ...roiToMask(selected), visible: true };
    editRegions(regions.map((region) => region.id === selectedId ? mask : region));
    setMasksVisible(true);
    setActiveClassId(mask.classId);
    canvas.current?.activateBrush();
    setStatus('Đã tô kín ROI thành mask. Dùng Brush/Eraser để chỉnh; Undo để trở lại ROI.');
  };
  const baseFilename = (currentImage?.filename || 'image').replace(/\.[^/.]+$/, '');
  const exportJson = () => {
    if (!document || !noDraftGesture()) return;
    const { dirty, ...data } = document;
    const payload = {
      ...data, classes, exportedAt: new Date().toISOString(), unsavedDraft: dirty,
      coordinateSystem: { width: document.width, height: document.height, origin: 'top-left', units: 'image-pixels', pixelSampling: 'pixel-centres' },
      mask: { format: 'PNG', bitDepth: 16, colorType: 'grayscale', fileSuffix: '_mask_ids_16bit.png', background: 0, pixelValue: 'classId', overlap: 'last-region-wins', includedTypes: ['polygon', 'brush'], visibilityAffectsExport: false },
      preview: { format: 'PNG', bitDepth: 8, colorType: 'rgb', fileSuffix: '_mask_mau.png', pixelValue: 'labelColor', trainingMask: false },
      roiTypes: ['box', 'ellipse']
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${baseFilename}_annotations.json`);
    setStatus('Đã xuất JSON gồm nhãn, mask, ROI và tọa độ ảnh gốc.');
  };
  const exportMask = async (mode = 'preview') => {
    if (!document || !noDraftGesture()) return;
    setExporting(true); setError('');
    try {
      const result = await new Promise((resolve, reject) => {
        const instance = new Worker(new URL('../workers/segmentationExport.js', import.meta.url), { type: 'module' });
        worker.current = instance;
        instance.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
        instance.onerror = () => reject(new Error('Không xuất được PNG mask. Hãy thử lại hoặc dùng ảnh nhỏ hơn.'));
        instance.postMessage({ regions: document.regions, width: document.width, height: document.height, mode, classes });
      });
      downloadBlob(result.blob, `${baseFilename}_${mode === 'preview' ? 'mask_mau' : 'mask_ids_16bit'}.png`);
      setStatus(result.empty
        ? 'Đã xuất mask trống (mọi pixel = 0). Hãy tô Brush/Polygon hoặc chuyển ROI thành mask nếu cần vùng gán nhãn.'
        : mode === 'preview'
          ? `Đã xuất ảnh PNG màu ${document.width}×${document.height}. Mở tệp ${baseFilename}_mask_mau.png để xem các vùng.`
          : `Đã xuất dữ liệu ID lớp 16-bit ${document.width}×${document.height} cho huấn luyện. Để xem vùng có màu, chọn Xuất PNG màu.`);
    } catch (failure) { setError(failure.message); }
    finally { worker.current?.terminate(); worker.current = null; setExporting(false); }
  };
  const loadServer = () => {
    if (documentRef.current?.dirty && !window.confirm('Tải lại bản máy chủ? Bản nháp hiện tại sẽ được giữ để bạn có thể khôi phục.')) return;
    canvas.current?.cancelDraft();
    requestServerChoice.current = true;
    setReload((value) => value + 1);
  };

  return <section className="flex h-full min-h-0 flex-col bg-gray-50" aria-label="Gán nhãn theo vùng">
    <div className="flex flex-wrap items-center justify-between gap-2 bg-white border-b border-gray-200 px-4 py-3">
      <div className="min-w-0"><h1 className="flex items-center gap-2 font-semibold text-gray-800"><ScanLine size={19} className="text-blue-600" />Segmentation 2D <span className="text-xs font-normal text-gray-500">Thủ công</span></h1><p className="text-xs mt-1 text-gray-500 truncate">{projects.find((project) => project._id === selectedProjectId)?.name || 'Chọn dataset'}{currentImage ? ` / ${currentImage.filename}` : ''}</p></div>
      <div className="flex flex-wrap gap-2 text-sm">
        <button onClick={() => saveCurrent(true, true)} disabled={!document || busy || Boolean(pendingDraft)} className="inline-flex items-center gap-1 rounded bg-green-500 hover:bg-green-600 text-white px-3 py-2 disabled:opacity-40">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Lưu</button>
        <button onClick={async () => { if (currentIndex < images.length - 1 && await saveCurrent(true)) setSelectedImageId(images[currentIndex + 1]._id); }} disabled={!document || busy || currentIndex >= images.length - 1} className="rounded border border-gray-300 px-3 py-2 disabled:opacity-40 hover:bg-gray-50">Lưu & ảnh tiếp</button>
        <button onClick={exportJson} disabled={!document || busy} className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-2 disabled:opacity-40"><Download size={15} />JSON</button>
        <button onClick={() => exportMask('preview')} disabled={!document || busy} title="Tải ảnh PNG có màu theo nhãn, mở được bằng trình xem ảnh" className="inline-flex items-center gap-1 rounded bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 disabled:opacity-40">{exporting ? <Loader2 size={16} className="animate-spin" /> : <Eye size={15} />}Xuất PNG màu</button>
        <button onClick={() => exportMask('data')} disabled={!document || busy} title="Dữ liệu huấn luyện: mỗi pixel là ID lớp 16-bit, ảnh sẽ trông gần đen khi mở thông thường" className="inline-flex items-center gap-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-2 disabled:opacity-40"><Download size={15} />Mask ID 16-bit</button>
      </div>
    </div>
    {error && <div role="alert" className="px-4 py-2 bg-red-50 border-b border-red-200 text-red-700 text-sm flex items-center justify-between gap-3"><span>{error}</span>{currentImage && <button onClick={loadServer} disabled={busy} className="underline shrink-0">Tải lại bản máy chủ</button>}</div>}
    {pendingDraft && <div role="alert" className="px-4 py-3 bg-amber-50 border-b border-amber-200 text-amber-900 text-sm flex flex-wrap gap-3 items-center"><span>Bản nháp dùng phiên bản {pendingDraft.revision}; máy chủ hiện là {document?.revision}. Chọn dữ liệu để tiếp tục.</span><button className="underline font-semibold" onClick={() => { const next = { ...document, regions: pendingDraft.regions, dirty: true }; replaceDocument(next); persistDraft(next); setPendingDraft(null); }}>Khôi phục bản nháp</button><button className="underline" onClick={() => { removeDraft(document); setPendingDraft(null); }}>Dùng bản máy chủ</button></div>}
    <div ref={workspace} data-testid="segmentation-workspace" className="flex-1 min-h-0 overflow-auto"><div className="grid h-full min-h-[530px] min-w-[800px] grid-cols-[12rem_minmax(320px,1fr)_15rem]">
      <aside className="flex min-h-0 flex-col bg-white border-r border-gray-200">
        <div className="p-3 border-b border-gray-200"><label className="block text-xs text-gray-500 mb-1" htmlFor="seg-dataset">Bộ dữ liệu</label><select id="seg-dataset" aria-label="Dataset Segmentation" value={selectedProjectId} disabled={busy} onChange={(event) => selectProject(event.target.value)} className="w-full p-1.5 rounded border border-gray-300 text-sm bg-white"><option value="" disabled>Chọn dataset</option>{projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}</select><input aria-label="Tìm ảnh Segmentation" placeholder="Tìm tên ảnh..." value={search} onChange={(event) => setSearch(event.target.value)} className="mt-3 w-full border border-gray-200 rounded px-2 py-1.5 text-xs" /></div>
        <div className="flex items-center justify-between p-3 text-xs border-b border-gray-200"><span className="font-semibold">Danh sách ảnh</span><span>{images.length ? `${currentIndex + 1} / ${images.length}` : '0 ảnh'}</span></div>
        <div className="flex-1 overflow-y-auto p-2">{listLoading && <p className="p-3 text-sm text-gray-500">Đang tải ảnh...</p>}{!listLoading && !images.length && <p className="p-3 text-xs text-gray-500">Chưa có ảnh được cấp quyền trong dataset này.</p>}{images.filter((image) => image.filename.toLowerCase().includes(search.toLowerCase())).map((image) => <button key={image._id} disabled={busy} onClick={() => selectImage(image._id)} title={image.filename} className={`w-full flex items-center gap-2 text-left rounded p-2 mb-1 border disabled:opacity-60 ${selectedImageId === image._id ? 'bg-blue-50 border-blue-300' : 'border-transparent hover:bg-gray-50'}`}><img src={imageUrl(image)} alt="" loading="lazy" className="w-10 h-10 object-contain bg-gray-100 rounded border border-gray-200 shrink-0" /><span className="min-w-0"><span className="block truncate text-xs font-medium text-gray-800">{image.filename}</span><span className={`block mt-1 text-[11px] ${summary[image._id]?.regionCount ? 'text-green-600' : 'text-gray-500'}`}>{selectedImageId === image._id && document?.dirty ? 'Bản nháp chưa lưu' : summary[image._id]?.regionCount ? `Đã gán · ${summary[image._id].regionCount} vùng` : summary[image._id]?.revision ? 'Đã lưu · chưa có vùng' : 'Chưa gán vùng'}</span></span></button>)}</div>
        <div className="flex items-center justify-between p-2 border-t"><button aria-label="Ảnh trước" disabled={busy || currentIndex <= 0} onClick={() => selectImage(images[currentIndex - 1]._id)} className="p-2 disabled:opacity-30"><ChevronLeft size={18} /></button><button aria-label="Ảnh tiếp theo" disabled={busy || currentIndex < 0 || currentIndex >= images.length - 1} onClick={() => selectImage(images[currentIndex + 1]._id)} className="p-2 disabled:opacity-30"><ChevronRight size={18} /></button></div>
      </aside>
      {document && currentImage ? <SegmentationCanvas key={`${selectedImageId}:${reload}`} ref={canvas} imageUrl={imageUrl(currentImage)} width={document.width} height={document.height} regions={regions} classes={classes} activeClassId={activeClassId} selectedId={selectedId} onSelect={selectRegion} onChange={editRegions} onUndo={undo} onRedo={redo} canUndo={history.length > 0} canRedo={future.length > 0} opacity={opacity} masksVisible={masksVisible} brushSize={brushSize} onStatus={setStatus} disabled={busy || Boolean(pendingDraft)} /> : <main className="flex items-center justify-center bg-gray-100 text-sm text-gray-500 p-6 text-center">{loading || listLoading ? <><Loader2 className="animate-spin mr-2" size={18} />Đang nạp ảnh và annotation...</> : 'Chọn dataset và ảnh để bắt đầu gán nhãn vùng.'}</main>}
      <aside className="min-h-0 overflow-y-auto bg-white border-l border-gray-200 text-sm">
        <div className="p-3 border-b border-gray-200"><h2 className="font-semibold text-gray-800 mb-2">Nhãn của dataset</h2>{!activeClasses.length && <p className="text-xs text-gray-500">Dataset chưa có nhãn. Admin cần thêm nhãn trong trang Quản lý nhãn.</p>}<div className="space-y-1">{activeClasses.map((item) => <button key={item.id} disabled={busy} onClick={() => { setActiveClassId(item.id); setSelectedId(null); }} className={`w-full text-left rounded px-2 py-2 flex items-center gap-2 border ${activeClassId === item.id ? 'border-blue-300 bg-blue-50' : 'border-transparent hover:bg-gray-50'}`}><span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} /><span className="truncate flex-1">{item.name}</span><span className="text-xs text-gray-400">{item.id}</span></button>)}</div></div>
        <div className="p-3 border-b space-y-3"><label className="flex items-center justify-between text-xs"><span>Hiển thị mask</span><input type="checkbox" checked={masksVisible} onChange={(event) => setMasksVisible(event.target.checked)} aria-label="Hiển thị mask" className="accent-blue-600" /></label><label className="block text-xs">Độ trong suốt: {opacity}%<input aria-label="Độ trong suốt mask" type="range" min="5" max="95" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} className="w-full accent-blue-600 mt-1" /></label><label className="block text-xs">Brush / Eraser: {brushSize} px gốc<input aria-label="Kích thước Brush và Eraser" type="range" min="1" max={brushLimit} value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} className="w-full accent-blue-600 mt-1" /></label><p className="text-[11px] text-gray-500 leading-relaxed">Polygon / Brush tạo mask. Ellipse / Box mặc định là ROI; chọn vùng và nhấn Tạo mask từ ROI để đưa vào PNG. Ẩn vùng chỉ ảnh hưởng hiển thị; PNG vẫn xuất tất cả mask.</p></div>
        <div className="p-3"><h2 className="font-semibold mb-2">Vùng đã gán ({regions.length})</h2>{selected && <div className="mb-3 border border-blue-200 bg-blue-50 rounded p-2">
          <label className="block text-xs mb-1" htmlFor="seg-region-label">Đổi nhãn vùng đang chọn</label>
          <select id="seg-region-label" value={selected.classId} disabled={busy} onChange={(event) => changeSelected({ classId: Number(event.target.value) })} className="w-full rounded border border-gray-300 p-1 text-xs bg-white">{!activeClasses.some((item) => item.id === selected.classId) && <option value={selected.classId} disabled>Nhãn đã xóa — hãy đổi</option>}{activeClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          {!isMask(selected) && <div className="mt-3">
            <button onClick={convertSelectedRoi} disabled={busy || Boolean(pendingDraft) || !activeClasses.some((item) => item.id === selected.classId)} className="w-full rounded bg-blue-600 hover:bg-blue-700 text-white px-2 py-2 text-xs font-medium disabled:opacity-40">Tạo mask từ ROI</button>
            <p className="mt-1 text-[11px] text-blue-700">Tô kín toàn bộ {selected.type === 'ellipse' ? 'Ellipse' : 'Box'} bằng nhãn đã chọn. Sau đó dùng Brush/Eraser để sửa; mask sẽ được xuất vào PNG.</p>
          </div>}
          <p className="mt-2 text-[11px] text-blue-700">Dùng công cụ Chọn / sửa để kéo vùng, kéo đỉnh Polygon hoặc góc ROI. Brush tô thêm vào vùng Brush đang chọn; Eraser tẩy vùng mask đang chọn.</p>
        </div>}
          <div className="space-y-1">{regions.map((region, index) => {
            const label = classes.find((item) => item.id === region.classId);
            return <div key={region.id} className={`flex items-center gap-1 rounded border px-2 py-2 ${selectedId === region.id ? 'border-blue-300 bg-blue-50' : 'border-transparent hover:bg-gray-50'}`}><button disabled={busy} onClick={() => selectRegion(region.id)} className="flex items-center gap-2 min-w-0 flex-1 text-left"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: label?.color || '#6b7280' }} /><span className="min-w-0"><span className="block text-xs truncate">{label?.name || `Lớp ${region.classId}`}{label?.active ? '' : ' (đã xóa)'}</span><span className="block text-[10px] text-gray-500">Vùng {index + 1} · {region.type} · {isMask(region) ? 'Mask' : 'ROI'}</span></span></button><button aria-label={`${region.visible ? 'Ẩn' : 'Hiện'} vùng ${index + 1}`} disabled={busy} onClick={() => editRegions(regions.map((item) => item.id === region.id ? { ...item, visible: !item.visible } : item))} className="p-1 text-gray-500">{region.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button><button aria-label={`Xóa vùng ${index + 1}`} disabled={busy} onClick={() => { editRegions(regions.filter((item) => item.id !== region.id)); if (selectedId === region.id) setSelectedId(null); }} className="p-1 text-gray-500 hover:text-red-600"><Trash2 size={14} /></button></div>;
          })}</div>{!regions.length && <p className="border border-dashed rounded p-4 text-center text-xs text-gray-500">Chọn nhãn và công cụ để tạo vùng đầu tiên.</p>}
        </div>
        <div className="p-3 border-t text-[11px] text-gray-500 leading-relaxed">Chọn Xuất PNG màu để mở và xem vùng theo màu nhãn. Mask ID 16-bit chứa dữ liệu lớp dùng cho huấn luyện, thường trông gần đen. Các vùng chồng nhau ưu tiên vùng tạo sau.</div>
      </aside>
    </div>
      <div ref={previewAnchor}>
        <SavedSegmentationPreview key={savedAnnotation ? `${savedAnnotation.imageId}:${savedAnnotation.revision}` : 'unsaved'} annotation={savedAnnotation && String(savedAnnotation.imageId) === String(selectedImageId) ? savedAnnotation : null} imageUrl={imageUrl(currentImage)} dirty={Boolean(document?.dirty)} />
      </div>
    </div>
    <div role="status" aria-live="polite" className="border-t border-gray-200 bg-white px-4 py-2 text-xs flex justify-between gap-2 text-gray-600"><span>{error ? 'Cần xử lý lỗi trước khi tiếp tục.' : status}</span><span className="shrink-0">{document?.dirty ? 'Chưa lưu máy chủ' : document?.revision ? `Đã lưu · v${document.revision}` : 'Chưa lưu'}{currentImage && <button title="Tải lại annotation" aria-label="Tải lại annotation" disabled={busy} onClick={loadServer} className="ml-3"><RotateCcw size={13} /></button>}</span></div>
  </section>;
});
export default SegmentationEditor;
