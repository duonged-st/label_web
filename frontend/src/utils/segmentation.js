export const isMask = (region) => region.type === 'polygon' || region.type === 'brush';
export const roiToMask = (region) => {
  if (!['box', 'ellipse'].includes(region.type) || !region.box) throw new Error('Hãy chọn Ellipse hoặc Box ROI để tạo mask.');
  return {
    id: region.id, type: 'brush', classId: region.classId, visible: region.visible,
    baseShape: { type: region.type, box: { ...region.box } }, strokes: []
  };
};
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const pathFor = (points) => points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ') + (points.length === 1 ? ' l 0 0.001' : '');
export const viewportToImage = (point, view) => ({ x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale });
export const zoomAt = (view, scale, anchor) => {
  const point = viewportToImage(anchor, view);
  return { scale, x: anchor.x - point.x * scale, y: anchor.y - point.y * scale };
};
export const boxFrom = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
export const regionPoints = (region) => {
  const box = region.box || region.baseShape?.box;
  return [
    ...(box ? [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height }] : []),
    ...(region.points || []), ...(region.strokes || []).flatMap((stroke) => stroke.points)
  ];
};
export const translateRegion = (region, dx, dy) => {
  const move = (point) => ({ x: point.x + dx, y: point.y + dy });
  return {
    ...region,
    ...(region.box ? { box: { ...region.box, x: region.box.x + dx, y: region.box.y + dy } } : {}),
    ...(region.baseShape ? { baseShape: { ...region.baseShape, box: { ...region.baseShape.box, x: region.baseShape.box.x + dx, y: region.baseShape.box.y + dy } } } : {}),
    ...(region.points ? { points: region.points.map(move) } : {}),
    ...(region.strokes ? { strokes: region.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map(move) })) } : {})
  };
};

// Pixel centres and hard coverage produce exact IDs, never blended RGB values.
// Visibility/opacity are display settings. All masks are exported; ROI is excluded.
export function rasterizeMask(regions, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 64 * 1024 * 1024) throw new Error('Kích thước mask không hợp lệ (tối đa 64 triệu pixel).');
  const output = new Uint16Array(width * height);
  const layer = new Uint8Array(width * height);
  const capsule = (a, b, radius, value) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const left = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius));
    const right = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + radius));
    const top = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius));
    const bottom = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + radius));
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const t = length ? clamp(((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / length, 0, 1) : 0;
        if ((x + 0.5 - a.x - t * dx) ** 2 + (y + 0.5 - a.y - t * dy) ** 2 <= radius * radius) layer[y * width + x] = value;
      }
    }
  };
  for (const region of regions) {
    if (!isMask(region)) continue;
    if (!Number.isInteger(region.classId) || region.classId < 1 || region.classId > 65535) throw new Error('ID lớp không hợp lệ.');
    layer.fill(0);
    if (region.baseShape) {
      const { type, box } = region.baseShape;
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const left = Math.max(0, Math.floor(box.x)), right = Math.min(width, Math.ceil(box.x + box.width));
      const top = Math.max(0, Math.floor(box.y)), bottom = Math.min(height, Math.ceil(box.y + box.height));
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const inside = type === 'ellipse'
          ? ((x + 0.5 - cx) / (box.width / 2)) ** 2 + ((y + 0.5 - cy) / (box.height / 2)) ** 2 <= 1
          : x + 0.5 >= box.x && x + 0.5 < box.x + box.width && y + 0.5 >= box.y && y + 0.5 < box.y + box.height;
        if (inside) layer[y * width + x] = 1;
      }
    }
    if (region.type === 'polygon') {
      const points = region.points || [];
      if (points.length < 3) continue;
      const top = Math.max(0, Math.floor(points.reduce((min, point) => Math.min(min, point.y), height)));
      const bottom = Math.min(height - 1, Math.ceil(points.reduce((max, point) => Math.max(max, point.y), 0)));
      for (let y = top; y <= bottom; y++) {
        const intersections = [];
        for (let index = 0; index < points.length; index++) {
          const a = points[index], b = points[(index + 1) % points.length];
          if ((a.y > y + 0.5) !== (b.y > y + 0.5)) intersections.push(a.x + (y + 0.5 - a.y) * (b.x - a.x) / (b.y - a.y));
        }
        intersections.sort((a, b) => a - b);
        for (let index = 0; index + 1 < intersections.length; index += 2) {
          const left = Math.max(0, Math.ceil(intersections[index] - 0.5));
          const right = Math.min(width, Math.ceil(intersections[index + 1] - 0.5));
          layer.fill(1, y * width + left, y * width + right);
        }
      }
    }
    for (const stroke of region.strokes || []) {
      for (let index = 0; index < stroke.points.length; index++) {
        capsule(stroke.points[Math.max(0, index - 1)], stroke.points[index], stroke.size / 2, stroke.mode === 'erase' ? 0 : 1);
      }
    }
    for (let index = 0; index < output.length; index++) if (layer[index]) output[index] = region.classId;
  }
  return output;
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
const pngChunk = (type, bytes) => {
  const result = new Uint8Array(12 + bytes.length);
  const data = new DataView(result.buffer);
  data.setUint32(0, bytes.length);
  result.set(new TextEncoder().encode(type), 4);
  result.set(bytes, 8);
  let crc = 0xffffffff;
  for (let index = 4; index < 8 + bytes.length; index++) crc = crcTable[(crc ^ result[index]) & 255] ^ (crc >>> 8);
  data.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
};

