import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MousePointer2, Pentagon, Paintbrush, Eraser, Circle, BoxSelect, Hand, ZoomIn, ZoomOut, Maximize, Undo2, Redo2, Check, X } from 'lucide-react';
import { boxFrom, clamp, isMask, pathFor, regionPoints, translateRegion, viewportToImage, zoomAt } from '../utils/segmentation';

const tools = [
  ['select', 'Chọn / sửa', MousePointer2], ['polygon', 'Polygon', Pentagon], ['brush', 'Brush', Paintbrush],
  ['eraser', 'Eraser', Eraser], ['ellipse', 'Ellipse ROI', Circle], ['box', 'Box ROI', BoxSelect], ['pan', 'Pan', Hand]
];

function Stroke({ stroke, color }) {
  return stroke.points.length === 1
    ? <circle cx={stroke.points[0].x} cy={stroke.points[0].y} r={stroke.size / 2} fill={color} />
    : <path d={pathFor(stroke.points)} fill="none" stroke={color} strokeWidth={stroke.size} strokeLinecap="round" strokeLinejoin="round" />;
}

function RegionShape({ region, color, opacity, width, height, scale, selected }) {
  let shape = region.type === 'polygon'
    ? <polygon points={region.points.map((point) => `${point.x},${point.y}`).join(' ')} fill={color} fillRule="evenodd" />
    : null;
  if (region.baseShape) {
    const box = region.baseShape.box;
    shape = region.baseShape.type === 'box'
      ? <rect {...box} fill={color} />
      : <ellipse cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} fill={color} />;
  }
  const masks = [];
  for (const [index, stroke] of (region.strokes || []).entries()) {
    if (stroke.mode === 'paint') shape = <>{shape}<Stroke stroke={stroke} color={color} /></>;
    else {
      const id = `seg-erase-${region.id}-${index}`;
      masks.push(<mask key={id} id={id} x="0" y="0" width={width} height={height} maskUnits="userSpaceOnUse" style={{ maskType: 'luminance' }}><rect width={width} height={height} fill="white" /><Stroke stroke={stroke} color="black" /></mask>);
      shape = <g mask={`url(#${id})`}>{shape}</g>;
    }
  }
  if (region.box) {
    const box = region.box;
    const props = { fill: 'transparent', stroke: color, strokeWidth: selected ? 3 : 2, vectorEffect: 'non-scaling-stroke', strokeDasharray: '7 5' };
    shape = region.type === 'box' ? <rect {...box} {...props} /> : <ellipse cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} {...props} />;
  }
  return <g data-region-id={region.id} opacity={isMask(region) ? opacity / 100 : 1}>
    <defs>{masks}</defs>{shape}
    {selected && region.type === 'polygon' && <polygon points={region.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={color} strokeWidth={2 / scale} pointerEvents="none" />}
  </g>;
}

