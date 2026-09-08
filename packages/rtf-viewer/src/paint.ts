import type { PageLayout, RenderOptions } from './types.js';
import { checkAbort, nextTask } from './lifecycle.js';
export type CanvasTarget = HTMLCanvasElement | OffscreenCanvas;
function ceilPixels(value: number): number {
  const nearest = Math.round(value);
  // The four scale operations can overshoot an integer by a few ULPs.
  // Keep real fractional extents and never round a positive extent to zero.
  return nearest > 0 && Math.abs(value - nearest) <= Number.EPSILON * Math.abs(value) * 4
    ? nearest : Math.ceil(value);
}
export function pixelSize(page: { width: number; height: number }, options: RenderOptions = {}) {
  const ppi = options.ppi ?? 96, scale = options.scale ?? 1, ratio = options.pixelRatio ?? 1;
  if (![ppi, scale, ratio].every((v) => Number.isFinite(v) && v > 0)) throw new RangeError('PPI, scale and pixelRatio must be positive finite numbers.');
  if (![page.width, page.height].every((v) => Number.isFinite(v) && v > 0)) throw new RangeError('Page dimensions must be positive finite numbers.');
  const factor = ppi / 72 * scale * ratio;
  if (!Number.isFinite(factor) || factor <= 0) throw new RangeError('Output scale exceeds the numeric range.');
  const width = ceilPixels(page.width * factor), height = ceilPixels(page.height * factor);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 32767 || height > 32767 || width * height > 32_000_000) throw new RangeError('Output canvas exceeds 32 million pixels or the dimension limit.');
  return { width, height, factor };
}
/** Paint is intentionally measurement-free: every line and image rectangle already exists. */
export async function paintPage(canvas: CanvasTarget, page: PageLayout, images: ReadonlyMap<string, ImageBitmap>, options: RenderOptions): Promise<void> {
  checkAbort(options.signal);
  const { width, height, factor } = pixelSize(page, options);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('Canvas 2D is unavailable.');
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.setTransform(factor, 0, 0, factor, 0, 0);
    context.textBaseline = 'alphabetic';
    context.fontKerning = 'normal';
    context.direction = 'ltr';
    for (let lineIndex = 0; lineIndex < page.lines.length; lineIndex++) {
      if (lineIndex % 32 === 0) { await nextTask(); checkAbort(options.signal); }
      for (const fragment of page.lines[lineIndex].fragments) {
        if (fragment.kind === 'image') {
          const image = images.get(fragment.imageId);
          if (image) context.drawImage(image, fragment.x, fragment.y, fragment.width, fragment.height);
          else {
            context.fillStyle = '#f1f3f5';
            context.fillRect(fragment.x, fragment.y, fragment.width, fragment.height);
            context.strokeStyle = '#9aa3ac'; context.lineWidth = 0.5;
            context.strokeRect(fragment.x, fragment.y, fragment.width, fragment.height);
            context.beginPath(); context.moveTo(fragment.x, fragment.y); context.lineTo(fragment.x + fragment.width, fragment.y + fragment.height); context.stroke();
          }
          continue;
        }
        if (fragment.highlight) { context.fillStyle = fragment.highlight; context.fillRect(fragment.x, fragment.y, fragment.width, fragment.height); }
        context.font = fragment.font;
        context.fillStyle = fragment.color;
        context.fillText(fragment.text, fragment.x, fragment.baseline);
        context.strokeStyle = fragment.color;
        context.lineWidth = Math.max(0.5, fragment.fontSize / 16);
        for (const position of [fragment.underline ? fragment.baseline + fragment.fontSize * 0.12 : null, fragment.strike ? fragment.baseline - fragment.fontSize * 0.3 : null]) {
          if (position === null) continue;
          context.beginPath(); context.moveTo(fragment.x, position); context.lineTo(fragment.x + fragment.width, position); context.stroke();
        }
      }
    }
    checkAbort(options.signal);
  } finally { context.restore(); }
}
