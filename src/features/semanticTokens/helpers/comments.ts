import type { Segment, TokenizerState } from '../types';

export function computeCommentSegments(lineText: string, state: TokenizerState): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  while (cursor < lineText.length) {
    if (state.inBlockComment) {
      const endIdx = lineText.indexOf('*/', cursor);
      if (endIdx === -1) {
        segments.push({ start: cursor, end: lineText.length });
        cursor = lineText.length;
        break;
      } else {
        const segmentEnd = endIdx + 2;
        segments.push({ start: cursor, end: segmentEnd });
        cursor = segmentEnd;
        state.inBlockComment = false;
      }
    } else {
      const blockStart = lineText.indexOf('/*', cursor);
      const lineCommentIdx = findLineCommentOutsideStrings(lineText, cursor);

      if (lineCommentIdx !== -1 && (blockStart === -1 || lineCommentIdx < blockStart)) {
        break;
      }

      if (blockStart === -1) {
        break;
      }

      const blockEnd = lineText.indexOf('*/', blockStart + 2);
      if (blockEnd === -1) {
        segments.push({ start: blockStart, end: lineText.length });
        state.inBlockComment = true;
        cursor = lineText.length;
        break;
      } else {
        const segmentEnd = blockEnd + 2;
        segments.push({ start: blockStart, end: segmentEnd });
        cursor = segmentEnd;
      }
    }
  }

  // Line comment (//) outside block comments AND outside quoted strings.
  const lineCommentIdx = findLineCommentOutsideStrings(lineText);
  if (
    lineCommentIdx !== -1 &&
    !segments.some(segment => lineCommentIdx >= segment.start && lineCommentIdx < segment.end)
  ) {
    segments.push({ start: lineCommentIdx, end: lineText.length });
  }

  segments.sort((a, b) => a.start - b.start);
  return segments;
}

export function findLineCommentOutsideStrings(lineText: string, startIndex = 0): number {
  let inSingle = false;
  let inDouble = false;

  for (let i = startIndex; i < lineText.length - 1; i++) {
    const ch = lineText[i];
    const next = lineText[i + 1];

    // handle quote state (ignore escaped quotes)
    if (!inDouble && ch === "'" && lineText[i - 1] !== '\\') {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"' && lineText[i - 1] !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    // only recognize // when not inside quotes
    if (!inSingle && !inDouble && ch === '/' && next === '/') {
      return i;
    }
  }

  return -1;
}

export function findMatchingParenOutsideStrings(lineText: string, openIndex: number): number {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;

  for (let i = openIndex; i < lineText.length; i++) {
    const ch = lineText[i];

    // quote toggles (ignore escaped quotes)
    if (!inDouble && ch === "'" && lineText[i - 1] !== '\\') {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"' && lineText[i - 1] !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle || inDouble) continue;

    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}
