const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const palette = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#d97706', '#0891b2', '#db2777', '#4f46e5'];

// IDs survive label renames and are never reassigned after deletion.
const buildClassCatalog = (saved = [], labels = [], migration = null) => {
  const entries = saved.map((entry) => ({ id: entry.id, name: entry.name, color: entry.color, active: false }));
  if (migration?.type === 'rename') {
    const entry = entries.find((item) => item.name === migration.from && saved.find((old) => old.id === item.id)?.active);
    if (entry) entry.name = migration.to;
  }
  let next = Math.max(0, ...entries.map((entry) => entry.id)) + 1;
  for (const name of labels) {
    let entry = entries.find((item) => item.name === name && (saved.find((old) => old.id === item.id)?.active || migration?.to === name));
    if (!entry) {
      if (next > 65535) fail('Dataset đã dùng hết ID lớp cho mask 16 bit.');
      entry = { id: next, name, color: palette[next - 1] || `hsl(${(next * 137.508) % 360} 72% 45%)`, active: true };
      next += 1;
      entries.push(entry);
    }
    entry.active = true;
  }
  return entries;
};

const validateAnnotation = (body, classes) => {
  const { width, height, revision, regions } = body || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 32768 || height > 32768 || width * height > 64 * 1024 * 1024) fail('Kích thước ảnh không hợp lệ (tối đa 64 triệu pixel).');
  if (!Number.isSafeInteger(revision) || revision < 0) fail('Thiếu phiên bản annotation hợp lệ.');
  if (!Array.isArray(regions) || regions.length > 1000) fail('Annotation tối đa 1000 vùng.');
  const activeIds = new Set(classes.filter((item) => item.active).map((item) => item.id));
  const ids = new Set();
  let pointCount = 0;
  const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const readBox = (box) => {
    if (!box || !finite(box.x, 0, width) || !finite(box.y, 0, height) ||
        !finite(box.width, 0.01, width) || !finite(box.height, 0.01, height) ||
        box.x + box.width > width + 0.00001 || box.y + box.height > height + 0.00001) fail('ROI hoặc mask nằm ngoài kích thước ảnh.');
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  const point = (value) => {
    pointCount += 1;
    if (pointCount > 200000 || !value || !finite(value.x, 0, width) || !finite(value.y, 0, height)) fail('Tọa độ vùng không hợp lệ hoặc có quá nhiều điểm.');
    return { x: value.x, y: value.y };
  };
  const normalized = regions.map((region) => {
    if (!region || typeof region.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(region.id) || ids.has(region.id)) fail('ID vùng không hợp lệ hoặc trùng nhau.');
    ids.add(region.id);
    if (!activeIds.has(region.classId)) fail('Vùng dùng nhãn đã xóa hoặc không thuộc dataset. Hãy đổi nhãn hoặc xóa vùng đó.');
    if (!['polygon', 'brush', 'ellipse', 'box'].includes(region.type)) fail('Loại vùng không được hỗ trợ.');
    const result = { id: region.id, classId: region.classId, type: region.type, visible: region.visible !== false };
    if (region.baseShape !== undefined) {
      if (region.type !== 'brush' || !region.baseShape || !['box', 'ellipse'].includes(region.baseShape.type)) fail('Hình gốc của mask chuyển từ ROI không hợp lệ.');
      result.baseShape = { type: region.baseShape.type, box: readBox(region.baseShape.box) };
    }
    if (region.type === 'polygon') {
      if (!Array.isArray(region.points) || region.points.length < 3) fail('Polygon cần ít nhất 3 điểm.');
      result.points = region.points.map(point);
    }
    if (region.type === 'ellipse' || region.type === 'box') {
      result.box = readBox(region.box);
    } else {
      const strokes = region.strokes || [];
      if (!Array.isArray(strokes) || strokes.length > 2000) fail('Quá nhiều nét vẽ trong một vùng.');
      result.strokes = strokes.map((stroke) => {
        if (!stroke || !['paint', 'erase'].includes(stroke.mode) ||
            (region.type === 'polygon' && stroke.mode !== 'erase') ||
            !finite(stroke.size, 0.25, Math.max(width, height) * 2) ||
            !Array.isArray(stroke.points) || !stroke.points.length) fail('Nét Brush/Eraser không hợp lệ.');
        return { mode: stroke.mode, size: stroke.size, points: stroke.points.map(point) };
      });
      if (region.type === 'brush' && !result.baseShape && !result.strokes.some((stroke) => stroke.mode === 'paint')) fail('Vùng Brush cần ít nhất một nét tô hoặc hình được chuyển từ ROI.');
    }
    return result;
  });
  return { width, height, revision, regions: normalized };
};

module.exports = { buildClassCatalog, validateAnnotation };
