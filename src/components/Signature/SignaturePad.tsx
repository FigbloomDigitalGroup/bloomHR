import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import { Button } from '../UI';

// A pad to draw a signature on with a mouse, a finger or a pen. The strokes are smoothed, and what is saved is a PNG
// with a transparent background, cropped to the ink, so it sits well on a letter.

const INK = '#1f2937';
const HEIGHT = 180;

/** The canvas cropped to its ink (with a little margin), or null when nothing is drawn. */
function cropToInk(canvas: HTMLCanvasElement, margin = 8): HTMLCanvasElement | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 0) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(width - 1, right + margin);
  bottom = Math.min(height - 1, bottom + margin);
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d')?.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the drawing'))), 'image/png'));

interface SignaturePadProps {
  onSave: (png: Blob) => void | Promise<void>;
  onCancel?: () => void;
  busy?: boolean;
  saveLabel?: string;
}

export default function SignaturePad({ onSave, onCancel, busy, saveLabel = 'Save signature' }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const mid = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // the canvas is drawn at the screen's pixel density, so the signature stays sharp in the PDF
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 560;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(HEIGHT * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const p = point(e);
    last.current = p;
    mid.current = p;
    const ctx = e.currentTarget.getContext('2d');
    if (ctx) {
      // a dot for a tap
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    }
    setEmpty(false);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current || !mid.current) return;
    e.preventDefault();
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    const nextMid = { x: (last.current.x + p.x) / 2, y: (last.current.y + p.y) / 2 };
    // a curve through the midpoints: smooth lines however fast the hand moves
    ctx.beginPath();
    ctx.moveTo(mid.current.x, mid.current.y);
    ctx.quadraticCurveTo(last.current.x, last.current.y, nextMid.x, nextMid.y);
    ctx.stroke();
    last.current = p;
    mid.current = nextMid;
  };

  const up = () => {
    drawing.current = false;
    last.current = null;
    mid.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
  };

  const save = async () => {
    const canvas = canvasRef.current;
    const cropped = canvas && cropToInk(canvas);
    if (!cropped) return;
    await onSave(await toPng(cropped));
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border-2 border-dashed border-border bg-white">
        <canvas
          ref={canvasRef}
          aria-label="Signature pad: draw your signature here"
          className="block w-full touch-none cursor-crosshair"
          style={{ height: HEIGHT }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          onPointerCancel={up}
        />
        <div className="pointer-events-none absolute left-6 right-6 bottom-10 border-b border-border" />
        {empty && <p className="pointer-events-none absolute inset-x-0 bottom-3 m-0 text-center text-[11px] text-subtle">Sign above the line</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={clear} disabled={busy || empty} icon={<Eraser className="h-4 w-4" />}>Clear</Button>
        {onCancel && <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button onClick={() => void save()} disabled={busy || empty}>{busy ? 'Saving…' : saveLabel}</Button>
      </div>
    </div>
  );
}
