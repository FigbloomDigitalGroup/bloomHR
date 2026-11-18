// A signature uploaded as a picture (a photo or scan of it signed on paper) made into what a drawn one is: a PNG with
// a transparent background, cropped to the ink and small enough to keep (the database takes up to about 300 KB).

export const SIGNATURE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_WIDTH = 600;
const MAX_HEIGHT = 240;
// lighter than this (0-255, on every channel) is paper, not ink
const PAPER = 200;

/** What is wrong with the picture before reading it, or null. */
export function signatureImageProblem(file: Pick<File, 'type' | 'size'>): string | null {
  if (!SIGNATURE_IMAGE_TYPES.includes(file.type)) return 'Upload a PNG or JPG picture of your signature.';
  if (file.size > 8 * 1024 * 1024) return 'The picture is over 8 MB. Take a smaller one.';
  return null;
}

const loadImage = (file: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That picture could not be read. Try a PNG or JPG.'));
    };
    img.src = url;
  });

/** The picture as a signature: paper made transparent, cropped to the ink, scaled down, as a PNG. */
export async function signatureFromImage(file: Blob): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, (MAX_WIDTH * 2) / img.width, (MAX_HEIGHT * 2) / img.height);
  const work = document.createElement('canvas');
  work.width = Math.max(1, Math.round(img.width * scale));
  work.height = Math.max(1, Math.round(img.height * scale));
  const ctx = work.getContext('2d');
  if (!ctx) throw new Error('Your browser could not read the picture.');
  ctx.drawImage(img, 0, 0, work.width, work.height);
  const data = ctx.getImageData(0, 0, work.width, work.height);
  const px = data.data;
  let top = work.height, left = work.width, right = -1, bottom = -1;
  for (let y = 0; y < work.height; y++) {
    for (let x = 0; x < work.width; x++) {
      const i = (y * work.width + x) * 4;
      const paper = px[i + 3] < 20 || (px[i] > PAPER && px[i + 1] > PAPER && px[i + 2] > PAPER);
      if (paper) {
        px[i + 3] = 0;
      } else {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error('No signature found in the picture: sign in dark ink on white paper and try again.');
  ctx.putImageData(data, 0, 0);
  const margin = 6;
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  const w = Math.min(work.width - left, right - left + 1 + margin * 2);
  const h = Math.min(work.height - top, bottom - top + 1 + margin * 2);
  const fit = Math.min(1, MAX_WIDTH / w, MAX_HEIGHT / h);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * fit));
  out.height = Math.max(1, Math.round(h * fit));
  out.getContext('2d')?.drawImage(work, left, top, w, h, 0, 0, out.width, out.height);
  return new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be saved.'))), 'image/png'));
}
