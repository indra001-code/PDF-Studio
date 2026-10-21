import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
const pdfCache = new WeakMap();
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

export function validateFileSize(file) {
  if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} is larger than the 50 MB per-file limit.`);
}

export function getPdfDocument(file) {
  if (!pdfCache.has(file)) {
    const promise = file.arrayBuffer().then((buffer) => {
      const data = new Uint8Array(buffer);
      if (new TextDecoder().decode(data.slice(0, 1024)).indexOf('%PDF-') < 0) throw new Error(`${file.name} does not look like a valid PDF.`);
      return getDocument({ data }).promise;
    }).catch((error) => {
      if (error?.name === 'PasswordException') throw new Error(`${file.name} is password-protected. Unlock it and try again.`);
      throw error instanceof Error && error.message.includes(file.name) ? error : new Error(`Could not open ${file.name}. It may be damaged or password-protected.`);
    });
    pdfCache.set(file, promise);
  }
  return pdfCache.get(file);
}

export async function createPdfFromImages(files) {
  if (!files.length) throw new Error('Choose at least one JPG or PNG image.');
  const output = await PDFDocument.create();
  for (const file of files) {
    validateFileSize(file);
    const bytes = await file.arrayBuffer();
    const name = file.name.toLowerCase();
    let image;
    if (file.type === 'image/png' || name.endsWith('.png')) image = await output.embedPng(bytes);
    else if (file.type === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg')) image = await output.embedJpg(bytes);
    else {
      try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable.');
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const png = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image conversion failed.')), 'image/png'));
        image = await output.embedPng(await png.arrayBuffer());
      } catch {
        throw new Error(`${file.name} could not be decoded by this browser. Try saving it as JPG or PNG, then upload it again.`);
      }
    }
    const scale = Math.min(1, 900 / Math.max(image.width, image.height));
    const width = image.width * scale;
    const height = image.height * scale;
    const page = output.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }
  return new File([await output.save()], 'images.pdf', { type: 'application/pdf' });
}

function hexColor(hex) {
  const h = hex.replace('#', '');
  const value = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return rgb(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
}

function toOriginalPoint(x, y, width, height, angle) {
  switch (((angle % 360) + 360) % 360) {
    case 90: return { x: y, y: height - x };
    case 180: return { x: width - x, y: height - y };
    case 270: return { x: width - y, y: x };
    default: return { x, y };
  }
}

function displayRectToPdf(x, y, w, h, pageWidth, pageHeight, angle) {
  const displayWidth = angle % 180 ? pageHeight : pageWidth;
  const displayHeight = angle % 180 ? pageWidth : pageHeight;
  const points = [
    toOriginalPoint(x * displayWidth, y * displayHeight, pageWidth, pageHeight, angle),
    toOriginalPoint((x + w) * displayWidth, y * displayHeight, pageWidth, pageHeight, angle),
    toOriginalPoint(x * displayWidth, (y + h) * displayHeight, pageWidth, pageHeight, angle),
    toOriginalPoint((x + w) * displayWidth, (y + h) * displayHeight, pageWidth, pageHeight, angle),
  ].map(({ x: px, y: py }) => ({ x: px, y: pageHeight - py }));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), displayWidth, displayHeight };
}

function normalizedPointToPdf(point, pageWidth, pageHeight, angle, displayWidth, displayHeight) {
  const original = toOriginalPoint(point.x * displayWidth, point.y * displayHeight, pageWidth, pageHeight, angle);
  return { x: original.x, y: pageHeight - original.y };
}

function drawArrowHead(page, start, end, color, thickness, opacity) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const length = Math.max(thickness * 3, Math.min(15, Math.hypot(end.x - start.x, end.y - start.y) * 0.18));
  const spread = Math.PI / 6;
  for (const direction of [angle - spread, angle + spread]) {
    const point = { x: end.x - length * Math.cos(direction), y: end.y - length * Math.sin(direction) };
    page.drawLine({ start: point, end, color, thickness, opacity });
  }
}

async function drawOverlay(page, output, overlay, angle, font) {
  const width = page.getWidth();
  const height = page.getHeight();
  const rect = displayRectToPdf(overlay.x, overlay.y, overlay.w || 0.2, overlay.h || 0.08, width, height, angle);
  const color = hexColor(overlay.color || '#7057e8');
  if (overlay.type === 'image' && overlay.dataUrl) {
    const raw = atob(overlay.dataUrl.split(',')[1]);
    const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
    const image = overlay.dataUrl.startsWith('data:image/png') ? await output.embedPng(bytes) : await output.embedJpg(bytes);
    page.drawImage(image, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  } else if (overlay.type === 'text' || overlay.type === 'signature') {
    const text = overlay.text || '';
    const point = toOriginalPoint(overlay.x * rect.displayWidth, overlay.y * rect.displayHeight, width, height, angle);
    const size = Math.max(8, (overlay.fontSize || 18) * rect.displayHeight / (overlay.referenceHeight || 850));
    page.drawText(text, { x: point.x, y: height - point.y - size, size, font, color });
  } else if (overlay.type === 'shape' && (overlay.shapeKind === 'line' || overlay.shapeKind === 'arrow' || overlay.shapeKind === 'freehand')) {
    const points = (overlay.points || []).map((point) => normalizedPointToPdf(point, width, height, angle, rect.displayWidth, rect.displayHeight));
    const thickness = Math.max(1, (overlay.strokeWidth || 2) * rect.displayHeight / (overlay.referenceHeight || 850));
    for (let index = 1; index < points.length; index += 1) page.drawLine({ start: points[index - 1], end: points[index], color, thickness });
    if (overlay.shapeKind === 'arrow' && points.length > 1) drawArrowHead(page, points[0], points[points.length - 1], color, thickness, 1);
  } else if (overlay.type === 'highlight' && overlay.shapeKind === 'freehand') {
    const points = (overlay.points || []).map((point) => normalizedPointToPdf(point, width, height, angle, rect.displayWidth, rect.displayHeight));
    const thickness = Math.max(6, (overlay.strokeWidth || 14) * rect.displayHeight / (overlay.referenceHeight || 850));
    for (let index = 1; index < points.length; index += 1) page.drawLine({ start: points[index - 1], end: points[index], color, thickness, opacity: 0.46 });
  } else if (overlay.type === 'shape' && overlay.shapeKind === 'ellipse') {
    page.drawEllipse({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, xScale: rect.width / 2, yScale: rect.height / 2, borderColor: color, borderWidth: Math.max(1, (overlay.strokeWidth || 2) * rect.displayHeight / (overlay.referenceHeight || 850)) });
  } else {
    const isHighlight = overlay.type === 'highlight';
    page.drawRectangle({
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      borderColor: color,
      borderWidth: isHighlight ? 0 : Math.max(1, (overlay.strokeWidth || 2) * rect.displayHeight / (overlay.referenceHeight || 850)),
      color: isHighlight ? color : undefined,
      opacity: isHighlight ? 0.34 : 1,
    });
  }
}

export async function exportPdf(files, pages, onProgress = () => {}) {
  const output = await PDFDocument.create();
  const sources = new Map();
  for (const spec of pages) {
    if (!sources.has(spec.fileIndex)) sources.set(spec.fileIndex, await PDFDocument.load(await files[spec.fileIndex].arrayBuffer()));
  }
  const font = await output.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages.length; i += 1) {
    const spec = pages[i];
    const source = sources.get(spec.fileIndex);
    const [page] = await output.copyPages(source, [spec.sourceIndex]);
    const rotation = (((source.getPage(spec.sourceIndex).getRotation().angle + (spec.rotation || 0)) % 360) + 360) % 360;
    page.setRotation(degrees(rotation));
    if (spec.crop) {
      const crop = displayRectToPdf(spec.crop.x, spec.crop.y, spec.crop.w, spec.crop.h, page.getWidth(), page.getHeight(), rotation);
      page.setCropBox(crop.x, crop.y, crop.width, crop.height);
    }
    output.addPage(page);
    for (const overlay of spec.overlays || []) await drawOverlay(page, output, overlay, rotation, font);
    onProgress(i + 1, pages.length);
  }
  return await output.save();
}