const SegmentationCanvas = forwardRef(function SegmentationCanvas({ imageUrl, width, height, regions, classes, activeClassId, selectedId, onSelect, onChange, onUndo, onRedo, canUndo, canRedo, opacity, masksVisible, brushSize, onStatus, disabled }, ref) {
  const viewport = useRef(null);
  const interaction = useRef(null);
  const viewRef = useRef({ x: 0, y: 0, scale: 1 });
  const [view, setView] = useState(viewRef.current);
  const [tool, setTool] = useState('brush');
  const [polygon, setPolygon] = useState([]);
  const polygonRef = useRef([]);
  const [preview, setPreview] = useState(null);
  const [cursor, setCursor] = useState(null);
  const fitted = useRef(false);
  const shown = preview || regions;
  const selected = shown.find((region) => region.id === selectedId);
  const colorFor = (id) => classes.find((item) => item.id === id)?.color || '#6b7280';

  const changeView = (next) => { viewRef.current = next; setView(next); };
  const fit = () => {
    if (!viewport.current || !width || !height) return;
    const bounds = viewport.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const scale = Math.min((bounds.width - 32) / width, (bounds.height - 32) / height);
    changeView({ scale, x: (bounds.width - width * scale) / 2, y: (bounds.height - height * scale) / 2 });
    fitted.current = true;
  };
  useEffect(() => {
    const element = viewport.current;
    const observer = new ResizeObserver(() => { if (!fitted.current) fit(); });
    observer.observe(element);
    fit();
    const wheel = (event) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const current = viewRef.current;
      const scale = clamp(current.scale * Math.exp(-event.deltaY * 0.0015), 0.01, 32);
      changeView(zoomAt(current, scale, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
    // A canvas is remounted for each image, whose natural dimensions are fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearDraft = () => {
    interaction.current = null;
    polygonRef.current = [];
    setPolygon([]);
    setPreview(null);
  };
  useImperativeHandle(ref, () => ({
    hasDraft: () => polygonRef.current.length > 0 || Boolean(interaction.current),
    cancelDraft: clearDraft,
    activateBrush: () => { clearDraft(); setTool('brush'); }
  }));
  const finishPolygon = () => {
    if (polygonRef.current.length < 3) { onStatus('Polygon cần ít nhất 3 điểm.'); return; }
    if (!activeClassId) { onStatus('Chọn nhãn trước khi vẽ.'); return; }
    const id = crypto.randomUUID();
    onChange([...regions, { id, type: 'polygon', classId: activeClassId, points: polygonRef.current, strokes: [], visible: true }]);
    onSelect(id);
    clearDraft();
  };
  const localPoint = (event, bounded = true) => {
    const bounds = viewport.current.getBoundingClientRect();
    const point = viewportToImage({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, viewRef.current);
    return bounded ? { x: clamp(point.x, 0, width), y: clamp(point.y, 0, height) } : point;
  };
  const applyInteraction = (point) => {
    const action = interaction.current;
    if (!action || action.kind === 'pan') return;
    let next;
    if (action.kind === 'stroke') {
      const last = action.stroke.points.at(-1);
      if (Math.hypot(last.x - point.x, last.y - point.y) >= Math.max(0.25, 1 / viewRef.current.scale)) action.stroke.points.push(point);
      next = { ...action.region, strokes: [...(action.region.strokes || []), { ...action.stroke, points: [...action.stroke.points] }] };
    } else if (action.kind === 'roi') next = { ...action.region, box: boxFrom(action.start, point) };
    else if (action.kind === 'vertex') next = { ...action.region, points: action.region.points.map((value, index) => index === action.vertex ? point : value) };
    else if (action.kind === 'resize') next = { ...action.region, box: boxFrom(action.anchor, point) };
    else {
      const bounds = regionPoints(action.region).reduce((box, value) => ({ left: Math.min(box.left, value.x), right: Math.max(box.right, value.x), top: Math.min(box.top, value.y), bottom: Math.max(box.bottom, value.y) }), { left: width, right: 0, top: height, bottom: 0 });
      next = translateRegion(action.region, clamp(point.x - action.start.x, -bounds.left, width - bounds.right), clamp(point.y - action.start.y, -bounds.top, height - bounds.bottom));
    }
    action.next = action.isNew ? [...regions, next] : regions.map((region) => region.id === next.id ? next : region);
    setPreview(action.next);
  };
  const pointerDown = (event) => {
    if (disabled || (event.button !== 0 && event.button !== 1)) return;
    viewport.current.focus();
    if (tool === 'pan' || event.button === 1 || event.altKey) {
      interaction.current = { kind: 'pan', x: event.clientX, y: event.clientY, view: viewRef.current };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    const raw = localPoint(event, false);
    if (raw.x < 0 || raw.x > width || raw.y < 0 || raw.y > height) return;
    const point = localPoint(event);
    if (tool === 'polygon') {
      if (!activeClassId) { onStatus('Dataset cần có nhãn; hãy chọn nhãn trước khi vẽ.'); return; }
      if (event.detail > 1) return;
      if (polygonRef.current.length >= 3 && Math.hypot(point.x - polygonRef.current[0].x, point.y - polygonRef.current[0].y) * viewRef.current.scale < 9) { finishPolygon(); return; }
      polygonRef.current = [...polygonRef.current, point];
      setPolygon(polygonRef.current);
      return;
    }
    if (tool === 'select') {
      const target = event.target.closest('[data-region-id]');
      const region = regions.find((item) => item.id === target?.dataset.regionId);
      onSelect(region?.id || null);
      if (!region) return;
      const vertex = event.target.getAttribute('data-vertex');
      const corner = event.target.getAttribute('data-corner');
      let kind = 'move', anchor;
      if (vertex !== null) kind = 'vertex';
      if (corner !== null && region.box) {
        kind = 'resize';
        const box = region.box;
        anchor = { x: Number(corner) & 1 ? box.x : box.x + box.width, y: Number(corner) & 2 ? box.y : box.y + box.height };
      }
      interaction.current = { kind, region, start: point, vertex: Number(vertex), anchor };
    } else if (tool === 'eraser' || tool === 'brush') {
      if (tool === 'eraser' && (!selected || !isMask(selected))) { onStatus('Chọn một vùng Polygon hoặc Brush trước khi tẩy.'); return; }
      if (tool === 'brush' && !activeClassId) { onStatus('Chọn nhãn trước khi vẽ.'); return; }
      const existing = tool === 'eraser' ? selected : selected?.type === 'brush' && selected.classId === activeClassId ? selected : null;
      const region = existing || { id: crypto.randomUUID(), type: 'brush', classId: activeClassId, visible: true, strokes: [] };
      interaction.current = { kind: 'stroke', region, isNew: !existing, stroke: { mode: tool === 'eraser' ? 'erase' : 'paint', size: brushSize, points: [point] } };
      onSelect(region.id);
    } else {
      if (!activeClassId) { onStatus('Chọn nhãn trước khi vẽ ROI.'); return; }
      const region = { id: crypto.randomUUID(), type: tool, classId: activeClassId, visible: true };
      interaction.current = { kind: 'roi', region, isNew: true, start: point };
      onSelect(region.id);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    applyInteraction(point);
  };
  const pointerMove = (event) => {
    const point = localPoint(event);
    setCursor(point);
    const action = interaction.current;
    if (action?.kind === 'pan') changeView({ ...action.view, x: action.view.x + event.clientX - action.x, y: action.view.y + event.clientY - action.y });
    else applyInteraction(point);
  };
  const pointerUp = (event) => {
    const action = interaction.current;
    if (!action) return;
    if (action.kind !== 'pan') {
      applyInteraction(localPoint(event));
      const target = action.next?.find((region) => region.id === action.region.id);
      if (action.next && (!target.box || (target.box.width >= 0.01 && target.box.height >= 0.01))) onChange(action.next);
    }
    interaction.current = null;
    setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const zoom = (factor) => {
    const bounds = viewport.current.getBoundingClientRect();
    changeView(zoomAt(viewRef.current, clamp(viewRef.current.scale * factor, 0.01, 32), { x: bounds.width / 2, y: bounds.height / 2 }));
  };
  const keyDown = (event) => {
    if (event.target.closest('input,select,textarea')) return;
    if (event.key === 'Escape') { clearDraft(); return; }
    if (event.key === 'Enter' && polygonRef.current.length) { event.preventDefault(); finishPolygon(); }
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); clearDraft();
      if (event.shiftKey || event.key.toLowerCase() === 'y') onRedo(); else onUndo();
    }
    if (event.key === 'Delete' && selectedId) { event.preventDefault(); onChange(regions.filter((region) => region.id !== selectedId)); onSelect(null); }
  };
  const handlePoints = selected?.box ? [0, 1, 2, 3].map((corner) => ({ x: selected.box.x + (corner & 1 ? selected.box.width : 0), y: selected.box.y + (corner & 2 ? selected.box.height : 0) })) : selected?.points || [];

  return <main className="min-w-0 min-h-0 flex flex-col bg-gray-100 border-r border-gray-200">
    <div className="flex flex-wrap gap-1 bg-white border-b border-gray-200 p-2">
      {tools.map(([id, label, icon]) => { const Icon = icon; return <button key={id} title={label} aria-label={label} aria-pressed={tool === id} disabled={disabled} onClick={() => { clearDraft(); setTool(id); }} className={`px-2 py-2 rounded text-xs flex items-center gap-1 disabled:opacity-40 ${tool === id ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}><Icon size={16} /><span className="hidden 2xl:inline">{label}</span></button>; })}
      <span className="border-l mx-1" />
      <button title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác" disabled={!canUndo || disabled} onClick={() => { clearDraft(); onUndo(); }} className="p-2 hover:bg-gray-100 rounded disabled:opacity-30"><Undo2 size={17} /></button>
      <button title="Khôi phục (Ctrl+Y)" aria-label="Khôi phục" disabled={!canRedo || disabled} onClick={() => { clearDraft(); onRedo(); }} className="p-2 hover:bg-gray-100 rounded disabled:opacity-30"><Redo2 size={17} /></button>
      {polygon.length > 0 && <><button onClick={finishPolygon} className="px-2 text-xs text-blue-700 flex items-center gap-1"><Check size={15} />Đóng Polygon ({polygon.length})</button><button onClick={clearDraft} title="Hủy nét đang vẽ" className="p-2"><X size={16} /></button></>}
    </div>
    <div ref={viewport} tabIndex={0} aria-label="Canvas gán nhãn vùng" data-testid="segmentation-viewport" className="relative flex-1 min-h-[360px] overflow-hidden outline-none touch-none" style={{ cursor: tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={clearDraft} onPointerLeave={() => setCursor(null)} onDoubleClick={() => { if (tool === 'polygon' && polygonRef.current.length >= 3) finishPolygon(); }} onKeyDown={keyDown} onContextMenu={(event) => event.preventDefault()}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', left: view.x, top: view.y, width: width * view.scale, height: height * view.scale, overflow: 'hidden' }} aria-label="Ảnh gốc và annotation">
        <image href={imageUrl} width={width} height={height} preserveAspectRatio="none" pointerEvents="none" />
        {shown.filter((region) => region.visible && (!isMask(region) || masksVisible)).map((region) => <RegionShape key={region.id} region={region} color={colorFor(region.classId)} opacity={opacity} width={width} height={height} scale={view.scale} selected={selectedId === region.id} />)}
        {tool === 'select' && selected?.visible && (!isMask(selected) || masksVisible) && <g data-region-id={selected.id}>{handlePoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={5 / view.scale} fill="white" stroke={colorFor(selected.classId)} strokeWidth={2 / view.scale} data-vertex={selected.type === 'polygon' ? index : undefined} data-corner={selected.box ? index : undefined} style={{ cursor: 'move' }} />)}</g>}
        {polygon.length > 0 && <g pointerEvents="none"><polyline points={polygon.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={colorFor(activeClassId)} strokeWidth={2 / view.scale} />{polygon.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={(index ? 3 : 6) / view.scale} fill={colorFor(activeClassId)} />)}</g>}
        {cursor && ['brush', 'eraser'].includes(tool) && <circle cx={cursor.x} cy={cursor.y} r={brushSize / 2} fill="none" stroke={tool === 'eraser' ? 'white' : colorFor(activeClassId)} strokeWidth={1.5 / view.scale} pointerEvents="none" />}
      </svg>
    </div>
    <div className="flex items-center justify-between gap-2 border-t border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
      <span>{width} × {height} px · {tool === 'polygon' ? 'Click thêm điểm · Enter đóng · Esc hủy' : tool === 'select' ? 'Kéo vùng / điểm để sửa' : 'Cuộn để zoom · Alt+kéo để pan'}</span>
      <div className="flex items-center gap-2"><button aria-label="Thu nhỏ" title="Thu nhỏ" onClick={() => zoom(1 / 1.25)}><ZoomOut size={16} /></button><span className="w-12 text-center">{Math.round(view.scale * 100)}%</span><button aria-label="Phóng to" title="Phóng to" onClick={() => zoom(1.25)}><ZoomIn size={16} /></button><button aria-label="Vừa khung" title="Vừa khung" onClick={fit}><Maximize size={16} /></button></div>
    </div>
  </main>;
});
export default SegmentationCanvas;
