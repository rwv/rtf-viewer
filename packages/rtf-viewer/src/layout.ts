import type { Block, Diagnostic, DocumentModel, TextStyle } from './generated/model.js';
import type { DocumentLayout, Fragment, LayoutOptions, LayoutServices, LineLayout, PageLayout } from './types.js';
import { checkAbort, nextTask } from './lifecycle.js';

type Paragraph = Extract<Block, { kind: 'paragraph' }>;
type Part = { text: string; style: TextStyle };
type Token = { kind: 'text' | 'space'; parts: Part[] } | { kind: 'tab' } | { kind: 'break' } | { kind: 'image'; id: string };
type Measured = { kind: 'text'; part: Part; width: number; ascent: number; descent: number }
  | { kind: 'image'; id: string; width: number; ascent: number; descent: number };
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const opening = /[（［｛〈《「『【〔〖〘〚“‘(\[{]$/u;
const closing = /^[、。，．？！：；）］｝〉》」』】〕〗〙〛”’!?,.;:)\]}]/u;

async function tokenize(paragraph: Paragraph, signal?: AbortSignal): Promise<Token[]> {
  const result: Token[] = [];
  let current: Extract<Token, { parts: Part[] }> | undefined;
  let previous = '';
  let count = 0;
  let tokenClusters = 0;
  const end = () => { current = undefined; previous = ''; };
  for (const run of paragraph.runs) {
    if (run.kind === 'image') { end(); result.push({ kind: 'image', id: run.imageId }); continue; }
    if (run.style.hidden) continue;
    for (const { segment } of graphemes.segment(run.text)) {
      if (++count % 2048 === 0) { await nextTask(); checkAbort(signal); }
      if (segment === '\n' || segment === '\t') {
        end(); result.push({ kind: segment === '\n' ? 'break' : 'tab' }); continue;
      }
      const space = segment === ' ';
      const boundary = previous && (cjk.test(previous) || cjk.test(segment)) && !opening.test(previous) && !closing.test(segment);
      if (!current || current.kind !== (space ? 'space' : 'text') || boundary) {
        current = { kind: space ? 'space' : 'text', parts: [] };
        tokenClusters = 0;
        result.push(current);
      }
      if (++tokenClusters > 16_384) throw new RangeError('An unbroken text token exceeds 16,384 grapheme clusters.');
      const last = current.parts.at(-1);
      if (last && last.style === run.style) last.text += segment;
      else current.parts.push({ text: segment, style: run.style });
      previous = segment;
    }
  }
  return result;
}

function measured(token: Token, services: LayoutServices): Measured[] {
  if (token.kind === 'image') {
    const size = services.imageSize(token.id);
    return [{ kind: 'image', id: token.id, width: size.width, ascent: size.height, descent: 0 }];
  }
  if (token.kind === 'tab' || token.kind === 'break') return [];
  return token.parts.map((part) => ({ kind: 'text', part, ...services.measure(part.text, part.style) }));
}
const totalWidth = (parts: Measured[]) => parts.reduce((sum, part) => sum + part.width, 0);

/** Split an overlong word at grapheme boundaries; a single oversized cluster still makes progress. */
function splitText(token: Extract<Token, { parts: Part[] }>, width: number, services: LayoutServices): [Token, Token | undefined] {
  const fitted: Part[] = [];
  const remaining: Part[] = [];
  let available = width;
  for (let index = 0; index < token.parts.length; index++) {
    const part = token.parts[index];
    if (remaining.length) { remaining.push(part); continue; }
    const size = services.measure(part.text, part.style).width;
    if (size <= available) { fitted.push(part); available -= size; continue; }
    const chars = Array.from(graphemes.segment(part.text), (item) => item.segment);
    let low = 0, high = chars.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (services.measure(chars.slice(0, mid).join(''), part.style).width <= available) low = mid;
      else high = mid - 1;
    }
    if (low === 0 && fitted.length === 0) low = 1;
    if (low > 0) fitted.push({ ...part, text: chars.slice(0, low).join('') });
    if (low < chars.length) remaining.push({ ...part, text: chars.slice(low).join('') });
  }
  return [{ kind: token.kind, parts: fitted }, remaining.length ? { kind: token.kind, parts: remaining } : undefined];
}

