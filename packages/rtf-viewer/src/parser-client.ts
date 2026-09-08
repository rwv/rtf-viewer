import type { DocumentModel } from './generated/model.js';
import type { LoadOptions, RtfInput } from './types.js';
import type { ParseResponse } from './worker-protocol.js';
import { abortable, abortError, checkAbort } from './lifecycle.js';
const MAX_BYTES = 16 * 1024 * 1024;
export async function parseInput(input: RtfInput, options: LoadOptions): Promise<DocumentModel> {
  checkAbort(options.signal);
  if (!(input instanceof Blob) && !(input instanceof ArrayBuffer) && !(input instanceof Uint8Array)) throw new TypeError('Expected a Blob, ArrayBuffer or Uint8Array.');
  const size = input instanceof Blob ? input.size : input.byteLength;
  if (!Number.isFinite(size) || size > MAX_BYTES) throw new RangeError('RTF input exceeds 16 MiB.');
  let bytes: ArrayBuffer;
  if (input instanceof Blob) bytes = await abortable(input.arrayBuffer(), options.signal);
  else if (input instanceof ArrayBuffer) bytes = input.slice(0);
  else if (input instanceof Uint8Array) bytes = new Uint8Array(input).buffer;
  else throw new TypeError('Expected a Blob, ArrayBuffer or Uint8Array.');
  checkAbort(options.signal);
  const timeout = options.parseTimeoutMs ?? 30_000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120_000) throw new RangeError('Invalid parser timeout.');
  const wasmUrl = options.wasmUrl
    ? new URL(String(options.wasmUrl), globalThis.location.href).href
    : new URL('./rtf_parser_bg.wasm', import.meta.url).href;
  // The literal Worker constructor is important for Vite's production asset discovery.
  const worker = options.workerUrl
    ? new Worker(options.workerUrl, { type: 'module' })
    : new Worker(new URL('./parser.worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, model?: DocumentModel) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error); else resolve(model!);
    };
    const abort = () => finish(abortError());
    const timer = setTimeout(() => finish(new Error('RTF parsing exceeded its time limit.')), timeout);
    worker.onmessage = ({ data }: MessageEvent<ParseResponse>) => {
      try {
        if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean') throw new Error('Invalid parser Worker response.');
        if (!data.ok) { finish(new Error(data.message)); return; }
        if (!data.model || data.model.schemaVersion !== 1 || !Array.isArray(data.model.blocks) || !Array.isArray(data.model.images)) throw new Error('Unsupported RTF model schema.');
        finish(undefined, data.model);
      } catch (error) { finish(error); }
    };
    worker.onerror = (event) => { event.preventDefault(); finish(new Error(event.message || 'Parser Worker failed.')); };
    worker.onmessageerror = () => finish(new Error('Invalid parser Worker response.'));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    try { worker.postMessage({ bytes, wasmUrl }, [bytes]); } catch (error) { finish(error); }
  });
}
