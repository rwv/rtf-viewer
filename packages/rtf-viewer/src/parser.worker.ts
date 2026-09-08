/// <reference lib="webworker" />
// This import remains external in the build; the generated glue lives beside the Worker.
import init, { parse_rtf } from './rtf_parser.js';
import type { ParseRequest, ParseResponse } from './worker-protocol.js';
import type { DocumentModel } from './generated/model.js';
const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = async ({ data }: MessageEvent<ParseRequest>) => {
  let result: ParseResponse;
  try {
    await init({ module_or_path: data.wasmUrl });
    const model = JSON.parse(parse_rtf(new Uint8Array(data.bytes))) as DocumentModel;
    result = { ok: true, model };
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  worker.postMessage(result);
};