async function encodePng(raw, width, height, bitDepth, colorType) {
  if (typeof CompressionStream === 'undefined') throw new Error('Hãy dùng Chrome, Edge hoặc Firefox mới để xuất PNG.');
  const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = bitDepth;
  header[9] = colorType;
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())], { type: 'image/png' });
}

// True single-channel, 16-bit grayscale PNG. Pixel value = class ID (0 = background).
export async function encodeMaskPng(pixels, width, height) {
  if (pixels.length !== width * height) throw new Error('Mask không khớp kích thước ảnh.');
  const raw = new Uint8Array(height * (1 + width * 2));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 2);
    for (let x = 0; x < width; x++) {
      const value = pixels[y * width + x];
      raw[row + 1 + x * 2] = value >>> 8;
      raw[row + 2 + x * 2] = value & 255;
    }
  }
  return encodePng(raw, width, height, 16, 0);
}

const previewColor = (entry, id) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(entry?.color || '');
  if (hex) return [0, 2, 4].map((offset) => parseInt(hex[1].slice(offset, offset + 2), 16));
  // Matches the HSL palette used by segmentationValidation for later classes.
  const hue = (id * 137.508) % 360;
  const chroma = (1 - Math.abs(2 * 0.45 - 1)) * 0.72;
  const secondary = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const offset = 0.45 - chroma / 2;
  const rgb = [[chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary], [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary]][Math.floor(hue / 60)];
  return rgb.map((value) => Math.round((value + offset) * 255));
};

async function encodeColoredMaskPng(pixels, width, height, classes, transparent) {
  if (pixels.length !== width * height) throw new Error('Mask không khớp kích thước ảnh.');
  const colors = new Map(classes.map((entry) => [entry.id, previewColor(entry, entry.id)]));
  colors.set(0, [0, 0, 0]);
  const channels = transparent ? 4 : 3;
  const raw = new Uint8Array(height * (1 + width * channels));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * channels);
    for (let x = 0; x < width; x++) {
      const id = pixels[y * width + x];
      if (!colors.has(id)) colors.set(id, previewColor(null, id));
      raw.set(colors.get(id), row + 1 + x * channels);
      if (transparent) raw[row + 1 + x * channels + 3] = id === 0 ? 0 : 255;
    }
  }
  return encodePng(raw, width, height, 8, transparent ? 6 : 2);
}

// Human-readable RGB preview. The training mask above retains the exact IDs.
export const encodeMaskPreviewPng = (pixels, width, height, classes = []) => encodeColoredMaskPng(pixels, width, height, classes, false);
// Transparent background allows a precise overlay without darkening the source image.
export const encodeMaskOverlayPng = (pixels, width, height, classes = []) => encodeColoredMaskPng(pixels, width, height, classes, true);

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
