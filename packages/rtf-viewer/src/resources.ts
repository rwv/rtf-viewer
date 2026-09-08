import type { Diagnostic, DocumentModel, TextStyle } from './generated/model.js';
import type { LayoutServices, LoadOptions, PageSize, TextMetricsPt } from './types.js';
import { abortable, checkAbort } from './lifecycle.js';
import { sniffRasterDimensions } from './vendor/raster-dimensions.js';

export class BrowserResources implements LayoutServices {
  readonly diagnostics: Diagnostic[] = [];
  readonly images = new Map<string, ImageBitmap>();
  private readonly sizes = new Map<string, PageSize>();
  private readonly metrics = new Map<string, TextMetricsPt>();
  private readonly names: Map<number, string>;
  private readonly canvas = new OffscreenCanvas(1, 1);
  private readonly context: OffscreenCanvasRenderingContext2D;
  private closed = false;
  fontEpoch = 0;
  private readonly fontListener = () => { this.fontEpoch++; };
  constructor(private readonly model: DocumentModel, private readonly options: LoadOptions) {
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable.');
    this.context = context;
    this.context.textBaseline = 'alphabetic';
    this.context.fontKerning = 'normal';
    this.context.direction = 'ltr';
    this.names = new Map(model.fonts.map((font) => {
      const mapped = options.fonts && Object.hasOwn(options.fonts, font.name)
        ? options.fonts[font.name]
        : undefined;
      return [font.id, typeof mapped === 'string' ? mapped : font.name];
    }));
    document.fonts.addEventListener('loadingdone', this.fontListener);
  }
  font(style: TextStyle): string {
    if (!Number.isFinite(style.fontSize) || style.fontSize <= 0 || style.fontSize > 2048 || !Number.isFinite(style.baseline) || Math.abs(style.baseline) > 2048) throw new RangeError('Text size or baseline exceeds the supported physical range.');
    const family = this.names.get(style.fontId) || this.options.fallbackFont || 'serif';
    const quoted = (name: string) => ['serif', 'sans-serif', 'monospace', 'system-ui'].includes(name) ? name : JSON.stringify(name.replace(/[\r\n\x00-\x1f]/g, '').slice(0, 200));
    const fallback = this.options.fallbackFont ? `${quoted(this.options.fallbackFont)}, ` : '';
    return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSize}px ${quoted(family)}, ${fallback}serif`;
  }
  measure(text: string, style: TextStyle): TextMetricsPt {
    if (this.closed) throw new Error('Document resources were destroyed.');
    const font = this.font(style);
    const key = `${font}\u0000${text}`;
    const known = this.metrics.get(key);
    if (known) return known;
    this.context.font = font;
    const metrics = this.context.measureText(text);
    const measured = {
      width: metrics.width,
      ascent: metrics.fontBoundingBoxAscent ?? Math.max(metrics.actualBoundingBoxAscent, style.fontSize * 0.8),
      descent: metrics.fontBoundingBoxDescent ?? Math.max(metrics.actualBoundingBoxDescent, style.fontSize * 0.2),
    };
    if (![measured.width, measured.ascent, measured.descent].every(Number.isFinite)) throw new Error('Invalid font metrics.');
    if (this.metrics.size < 20_000 && text.length < 1024) this.metrics.set(key, measured);
    return measured;
  }
  imageSize(id: string): PageSize { return this.sizes.get(id) ?? { width: 72, height: 54 }; }
  async prepareFonts(signal?: AbortSignal): Promise<void> {
    const fonts = new Map<string, string>();
    for (const block of this.model.blocks) {
      if (block.kind !== 'paragraph') continue;
      fonts.set(this.font(block.markStyle), 'Mg');
      for (const run of block.runs) {
        if (run.kind !== 'text') continue;
        const font = this.font(run.style);
        const sample = (fonts.get(font) ?? '') + run.text.slice(0, 128);
        fonts.set(font, sample.slice(0, 512));
      }
    }
    await abortable(Promise.all(Array.from(fonts, ([font, sample]) => document.fonts.load(font, sample))), signal);
    await abortable(document.fonts.ready, signal);
    checkAbort(signal);
    this.metrics.clear();
  }
  async prepare(signal?: AbortSignal): Promise<void> {
    await this.prepareFonts(signal);
    let pixels = 0;
    for (const resource of this.model.images) {
      checkAbort(signal);
      if (this.closed) throw new Error('Document resources were destroyed.');
      const fallbackSize = { width: resource.width ?? 72, height: resource.height ?? 54 };
      if (![fallbackSize.width, fallbackSize.height].every((v) => Number.isFinite(v) && v > 0 && v <= 14400)) throw new RangeError('Invalid image display dimensions.');
      this.sizes.set(resource.id, fallbackSize);
      if (resource.format !== 'png' && resource.format !== 'jpeg') {
        this.diagnostics.push({ code: 'unsupported-image-format', message: `Image ${resource.id}: ${resource.format} needs an optional decoder. A placeholder is retained.`, offset: 0 });
        continue;
      }
      const bytes = new Uint8Array(resource.data);
      const dims = sniffRasterDimensions(bytes);
      // A failed sniffer is a rejection, never permission to decode an unbounded source.
      if (!dims || dims.width <= 0 || dims.height <= 0 || dims.width > 32767 || dims.height > 32767 || dims.width * dims.height + pixels > 32_000_000) {
        throw new RangeError(`Image ${resource.id} is invalid or exceeds the decoded image budget.`);
      }
      const signatureMatches = resource.format === 'png' ? bytes[0] === 0x89 && bytes[1] === 0x50 : bytes[0] === 0xff && bytes[1] === 0xd8;
      if (!signatureMatches) throw new Error(`Image ${resource.id} does not match its RTF picture format.`);
      pixels += dims.width * dims.height;
      let bitmap: ImageBitmap;
      try {
        bitmap = await abortable(createImageBitmap(new Blob([bytes], { type: `image/${resource.format}` })), signal, (late) => late.close());
      } catch (error) {
        checkAbort(signal);
        this.diagnostics.push({ code: 'image-decode-failed', message: `Image ${resource.id} could not be decoded: ${String(error)}`, offset: 0 });
        continue;
      }
      if (this.closed || signal?.aborted) { bitmap.close(); checkAbort(signal); throw new Error('Document resources were destroyed.'); }
      if (bitmap.width * bitmap.height > dims.width * dims.height) { bitmap.close(); throw new RangeError('Decoded image dimensions exceed admitted dimensions.'); }
      this.images.set(resource.id, bitmap);
      const width = resource.width ?? bitmap.width * 72 / 96;
      const height = resource.height ?? bitmap.height * 72 / 96;
      if (![width, height].every((v) => Number.isFinite(v) && v > 0 && v <= 14400)) throw new RangeError('Invalid image display dimensions.');
      this.sizes.set(resource.id, { width, height });
    }
    if (!this.options.fonts) this.diagnostics.push({ code: 'system-font-environment', message: 'Font availability and fallback depend on this browser. Supply prepared fonts and a font mapping for reproducible pagination.', offset: 0 });
  }
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    document.fonts.removeEventListener('loadingdone', this.fontListener);
    for (const bitmap of this.images.values()) bitmap.close();
    this.images.clear();
    this.metrics.clear();
    this.sizes.clear();
    this.canvas.width = this.canvas.height = 1;
  }
}