export async function layoutDocument(model: DocumentModel, services: LayoutServices, options: LayoutOptions = {}): Promise<DocumentLayout> {
  checkAbort(options.signal);
  const p = model.page;
  const values = [p.width, p.height, p.marginLeft, p.marginRight, p.marginTop, p.marginBottom];
  if (!values.every(Number.isFinite) || p.width <= 0 || p.height <= 0 || p.width > 14400 || p.height > 14400
    || values.slice(2).some((v) => v < 0) || p.width <= p.marginLeft + p.marginRight || p.height <= p.marginTop + p.marginBottom) {
    throw new RangeError('Invalid RTF paper size or margins.');
  }
  const maxPages = options.maxPages ?? 2000;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 2000) throw new RangeError('Invalid page limit.');
  const pages: { index: number; width: number; height: number; lines: LineLayout[] }[] = [];
  const diagnostics: Diagnostic[] = [];
  const reported = new Set<string>();
  const warn = (code: string, message: string) => {
    if (!reported.has(code)) { reported.add(code); diagnostics.push({ code, message, offset: 0 }); }
  };
  let page: (typeof pages)[number];
  let y = p.marginTop;
  const newPage = () => {
    if (pages.length >= maxPages) throw new RangeError('RTF page count exceeds the configured limit.');
    page = { index: pages.length, width: p.width, height: p.height, lines: [] };
    pages.push(page);
    y = p.marginTop;
  };
  newPage();
  const bottom = p.height - p.marginBottom;
  let lineCount = 0;
  for (let blockIndex = 0; blockIndex < model.blocks.length; blockIndex++) {
    if (blockIndex % 32 === 0) { await nextTask(); checkAbort(options.signal); }
    const block = model.blocks[blockIndex];
    if (block.kind === 'pageBreak') { newPage(); continue; }
    if (block.runs.some((run) => run.kind === 'text' && /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Thai}]/u.test(run.text))) warn('complex-script-layout', 'This script needs additional bidirectional or dictionary layout rules; rendering uses the initial horizontal layout.');
    const style = block.style;
    if (style.pageBreakBefore && (page!.lines.length > 0 || y > p.marginTop)) newPage();
    const paragraphLeft = p.marginLeft + style.leftIndent;
    const paragraphWidth = p.width - p.marginLeft - p.marginRight - style.leftIndent - style.rightIndent;
    if (![paragraphLeft, paragraphWidth, style.firstLineIndent, style.spaceBefore, style.spaceAfter, style.lineSpacing.kind === 'auto' ? 0 : style.lineSpacing.value].every(Number.isFinite)
      || paragraphWidth <= 0 || paragraphWidth - style.firstLineIndent <= 0) {
      throw new RangeError('Paragraph indents leave no usable line width.');
    }
    if (style.lineSpacing.kind !== 'auto' && style.lineSpacing.value <= 0) throw new RangeError('Invalid line spacing.');
    let before = Math.max(0, style.spaceBefore);
    if (y + before >= bottom && page!.lines.length > 0) { newPage(); before = 0; }
    y += before;
    const tokens = await tokenize(block, options.signal);
    const mark = services.measure('Mg', block.markStyle);
    let firstLine = true;
    let parts: Measured[] = [];
    let width = 0;
    let forcedEnding = false;
    const lineX = () => paragraphLeft + (firstLine ? style.firstLineIndent : 0);
    const available = () => paragraphWidth - (firstLine ? style.firstLineIndent : 0);
    const emit = (last: boolean, forced = false) => {
      // Spaces consumed at wrap boundaries have no ink and do not affect alignment.
      while (parts.at(-1)?.kind === 'text' && /^ +$/.test((parts.at(-1) as Extract<Measured, { kind: 'text' }>).part.text)) {
        width -= parts.pop()!.width;
      }
      let ascent = mark.ascent, descent = mark.descent;
      for (const part of parts) {
        const shift = part.kind === 'text' ? part.part.style.baseline : 0;
        ascent = Math.max(ascent, part.ascent + shift);
        descent = Math.max(descent, part.descent - shift);
      }
      const natural = Math.max(1, ascent + descent);
      let height = natural;
      const spacing = style.lineSpacing;
      if (spacing.kind === 'exact') height = Math.max(0.1, spacing.value);
      else if (spacing.kind === 'atLeast') height = Math.max(natural, spacing.value);
      else if (spacing.kind === 'multiple') height = Math.max(0.1, natural * spacing.value);
      if (y + height > bottom + 0.001 && page!.lines.length > 0) newPage();
      if (height > bottom - p.marginTop) warn('oversized-line', 'A line is taller than the page content area; it is placed once and may overflow.');
      if (width > available() + 0.001) warn('oversized-inline', 'An indivisible text cluster or inline image is wider than the paragraph.');
      let x = lineX();
      const slack = Math.max(0, available() - width);
      if (style.align === 'center') x += slack / 2;
      if (style.align === 'right') x += slack;
      const spaces = parts.filter((part) => part.kind === 'text' && /^ +$/.test(part.part.text));
      const extraSpace = style.align === 'justify' && !last && !forced && spaces.length > 0 ? slack / spaces.length : 0;
      const baseline = y + ascent + (height - natural) / 2;
      const fragments: Fragment[] = [];
      const startX = x;
      for (const part of parts) {
        if (part.kind === 'image') {
          fragments.push({ kind: 'image', imageId: part.id, x, y: baseline - part.ascent, width: part.width, height: part.ascent });
        } else {
          const textStyle = part.part.style;
          const spaceExtra = /^ +$/.test(part.part.text) ? extraSpace : 0;
          fragments.push({ kind: 'text', text: part.part.text, x, y, width: part.width + spaceExtra, height,
            baseline: baseline - textStyle.baseline, font: services.font(textStyle), fontSize: textStyle.fontSize,
            color: (textStyle.color === null ? null : model.colors[textStyle.color]) ?? '#000000', highlight: textStyle.highlight === null ? null : model.colors[textStyle.highlight] ?? null,
            underline: textStyle.underline, strike: textStyle.strike });
          x += spaceExtra;
        }
        x += part.width;
      }
      page!.lines.push({ x: startX, y, width: x - startX, height, paragraphIndex: blockIndex, fragments });
      y += height;
      firstLine = false;
      parts = [];
      width = 0;
      lineCount++;
    };
    for (let index = 0; index < tokens.length; index++) {
      if (lineCount > 0 && lineCount % 64 === 0) { await nextTask(); checkAbort(options.signal); }
      let token = tokens[index];
      if (token.kind === 'break') { emit(false, true); forcedEnding = true; continue; }
      forcedEnding = false;
      if (token.kind === 'tab') {
        const tab = model.defaultTab > 0 ? model.defaultTab : 36;
        const position = lineX() - p.marginLeft + width;
        let advance = tab - ((position % tab) + tab) % tab;
        if (width + advance > available() && parts.length > 0) { emit(false); advance = tab; }
        const tabStyle = block.markStyle;
        parts.push({ kind: 'text', part: { text: ' ', style: tabStyle }, width: advance, ascent: mark.ascent, descent: mark.descent });
        width += advance;
        continue;
      }
      let additions = measured(token, services);
      let additionWidth = totalWidth(additions);
      if (width + additionWidth > available() + 0.001 && parts.length > 0) {
        emit(false);
        if (token.kind === 'space') continue;
      }
      if (additionWidth > available() && (token.kind === 'text' || token.kind === 'space')) {
        const [head, tail] = splitText(token, available(), services);
        additions = measured(head, services);
        additionWidth = totalWidth(additions);
        if (tail) { tokens[index] = tail; index--; }
      }
      parts.push(...additions);
      width += additionWidth;
    }
    if (parts.length > 0 || firstLine || forcedEnding) emit(true);
    y += Math.max(0, style.spaceAfter);
  }
  checkAbort(options.signal);
  return { pages: pages as PageLayout[], diagnostics };
}
