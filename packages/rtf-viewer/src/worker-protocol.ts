import type { DocumentModel } from './generated/model.js';
export interface ParseRequest { bytes: ArrayBuffer; wasmUrl: string }
export type ParseResponse = { ok: true; model: DocumentModel } | { ok: false; message: string };
