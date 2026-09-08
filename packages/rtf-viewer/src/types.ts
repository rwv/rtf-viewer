import type { Diagnostic, TextStyle } from './generated/model.js';
export type { Diagnostic, DocumentModel, TextStyle } from './generated/model.js';

export type RtfInput = Blob | ArrayBuffer | Uint8Array;
export interface LoadOptions {
  signal?: AbortSignal;
  /** Font names mapped to caller-prepared local/CSS font families. */
  fonts?: Readonly<Record<string, string>>;
  fallbackFont?: string;
  /** Optional deployment overrides. Defaults are assets adjacent to this module. */
  workerUrl?: string | URL;
  wasmUrl?: string | URL;
  /** Default 30 seconds; must be between 1 and 120000 ms. */
  parseTimeoutMs?: number;
}
export interface RenderOptions {
  ppi?: number;
  scale?: number;
  pixelRatio?: number;
  signal?: AbortSignal;
}
export interface PageSize {
  readonly width: number;
  readonly height: number;
}
export interface TextFragment {
  readonly kind: 'text';
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly baseline: number;
  readonly font: string;
  readonly fontSize: number;
  readonly color: string;
  readonly highlight: string | null;
  readonly underline: boolean;
  readonly strike: boolean;
}
export interface ImageFragment {
  readonly kind: 'image';
  readonly imageId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
/** A filled rectangle placed beneath the text, currently only table borders. */
export interface RuleFragment {
  readonly kind: 'rule';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
}
export type Fragment = TextFragment | ImageFragment;
export interface LineLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly paragraphIndex: number;
  readonly fragments: readonly Fragment[];
}
export interface PageLayout extends PageSize {
  readonly index: number;
  readonly lines: readonly LineLayout[];
  /** Rectangles painted before the lines, in back-to-front order. */
  readonly decorations: readonly RuleFragment[];
}
export interface DocumentLayout {
  readonly pages: readonly PageLayout[];
  readonly diagnostics: readonly Diagnostic[];
}
export interface TextMetricsPt {
  width: number;
  ascent: number;
  descent: number;
}
export interface LayoutServices {
  measure(text: string, style: TextStyle): TextMetricsPt;
  font(style: TextStyle): string;
  imageSize(id: string): PageSize;
}
export interface LayoutOptions {
  signal?: AbortSignal;
  maxPages?: number;
}
