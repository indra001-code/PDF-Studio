import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Crop, Fingerprint,
  Circle, FileImage, FilePlus2, FileText, Files, Highlighter, ImagePlus,
  Layers3, LoaderCircle, LockKeyhole, Menu, Minus, MousePointer2,
  PencilLine, Plus, RotateCcw, RotateCw, ShieldCheck, Sparkles, Trash2, WandSparkles,
  Type, Undo2, Redo2, X,
} from 'lucide-react';

const TOOL_CARDS = [
  { id: 'edit', icon: PencilLine, title: 'Edit PDF', copy: 'Add text, highlights, shapes, and image notes.' },
  { id: 'merge', icon: Files, title: 'Merge PDFs', copy: 'Combine documents and arrange pages your way.' },
  { id: 'pdf-images', icon: FileImage, title: 'PDF to images', copy: 'Download every page as a PNG image.' },
  { id: 'images-pdf', icon: FilePlus2, title: 'Images to PDF', copy: 'Turn laptop photos and common image files into a PDF.' },
];

const toolDetails = {
  select: ['Select', 'Tap an item to select; drag to move, use its corner handle to resize, or double-click text to edit.'],
  text: ['Add text', 'Click on the page to place your text.'],
  highlight: ['Highlight', 'Choose a color and marker style, then drag on the page.'],
  shape: ['Shape', 'Choose a shape and color, then drag on the page.'],
  signature: ['Signature mark', 'Click on the page to add a typed signature.'],
  image: ['Add image', 'Click on the page, then choose a JPG or PNG.'],
  crop: ['Crop page', 'Outside the selected area is hidden. Undo restores the full page.'],
};

const ANNOTATION_COLORS = ['#f3cf43', '#ee89ae', '#82bdf5', '#84d8ae', '#a992f4', '#ffae70'];

function ColorPalette({ value, onChange, label }) {
  return <div className="color-palette" role="group" aria-label={label}>{ANNOTATION_COLORS.map((color) => <button key={color} className={value === color ? 'color-swatch swatch-active' : 'color-swatch'} type="button" style={{ '--swatch': color }} aria-label={`${label}: ${color}`} aria-pressed={value === color} onClick={() => onChange(color)} />)}</div>;
}

function pathBounds(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(0.012, Math.max(...xs) - x), h: Math.max(0.012, Math.max(...ys) - y) };
}

function overlayWidth(overlay, pageSize) {
  if (overlay.w) return overlay.w;
  if (overlay.type === 'image') return 0.24;
  if (overlay.type !== 'text' && overlay.type !== 'signature') return 0.2;
  const fontSize = (overlay.fontSize || 18) * pageSize.height / (overlay.referenceHeight || pageSize.height);
  const longestLine = Math.max(...(overlay.text || '').split('\n').map((line) => line.length), 1);
  return Math.min(0.92, Math.max(0.12, (longestLine * fontSize * 0.62 + 12) / pageSize.width));
}

