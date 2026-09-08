import { RtfDocument } from './document.js';
import type { LoadOptions, RtfInput } from './types.js';
import { abortError, checkAbort } from './lifecycle.js';

/** Canvas-mounted viewer. UI controls are deliberately left to the host. */
export class RtfViewer {
  private owned = true;
  private closed = false;
  private current: RtfDocument | null = null;
  private index = 0;
  private zoom = 1;
  private loadGeneration = 0;
  private paintGeneration = 0;
  private loadController?: AbortController;
  private paintController?: AbortController;
  private pending: Promise<void> = Promise.resolve();
  constructor(readonly canvas: HTMLCanvasElement, private readonly options: LoadOptions = {}) {}
  static fromDocument(canvas: HTMLCanvasElement, document: RtfDocument): RtfViewer {
    if (document.destroyed) throw new Error('Cannot borrow a destroyed document.');
    const viewer = new RtfViewer(canvas);
    viewer.owned = false;
    viewer.current = document;
    return viewer;
  }
  get document(): RtfDocument | null { return this.current; }
  get pageIndex(): number { return this.index; }
  get scale(): number { return this.zoom; }
  get pageCount(): number { return this.current?.pageCount ?? 0; }
  private ensureOpen(): void { if (this.closed) throw new Error('The RTF viewer has been destroyed.'); }
  async load(input: RtfInput, options: LoadOptions = {}): Promise<void> {
    this.ensureOpen();
    if (!this.owned) throw new Error('A borrowed viewer cannot replace its document.');
    const generation = ++this.loadGeneration;
    this.loadController?.abort();
    this.paintController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    const supplied = options.signal ?? this.options.signal;
    const signal = supplied ? AbortSignal.any([supplied, controller.signal]) : controller.signal;
    this.current?.destroy();
    this.current = null;
    const document = await RtfDocument.load(input, { ...this.options, ...options, signal });
    if (this.closed || generation !== this.loadGeneration || signal.aborted) {
      document.destroy(); throw abortError();
    }
    this.current = document;
    this.index = 0;
    await this.draw(0, this.zoom);
  }
  async goToPage(index: number): Promise<void> { await this.draw(index, this.zoom); }
  async setScale(scale: number): Promise<void> {
    if (!Number.isFinite(scale) || scale <= 0 || scale > 8) throw new RangeError('Viewer scale must be between 0 and 8.');
    await this.draw(this.index, scale);
  }
  private async draw(index: number, scale: number): Promise<void> {
    this.ensureOpen();
    const document = this.current;
    if (!document) throw new Error('Load a document first.');
    const size = document.getPageSize(index);
    const generation = ++this.paintGeneration;
    this.paintController?.abort();
    const controller = new AbortController();
    this.paintController = controller;
    const prior = this.pending;
    const operation = (async () => {
      await prior.catch(() => undefined);
      checkAbort(controller.signal);
      if (this.closed || generation !== this.paintGeneration) throw abortError();
      await document.renderPage(this.canvas, index, { scale, pixelRatio: globalThis.devicePixelRatio || 1, signal: controller.signal });
      if (this.closed || generation !== this.paintGeneration) throw abortError();
      this.canvas.style.width = `${size.width * 96 / 72 * scale}px`;
      this.canvas.style.height = `${size.height * 96 / 72 * scale}px`;
      this.index = index;
      this.zoom = scale;
    })();
    this.pending = operation;
    await operation;
  }
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.loadGeneration++;
    this.paintGeneration++;
    this.loadController?.abort();
    this.paintController?.abort();
    if (this.owned) this.current?.destroy();
    this.current = null;
  }
}
