import { describe, expect, it } from 'vitest';
import { layoutDocument } from './layout.js';
import { pixelSize } from './paint.js';
import type { Block, DocumentModel, ParagraphStyle, TextStyle } from './generated/model.js';
import type { LayoutServices } from './types.js';
const textStyle: TextStyle = { fontId: 0, fontSize: 10, bold: false, italic: false, underline: false, strike: false, color: null, highlight: null, hidden: false, baseline: 0 };
const paragraphStyle: ParagraphStyle = { align: 'left', leftIndent: 0, rightIndent: 0, firstLineIndent: 0, spaceBefore: 0, spaceAfter: 0, lineSpacing: { kind: 'exact', value: 10 }, pageBreakBefore: false };
const services: LayoutServices = {
  font: (style) => `${style.fontSize}px monospace`,
  measure: (text) => ({ width: Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length * 5, ascent: 8, descent: 2 }),
  imageSize: () => ({ width: 20, height: 15 }),
};
function paragraph(text: string, style: Partial<ParagraphStyle> = {}): Block {
  return { kind: 'paragraph', runs: [{ kind: 'text', text, style: textStyle }], style: { ...paragraphStyle, ...style }, markStyle: textStyle };
}
function model(blocks: Block[], contentWidth = 50, contentHeight = 30): DocumentModel {
  return { schemaVersion: 1, page: { width: contentWidth + 20, height: contentHeight + 20, marginLeft: 10, marginRight: 10, marginTop: 10, marginBottom: 10 }, defaultTab: 10,
    fonts: [{ id: 0, name: 'monospace', charset: null, codepage: null }], colors: [null], images: [], blocks, diagnostics: [] };
}
const textOf = (line: Awaited<ReturnType<typeof layoutDocument>>['pages'][0]['lines'][0]) => line.fragments.map((f) => f.kind === 'text' ? f.text : '[image]').join('');

