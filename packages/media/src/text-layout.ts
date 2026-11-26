const words = new Intl.Segmenter('und', { granularity: 'word' });
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
const spaces = /^[\t ]+$/;
const closing = /^[\p{Pe}\p{Pf},.!?;:、。，！？；：…％%‰'"’”]+$/u;
const opening = /[\p{Ps}\p{Pi}'"‘“]$/u;
const nonBreaking = /[\u00a0\u202f\u2060]$/u;
const trimEnd = (value: string) => value.replace(/[\t ]+$/, '');
export const textFont = (size:number,family:string,bold=false) => `${bold?'bold ':''}${size}px "Microsoft YaHei", "Noto Sans CJK SC", ${family==='serif'?'serif':'sans-serif'}`;

function units(paragraph: string) {
  const result: string[] = [];
  for (const { segment } of words.segment(paragraph)) {
    const previous = result.at(-1);
    if (previous && !spaces.test(previous) && !spaces.test(segment)
      && (closing.test(segment) || opening.test(previous) || nonBreaking.test(previous)
        || nonBreaking.test(segment) || /[-‐‑]$/u.test(previous))) result[result.length - 1] += segment;
    else result.push(segment);
  }
  return result;
}

function splitLongUnit(value: string, width: number, measure: (value: string) => number) {
  const result: string[] = [];
  let line: string[] = [];
  for (const { segment } of graphemes.segment(value)) {
    if (line.length && measure(line.join('') + segment) > width) {
      const tail = line.at(-1)!;
      // Keep paired punctuation with a neighbouring glyph when the box can hold both.
      if (line.length > 1 && (closing.test(segment) || opening.test(tail)) && measure(tail + segment) <= width) {
        result.push(line.slice(0, -1).join(''));
        line = [tail, segment];
      } else {
        result.push(line.join(''));
        line = [segment];
      }
    } else line.push(segment);
  }
  if (line.length) result.push(line.join(''));
  return result;
}

/** Soft-wrap for drawing only; the stored script, subtitle text and timing are unchanged. */
export function wrapText(text: string, width: number, measure: (value: string) => number): string[] {
  if (!Number.isFinite(width) || width <= 0) return [];
  const result: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '', gap = '';
    for (const unit of units(paragraph)) {
      if (spaces.test(unit)) { if (line) gap += unit; else line += unit; continue; }
      const candidate = line + gap + unit;
      if (measure(candidate) <= width) { line = candidate; gap = ''; continue; }
      if (trimEnd(line)) result.push(trimEnd(line));
      gap = '';
      const pieces = measure(unit) <= width ? [unit] : splitLongUnit(unit, width, measure);
      line = pieces.pop() ?? '';
      result.push(...pieces);
    }
    result.push(trimEnd(line));
  }
  return result;
}