function PathOverlay({ overlay, pageHeight, selected, activeTool, onSelect, onPointerDown, onPointerMove, onPointerUp }) {
  const bounds = pathBounds(overlay.points);
  const strokeWidth = (overlay.strokeWidth || 2) * pageHeight / (overlay.referenceHeight || pageHeight);
  const points = overlay.points.map((point) => `${((point.x - bounds.x) / bounds.w) * 100},${((point.y - bounds.y) / bounds.h) * 100}`).join(' ');
  const end = overlay.points[overlay.points.length - 1];
  const start = overlay.points[0];
  let arrowHead = '';
  if (overlay.shapeKind === 'arrow' && start && end) {
    const sx = ((start.x - bounds.x) / bounds.w) * 100;
    const sy = ((start.y - bounds.y) / bounds.h) * 100;
    const ex = ((end.x - bounds.x) / bounds.w) * 100;
    const ey = ((end.y - bounds.y) / bounds.h) * 100;
    const angle = Math.atan2(ey - sy, ex - sx);
    const length = Math.max(5, Math.min(14, Math.hypot(ex - sx, ey - sy) * .18));
    const left = `${ex - length * Math.cos(angle - Math.PI / 6)},${ey - length * Math.sin(angle - Math.PI / 6)}`;
    const right = `${ex - length * Math.cos(angle + Math.PI / 6)},${ey - length * Math.sin(angle + Math.PI / 6)}`;
    arrowHead = `${left} ${ex},${ey} ${right}`;
  }
  return <svg className={`pdf-overlay path-overlay${selected ? ' overlay-selected' : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={overlay.type === 'highlight' ? 'Freehand highlight' : `Freehand ${overlay.shapeKind}`} onClick={(event) => { if (activeTool === 'select') { event.stopPropagation(); onSelect(); } }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} style={{ left: `${bounds.x * 100}%`, top: `${bounds.y * 100}%`, width: `${bounds.w * 100}%`, height: `${bounds.h * 100}%`, color: overlay.color }}>
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth={overlay.type === 'highlight' ? Math.max(10, strokeWidth) : strokeWidth} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={overlay.type === 'highlight' ? '.48' : '1'} />
    {arrowHead && <polyline points={arrowHead} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
  </svg>;
}

function Brand({ compact = false }) {
  return <a className="brand" href="#top" onClick={(event) => event.preventDefault()}><span className="brand-mark"><Layers3 size={19} strokeWidth={2.25} /></span><span>pdf<span className="brand-strong">studio</span></span>{compact && <span className="brand-tag">BETA</span>}</a>;
}

function PageThumbnail({ file, pageNumber, rotation = 0, selected, onClick }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    let active = true;
    let observer;
    async function draw() {
      try {
        const { getPdfDocument } = await import('./pdfUtils.js');
        const doc = await getPdfDocument(file);
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 0.22, rotation: (page.rotate + rotation) % 360 });
        const canvas = canvasRef.current;
        if (!active || !canvas) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      } catch { /* the main viewer reports document errors */ }
    }
    const canvas = canvasRef.current;
    if (canvas && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          draw();
        }
      }, { root: canvas.closest('.thumbnail-list'), rootMargin: '160px 0px' });
      observer.observe(canvas);
    } else {
      draw();
    }
    return () => { active = false; observer?.disconnect(); };
  }, [file, pageNumber, rotation]);
  return <button className={`thumb-button${selected ? ' thumb-selected' : ''}`} type="button" onClick={onClick} aria-current={selected ? 'page' : undefined}>
    <span className="thumb-paper"><canvas ref={canvasRef} /></span><span className="thumb-num">{pageNumber}</span>
  </button>;
}

function App() {
  const [view, setView] = useState('home');
  const [workflow, setWorkflow] = useState('edit');
  const [files, setFiles] = useState([]);
  const [pages, setPages] = useState([]);
  const [activePage, setActivePage] = useState(0);
  const [activeTool, setActiveTool] = useState('select');
  const [zoom, setZoom] = useState(1);
  const [pageSize, setPageSize] = useState({ width: 640, height: 820, referenceHeight: 820 });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [drawRect, setDrawRect] = useState(null);
  const [drawPoints, setDrawPoints] = useState([]);
  const [shapeKind, setShapeKind] = useState('rectangle');
  const [highlightKind, setHighlightKind] = useState('area');
  const [shapeColor, setShapeColor] = useState('#7057e8');
  const [highlightColor, setHighlightColor] = useState('#f3cf43');
  const [shapeWidth, setShapeWidth] = useState(2);
  const [highlightWidth, setHighlightWidth] = useState(14);
  const [textDraft, setTextDraft] = useState(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState(null);
  const [dragOverlay, setDragOverlay] = useState(null);
  const textSizeEditRef = useRef(false);
  const overlayResizeRef = useRef(null);
  const zoomRef = useRef(zoom);
  const pendingZoomRef = useRef(null);
  const zoomFrameRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputFlowRef = useRef('edit');
  const imageInputRef = useRef(null);
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const overlayLayerRef = useRef(null);
  const overlayMoveRef = useRef(null);
  const renderTaskRef = useRef(null);
  const renderQueueRef = useRef(Promise.resolve());
  const renderSequenceRef = useRef(0);
  const imageTargetRef = useRef(null);
  const dropRef = useRef(null);
  const page = pages[activePage];
  const selectedOverlay = page?.overlays.find((overlay) => overlay.id === selectedOverlayId);
  const selectedTextOverlay = selectedOverlay && (selectedOverlay.type === 'text' || selectedOverlay.type === 'signature') ? selectedOverlay : null;
  const isImageExport = workflow === 'pdf-images';

  const updatePages = useCallback((next) => {
    setHistory((old) => [...old.slice(-30), pages]);
    setRedoStack([]);
    setPages(next);
  }, [pages]);

  const startFlow = (flow) => {
    setError('');
    inputFlowRef.current = flow;
    if (view !== 'workspace') setWorkflow(flow);
    if (!fileInputRef.current) return;
    fileInputRef.current.multiple = flow === 'merge' || flow === 'images-pdf';
    fileInputRef.current.accept = flow === 'images-pdf' ? 'image/*' : '.pdf,application/pdf';
    fileInputRef.current.click();
  };

  const openWorkspace = async (selectedFiles, flow = workflow) => {
    const incoming = Array.from(selectedFiles || []);
    if (!incoming.length) return;
    setBusy(true);
    setError('');
    setProgress('Preparing your files…');
    try {
      const { getPdfDocument, validateFileSize } = await import('./pdfUtils.js');
      incoming.forEach(validateFileSize);
      const isAppending = view === 'workspace' && flow === 'merge';
      const combinedSize = incoming.reduce((sum, file) => sum + file.size, 0) + (isAppending ? files.reduce((sum, file) => sum + file.size, 0) : 0);
      if (combinedSize > 150 * 1024 * 1024) throw new Error('The combined file size must be under 150 MB.');
      let sourceFiles = incoming;
      let currentFlow = flow;
      if (flow === 'images-pdf') {
        const { createPdfFromImages } = await import('./pdfUtils.js');
        const output = await createPdfFromImages(incoming);
        sourceFiles = [output];
        currentFlow = 'edit';
      } else {
        if (flow !== 'merge') sourceFiles = [incoming[0]];
        if (sourceFiles.some((file) => file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))) {
          throw new Error('Choose a PDF file for this tool.');
        }
      }
      const specs = [];
      for (let fileIndex = 0; fileIndex < sourceFiles.length; fileIndex += 1) {
        setProgress(`Reading ${sourceFiles[fileIndex].name}…`);
        const doc = await getPdfDocument(sourceFiles[fileIndex]);
        if (specs.length + doc.numPages > 200) throw new Error('This workspace supports up to 200 pages at a time.');
        for (let sourceIndex = 0; sourceIndex < doc.numPages; sourceIndex += 1) specs.push({ fileIndex: fileIndex + (isAppending ? files.length : 0), sourceIndex, rotation: 0, overlays: [] });
      }
      setFiles(isAppending ? [...files, ...sourceFiles] : sourceFiles);
      setPages(isAppending ? [...pages, ...specs] : specs);
      setActivePage(isAppending ? pages.length : 0);
      setActiveTool('select');
      setZoom(1);
      setHistory([]);
      setRedoStack([]);
      if (!isAppending) setWorkflow(currentFlow);
      setView('workspace');
    } catch (caught) {
      setError(caught?.message || 'Something went wrong while opening your file.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const handleInput = (event) => {
    const flow = inputFlowRef.current;
    openWorkspace(event.target.files, flow);
    event.target.value = '';
  };

  useEffect(() => {
    if (view !== 'workspace' || !page || !viewerRef.current || !canvasRef.current) return undefined;
    let cancelled = false;
    const sequence = ++renderSequenceRef.current;
    renderTaskRef.current?.cancel();
    const renderJob = renderQueueRef.current.catch(() => {}).then(async () => {
      let task = null;
      try {
        if (cancelled || sequence !== renderSequenceRef.current) return;
        setProgress('Rendering page…');
        const { getPdfDocument } = await import('./pdfUtils.js');
        const doc = await getPdfDocument(files[page.fileIndex]);
        if (cancelled || sequence !== renderSequenceRef.current) return;
        const pdfPage = await doc.getPage(page.sourceIndex + 1);
        if (cancelled || sequence !== renderSequenceRef.current) return;
        const rotation = ((pdfPage.rotate + page.rotation) % 360 + 360) % 360;
        const unit = pdfPage.getViewport({ scale: 1, rotation });
        const available = Math.max(280, viewerRef.current?.clientWidth - 70 || 640);
        const scale = Math.min(1.1, available / unit.width) * zoom;
        const viewport = pdfPage.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        if (cancelled || sequence !== renderSequenceRef.current || !canvas) return;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        setPageSize({ width: viewport.width, height: viewport.height, referenceHeight: viewport.height, rotation });
        task = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
        renderTaskRef.current = task;
        await task.promise;
      } catch (caught) {
        if (!cancelled && sequence === renderSequenceRef.current && caught?.name !== 'RenderingCancelledException') setError(caught?.message || 'Could not render this page.');
      } finally {
        if (renderTaskRef.current === task) renderTaskRef.current = null;
        if (!cancelled && sequence === renderSequenceRef.current) setProgress('');
      }
    });
    renderQueueRef.current = renderJob;
    return () => { cancelled = true; renderTaskRef.current?.cancel(); };
  }, [view, files, page?.fileIndex, page?.sourceIndex, page?.rotation, activePage, zoom]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || view !== 'workspace') return undefined;
    const handleWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomRef.current = Math.max(0.55, Math.min(1.8, zoomRef.current * Math.exp(-event.deltaY * 0.002)));
      pendingZoomRef.current = zoomRef.current;
      if (zoomFrameRef.current === null) {
        zoomFrameRef.current = requestAnimationFrame(() => {
          zoomFrameRef.current = null;
          if (pendingZoomRef.current !== null) setZoom(pendingZoomRef.current);
          pendingZoomRef.current = null;
        });
      }
    };
    viewer.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      viewer.removeEventListener('wheel', handleWheel);
      if (zoomFrameRef.current !== null) cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = null;
    };
  }, [view]);

  useEffect(() => { setSelectedOverlayId(null); textSizeEditRef.current = false; overlayMoveRef.current = null; setDragOverlay(null); }, [activePage]);

  const addOverlay = (overlay) => {
    if (!page) return;
    const annotation = { id: overlay.id || crypto.randomUUID(), ...overlay };
    const next = pages.map((item, index) => index === activePage ? { ...item, overlays: [...item.overlays, annotation] } : item);
    updatePages(next);
    return annotation.id;
  };

  const coordinates = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  };

  const pageCoordinates = (event) => {
    const bounds = overlayLayerRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  };

  const beginOverlayMove = (event, overlay) => {
    if (activeTool !== 'select' || !['text', 'signature', 'image', 'shape', 'highlight'].includes(overlay.type)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pageCoordinates(event);
    const width = overlayWidth(overlay, pageSize);
    const height = overlay.h || 0.08;
    overlayMoveRef.current = { id: overlay.id, offsetX: point.x - overlay.x, offsetY: point.y - overlay.y, width, height, startX: overlay.x, startY: overlay.y, nextX: overlay.x, nextY: overlay.y };
    setSelectedOverlayId(overlay.id);
    setDragOverlay({ id: overlay.id, x: overlay.x, y: overlay.y, w: width, h: height });
  };

  const beginPathMove = (event, overlay) => {
    if (activeTool !== 'select') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = pathBounds(overlay.points);
    const point = pageCoordinates(event);
    overlayMoveRef.current = {
      id: overlay.id,
      points: overlay.points,
      offsetX: point.x - bounds.x,
      offsetY: point.y - bounds.y,
      startX: bounds.x,
      startY: bounds.y,
      width: bounds.w,
      height: bounds.h,
      nextX: bounds.x,
      nextY: bounds.y,
    };
    setSelectedOverlayId(overlay.id);
  };

  const moveSelectedOverlay = (event) => {
    const resize = overlayResizeRef.current;
    if (resize) {
      const bounds = overlayLayerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      if (resize.isText) {
        const fontSize = Math.round(Math.max(8, Math.min(48, resize.fontSize + ((event.clientY - resize.clientY) * pageSize.referenceHeight / pageSize.height) * 0.5)));
        resize.nextFontSize = fontSize;
        setDragOverlay({ id: resize.id, x: resize.x, y: resize.y, fontSize });
      } else {
        const w = Math.max(0.04, Math.min(1 - resize.x, resize.w + (event.clientX - resize.clientX) / bounds.width));
        const h = Math.max(0.04, Math.min(1 - resize.y, resize.h + (event.clientY - resize.clientY) / bounds.height));
        resize.nextW = w;
        resize.nextH = h;
        setDragOverlay({ id: resize.id, x: resize.x, y: resize.y, w, h });
      }
      return;
    }
    const drag = overlayMoveRef.current;
    if (!drag) return;
    const point = pageCoordinates(event);
    const x = Math.max(0, Math.min(1 - drag.width, point.x - drag.offsetX));
    const y = Math.max(0, Math.min(1 - drag.height, point.y - drag.offsetY));
    drag.nextX = x;
    drag.nextY = y;
    setDragOverlay(drag.points
      ? { id: drag.id, dx: x - drag.startX, dy: y - drag.startY }
      : { id: drag.id, x, y, w: drag.width, h: drag.height });
  };

  const beginOverlayResize = (event, overlay) => {
    if (activeTool !== 'select') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    overlayMoveRef.current = null;
    const isText = overlay.type === 'text' || overlay.type === 'signature';
    overlayResizeRef.current = {
      id: overlay.id,
      x: overlay.x,
      y: overlay.y,
      w: overlayWidth(overlay, pageSize),
      h: overlay.h || 0.08,
      fontSize: overlay.fontSize || 18,
      nextW: overlayWidth(overlay, pageSize),
      nextH: overlay.h || 0.08,
      nextFontSize: overlay.fontSize || 18,
      clientX: event.clientX,
      clientY: event.clientY,
      isText,
    };
    setSelectedOverlayId(overlay.id);
  };

  const finishOverlayResize = () => {
    const resize = overlayResizeRef.current;
    if (!resize) return;
    const patch = resize.isText
      ? { fontSize: resize.nextFontSize }
      : { w: resize.nextW, h: resize.nextH };
    const changed = resize.isText
      ? Math.abs(resize.nextFontSize - resize.fontSize) > 0.01
      : Math.abs(resize.nextW - resize.w) > 0.001 || Math.abs(resize.nextH - resize.h) > 0.001;
    if (changed) {
      updatePages(pages.map((item, index) => index === activePage ? {
        ...item,
        overlays: item.overlays.map((overlay) => overlay.id === resize.id ? { ...overlay, ...patch } : overlay),
      } : item));
    }
    overlayResizeRef.current = null;
    setDragOverlay(null);
  };

  const finishOverlayMove = () => {
    const drag = overlayMoveRef.current;
    if (!drag) return;
    if (Math.abs(drag.nextX - drag.startX) > 0.001 || Math.abs(drag.nextY - drag.startY) > 0.001) {
      updatePages(pages.map((item, index) => index === activePage ? {
        ...item,
        overlays: item.overlays.map((overlay) => {
          if (overlay.id !== drag.id) return overlay;
          if (drag.points) return { ...overlay, points: drag.points.map((point) => ({ x: point.x + drag.nextX - drag.startX, y: point.y + drag.nextY - drag.startY })) };
          return { ...overlay, x: drag.nextX, y: drag.nextY };
        }),
      } : item));
    }
    overlayMoveRef.current = null;
    setDragOverlay(null);
  };

  const editTextOverlay = (event, overlay) => {
    if (activeTool !== 'select' || !['text', 'signature'].includes(overlay.type)) return;
    event.preventDefault();
    event.stopPropagation();
    overlayMoveRef.current = null;
    setDragOverlay(null);
    setSelectedOverlayId(overlay.id);
    setActiveTool('text');
    setTextDraft({ tool: overlay.type, editingId: overlay.id, point: { x: overlay.x, y: overlay.y }, value: overlay.text || '', color: overlay.color || '#263047', fontSize: overlay.fontSize || 18 });
  };

  const onPageClick = (event) => {
    if (activeTool === 'select') { setSelectedOverlayId(null); return; }
    if (activeTool !== 'text' && activeTool !== 'signature' && activeTool !== 'image') return;
    const point = coordinates(event);
    if (activeTool === 'image') {
      imageTargetRef.current = point;
      imageInputRef.current?.click();
      return;
    }
    setTextDraft({ tool: activeTool, point, value: '', color: activeTool === 'signature' ? '#4a3a9c' : '#263047', fontSize: activeTool === 'signature' ? 23 : 18 });
  };

  const submitTextDraft = (event) => {
    event?.preventDefault();
    if (!textDraft?.value.trim()) return;
    const id = textDraft.editingId || addOverlay({ type: textDraft.tool, ...textDraft.point, text: textDraft.value.trim(), color: textDraft.color, fontSize: textDraft.fontSize, referenceHeight: pageSize.referenceHeight });
    if (textDraft.editingId) updatePages(pages.map((item, index) => index === activePage ? { ...item, overlays: item.overlays.map((overlay) => overlay.id === textDraft.editingId ? { ...overlay, text: textDraft.value.trim(), color: textDraft.color, fontSize: textDraft.fontSize } : overlay) } : item));
    setTextDraft(null);
    setActiveTool('select');
    setSelectedOverlayId(id);
  };

  const onPointerDown = (event) => {
    if (activeTool !== 'shape' && activeTool !== 'highlight' && activeTool !== 'crop') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = coordinates(event);
    setDrawStart(point);
    setDrawRect({ x: point.x, y: point.y, w: 0, h: 0 });
    setDrawPoints([point]);
  };
  const onPointerMove = (event) => {
    if (!drawStart) return;
    const point = coordinates(event);
    setDrawRect({ x: Math.min(drawStart.x, point.x), y: Math.min(drawStart.y, point.y), w: Math.abs(point.x - drawStart.x), h: Math.abs(point.y - drawStart.y) });
    if ((activeTool === 'shape' && shapeKind === 'freehand') || (activeTool === 'highlight' && highlightKind === 'freehand')) {
      setDrawPoints((current) => [...current, point]);
    } else if (activeTool === 'shape' && (shapeKind === 'line' || shapeKind === 'arrow')) {
      setDrawPoints([drawStart, point]);
    }
  };
  const onPointerUp = (event) => {
    if (!drawStart) return;
    const point = coordinates(event);
    const rect = { x: Math.min(drawStart.x, point.x), y: Math.min(drawStart.y, point.y), w: Math.max(0.012, Math.abs(point.x - drawStart.x)), h: Math.max(0.012, Math.abs(point.y - drawStart.y)) };
    if (activeTool === 'crop') {
      if (rect.w < 0.04 || rect.h < 0.04) setError('Drag a larger area to crop the page.');
      else updatePages(pages.map((item, index) => index === activePage ? { ...item, crop: rect } : item));
    } else if (activeTool === 'highlight' && highlightKind === 'freehand') {
      const points = [...drawPoints, point];
      addOverlay({ type: 'highlight', shapeKind: 'freehand', x: 0, y: 0, w: 1, h: 1, points, color: highlightColor, strokeWidth: highlightWidth, referenceHeight: pageSize.referenceHeight });
    } else if (activeTool === 'highlight') {
      addOverlay({ type: 'highlight', ...rect, color: highlightColor, strokeWidth: highlightWidth });
    } else if (shapeKind === 'freehand' || shapeKind === 'line' || shapeKind === 'arrow') {
      const points = shapeKind === 'freehand' ? [...drawPoints, point] : [drawStart, point];
      addOverlay({ type: 'shape', shapeKind, x: 0, y: 0, w: 1, h: 1, points, color: shapeColor, strokeWidth: shapeWidth, referenceHeight: pageSize.referenceHeight });
    } else {
      addOverlay({ type: 'shape', shapeKind, ...rect, color: shapeColor, strokeWidth: shapeWidth });
    }
    setDrawStart(null);
    setDrawRect(null);
    setDrawPoints([]);
  };

  const handleImageInput = (event) => {
    const file = event.target.files?.[0];
    const point = imageTargetRef.current;
    event.target.value = '';
    if (!file || !point) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError('Choose a JPG or PNG image.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('Overlay images must be smaller than 10 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => addOverlay({ type: 'image', ...point, w: 0.24, h: 0.18, dataUrl: reader.result });
    reader.readAsDataURL(file);
  };

  const undo = () => {
    if (!history.length) return;
    const previous = history[history.length - 1];
    setRedoStack((old) => [...old, pages]);
    setHistory(history.slice(0, -1));
    setPages(previous);
  };
  const redo = () => {
    if (!redoStack.length) return;
    setHistory((old) => [...old, pages]);
    setPages(redoStack[redoStack.length - 1]);
    setRedoStack(redoStack.slice(0, -1));
  };

  const rotatePage = (amount) => updatePages(pages.map((item, index) => index === activePage ? { ...item, rotation: (item.rotation + amount + 360) % 360 } : item));
  const cancelTool = () => {
    setActiveTool('select');
    setDrawStart(null);
    setDrawRect(null);
    setDrawPoints([]);
    setTextDraft(null);
    setSelectedOverlayId(null);
    overlayMoveRef.current = null;
    overlayResizeRef.current = null;
    setDragOverlay(null);
  };
  const deleteSelectedOverlay = () => {
    if (!selectedOverlayId) return;
    updatePages(pages.map((item, index) => index === activePage ? { ...item, overlays: item.overlays.filter((overlay) => overlay.id !== selectedOverlayId) } : item));
    setSelectedOverlayId(null);
  };
  const updateSelectedText = (patch) => {
    if (!selectedTextOverlay) return;
    updatePages(pages.map((item, index) => index === activePage ? { ...item, overlays: item.overlays.map((overlay) => overlay.id === selectedOverlayId ? { ...overlay, ...patch } : overlay) } : item));
  };
  const beginTextSizeEdit = () => {
    if (textSizeEditRef.current) return;
    textSizeEditRef.current = true;
    setHistory((old) => [...old.slice(-30), pages]);
    setRedoStack([]);
  };
  const changeSelectedTextSize = (value) => {
    if (!selectedTextOverlay) return;
    if (!textSizeEditRef.current) beginTextSizeEdit();
    const size = Number(value);
    setPages((current) => current.map((item, index) => index === activePage ? { ...item, overlays: item.overlays.map((overlay) => overlay.id === selectedOverlayId ? { ...overlay, fontSize: size } : overlay) } : item));
  };
  const clearCrop = () => updatePages(pages.map((item, index) => index === activePage ? { ...item, crop: null } : item));
  const removePage = (index) => {
    if (pages.length < 2) { setError('Keep at least one page in the document.'); return; }
    if (!window.confirm(`Delete page ${index + 1}? This change can be undone.`)) return;
    updatePages(pages.filter((_, i) => i !== index));
    setActivePage(Math.min(index, pages.length - 2));
  };
  const movePage = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    [next[index], next[target]] = [next[target], next[index]];
    updatePages(next);
    setActivePage(target);
  };

  const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const savePdf = async () => {
    if (!pages.length) return;
    setBusy(true);
    setError('');
    try {
      const { exportPdf } = await import('./pdfUtils.js');
      const bytes = await exportPdf(files, pages, (done, total) => setProgress(`Preparing page ${done} of ${total}…`));
      const merged = files.length > 1;
      const base = merged ? 'merged-document' : files[0].name.replace(/\.pdf$/i, '-edited');
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${base}.pdf`);
      setProgress('Your PDF has been downloaded.');
    } catch (caught) { setError(caught?.message || 'Could not create the PDF.'); }
    finally { setBusy(false); }
  };

  const saveImages = async () => {
    setBusy(true);
    setError('');
    try {
      const [{ getPdfDocument }, { default: JSZip }] = await Promise.all([import('./pdfUtils.js'), import('jszip')]);
      const zip = new JSZip();
      for (let i = 0; i < pages.length; i += 1) {
        setProgress(`Converting page ${i + 1} of ${pages.length}…`);
        const spec = pages[i];
        const doc = await getPdfDocument(files[spec.fileIndex]);
        const pdfPage = await doc.getPage(spec.sourceIndex + 1);
        const rotation = ((pdfPage.rotate + spec.rotation) % 360 + 360) % 360;
        const viewport = pdfPage.getViewport({ scale: 2, rotation });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (blob) zip.file(`page-${String(i + 1).padStart(3, '0')}.png`, blob);
      }
      setProgress('Packing your images…');
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, 'pdf-pages.zip');
      setProgress('Your PNG images have been downloaded.');
    } catch (caught) { setError(caught?.message || 'Could not convert these pages to images.'); }
    finally { setBusy(false); }
  };

  const returnHome = () => {
    if (busy) return;
    if (history.length && !window.confirm('Exit the editor? Your original file will stay unchanged, but your edits will be discarded.')) return;
    setView('home'); setFiles([]); setPages([]); setActivePage(0); setError(''); setProgress('');
  };

  const onDrop = (event) => {
    event.preventDefault(); setDragOver(false);
    openWorkspace(event.dataTransfer.files, view === 'workspace' ? 'merge' : workflow);
  };
  const onHomeDrop = (event) => {
    event.preventDefault(); setDragOver(false);
    openWorkspace(event.dataTransfer.files, 'edit');
  };

  return <div className="app-shell" id="top">
    <input ref={fileInputRef} className="hidden-input" type="file" onChange={handleInput} />
    <input ref={imageInputRef} className="hidden-input" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={handleImageInput} />
    {view === 'home' ? <>
      <header className="site-header"><div className="nav-wrap"><Brand compact /><nav className="main-nav"><a href="#tools">Tools</a><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a><button className="nav-cta" type="button" onClick={() => startFlow('edit')}>Open a PDF <ArrowRight size={15} /></button></nav><button className="mobile-menu" type="button" onClick={() => startFlow('edit')} aria-label="Open a PDF"><Menu size={20} /></button></div></header>
      <main>
        <section className="hero section-wrap"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-spark"><Sparkles size={13} /></span> Your documents, right in the browser</div><h1>PDF work,<br /><span>made simple.</span></h1><p className="hero-text">Edit, organize, merge, and convert your PDFs in one friendly workspace. No installs or accounts required.</p><div className="hero-buttons"><button className="button button-primary" type="button" onClick={() => startFlow('edit')}>Open a PDF <ArrowRight size={16} /></button><a className="button button-quiet" href="#tools">Explore the tools <ChevronDown size={15} /></a></div><div className="hero-footnote"><ShieldCheck size={16} /><span>Files stay on your device <i /> Browser-based processing</span></div></div><div className="hero-art"><div className="art-halo" /><div className="preview-shell"><div className="preview-window-bar"><div className="window-dots"><i /><i /><i /></div><span className="preview-file"><FileText size={14} /> project-brief.pdf</span><span className="preview-save"><Check size={13} /> Ready to edit</span></div><div className="preview-app"><aside className="preview-pages"><span className="preview-label">PAGES <small>03</small></span>{[1, 2, 3].map((n) => <div className={`mini-page-wrap${n === 1 ? ' selected' : ''}`} key={n}><div className="mini-page"><b /><span /><span /><span className="short" /><i /><span /><span className="short" /></div><small>{n}</small></div>)}</aside><section className="preview-workspace"><div className="preview-toolbar"><div className="preview-tools"><span className="tool-selected"><MousePointer2 size={15} /></span><span><Type size={15} /></span><span><Highlighter size={15} /></span><span><Circle size={14} /></span></div><div className="preview-actions"><span>−</span><b>100%</b><span>+</span></div></div><div className="paper-stage"><div className="paper-page"><span className="paper-eyebrow">PROJECT OVERVIEW</span><strong>Make room for<br />great work.</strong><span className="paper-line paper-line-wide" /><span className="paper-line" /><span className="paper-line paper-line-mid" /><div className="paper-note"><Sparkles size={13} /> Ideas, organized.</div><span className="paper-line paper-line-wide" /><span className="paper-line paper-line-mid" /><small>01 — INTRODUCTION</small></div><div className="floating-highlight"><Highlighter size={14} /> Highlight</div></div></section></div><div className="preview-caption"><span><span className="caption-dot" /> Edit right in your browser</span><span>PDF Studio</span></div></div><div className="art-spark art-spark-one">✳</div><div className="art-spark art-spark-two">✦</div></div></section>
        <section className={`home-upload${dragOver ? ' home-upload-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onHomeDrop}><span className="upload-icon"><FileText size={20} /></span><span className="upload-copy"><strong>Drop a PDF here</strong><small>Files stay on your device · Up to 50 MB per file</small></span><span className="upload-or">or</span><button type="button" onClick={() => startFlow('edit')}>Browse files</button></section>
        <section className="trust-strip"><div><span className="trust-icon"><LockKeyhole size={17} /></span>Files processed on your device</div><span className="trust-divider" /><div><span className="trust-icon"><WandSparkles size={17} /></span>Everyday PDF tools</div><span className="trust-divider" /><div><span className="trust-icon"><Fingerprint size={17} /></span>No account needed</div></section>
        <section className="tools-section section-wrap" id="tools"><div className="section-heading"><div><span className="section-kicker">PICK A TOOL</span><h2>What can we help with?</h2></div><p>Choose a task to get started. Your files are opened and processed locally in this browser.</p></div><div className="tool-grid">{TOOL_CARDS.map(({ id, icon: Icon, title, copy }, index) => <button className="tool-card" key={id} type="button" onClick={() => startFlow(id)}><span className={`tool-icon tint-${index}`}><Icon size={21} strokeWidth={1.9} /></span><span className="tool-index">0{index + 1}</span><h3>{title}</h3><p>{copy}</p><span className="tool-card-link">Choose files <ArrowRight size={14} /></span></button>)}</div><div className="privacy-callout" id="privacy"><span className="privacy-callout-icon"><LockKeyhole size={18} /></span><span><strong>Your files stay yours.</strong> Files are processed in your browser and aren’t uploaded to a PDF Studio server.</span><span className="size-note">Up to 50 MB per file</span></div></section>
        <section className="how-section" id="how-it-works"><div className="section-wrap"><div className="how-heading"><span className="section-kicker">QUICK AND STRAIGHTFORWARD</span><h2>Three steps. That’s the whole thing.</h2><p>Keep the task simple and get back to what you were doing.</p></div><div className="how-grid"><article><span className="how-num">01</span><span className="how-icon"><ArrowDownToLine size={19} /></span><h3>Choose your files</h3><p>Pick a PDF or images from your device. No account or upload queue.</p></article><article><span className="how-num">02</span><span className="how-icon"><PencilLine size={19} /></span><h3>Make your changes</h3><p>Annotate pages, arrange them, combine PDFs, or convert to images.</p></article><article><span className="how-num">03</span><span className="how-icon"><Check size={19} /></span><h3>Download and go</h3><p>Save your finished file straight back to your device.</p></article></div></div></section>
        <section className="bottom-cta section-wrap"><div><span className="section-kicker">READY WHEN YOU ARE</span><h2>Let’s make that PDF easier.</h2><p>Open a document and choose the tool you need.</p></div><button className="button button-primary" type="button" onClick={() => startFlow('edit')}>Open a PDF <ArrowRight size={16} /></button></section>
      </main>
      <footer className="site-footer"><div className="footer-main section-wrap"><Brand /><p>Useful PDF tools. Right in your browser.</p><nav><a href="#tools">Tools</a><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a></nav></div><div className="footer-bottom section-wrap"><span>© 2026 PDF Studio</span><span>Files stay on your device <ShieldCheck size={14} /></span><span>Up to 50 MB per file</span></div></footer>
      {busy && <div className="toast-progress"><LoaderCircle className="spin" size={17} />{progress || 'Working…'}</div>}
      {error && <div className="toast-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss" onClick={() => setError('')}><X size={16} /></button></div>}
    </> : <>
      <header className="editor-header"><button className="back-brand" type="button" onClick={returnHome} title="Exit editor"><ArrowLeft size={16} /><Brand compact /><span className="exit-label">Exit</span></button><div className="editor-filename"><FileText size={15} /><span>{files.length > 1 ? `${files.length} PDFs · ${pages.length} pages` : files[0]?.name}</span><span className="local-pill"><span /> Local</span></div><div className="editor-actions"><button className="icon-button" type="button" title="Undo last change" aria-label="Undo last change" onClick={undo} disabled={!history.length}><Undo2 size={17} /></button><button className="icon-button" type="button" title="Redo last undone change" aria-label="Redo last undone change" onClick={redo} disabled={!redoStack.length}><Redo2 size={17} /></button><button className="button button-primary save-button" type="button" disabled={busy} onClick={isImageExport ? saveImages : savePdf}>{busy ? <LoaderCircle className="spin" size={16} /> : isImageExport ? <FileImage size={16} /> : <ArrowDownToLine size={16} />}{busy ? 'Working…' : isImageExport ? 'Download PNGs' : 'Download PDF'}</button></div></header>
      <div className={`editor-layout${dragOver ? ' drag-highlight' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false); }} onDrop={onDrop} ref={dropRef}>
        <aside className="pages-sidebar"><div className="sidebar-title"><span>Pages</span><span className="page-count">{pages.length}</span></div><div className="thumbnail-list">{pages.map((item, index) => <div className={`thumbnail-row${activePage === index ? ' active-thumbnail' : ''}`} key={`${item.fileIndex}-${item.sourceIndex}-${index}`}><PageThumbnail file={files[item.fileIndex]} pageNumber={item.sourceIndex + 1} rotation={item.rotation} selected={activePage === index} onClick={() => setActivePage(index)} /><div className="thumb-actions"><button title="Move page up" type="button" onClick={() => movePage(index, -1)} disabled={index === 0}><ArrowUp size={13} /></button><button title="Move page down" type="button" onClick={() => movePage(index, 1)} disabled={index === pages.length - 1}><ArrowRight size={13} style={{ transform: 'rotate(90deg)' }} /></button><button title="Rotate page right" type="button" onClick={() => { setActivePage(index); updatePages(pages.map((p, i) => i === index ? { ...p, rotation: (p.rotation + 90) % 360 } : p)); }}><RotateCw size={13} /></button><button title="Delete page" type="button" onClick={() => removePage(index)}><Trash2 size={13} /></button></div></div>)}</div><button className="sidebar-add" type="button" onClick={() => startFlow('merge')}><Plus size={15} /> Add PDF pages</button><div className="sidebar-privacy"><LockKeyhole size={14} /> Files stay in this browser</div></aside>
        <main className="editor-main"><div className="editing-toolbar"><div className="editing-tools">{[['select', MousePointer2, 'Select'], ['text', Type, 'Text'], ['highlight', Highlighter, 'Highlight'], ['shape', Circle, 'Shape'], ['signature', PencilLine, 'Sign'], ['image', ImagePlus, 'Image'], ['crop', Crop, 'Crop']].map(([key, Icon, label]) => <button className={`edit-tool${activeTool === key ? ' active-tool' : ''}`} key={key} type="button" onClick={() => { setActiveTool(key); setSelectedOverlayId(null); setDrawStart(null); setDrawRect(null); }} title={label}><Icon size={17} /><span>{label}</span></button>)}</div>{activeTool !== 'select' && <button className="cancel-tool" type="button" title="Stop this tool; keep edits already applied" onClick={cancelTool}><X size={14} /><span>Stop tool</span></button>}<span className="toolbar-divider" /><div className="zoom-control"><button type="button" title="Zoom out" onClick={() => setZoom(Math.max(0.55, zoom - 0.1))}><Minus size={15} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" title="Zoom in" onClick={() => setZoom(Math.min(1.8, zoom + 0.1))}><Plus size={15} /></button><button className="fit-button" type="button" title="Fit page to viewer" onClick={() => setZoom(1)}>Fit</button></div></div>
          <div className="editor-subbar">
            <span><strong>{toolDetails[activeTool][0]}</strong><span>{toolDetails[activeTool][1]}</span></span>
            <div className="subbar-actions">{selectedOverlayId && <button className="remove-annotation" type="button" title="Delete selected annotation" onClick={deleteSelectedOverlay}><Trash2 size={15} /><span>Remove</span></button>}{page?.crop && <button type="button" title="Reset page crop" onClick={clearCrop}><X size={15} /></button>}<button type="button" title="Rotate left" onClick={() => rotatePage(-90)}><RotateCcw size={15} /></button><button type="button" title="Rotate right" onClick={() => rotatePage(90)}><RotateCw size={15} /></button><button type="button" className="danger-action" title="Delete current page" onClick={() => removePage(activePage)}><Trash2 size={15} /></button></div>
            {activeTool === 'shape' && <div className="tool-options"><span className="option-label">Shape</span>{[['rectangle', 'Rectangle'], ['ellipse', 'Oval'], ['line', 'Line'], ['arrow', 'Arrow'], ['freehand', 'Freehand']].map(([kind, label]) => <button className={shapeKind === kind ? 'option-chip option-chip-active' : 'option-chip'} key={kind} type="button" onClick={() => { setShapeKind(kind); setDrawStart(null); setDrawRect(null); setDrawPoints([]); }}>{label}</button>)}<span className="options-divider" /><ColorPalette value={shapeColor} onChange={setShapeColor} label="Shape color" /><label className="stroke-option">Width <input type="range" min="1" max="8" value={shapeWidth} onChange={(event) => setShapeWidth(Number(event.target.value))} /><b>{shapeWidth}</b></label></div>}
            {activeTool === 'highlight' && <div className="tool-options"><span className="option-label">Style</span>{[['area', 'Marker'], ['freehand', 'Freehand']].map(([kind, label]) => <button className={highlightKind === kind ? 'option-chip option-chip-active' : 'option-chip'} key={kind} type="button" onClick={() => { setHighlightKind(kind); setDrawStart(null); setDrawRect(null); setDrawPoints([]); }}>{label}</button>)}<span className="options-divider" /><ColorPalette value={highlightColor} onChange={setHighlightColor} label="Highlight color" />{highlightKind === 'freehand' && <label className="stroke-option">Width <input type="range" min="8" max="28" step="2" value={highlightWidth} onChange={(event) => setHighlightWidth(Number(event.target.value))} /><b>{highlightWidth}</b></label>}</div>}
            {activeTool === 'select' && selectedTextOverlay && <div className="tool-options text-selection-options"><span className="option-label">Selected text</span><label className="text-color-control">Color <input aria-label="Change selected text color" type="color" value={selectedTextOverlay.color || '#263047'} onChange={(event) => updateSelectedText({ color: event.target.value })} /></label><label className="stroke-option">Size <input aria-label="Resize selected text" type="range" min="8" max="48" value={selectedTextOverlay.fontSize || 18} onPointerDown={beginTextSizeEdit} onPointerUp={() => { textSizeEditRef.current = false; }} onBlur={() => { textSizeEditRef.current = false; }} onChange={(event) => changeSelectedTextSize(event.target.value)} /><b>{selectedTextOverlay.fontSize || 18}px</b></label></div>}
          </div>
          <div className="document-scroll" ref={viewerRef}>
            <div className="page-loading" style={{ display: progress && progress.startsWith('Rendering') ? 'flex' : 'none' }}><LoaderCircle className="spin" size={18} /> Rendering page?</div>
            <div className="document-page" style={{ width: `${pageSize.width}px`, height: `${pageSize.height}px` }}>
              <canvas ref={canvasRef} />
              <div className={`overlay-layer tool-${activeTool}`} ref={overlayLayerRef} onClick={onPageClick} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
                {page?.crop && <div className="crop-preview" style={{ '--crop-x': `${page.crop.x * 100}%`, '--crop-y': `${page.crop.y * 100}%`, '--crop-w': `${page.crop.w * 100}%`, '--crop-h': `${page.crop.h * 100}%` }}><span className="crop-shade shade-top" /><span className="crop-shade shade-left" /><span className="crop-shade shade-right" /><span className="crop-shade shade-bottom" /><span className="crop-frame" /></div>}
                {(page?.overlays || []).map((overlay, index) => {
                  const selected = selectedOverlayId === overlay.id;
                  const positioned = dragOverlay?.id === overlay.id ? { ...overlay, ...dragOverlay } : overlay;
                  if (overlay.points) {
                    const positionedPath = dragOverlay?.id === overlay.id
                      ? { ...overlay, points: overlay.points.map((point) => ({ x: point.x + (dragOverlay.dx || 0), y: point.y + (dragOverlay.dy || 0) })) }
                      : overlay;
                    return <PathOverlay key={overlay.id || index} overlay={positionedPath} pageHeight={pageSize.height} selected={selected} activeTool={activeTool} onSelect={() => setSelectedOverlayId(overlay.id)} onPointerDown={(event) => beginPathMove(event, overlay)} onPointerMove={moveSelectedOverlay} onPointerUp={finishOverlayMove} />;
                  }
                  const shapeClass = overlay.type === 'shape' && overlay.shapeKind === 'ellipse' ? ' overlay-ellipse' : '';
                  const isTextOverlay = overlay.type === 'text' || overlay.type === 'signature';
                  return <div className={`pdf-overlay overlay-${overlay.type}${shapeClass}${selected ? ' overlay-selected' : ''}`} key={overlay.id || index} onClick={(event) => { if (activeTool === 'select') { event.stopPropagation(); setSelectedOverlayId(overlay.id); } }} onDoubleClick={(event) => editTextOverlay(event, overlay)} onPointerDown={(event) => beginOverlayMove(event, overlay)} onPointerMove={moveSelectedOverlay} onPointerUp={finishOverlayMove} style={{ left: `${positioned.x * 100}%`, top: `${positioned.y * 100}%`, width: `${(positioned.w || overlayWidth(positioned, pageSize)) * 100}%`, height: `${(positioned.h || 0.08) * 100}%`, color: overlay.color, borderColor: overlay.type === 'shape' ? overlay.color : undefined, backgroundColor: overlay.type === 'highlight' ? `${overlay.color}78` : undefined, fontSize: `${(positioned.fontSize || 18) * pageSize.height / (overlay.referenceHeight || pageSize.height)}px` }}>{overlay.type === 'image' ? <img src={overlay.dataUrl} alt="Added to document" /> : overlay.text || null}{selected && activeTool === 'select' && <button className={`overlay-resize-handle${isTextOverlay ? ' overlay-resize-text' : ''}`} type="button" aria-label={`Resize ${overlay.type === 'signature' ? 'signature' : overlay.type}`} title="Drag to resize" onPointerDown={(event) => beginOverlayResize(event, overlay)} onPointerUp={(event) => { event.stopPropagation(); finishOverlayResize(); }} />}</div>;
                })}
                {drawPoints.length > 1 && ((activeTool === 'shape' && ['freehand', 'line', 'arrow'].includes(shapeKind)) || (activeTool === 'highlight' && highlightKind === 'freehand')) && <PathOverlay overlay={{ type: activeTool === 'highlight' ? 'highlight' : 'shape', shapeKind: activeTool === 'highlight' ? 'freehand' : shapeKind, x: 0, y: 0, w: 1, h: 1, points: drawPoints, color: activeTool === 'highlight' ? highlightColor : shapeColor, strokeWidth: activeTool === 'highlight' ? highlightWidth : shapeWidth, referenceHeight: pageSize.referenceHeight }} pageHeight={pageSize.height} selected={false} activeTool={activeTool} onSelect={() => {}} />}
                {drawRect && !((activeTool === 'shape' && ['freehand', 'line', 'arrow'].includes(shapeKind)) || (activeTool === 'highlight' && highlightKind === 'freehand')) && <div className={`pdf-overlay ${activeTool === 'crop' ? 'crop-frame' : activeTool === 'shape' && shapeKind === 'ellipse' ? 'overlay-ellipse' : activeTool === 'highlight' ? 'overlay-highlight' : 'overlay-shape'}`} style={{ left: `${drawRect.x * 100}%`, top: `${drawRect.y * 100}%`, width: `${drawRect.w * 100}%`, height: `${drawRect.h * 100}%`, borderColor: activeTool === 'shape' ? shapeColor : undefined, backgroundColor: activeTool === 'highlight' ? `${highlightColor}78` : undefined }} />}
          </div>
            </div>
          </div>
          <div className="editor-bottom-bar"><span>Page {activePage + 1} of {pages.length}</span><div><button type="button" disabled={activePage === 0} onClick={() => setActivePage(activePage - 1)}>Previous</button><button type="button" disabled={activePage >= pages.length - 1} onClick={() => setActivePage(activePage + 1)}>Next <ArrowRight size={13} /></button></div></div>
        </main>
      </div>
      {textDraft && <div className="inline-text-editor" style={{ left: `${Math.min(textDraft.point.x, 0.72) * 100}%`, top: `${Math.min(textDraft.point.y, 0.78) * 100}%`, color: textDraft.color }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><textarea autoFocus rows="1" maxLength={240} aria-label="Type text on the PDF" placeholder="Type here" value={textDraft.value} onChange={(event) => setTextDraft({ ...textDraft, value: event.target.value })} onFocus={(event) => { if (textDraft.editingId) event.currentTarget.select(); }} onKeyDown={(event) => { if (event.key === 'Escape') setTextDraft(null); if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submitTextDraft(event); }} style={{ fontSize: `${textDraft.fontSize}px`, color: textDraft.color }} /><div className="inline-text-controls"><label title="Text color"><input aria-label="Text color" type="color" value={textDraft.color} onChange={(event) => setTextDraft({ ...textDraft, color: event.target.value })} /></label><label className="inline-size-control" title="Text size"><Type size={13} /><input aria-label="Text size" type="range" min="8" max="48" value={textDraft.fontSize} onChange={(event) => setTextDraft({ ...textDraft, fontSize: Number(event.target.value) })} /><span>{textDraft.fontSize}</span></label><button type="button" title={textDraft.editingId ? 'Save text' : 'Place text'} aria-label={textDraft.editingId ? 'Save text' : 'Place text'} onClick={submitTextDraft} disabled={!textDraft.value.trim()}><Check size={15} /></button><button type="button" title="Cancel text" aria-label="Cancel text" onClick={() => setTextDraft(null)}><X size={15} /></button></div></div>}
      {busy && <div className="toast-progress"><LoaderCircle className="spin" size={17} />{progress || 'Working…'}</div>}
      {error && <div className="toast-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss" onClick={() => setError('')}><X size={16} /></button></div>}
    </>}
  </div>;
}

export default App;
