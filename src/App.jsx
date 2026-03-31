import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, 
  Download, 
  Eye, 
  EyeOff, 
  Trash2, 
  LayoutGrid,
  Link as LinkIcon,
  MoveHorizontal,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Zap,
  X,
  Square,
  Maximize,
  Archive
} from 'lucide-react';

const CANVAS_SIZE = 1000;
const SNAP_THRESHOLD = 15; 
const GUIDE_HIT_WIDTH = 25; 
const RESIZE_HANDLE_SIZE = 12;

const getContentBounds = (img) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
  let found = false;

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
      const isWhite = r > 250 && g > 250 && b > 250;
      if (a > 10 && !isWhite) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  return found ? { 
    left: minX, top: minY, right: maxX, bottom: maxY,
    width: maxX - minX, height: maxY - minY
  } : { left: 0, top: 0, right: img.width, bottom: img.height, width: img.width, height: img.height };
};

export default function App() {
  const [layers, setLayers] = useState([]);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [showGuidelines, setShowGuidelines] = useState(true);
  const [useSnapping, setUseSnapping] = useState(true);
  const [activeSnaps, setActiveSnaps] = useState({ x: [], y: [] });
  const [zoom, setZoom] = useState(0.5);
  const [isExportingZip, setIsExportingZip] = useState(false);
  
  const [margins, setMargins] = useState({ top: 100, bottom: 100, left: 100, right: 100 });
  const [constrainMargins, setConstrainMargins] = useState(false);
  
  const [hGuides, setHGuides] = useState([]); 
  const [vGuides, setVGuides] = useState([]); 

  const canvasRef = useRef(null);
  const isDraggingLayer = useRef(false);
  const isResizing = useRef(false);
  const draggingGuide = useRef(null); 
  const lastMousePos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const cb = getContentBounds(img);
          const aw = CANVAS_SIZE - (margins.left + margins.right);
          const ah = CANVAS_SIZE - (margins.top + margins.bottom);
          const ratio = Math.min(aw / cb.width, ah / cb.height);
          
          const newLayer = {
            id: crypto.randomUUID(),
            name: file.name.replace(/\.[^/.]+$/, ""),
            img: img,
            contentBounds: cb,
            x: margins.left - (cb.left * ratio),
            y: margins.top - (cb.top * ratio),
            scale: ratio,
            visible: true,
            opacity: 1,
            thumbnail: event.target.result 
          };
          setLayers(prev => [...prev, newLayer]);
          setSelectedLayerId(newLayer.id);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
    e.target.value = null;
  };

  const bulkAlign = () => {
    if (layers.length < 2) return;
    const master = layers[0];
    const mCB = master.contentBounds;
    const mStartX = master.x + (mCB.left * master.scale);
    const mStartY = master.y + (mCB.top * master.scale);
    const currentMasterScale = master.scale;

    setLayers(prev => prev.map((l, i) => {
      if (i === 0) return l; 
      const lCB = l.contentBounds;
      return {
        ...l,
        scale: currentMasterScale,
        x: mStartX - (lCB.left * currentMasterScale),
        y: mStartY - (lCB.top * currentMasterScale)
      };
    }));
  };

  const handleBulkZipExport = async () => {
    if (layers.length === 0 || typeof window.JSZip === 'undefined') return;
    setIsExportingZip(true);
    
    try {
      const zip = new window.JSZip();
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = CANVAS_SIZE;
      exportCanvas.height = CANVAS_SIZE;
      const ctx = exportCanvas.getContext('2d');

      for (const layer of layers) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        const drawW = layer.img.width * layer.scale;
        const drawH = layer.img.height * layer.scale;
        ctx.drawImage(layer.img, layer.x, layer.y, drawW, drawH);
        const blob = await new Promise(resolve => exportCanvas.toBlob(resolve, 'image/png'));
        zip.file(`${layer.name}.png`, blob);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = "aligned_assets.zip";
      link.click();
    } catch (err) {
      console.error("ZIP Export failed", err);
    } finally {
      setIsExportingZip(false);
    }
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = '#ffffff'; 
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    layers.forEach(layer => {
      if (!layer.visible) return;
      ctx.globalAlpha = layer.opacity;
      const drawW = layer.img.width * layer.scale;
      const drawH = layer.img.height * layer.scale;
      ctx.drawImage(layer.img, layer.x, layer.y, drawW, drawH);

      if (selectedLayerId === layer.id) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        const cb = layer.contentBounds;
        const bx = layer.x + (cb.left * layer.scale);
        const by = layer.y + (cb.top * layer.scale);
        const bw = cb.width * layer.scale;
        const bh = cb.height * layer.scale;
        ctx.strokeRect(bx, by, bw, bh);
        
        ctx.setLineDash([]);
        ctx.fillStyle = 'white';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        const handles = [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]];
        handles.forEach(([hx, hy]) => {
          ctx.beginPath();
          ctx.arc(hx, hy, RESIZE_HANDLE_SIZE / zoom / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
      }
    });

    ctx.globalAlpha = 1;

    if (showGuidelines) {
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      const mLines = [
        { x1: margins.left, y1: 0, x2: margins.left, y2: CANVAS_SIZE },
        { x1: CANVAS_SIZE - margins.right, y1: 0, x2: CANVAS_SIZE - margins.right, y2: CANVAS_SIZE },
        { x1: 0, y1: margins.top, x2: CANVAS_SIZE, y2: margins.top },
        { x1: 0, y1: CANVAS_SIZE - margins.bottom, x2: CANVAS_SIZE, y2: CANVAS_SIZE - margins.bottom }
      ];
      mLines.forEach(l => {
        ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
      });

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
      hGuides.forEach(y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_SIZE, y); ctx.stroke(); });
      vGuides.forEach(x => { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_SIZE); ctx.stroke(); });

      if (activeSnaps.x.length > 0 || activeSnaps.y.length > 0) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#10b981';
        activeSnaps.x.forEach(x => { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_SIZE); ctx.stroke(); });
        activeSnaps.y.forEach(y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_SIZE, y); ctx.stroke(); });
      }
    }
  }, [layers, showGuidelines, hGuides, vGuides, margins, activeSnaps, selectedLayerId, zoom]);

  useEffect(() => { draw(); }, [draw]);

  const handleMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = CANVAS_SIZE / rect.width;
    const mouseX = (e.clientX - rect.left) * scale;
    const mouseY = (e.clientY - rect.top) * scale;
    lastMousePos.current = { x: mouseX, y: mouseY };

    if (selectedLayerId) {
      const l = layers.find(layer => layer.id === selectedLayerId);
      const cb = l.contentBounds;
      const bx = l.x + (cb.left * l.scale);
      const by = l.y + (cb.top * l.scale);
      const bw = cb.width * l.scale;
      const bh = cb.height * l.scale;
      const hRadius = (RESIZE_HANDLE_SIZE / zoom);
      const corners = [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]];
      const cornerIdx = corners.findIndex(([hx, hy]) => Math.sqrt((mouseX-hx)**2 + (mouseY-hy)**2) < hRadius);
      if (cornerIdx !== -1) { isResizing.current = true; return; }
    }

    if (showGuidelines) {
      if (Math.abs(mouseX - margins.left) < GUIDE_HIT_WIDTH) { draggingGuide.current = { type: 'm', dir: 'left' }; return; }
      if (Math.abs(mouseX - (CANVAS_SIZE - margins.right)) < GUIDE_HIT_WIDTH) { draggingGuide.current = { type: 'm', dir: 'right' }; return; }
      if (Math.abs(mouseY - margins.top) < GUIDE_HIT_WIDTH) { draggingGuide.current = { type: 'm', dir: 'top' }; return; }
      if (Math.abs(mouseY - (CANVAS_SIZE - margins.bottom)) < GUIDE_HIT_WIDTH) { draggingGuide.current = { type: 'm', dir: 'bottom' }; return; }
      const vIdx = vGuides.findIndex(x => Math.abs(mouseX - x) < GUIDE_HIT_WIDTH);
      if (vIdx !== -1) { draggingGuide.current = { type: 'v', index: vIdx }; return; }
      const hIdx = hGuides.findIndex(y => Math.abs(mouseY - y) < GUIDE_HIT_WIDTH);
      if (hIdx !== -1) { draggingGuide.current = { type: 'h', index: hIdx }; return; }
    }

    const layerUnderMouse = [...layers].reverse().find(l => {
        if (!l.visible) return false;
        const cb = l.contentBounds;
        const bx = l.x + (cb.left * l.scale);
        const by = l.y + (cb.top * l.scale);
        const bw = cb.width * l.scale;
        const bh = cb.height * l.scale;
        return mouseX >= bx && mouseX <= bx + bw && mouseY >= by && mouseY <= by + bh;
    });
    if (layerUnderMouse) { setSelectedLayerId(layerUnderMouse.id); isDraggingLayer.current = true; } 
    else { setSelectedLayerId(null); }
  };

  const handleMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    if (!rect) return;
    const canvasScale = CANVAS_SIZE / rect.width;
    const currentX = (e.clientX - rect.left) * canvasScale;
    const currentY = (e.clientY - rect.top) * canvasScale;
    const dx = currentX - lastMousePos.current.x;
    const dy = currentY - lastMousePos.current.y;

    if (isResizing.current && selectedLayerId) {
        setLayers(prev => prev.map(l => {
            if (l.id !== selectedLayerId) return l;
            const factor = 1 + (dx / (l.contentBounds.width * l.scale));
            return { ...l, scale: Math.max(0.01, l.scale * factor) };
        }));
    } else if (draggingGuide.current) {
        const d = draggingGuide.current;
        if (d.type === 'm') {
            setMargins(prev => {
                const delta = (d.dir === 'left' || d.dir === 'top') ? (d.dir === 'left' ? dx : dy) : (d.dir === 'right' ? -dx : -dy);
                const newVal = Math.max(0, Math.min(500, prev[d.dir] + delta));
                if (constrainMargins) return { top: newVal, bottom: newVal, left: newVal, right: newVal };
                return { ...prev, [d.dir]: newVal };
            });
        } else if (d.type === 'v') {
            setVGuides(prev => prev.map((x, i) => i === d.index ? Math.max(0, Math.min(CANVAS_SIZE, x + dx)) : x));
        } else {
            setHGuides(prev => prev.map((y, i) => i === d.index ? Math.max(0, Math.min(CANVAS_SIZE, y + dy)) : y));
        }
    } else if (isDraggingLayer.current && selectedLayerId) {
      setLayers(prev => prev.map(l => {
        if (l.id !== selectedLayerId) return l;
        let nx = l.x + dx;
        let ny = l.y + dy;
        const cb = l.contentBounds;
        const realX = nx + (cb.left * l.scale);
        const realY = ny + (cb.top * l.scale);
        const realW = cb.width * l.scale;
        const realH = cb.height * l.scale;

        const snapX = [0, CANVAS_SIZE/2, CANVAS_SIZE, margins.left, CANVAS_SIZE - margins.right, ...vGuides];
        const snapY = [0, CANVAS_SIZE/2, CANVAS_SIZE, margins.top, CANVAS_SIZE - margins.bottom, ...hGuides];
        const snaps = { x: [], y: [] };

        if (useSnapping) {
          [realX, realX + realW/2, realX + realW].forEach(p => {
            snapX.forEach(g => { if (Math.abs(p - g) < SNAP_THRESHOLD) { nx += (g - p); snaps.x.push(g); } });
          });
          [realY, realY + realH/2, realY + realH].forEach(p => {
            snapY.forEach(g => { if (Math.abs(p - g) < SNAP_THRESHOLD) { ny += (g - p); snaps.y.push(g); } });
          });
        }
        setActiveSnaps(snaps);
        return { ...l, x: nx, y: ny };
      }));
    }
    lastMousePos.current = { x: currentX, y: currentY };
  };

  const handleMouseUp = () => {
    isDraggingLayer.current = false;
    isResizing.current = false;
    draggingGuide.current = null;
    setActiveSnaps({ x: [], y: [] });
  };

  const nudge = (dir) => {
    setLayers(prev => prev.map(l => {
        if (l.id !== selectedLayerId) return l;
        const step = 1;
        if (dir === 'up') return { ...l, y: l.y - step };
        if (dir === 'down') return { ...l, y: l.y + step };
        if (dir === 'left') return { ...l, x: l.x - step };
        if (dir === 'right') return { ...l, x: l.x + step };
        return l;
    }));
  };

  const updateLayer = (id, updates) => setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  const deleteLayer = (id) => { setLayers(prev => prev.filter(l => l.id !== id)); if (selectedLayerId === id) setSelectedLayerId(null); };
  const addGuide = (type) => { if (type === 'v') setVGuides(prev => [...prev, 500]); else setHGuides(prev => [...prev, 500]); };

  const currentLayer = layers.find(l => l.id === selectedLayerId);

  return (
    <div className="app-container">
      <style>{`
        body, html {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: #050505;
        }
        .app-container {
          display: flex;
          height: 100vh;
          width: 100vw;
          background-color: #050505;
          color: #e5e7eb;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          overflow: hidden;
        }
        .sidebar {
          width: 320px;
          height: 100%;
          border-right: 1px solid #1f2937;
          background-color: #0e0e0e;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          z-index: 20;
        }
        .sidebar-header {
          padding: 16px;
          border-bottom: 1px solid #1f2937;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background-color: #141414;
        }
        .section {
          padding: 16px;
          border-bottom: 1px solid #1f2937;
        }
        .btn-primary {
          background-color: #2563eb;
          color: white;
          padding: 8px;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .btn-action {
          width: 100%;
          padding: 12px;
          color: white;
          border-radius: 8px;
          font-size: 10px;
          font-weight: 900;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          text-transform: uppercase;
        }
        .label-caps {
          font-size: 10px;
          font-weight: 900;
          color: #6b7280;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .scroll-box {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }
        .layer-card {
          padding: 8px;
          border-radius: 8px;
          border: 1px solid transparent;
          background-color: #1f2937;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .layer-card.active {
          border-color: #3b82f6;
          background-color: rgba(59, 130, 246, 0.1);
        }
        .workspace {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          position: relative;
        }
        .workspace-toolbar {
          height: 56px;
          background-color: #0e0e0e;
          border-bottom: 1px solid #1f2937;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .zoom-control {
          display: flex;
          align-items: center;
          gap: 12px;
          background: #000;
          padding: 6px 16px;
          border-radius: 20px;
          border: 1px solid #1f2937;
        }
        .canvas-area {
          flex: 1;
          overflow: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 64px;
          background-color: #060606;
        }
        .status-bar {
          height: 32px;
          background-color: #0e0e0e;
          border-top: 1px solid #1f2937;
          display: flex;
          align-items: center;
          font-size: 9px;
          color: #374151;
          letter-spacing: 0.1em;
          padding: 0 16px;
          text-transform: uppercase;
        }
        input[type="range"] {
          cursor: pointer;
        }
      `}</style>

      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2 style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', color: '#60a5fa', fontSize: '14px', margin: 0 }}>
            <LayoutGrid size={16} /> Asset Studio
          </h2>
          <label className="btn-primary">
            <Upload size={16} />
            <input type="file" multiple hidden onChange={handleFileUpload} accept="image/*" />
          </label>
        </div>

        {/* Bulk Align */}
        <div className="section">
            <button 
                onClick={bulkAlign}
                disabled={layers.length < 2}
                className="btn-action"
                style={{ backgroundColor: layers.length < 2 ? '#374151' : '#059669' }}
            >
                <Zap size={14} /> Bulk Align (1st Ref)
            </button>
        </div>

        {/* Margins Control */}
        <div className="section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
               <span className="label-caps" style={{ color: '#f87171', display: 'flex', alignItems: 'center' }}><Square size={10} style={{marginRight:4}}/> Margins</span>
               <button onClick={() => setConstrainMargins(!constrainMargins)} style={{ background: constrainMargins ? '#dc2626' : '#1f2937', border: 'none', color: 'white', padding: '4px', borderRadius: '4px', cursor: 'pointer' }}><LinkIcon size={12}/></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {['top', 'bottom', 'left', 'right'].map(dir => (
                    <div key={dir}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginBottom: '4px' }}>
                            <span style={{ color: '#4b5563', textTransform: 'uppercase' }}>{dir}</span>
                            <span style={{ color: '#f87171' }}>{margins[dir]}px</span>
                        </div>
                        <input type="range" min="0" max="500" value={margins[dir]} onChange={(e) => {
                            const v = parseInt(e.target.value);
                            if (constrainMargins) setMargins({ top: v, bottom: v, left: v, right: v });
                            else setMargins(prev => ({ ...prev, [dir]: v }));
                        }} style={{ width: '100%', accentColor: '#f87171' }} />
                    </div>
                ))}
            </div>
        </div>

        {/* Custom Guides */}
        <div className="section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span className="label-caps" style={{ display: 'flex', alignItems: 'center' }}><MoveHorizontal size={10} style={{marginRight:4}}/> Guides</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => addGuide('v')} style={{ background: '#374151', border: 'none', color: 'white', fontSize: '9px', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer' }}>V+</button>
                    <button onClick={() => addGuide('h')} style={{ background: '#374151', border: 'none', color: 'white', fontSize: '9px', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer' }}>H+</button>
                </div>
            </div>
            <div style={{ maxHeight: '80px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {vGuides.map((g, i) => (
                    <div key={`v-${i}`} style={{ display: 'flex', alignItems: 'center', background: '#000', padding: '4px 8px', borderRadius: '4px', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '9px', color: '#6b7280' }}>V: {Math.round(g)}px</span>
                        <button onClick={() => setVGuides(vGuides.filter((_, idx) => idx !== i))} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}><X size={10} /></button>
                    </div>
                ))}
                {hGuides.map((g, i) => (
                    <div key={`h-${i}`} style={{ display: 'flex', alignItems: 'center', background: '#000', padding: '4px 8px', borderRadius: '4px', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '9px', color: '#6b7280' }}>H: {Math.round(g)}px</span>
                        <button onClick={() => setHGuides(hGuides.filter((_, idx) => idx !== i))} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}><X size={10} /></button>
                    </div>
                ))}
            </div>
        </div>

        {/* Transform Tools */}
        {currentLayer && (
            <div className="section" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <span className="label-caps" style={{ color: '#3b82f6', display: 'flex', alignItems: 'center' }}><Maximize size={10} style={{marginRight:4}}/> Transform</span>
                    <span style={{ fontSize: '10px', color: '#3b82f6' }}>{(currentLayer.scale * 100).toFixed(1)}%</span>
                </div>
                <input type="range" min="0.01" max="2" step="0.01" value={currentLayer.scale} onChange={e => updateLayer(currentLayer.id, { scale: parseFloat(e.target.value) })} style={{ width: '100%', accentColor: '#3b82f6', marginBottom: '12px' }} />
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                        <div/> <button onClick={() => nudge('up')} style={{ background: '#1f2937', color: 'white', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer' }}><ChevronUp size={14}/></button> <div/>
                        <button onClick={() => nudge('left')} style={{ background: '#1f2937', color: 'white', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer' }}><ChevronLeft size={14}/></button>
                        <button onClick={() => nudge('down')} style={{ background: '#1f2937', color: 'white', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer' }}><ChevronDown size={14}/></button>
                        <button onClick={() => nudge('right')} style={{ background: '#1f2937', color: 'white', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer' }}><ChevronRight size={14}/></button>
                    </div>
                </div>
            </div>
        )}

        {/* Layers List */}
        <div className="scroll-box">
            <p className="label-caps" style={{ marginBottom: '12px' }}>Layers ({layers.length})</p>
            {layers.map((layer, idx) => (
                <div key={layer.id} onClick={() => setSelectedLayerId(layer.id)} className={`layer-card ${selectedLayerId === layer.id ? 'active' : ''}`}>
                    <img src={layer.thumbnail} style={{ width: '36px', height: '36px', background: 'black', objectFit: 'contain', border: '1px solid #374151', opacity: layer.visible ? 1 : 0.2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: '10px', fontWeight: 'bold', color: layer.visible ? '#e5e7eb' : '#4b5563', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>{layer.name}</p>
                        {idx === 0 && <p style={{ fontSize: '7px', color: '#10b981', fontWeight: 'bold', margin: 0, marginTop: 2 }}>MASTER REF</p>}
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }} style={{ color: layer.visible ? '#3b82f6' : '#4b5563', background: 'none', border: 'none', cursor: 'pointer' }}>
                            {layer.visible ? <Eye size={12}/> : <EyeOff size={12}/>}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>
                            <Trash2 size={12}/>
                        </button>
                    </div>
                </div>
            )).reverse()}
        </div>

        {/* Footer Actions */}
        <div style={{ padding: '16px', borderTop: '1px solid #1f2937', backgroundColor: '#111827' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <button onClick={() => setShowGuidelines(!showGuidelines)} style={{ flex: 1, padding: '8px', fontSize: '10px', fontWeight: 'bold', borderRadius: '4px', border: '1px solid #374151', background: showGuidelines ? '#ef444422' : 'transparent', color: showGuidelines ? '#ef4444' : '#6b7280', cursor: 'pointer' }}>GUIDES</button>
                <button onClick={() => setUseSnapping(!useSnapping)} style={{ flex: 1, padding: '8px', fontSize: '10px', fontWeight: 'bold', borderRadius: '4px', border: '1px solid #374151', background: useSnapping ? '#10b98122' : 'transparent', color: useSnapping ? '#10b981' : '#6b7280', cursor: 'pointer' }}>SNAPPING</button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => {
                   const was = showGuidelines; setShowGuidelines(false);
                   setTimeout(() => {
                      const link = document.createElement('a');
                      link.download = `composition.png`;
                      link.href = canvasRef.current.toDataURL('image/png');
                      link.click();
                      setShowGuidelines(was);
                   }, 100);
                }} className="btn-action" style={{ flex: 1, background: '#2563eb' }}><Download size={14}/> Comp</button>
                <button onClick={handleBulkZipExport} disabled={isExportingZip || layers.length === 0} className="btn-action" style={{ flex: 1, background: '#059669' }}>
                   {isExportingZip ? '...' : <Archive size={14}/>} Zip
                </button>
            </div>
        </div>
      </div>

      {/* Workspace */}
      <div className="workspace">
        <div className="workspace-toolbar">
            <div className="zoom-control">
                <span style={{ fontSize: '10px', color: '#4b5563', fontWeight: 'bold' }}>ZOOM</span>
                <input type="range" min="0.1" max="1.5" step="0.05" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} style={{ width: '100px', accentColor: '#3b82f6' }} />
                <span style={{ fontSize: '10px', color: '#3b82f6', fontWeight: 'bold' }}>{Math.round(zoom * 100)}%</span>
            </div>
        </div>
        
        <div className="canvas-area" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
          <div style={{ position: 'relative', backgroundColor: 'white', width: `${CANVAS_SIZE * zoom}px`, height: `${CANVAS_SIZE * zoom}px`, boxShadow: '0 0 100px rgba(0,0,0,0.8)' }}>
            <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} onMouseDown={handleMouseDown} style={{ width: '100%', height: '100%', cursor: 'crosshair', display: 'block' }} />
          </div>
        </div>
        
        <div className="status-bar">
            1000 X 1000 PIXELS • ASSET ALIGNMENT SUITE • {layers.length} LAYERS
        </div>
      </div>
    </div>
  );
}