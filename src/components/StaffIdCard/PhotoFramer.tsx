import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Crosshair } from 'lucide-react';
import { Button } from '../UI';
import { hexagon, useImageSize } from './StaffIdCard';
import { type PhotoFraming, CENTRED, placePhoto, setStaffIdCardPhotoFraming } from '../../lib/staffIdCards';

// Framing the photo on a staff ID card (20261027600000): drag the photo inside the hexagon and zoom, then Save. Only
// where the photo sits on the card changes; the photo itself is not edited.

const VIEW = 300;
const R = 120;
const STEP = 0.02;

export default function PhotoFramer({
  employeeId,
  photoUrl,
  framing: saved,
  onSaved,
  onCancel,
  onChange,
}: {
  employeeId: string;
  photoUrl: string;
  framing: PhotoFraming;
  onSaved: (framing: PhotoFraming) => void;
  onCancel: () => void;
  /** the position as it is being moved, to show it on the card */
  onChange?: (framing: PhotoFraming) => void;
}) {
  const natural = useImageSize(photoUrl);
  const [framing, setDraft] = useState<PhotoFraming>(saved);
  const setFraming = (next: PhotoFraming) => {
    setDraft(next);
    onChange?.(next);
  };
  const [saving, setSaving] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ px: number; py: number; from: PhotoFraming } | null>(null);
  const placed = placePhoto(natural, framing, VIEW / 2, VIEW / 2, R * 2);
  // keeps a point the photo can reach (it never leaves a gap in the hexagon)
  const move = (next: PhotoFraming) => setFraming(placePhoto(natural, next, VIEW / 2, VIEW / 2, R * 2).framing);

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    drag.current = { px: e.clientX, py: e.clientY, from: placed.framing };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const unit = VIEW / (svg.current?.getBoundingClientRect().width || VIEW);
    const { px, py, from } = drag.current;
    move({ ...from, x: from.x - ((e.clientX - px) * unit) / placed.width, y: from.y - ((e.clientY - py) * unit) / placed.height });
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const f = placed.framing;
    const next: Record<string, PhotoFraming> = {
      ArrowLeft: { ...f, x: f.x - STEP }, ArrowRight: { ...f, x: f.x + STEP },
      ArrowUp: { ...f, y: f.y - STEP }, ArrowDown: { ...f, y: f.y + STEP },
      '+': { ...f, zoom: f.zoom + 0.1 }, '=': { ...f, zoom: f.zoom + 0.1 }, '-': { ...f, zoom: f.zoom - 0.1 },
    };
    if (!next[e.key]) return;
    e.preventDefault();
    move(next[e.key]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await setStaffIdCardPhotoFraming(employeeId, placed.framing);
      onSaved(placed.framing);
      toast.success('Photo position saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm space-y-3 rounded-tile border border-border bg-background p-4" data-testid="photo-framer">
      <p className="m-0 text-center text-[12.5px] text-muted-foreground">
        Drag the photo to centre it in the hexagon, and zoom if needed. The photo itself doesn’t change.
      </p>
      <svg
        ref={svg}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="mx-auto block w-full max-w-[260px] cursor-grab touch-none select-none rounded-md bg-[#E8ECEF] outline-none focus-visible:ring-2 focus-visible:ring-brand active:cursor-grabbing"
        role="application"
        aria-label="Photo position: drag, or use the arrow keys to move and + or - to zoom"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <defs>
          <clipPath id="photo-framer-hex">
            <polygon points={hexagon(VIEW / 2, VIEW / 2, R)} />
          </clipPath>
        </defs>
        {/* the rest of the photo, faded, so you can see what's outside the hexagon */}
        <image href={photoUrl} x={placed.x} y={placed.y} width={placed.width} height={placed.height} preserveAspectRatio="xMidYMid slice" opacity={0.3} />
        <image
          href={photoUrl}
          x={placed.x} y={placed.y} width={placed.width} height={placed.height}
          preserveAspectRatio="xMidYMid slice"
          clipPath="url(#photo-framer-hex)"
          data-testid="framer-photo"
        />
        <polygon points={hexagon(VIEW / 2, VIEW / 2, R)} fill="none" stroke="#FFFFFF" strokeWidth={3} />
      </svg>
      <label className="flex items-center gap-3 text-[12px] text-muted-foreground">
        Zoom
        <input
          type="range"
          min={1}
          max={4}
          step={0.05}
          value={placed.framing.zoom}
          onChange={(e) => move({ ...placed.framing, zoom: Number(e.target.value) })}
          className="flex-1"
          aria-label="Zoom"
        />
      </label>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="ghost" onClick={() => setFraming(CENTRED)} icon={<Crosshair className="w-3.5 h-3.5" />}>
          Centre
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
