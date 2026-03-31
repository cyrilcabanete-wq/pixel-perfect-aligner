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
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#050505', color: '#e5e7eb', fontFamily: 'sans-serif', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ width: '320px', borderRight: '1px solid #1f2937', backgroundColor: '#0e0e0e', display: 'flex', flexDirection: 'column', zIndex: 20 }}>
        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-[#141414]">
          <h2 className="font-bold flex items-center gap-2 text-blue-400 text-sm tracking-tight">
            <LayoutGrid size={16} /> Asset Studio
          </h2>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-lg transition-transform active:scale-95 shadow-lg shadow-blue-900/20">
            <Upload size={16} />
            <input type="file" multiple hidden onChange={handleFileUpload} accept="image/*" />
          </label>
        </div>

        <div className="p-4 border-b border-gray-800 bg-emerald-500/5">
            <button 
                onClick={bulkAlign}
                disabled={layers.length < 2}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 text-white rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
            >
                <Zap size={14} /> Bulk Align (1st Layer Ref)
            </button>
        </div>

        {/* Margins */}
        <div className="p-4 bg-red-950/10 border-b border-gray-800 space-y-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-red-400 flex items-center gap-2">
                    <Square size={12} /> Margins
                </span>
                <button 
                  onClick={() => setConstrainMargins(!constrainMargins)}
                  className={`p-1 rounded transition-colors ${constrainMargins ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-500'}`}
                >
                  <LinkIcon size={12} />
                </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {['top', 'bottom', 'left', 'right'].map(dir => (
                <div key={dir} className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[8px] uppercase font-bold text-gray-600">{dir}</span>
                    <span className="text-[9px] font-mono text-red-400">{margins[dir]}px</span>
                  </div>
                  <input type="range" min="0" max="500" value={margins[dir]} onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (constrainMargins) setMargins({ top: v, bottom: v, left: v, right: v });
                      else setMargins(prev => ({ ...prev, [dir]: v }));
                    }} className="w-full accent-red-600/40 h-1" />
                </div>
              ))}
            </div>
        </div>

        {/* Custom Guides */}
        <div className="p-4 bg-gray-900/20 border-b border-gray-800 space-y-3">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-gray-400">
                <span className="flex items-center gap-2"><MoveHorizontal size={12} /> Custom Guides</span>
                <div className="flex gap-1">
                    <button onClick={() => addGuide('v')} className="bg-gray-800 hover:bg-gray-700 px-1.5 py-0.5 rounded text-[8px]">V+</button>
                    <button onClick={() => addGuide('h')} className="bg-gray-800 hover:bg-gray-700 px-1.5 py-0.5 rounded text-[8px]">H+</button>
                </div>
            </div>
            <div className="max-h-24 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                {vGuides.map((g, i) => (
                    <div key={`v-${i}`} className="flex items-center justify-between bg-black/40 p-1 rounded border border-gray-800">
                        <span className="text-[9px] text-gray-500 font-bold px-1">V</span>
                        <input type="number" value={Math.round(g)} onChange={e => setVGuides(prev => prev.map((v, idx) => idx === i ? parseInt(e.target.value) : v))} className="bg-transparent text-[10px] w-12 font-mono text-red-300" />
                        <button onClick={() => setVGuides(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-600 hover:text-red-500"><X size={10} /></button>
                    </div>
                ))}
                {hGuides.map((g, i) => (
                    <div key={`h-${i}`} className="flex items-center justify-between bg-black/40 p-1 rounded border border-gray-800">
                        <span className="text-[9px] text-gray-500 font-bold px-1">H</span>
                        <input type="number" value={Math.round(g)} onChange={e => setHGuides(prev => prev.map((v, idx) => idx === i ? parseInt(e.target.value) : v))} className="bg-transparent text-[10px] w-12 font-mono text-red-300" />
                        <button onClick={() => setHGuides(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-600 hover:text-red-500"><X size={10} /></button>
                    </div>
                ))}
            </div>
        </div>

        {/* Transform Controls */}
        {currentLayer && (
            <div className="p-4 bg-blue-600/5 border-b border-gray-800 space-y-4">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-blue-500">
                    <span className="flex items-center gap-2"><Maximize size={12} /> Transform</span>
                    <span className="font-mono">{(currentLayer.scale * 100).toFixed(1)}%</span>
                </div>
                <input type="range" min="0.01" max="2" step="0.01" value={currentLayer.scale} onChange={e => updateLayer(currentLayer.id, { scale: parseFloat(e.target.value) })} className="w-full accent-blue-500 h-1" />
                <div className="flex justify-center gap-1">
                    <div className="grid grid-cols-3 gap-1">
                        <div /> <button onClick={() => nudge('up')} className="p-2 bg-gray-800 rounded hover:bg-blue-600 transition-colors"><ChevronUp size={14}/></button> <div />
                        <button onClick={() => nudge('left')} className="p-2 bg-gray-800 rounded hover:bg-blue-600 transition-colors"><ChevronLeft size={14}/></button>
                        <button onClick={() => nudge('down')} className="p-2 bg-gray-800 rounded hover:bg-blue-600 transition-colors"><ChevronDown size={14}/></button>
                        <button onClick={() => nudge('right')} className="p-2 bg-gray-800 rounded hover:bg-blue-600 transition-colors"><ChevronRight size={14}/></button>
                    </div>
                </div>
            </div>
        )}

        {/* Layers List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
          {layers.map((layer, idx) => (
            <div key={layer.id} onClick={() => setSelectedLayerId(layer.id)} className={`p-2 rounded-lg border transition-all cursor-pointer ${selectedLayerId === layer.id ? 'bg-blue-600/10 border-blue-500/40' : 'bg-white/5 border-transparent'}`}>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <img src={layer.thumbnail} alt="" className={`w-10 h-10 object-contain bg-black border border-gray-800 ${!layer.visible ? 'opacity-20 grayscale' : ''}`} />
                  {!layer.visible && <div className="absolute inset-0 flex items-center justify-center"><EyeOff size={14} className="text-gray-500" /></div>}
                </div>
                <div className="flex-1 min-w-0">
                    <p className={`text-[10px] font-bold truncate ${!layer.visible ? 'text-gray-600' : 'text-gray-200'}`}>{layer.name}</p>
                    {idx === 0 && <span className="text-[7px] text-emerald-400 font-black uppercase tracking-tighter">Master Reference</span>}
                </div>
                <div className="flex gap-1">
                  <button onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }} className={`p-1.5 rounded ${layer.visible ? 'text-blue-400' : 'text-gray-600'}`}>{layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button>
                  <button onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id) }} className="text-red-500 p-1.5 hover:bg-red-500/10 rounded"><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          )).reverse()}
        </div>

        {/* Footer Sidebar Actions */}
        <div className="p-4 border-t border-gray-800 space-y-2 bg-[#121212]">
          <div className="flex gap-2">
            <button onClick={() => setShowGuidelines(!showGuidelines)} className={`flex-1 py-2 rounded text-[10px] font-bold uppercase transition-colors ${showGuidelines ? 'bg-red-600/20 text-red-400 border border-red-500/30' : 'bg-gray-800 text-gray-500'}`}>Guides</button>
            <button onClick={() => setUseSnapping(!useSnapping)} className={`flex-1 py-2 rounded text-[10px] font-bold uppercase transition-colors ${useSnapping ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'bg-gray-800 text-gray-500'}`}>Snap</button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => {
                  const was = showGuidelines; setShowGuidelines(false);
                  setTimeout(() => {
                      const link = document.createElement('a');
                      link.download = `composition.png`;
                      link.href = canvasRef.current.toDataURL('image/png');
                      link.click();
                      setShowGuidelines(was);
                  }, 100);
              }} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"><Download size={14} /> Comp</button>
            <button onClick={handleBulkZipExport} disabled={isExportingZip || layers.length === 0} className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2">
              {isExportingZip ? <div className="animate-spin rounded-full h-3 w-3 border-2 border-white/20 border-t-white" /> : <Archive size={14} />} Bulk ZIP</button>
          </div>
        </div>
      </div>

      {/* Main Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ height: '56px', backgroundColor: '#0e0e0e', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', padding: '0 24px', justifyContent: 'space-between' }}>
          <div className="flex items-center gap-4 bg-black/40 px-4 py-1.5 rounded-full border border-gray-800">
                <span className="text-[10px] uppercase font-bold text-gray-600 tracking-widest">Zoom</span>
                <input type="range" min="0.1" max="1.5" step="0.05" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} className="w-24 accent-blue-600 h-1" />
                <span className="text-[11px] font-mono font-black text-blue-500 w-10 text-right">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
        
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#060606', padding: '64px', position: 'relative' }} 
             onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
          <div style={{ position: 'relative', backgroundColor: 'white', boxShadow: '0 0 120px rgba(0,0,0,0.9)', outline: '1px solid rgba(255,255,255,0.1)', width: `${CANVAS_SIZE * zoom}px`, height: `${CANVAS_SIZE * zoom}px` }}>
            <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} onMouseDown={handleMouseDown} style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair', touchAction: 'none' }} />
          </div>
        </div>

        <div style={{ height: '40px', backgroundColor: '#0e0e0e', borderTop: '1px solid #1f2937', padding: '0 24px', display: 'flex', alignItems: 'center', fontSize: '9px', fontWeight: 'bold', color: '#4b5563', gap: '32px', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
            <span>1000x1000 Master Grid</span>
            <span style={{ color: '#60a5fa' }}>Hold Shift for Aspect Ratio (Coming soon)</span>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #222; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #333; }
        body { margin: 0; padding: 0; background-color: #050505; }
      `}</style>
    </div>
  );
}