describe('retained point geometry', () => {
  it('wraps at words and automatically paginates using exact line height', async () => {
    const layout = await layoutDocument(model(Array.from({ length: 7 }, (_, i) => paragraph(`Line ${i}`))), services);
    expect(layout.pages.map((p) => p.lines.length)).toEqual([3, 3, 1]);
    expect(layout.pages[1].lines.map(textOf)).toEqual(['Line 3', 'Line 4', 'Line 5']);
    expect(layout.pages[0].lines.map((l) => l.y)).toEqual([10, 20, 30]);
  });
  it('retains CJK punctuation with its preceding cluster and preserves emoji graphemes', async () => {
    const layout = await layoutDocument(model([paragraph('中文，世界👩‍💻文')], 15, 100), services);
    const lines = layout.pages[0].lines.map(textOf);
    expect(lines.join('')).toBe('中文，世界👩‍💻文');
    expect(lines.every((line) => !line.startsWith('，'))).toBe(true);
    expect(lines.some((line) => line.includes('👩‍💻'))).toBe(true);
  });
  it('does not break a word just because its style changes', async () => {
    const p = paragraph('') as Extract<Block, { kind: 'paragraph' }>;
    p.runs = [{ kind: 'text', text: 'hi ab', style: textStyle }, { kind: 'text', text: 'cdef', style: { ...textStyle, bold: true } }];
    const layout = await layoutDocument(model([p], 35, 100), services);
    expect(layout.pages[0].lines.map(textOf)).toEqual(['hi', 'abcdef']);
  });
  it('applies first-line and hanging indents only to their intended lines', async () => {
    const layout = await layoutDocument(model([paragraph('abc def ghi jkl', { leftIndent: 5, firstLineIndent: 10 })], 50, 100), services);
    expect(layout.pages[0].lines.map((l) => l.x)).toEqual([25, 15]);
    const hanging = await layoutDocument(model([paragraph('abc def ghi jkl', { leftIndent: 10, firstLineIndent: -5 })], 45, 100), services);
    expect(hanging.pages[0].lines.map((l) => l.x)).toEqual([15, 20]);
  });
  it('recomputes a wrapped tab from the continuation-line indent', async () => {
    const layout = await layoutDocument(model([paragraph('abc\tz', { leftIndent: 3 })], 19, 100), services);
    const lines = layout.pages[0].lines;
    expect(lines.map(textOf)).toEqual(['abc', ' z']);
    expect(lines[1]).toMatchObject({ x: 13, width: 12 });
    expect(lines[1].fragments.map((fragment) => ({ x: fragment.x, width: fragment.width })))
      .toEqual([{ x: 13, width: 7 }, { x: 20, width: 5 }]);
  });
  it('centers, right-aligns and expands justification using retained advances', async () => {
    const centered = await layoutDocument(model([paragraph('abc', { align: 'center' })]), services);
    expect(centered.pages[0].lines[0].x).toBe(27.5);
    const right = await layoutDocument(model([paragraph('abc', { align: 'right' })]), services);
    expect(right.pages[0].lines[0].x).toBe(45);
    const justified = await layoutDocument(model([paragraph('ab cd ef gh', { align: 'justify' })], 45, 100), services);
    expect(justified.pages[0].lines[0].width).toBe(45);
    expect(justified.pages[0].lines[1].width).toBe(10);
  });
  it('handles forced lines, empty paragraphs and explicit blank pages', async () => {
    const layout = await layoutDocument(model([paragraph('one\ntwo\n'), { kind: 'pageBreak' }, { kind: 'pageBreak' }, paragraph('last')], 50, 100), services);
    expect(layout.pages.map((p) => p.lines.map(textOf))).toEqual([['one', 'two', ''], [], ['last']]);
  });
  it('does not add a blank line when a forced break follows an exactly full line', async () => {
    const layout = await layoutDocument(model([paragraph('abcdefghij\nx')], 50, 100), services);
    expect(layout.pages[0].lines.map(textOf)).toEqual(['abcdefghij', 'x']);
  });
  it('applies before/after spacing and multiple line spacing', async () => {
    const layout = await layoutDocument(model([paragraph('a', { spaceBefore: 5, spaceAfter: 7, lineSpacing: { kind: 'multiple', value: 1.5 } }), paragraph('b')], 50, 100), services);
    expect(layout.pages[0].lines.map((l) => [l.y, l.height])).toEqual([[15, 15], [37, 10]]);
  });
  it('retains images as measured rectangles and makes progress for oversized content', async () => {
    const p = paragraph('') as Extract<Block, { kind: 'paragraph' }>;
    p.runs = [{ kind: 'image', imageId: 'image-0' }];
    const layout = await layoutDocument(model([p], 10, 10), services);
    expect(layout.pages).toHaveLength(1);
    expect(layout.diagnostics.map((d) => d.code)).toContain('oversized-inline');
    expect(layout.pages[0].lines[0].fragments[0]).toMatchObject({ kind: 'image', width: 20, height: 15 });
  });
  it('enforces paper and page limits without producing invalid geometry', async () => {
    await expect(layoutDocument(model([paragraph('a')], 0), services)).rejects.toThrow('paper');
    await expect(layoutDocument(model([paragraph('a'), paragraph('b')], 50, 10), services, { maxPages: 1 })).rejects.toThrow('page count');
  });
  it('cancels long paragraph tokenization while yielding to the event loop', async () => {
    const controller = new AbortController();
    const result = layoutDocument(model([paragraph('word '.repeat(50_000))]), services, { signal: controller.signal });
    setTimeout(() => controller.abort(), 2);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('changes only backing dimensions across PPI, zoom and pixel ratio', async () => {
    const layout = await layoutDocument(model([paragraph('abc def ghi jkl')]), services);
    const before = JSON.stringify(layout);
    expect(pixelSize(layout.pages[0], { ppi: 72 })).toMatchObject({ width: 70, height: 50 });
    expect(pixelSize(layout.pages[0], { ppi: 144, scale: 2, pixelRatio: 2 })).toMatchObject({ width: 560, height: 400 });
    expect(JSON.stringify(layout)).toBe(before);
    expect(() => pixelSize(layout.pages[0], { ppi: NaN })).toThrow();
    expect(() => pixelSize(layout.pages[0], { ppi: 100_000 })).toThrow();
  });
});
