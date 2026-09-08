import type { DocumentModel, Diagnostic } from './generated/model.js';
import type {
  DocumentLayout,
  LoadOptions,
  PageLayout,
  PageSize,
  RenderOptions,
  RtfInput,
} from './types.js';
import { parseInput } from './parser-client.js';
import { BrowserResources } from './resources.js';
import { layoutDocument } from './layout.js';
import { paintPage, pixelSize, type CanvasTarget } from './paint.js';
import { abortable, checkAbort, freezeDeep } from './lifecycle.js';
const activeCanvases = new WeakSet<CanvasTarget>();

export class RtfDocument {
  private closed = false;
  private fontEpoch: number;
  private updating = false;
  private revision = 1;
  private readonly lifetime = new AbortController();
  private constructor(
    readonly model: DocumentModel,
    private resources: BrowserResources,
    private layout: DocumentLayout,
  ) {
    this.fontEpoch = resources.fontEpoch;
  }
  static async load(input: RtfInput, options: LoadOptions = {}): Promise<RtfDocument> {
    const model = await parseInput(input, options);
    checkAbort(options.signal);
    const resources = new BrowserResources(model, options);
    try {
      await resources.prepare(options.signal);
      const epoch = resources.fontEpoch;
      const layout = await layoutDocument(model, resources, { signal: options.signal });
      if (resources.fontEpoch !== epoch)
        throw new Error('Fonts changed during layout. Retry after fonts settle.');
      checkAbort(options.signal);
      return new RtfDocument(freezeDeep(model), resources, freezeDeep(layout));
    } catch (error) {
      resources.destroy();
      throw error;
    }
  }
  get pageCount(): number {
    return this.layout.pages.length;
  }
  get layoutRevision(): number {
    return this.revision;
  }
  get needsRelayout(): boolean {
    return this.fontEpoch !== this.resources.fontEpoch;
  }
  get destroyed(): boolean {
    return this.closed;
  }
  get diagnostics(): readonly Diagnostic[] {
    return freezeDeep([
      ...this.model.diagnostics,
      ...this.resources.diagnostics,
      ...this.layout.diagnostics,
    ]);
  }
  getPageSize(index: number): PageSize {
    const page = this.getPageLayout(index);
    return { width: page.width, height: page.height };
  }
  getPageLayout(index: number): PageLayout {
    if (!Number.isInteger(index) || index < 0 || index >= this.pageCount)
      throw new RangeError('Page index is out of range (zero-based).');
    return this.layout.pages[index];
  }
  private ensureReady(revision = this.revision): void {
    if (this.closed) throw new Error('The RTF document has been destroyed.');
    if (this.needsRelayout)
      throw new Error('Fonts changed. Call document.relayout() before rendering.');
    if (this.updating) throw new Error('Document layout is being refreshed.');
    if (revision !== this.revision)
      throw new Error('Document layout changed during rendering. Retry with the current layout.');
  }
  private signal(signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
  }
  async relayout(options: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.closed) throw new Error('The RTF document has been destroyed.');
    if (this.updating) throw new Error('Document layout is already being refreshed.');
    this.updating = true;
    const signal = this.signal(options.signal);
    try {
      await this.resources.prepareFonts(signal);
      const epoch = this.resources.fontEpoch;
      const layout = await layoutDocument(this.model, this.resources, { signal });
      if (this.resources.fontEpoch !== epoch)
        throw new Error('Fonts changed during layout. Retry after fonts settle.');
      checkAbort(signal);
      this.layout = freezeDeep(layout);
      this.fontEpoch = epoch;
      this.revision++;
    } finally {
      this.updating = false;
    }
  }
  async renderPage(
    canvas: CanvasTarget,
    index: number,
    options: RenderOptions = {},
  ): Promise<void> {
    this.ensureReady();
    const revision = this.revision;
    const page = this.getPageLayout(index);
    if (activeCanvases.has(canvas)) throw new Error('A render is already active on this canvas.');
    const signal = this.signal(options.signal);
    checkAbort(signal);
    activeCanvases.add(canvas);
    try {
      await paintPage(canvas, page, this.resources.images, { ...options, signal });
      this.ensureReady(revision);
    } finally {
      activeCanvases.delete(canvas);
    }
  }
  async renderPageToBitmap(index: number, options: RenderOptions = {}): Promise<ImageBitmap> {
    this.ensureReady();
    const revision = this.revision;
    const size = pixelSize(this.getPageLayout(index), options);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const signal = this.signal(options.signal);
    try {
      await this.renderPage(canvas, index, { ...options, signal });
      const bitmap = await abortable(createImageBitmap(canvas), signal, (late) => late.close());
      try {
        checkAbort(signal);
        this.ensureReady(revision);
      } catch (error) {
        bitmap.close();
        throw error;
      }
      return bitmap;
    } finally {
      canvas.width = canvas.height = 1;
    }
  }
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    this.resources.destroy();
  }
}
